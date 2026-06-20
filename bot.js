require('dotenv').config();
const { db } = require('./database');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

if (BOT_TOKEN) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(BOT_TOKEN, { polling: true });

    bot.onText(/\/start(.*)/, (msg, match) => {
      const chatId = msg.chat.id;
      const token = match[1]?.trim().toUpperCase();

      if (token) {
        const user = db.prepare('SELECT * FROM users WHERE telegram_token = ?').get(token);
        if (user) {
          db.prepare('UPDATE users SET telegram_id = ?, telegram_token = NULL WHERE id = ?')
            .run(String(chatId), user.id);
          bot.sendMessage(chatId,
            `✅ *Аккаунт привязан!*\n\nПривет, ${user.name}\\! Теперь вы будете получать уведомления о задачах здесь\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        } else {
          bot.sendMessage(chatId, '❌ Неверный код. Попробуйте снова в разделе Настройки платформы.');
        }
      } else {
        bot.sendMessage(chatId,
          '👋 *TeamTask Bot*\n\nДля подключения зайдите в Настройки платформы и нажмите "Подключить Telegram".',
          { parse_mode: 'Markdown' }
        );
      }
    });

    console.log('🤖 Telegram бот запущен');
  } catch (e) {
    console.log('⚠️  Ошибка запуска Telegram бота:', e.message);
  }
} else {
  console.log('ℹ️  TELEGRAM_BOT_TOKEN не задан — бот отключён');
}

function sendTelegramNotification(telegramId, message) {
  if (!bot || !telegramId) return;
  bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' }).catch(err => {
    console.error('Ошибка Telegram:', err.message);
  });
}

module.exports = { sendTelegramNotification };
