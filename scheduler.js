const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const { db } = require('./database');
const { sendTelegramNotification } = require('./bot');

let sseClientsRef = null;

function setSseClients(clients) {
  sseClientsRef = clients;
}

function sendSSE(userId, data) {
  if (!sseClientsRef) return;
  const clients = sseClientsRef.get(userId) || [];
  clients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

// Returns all (task, user) pairs for tasks with deadline in [fromISO, toISO].
// Handles both date-only deadlines ("2026-06-21") and datetime deadlines.
// Covers both legacy single-assignee and multi-assignee (task_assignees) tasks.
function getTasksWithDeadline(fromISO, toISO, notifType, cooldownHours) {
  const fromDate = fromISO.slice(0, 10);
  const toDate = toISO.slice(0, 10);

  // Single-assignee tasks (no task_assignees rows)
  const single = db.prepare(`
    SELECT t.id, t.title, t.deadline, u.id as uid, u.telegram_id
    FROM tasks t
    JOIN users u ON u.id = t.assignee_id
    WHERE t.status != 'done'
      AND (
        (length(t.deadline) > 10 AND t.deadline BETWEEN ? AND ?)
        OR (length(t.deadline) <= 10 AND t.deadline BETWEEN ? AND ?)
      )
      AND NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = t.id)
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.task_id = t.id AND n.user_id = u.id AND n.type = ?
          AND n.created_at > datetime('now', '-${cooldownHours} hours')
      )
  `).all(fromISO, toISO, fromDate, toDate, notifType);

  // Multi-assignee tasks — notify each assignee who hasn't done their part
  const multi = db.prepare(`
    SELECT t.id, t.title, t.deadline, u.id as uid, u.telegram_id
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id AND ta.done = 0
    JOIN users u ON u.id = ta.user_id
    WHERE t.status != 'done'
      AND (
        (length(t.deadline) > 10 AND t.deadline BETWEEN ? AND ?)
        OR (length(t.deadline) <= 10 AND t.deadline BETWEEN ? AND ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.task_id = t.id AND n.user_id = u.id AND n.type = ?
          AND n.created_at > datetime('now', '-${cooldownHours} hours')
      )
  `).all(fromISO, toISO, fromDate, toDate, notifType);

  return [...single, ...multi];
}

function checkDeadlines() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in1h  = new Date(now.getTime() + 60 * 60 * 1000);

  // За 24 часа
  const tasks24 = getTasksWithDeadline(now.toISOString(), in24h.toISOString(), 'deadline_24h', 25);
  tasks24.forEach(task => {
    const msg = `⏰ Через 24 часа истекает дедлайн: «${task.title}»`;
    db.prepare(`INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'deadline_24h', ?)`)
      .run(task.uid, task.id, msg);
    sendSSE(task.uid, { type: 'notification', message: msg });
    if (task.telegram_id) {
      const dl = new Date(task.deadline).toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
      sendTelegramNotification(task.telegram_id,
        `⏰ *Истекает срок задачи*\n\n*${task.title}*\n\n📅 *Дедлайн:* ${dl}\n⚠️ Осталось менее 24 часов`);
    }
  });

  // За 1 час
  const tasks1 = getTasksWithDeadline(now.toISOString(), in1h.toISOString(), 'deadline_1h', 2);
  tasks1.forEach(task => {
    const msg = `🔴 Через 1 час истекает дедлайн: «${task.title}»`;
    db.prepare(`INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'deadline_1h', ?)`)
      .run(task.uid, task.id, msg);
    sendSSE(task.uid, { type: 'notification', message: msg });
    if (task.telegram_id) {
      const dl = new Date(task.deadline).toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
      sendTelegramNotification(task.telegram_id,
        `🔴 *СРОЧНО! Истекает срок задачи*\n\n*${task.title}*\n\n📅 *Дедлайн:* ${dl}\n⚠️ Осталось менее 1 часа`);
    }
  });

  if (tasks24.length || tasks1.length) {
    console.log(`[Планировщик] Отправлено напоминаний: 24ч=${tasks24.length}, 1ч=${tasks1.length}`);
  }
}

function backupDB() {
  const src = process.env.DB_PATH || path.join(__dirname, 'teamtask.db');
  const backupDir = path.join(__dirname, 'backups');
  try {
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    const date = new Date().toISOString().slice(0, 10);
    const dst  = path.join(backupDir, `teamtask_${date}.db`);
    fs.copyFileSync(src, dst);
    console.log(`✅ Резервная копия БД: backups/teamtask_${date}.db`);
    // Keep last 7 backups
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('teamtask_') && f.endsWith('.db'))
      .sort();
    files.slice(0, Math.max(0, files.length - 7)).forEach(f => {
      fs.unlinkSync(path.join(backupDir, f));
    });
  } catch (e) {
    console.error('❌ Ошибка резервного копирования:', e.message);
  }
}

function startScheduler(sseClients) {
  setSseClients(sseClients);
  cron.schedule('*/30 * * * *', checkDeadlines);
  cron.schedule('0 2 * * *', backupDB);   // ежедневно в 02:00
  console.log('⏰ Планировщик запущен (проверка каждые 30 минут)');
}

module.exports = { startScheduler };
