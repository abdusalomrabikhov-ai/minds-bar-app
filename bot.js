require('dotenv').config();
const { db } = require('./database');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

// Webhook URL
const PUBLIC_DOMAIN =
  process.env.RAILWAY_PUBLIC_DOMAIN ||
  process.env.APP_DOMAIN ||
  (process.env.NODE_ENV === 'production' ? 'minds-bar-app-production.up.railway.app' : null);
const WEBHOOK_PATH = '/api/telegram/webhook';
const WEBHOOK_URL  = PUBLIC_DOMAIN ? `https://${PUBLIC_DOMAIN}${WEBHOOK_PATH}` : null;

if (BOT_TOKEN && process.env.NODE_ENV === 'production') {
  try {
    const TelegramBot = require('node-telegram-bot-api');

    if (WEBHOOK_URL) {
      // Webhook mode — no polling, no 409 conflicts on redeploy
      bot = new TelegramBot(BOT_TOKEN, { webHook: false });
      bot.setWebHook(WEBHOOK_URL)
        .then(() => console.log('🤖 Telegram бот запущен (webhook):', WEBHOOK_URL))
        .catch(e => console.error('⚠️  Webhook error:', e.message));
    } else {
      // Fallback to polling if no public domain is set
      bot = new TelegramBot(BOT_TOKEN, { polling: true });
      console.log('🤖 Telegram бот запущен (polling)');
    }

    bot.onText(/\/start(.*)/, (msg, match) => {
      const chatId = msg.chat.id;
      const token  = match[1]?.trim().toUpperCase();

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

  } catch (e) {
    console.log('⚠️  Ошибка запуска Telegram бота:', e.message);
  }
} else {
  console.log('ℹ️  Telegram бот отключён локально (работает только на сервере)');
}

function sendTelegramNotification(telegramId, message) {
  if (!bot || !telegramId) return;
  bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' }).catch(err => {
    console.error('Ошибка Telegram:', err.message);
  });
}

function sendTelegramDocument(telegramId, buffer, filename, caption) {
  if (!bot || !telegramId) return;
  bot.sendDocument(
    telegramId,
    buffer,
    { caption: caption || '📊 Отчёт MindsBar' },
    { filename: filename || 'report.pdf', contentType: 'application/pdf' }
  ).catch(err => console.error('Telegram document error:', err.message));
}

function processWebhookUpdate(update) {
  bot?.processUpdate(update);
}

module.exports = { sendTelegramNotification, sendTelegramDocument, processWebhookUpdate, WEBHOOK_PATH };
