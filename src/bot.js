import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import Bottleneck from "bottleneck";
import fs from "fs";
import { ethers } from "ethers";
import { analyzeToken } from "./analyzer.js";

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ BOT_TOKEN missing!");
  process.exit(1);
}

const log = (msg, data) => fs.appendFileSync("bot.log", `${new Date().toISOString()} - ${msg} ${JSON.stringify(data)}\n`);

const bot = new TelegramBot(token, { polling: true });

// Clear Telegram queue on startup
bot.getUpdates({ offset: -1 }).then(updates => {
  if (updates.length) {
    bot.getUpdates({ offset: updates[updates.length - 1].update_id + 1 });
    log("Cleared queue", {});
  }
}).catch(err => log("Queue clear failed", { error: err.message }));

// Rate limiters
const globalLimiter = new Bottleneck({ maxConcurrent: 3, minTime: 2000 });
const userLimiters = new Map();

// Polling error handling
bot.on("polling_error", err => {
  log("Polling error", { error: err.message });
  if (err.message.includes("ETELEGRAM")) {
    bot.stopPolling();
    setTimeout(() => bot.startPolling(), 30000);
  }
});

// Handle /start
bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id;
  log("Received /start", { chatId });
  bot.sendMessage(chatId, "👋 BESC Token Scanner\nSend a token address to analyze (1 per 10s).");
});

// Handle token addresses
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  log("Received message", { chatId, text });

  if (!ethers.isAddress(text)) {
    log("Invalid address", { text });
    return bot.sendMessage(chatId, "⚠️ Invalid address.");
  }

  if (!userLimiters.has(chatId)) {
    userLimiters.set(chatId, new Bottleneck({ reservoir: 1, reservoirRefreshAmount: 1, reservoirRefreshInterval: 10000 }));
  }

  try {
    await globalLimiter.schedule(() =>
      userLimiters.get(chatId).schedule(async () => {
        log("Analyzing", { text, chatId });
        await bot.sendMessage(chatId, "⏳ Analyzing...");
        const result = await analyzeToken(text);
        await bot.sendMessage(chatId, result, { parse_mode: "HTML" });
      })
    );
  } catch (err) {
    log("Analysis failed", { text, chatId, error: err.message });
    await bot.sendMessage(chatId, err.message.includes("Too Many") ? "⚠️ Slow down! Try in 10s." : "⚠️ Error analyzing token.");
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  log("Shutting down", {});
  bot.stopPolling();
  process.exit(0);
});

// Delay startup
setTimeout(() => bot.startPolling(), 5000);
