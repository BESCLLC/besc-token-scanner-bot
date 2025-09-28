import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import Bottleneck from "bottleneck";
import fs from "fs";
import { ethers } from "ethers";
import express from "express";
import { analyzeToken } from "./analyzer.js";

dotenv.config();

// Validate BOT_TOKEN
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ BOT_TOKEN missing in environment!");
  process.exit(1);
}

// Structured logging to file
const log = (message, data) => {
  fs.appendFileSync('bot.log', `${new Date().toISOString()} - ${message} ${JSON.stringify(data)}\n`);
};

// Initialize bot
console.log("🚀 Starting BESC Token Scanner bot...");
const bot = new TelegramBot(token, { polling: true });

// Clear Telegram message queue on startup to prevent flood
bot.getUpdates({ offset: -1 }).then(updates => {
  if (updates.length > 0) {
    const lastUpdateId = updates[updates.length - 1].update_id;
    bot.getUpdates({ offset: lastUpdateId + 1 }); // Clear queue
    log("Cleared Telegram message queue", {});
  }
}).catch(err => log("Failed to clear queue", { error: err.message }));

// Rate limiters
const globalLimiter = new Bottleneck({
  maxConcurrent: 3, // Max 3 concurrent analyses
  minTime: 2000 // 2 seconds between analyses
});

const userLimiters = new Map(); // Per-user rate limiting

// Handle polling errors
bot.on("polling_error", (err) => {
  log("Polling error", { error: err.message });
  if (err.message.includes("ETELEGRAM")) {
    log("Pausing polling for 30 seconds due to Telegram API error", {});
    bot.stopPolling();
    setTimeout(() => {
      log("Resuming polling", {});
      bot.startPolling();
    }, 30000);
  }
});

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  log("Received /start", { chatId });
  bot.sendMessage(
    chatId,
    "👋 Welcome to BESC Token Scanner!\n\nSend me a token contract address and I will:\n" +
      "• Fetch supply & decimals\n" +
      "• Show top holders (from BlockScout)\n" +
      "• Check LP status (burn/lock %)\n" +
      "• Detect dev sells in last 24h\n" +
      "• Show buy/sell tax if available\n\n" +
      "⚠️ Please send one address at a time (max 1 per 10 seconds)."
  );
});

// Handle token address messages
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  log("Received message", { chatId, text });

  // Validate address
  if (!ethers.isAddress(text)) {
    log("Invalid address", { text });
    await bot.sendMessage(chatId, "⚠️ Invalid contract address. Please provide a valid Ethereum address.");
    return;
  }

  // Per-user limiter: 1 request every 10 seconds
  if (!userLimiters.has(chatId)) {
    userLimiters.set(chatId, new Bottleneck({
      reservoir: 1,
      reservoirRefreshAmount: 1,
      reservoirRefreshInterval: 10 * 1000 // 10 seconds
    }));
  }

  try {
    await globalLimiter.schedule(() =>
      userLimiters.get(chatId).schedule(async () => {
        log("Starting analysis", { text, chatId });
        await bot.sendMessage(chatId, "⏳ Analyzing token...");
        const result = await analyzeToken(text);
        await bot.sendMessage(chatId, result, { parse_mode: "HTML" });
        log("Analysis complete", { text, chatId });
      })
    );
  } catch (err) {
    log("Analysis failed", { text, chatId, error: err.message });
    if (err.message.includes("Too Many Requests")) {
      await bot.sendMessage(chatId, "⚠️ Rate limit reached. Please wait 10 seconds and try again.");
    } else {
      await bot.sendMessage(chatId, "⚠️ Error analyzing token. Please try again later.");
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  log("Received SIGTERM, shutting down", {});
  bot.stopPolling();
  log("Stopped Telegram polling", {});
  process.exit(0);
});

process.on('SIGINT', async () => {
  log("Received SIGINT, shutting down", {});
  bot.stopPolling();
  log("Stopped Telegram polling", {});
  process.exit(0);
});

// Delay startup to stabilize
setTimeout(() => {
  log("Starting bot polling", {});
  bot.startPolling();
}, 5000); // 5-second delay

// Health check for Railway
const app = express();
app.get('/health', (req, res) => {
  log("Health check requested", {});
  res.status(200).send('OK');
});
app.listen(process.env.PORT || 3000, () => {
  log("Health check server running", { port: process.env.PORT || 3000 });
});
