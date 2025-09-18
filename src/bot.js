import TelegramBot from 'node-telegram-bot-api';
import { analyzeToken } from './analyzer.js';

export function startBot() {
  const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "👋 Send me a token address to analyze. Works here or in any group chat.");
  });

  bot.on("message", async (msg) => {
    const text = msg.text?.trim();
    if (!text || text.startsWith("/")) return;

    await bot.sendChatAction(msg.chat.id, "typing");

    try {
      const result = await analyzeToken(text);
      bot.sendMessage(msg.chat.id, result, { parse_mode: "HTML" });
    } catch (e) {
      console.error("Analysis error:", e);
      bot.sendMessage(msg.chat.id, "⚠️ Could not analyze this token. Double-check the address.");
    }
  });

  console.log("✅ Bot running and listening for messages...");
}
