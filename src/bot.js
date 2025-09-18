import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { analyzeToken } from "./analyzer.js";

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ BOT_TOKEN missing in environment!");
  process.exit(1);
}

// Create polling bot
console.log("🚀 Starting BESC Token Scanner bot...");
const bot = new TelegramBot(token, { polling: true });

bot.on("polling_error", (err) => console.error("⚠️ Polling error:", err.message));

// Welcome message for /start
bot.onText(/\/start/, (msg) => {
  console.log(`✅ /start from ${msg.chat.id}`);
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to BESC Token Scanner!\n\nSend me a token contract address and I will:\n" +
      "• Fetch supply & decimals\n" +
      "• Show top holders (from BlockScout)\n" +
      "• Check LP status (burn/lock %)\n" +
      "• Detect dev sells in last 24h\n" +
      "• Show buy/sell tax if available"
  );
});

// Handle all other messages
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return; // ignore commands except /start
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  try {
    console.log(`🔎 Analyzing ${text}`);
    await bot.sendMessage(chatId, "⏳ Analyzing token...");
    const result = await analyzeToken(text);
    await bot.sendMessage(chatId, result, { parse_mode: "HTML" });
  } catch (err) {
    console.error("❌ Analysis failed:", err);
    await bot.sendMessage(chatId, "⚠️ Error analyzing token. Check Railway logs.");
  }
});
