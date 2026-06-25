const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const { db } = require('./database');
const { sendTelegramNotification, sendTelegramDocument } = require('./bot');
const { buildSummaryData, generateSummaryPDF } = require('./reports');

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
  // Use Dushanbe local time (UTC+5) since deadlines are stored in local time
  const TZ_OFFSET = 5;
  const nowLocal  = new Date(Date.now() + TZ_OFFSET*3600000);
  const in24h     = new Date(nowLocal.getTime() + 24*3600000);
  const in1h      = new Date(nowLocal.getTime() + 3600000);
  const toLocal   = d => d.toISOString().slice(0,19); // keep 'T' to match deadline format

  // За 24 часа
  const tasks24 = getTasksWithDeadline(toLocal(nowLocal), toLocal(in24h), 'deadline_24h', 25);
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
  const tasks1 = getTasksWithDeadline(toLocal(nowLocal), toLocal(in1h), 'deadline_1h', 2);
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
    const date = new Date(Date.now() + 5*3600000).toISOString().slice(0, 10);
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

function copyRecurringFinance() {
  const TZ_OFFSET = 5;
  const nowLocal  = new Date(Date.now() + TZ_OFFSET*3600000);
  const thisMonth = nowLocal.toISOString().slice(0,7);
  const prevDate  = new Date(nowLocal.getFullYear(), nowLocal.getMonth()-1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
  const recurring = db.prepare('SELECT * FROM finance WHERE is_recurring=1 AND month=?').all(prevMonth);
  recurring.forEach(r => {
    const exists = db.prepare('SELECT id FROM finance WHERE project_name=? AND month=? AND is_recurring=1').get(r.project_name, thisMonth);
    if (!exists) {
      db.prepare(`INSERT INTO finance (project_id,project_name,service_amount,paid_amount,status,payment_type,comment,month,currency,client_name,client_phone,is_recurring)
        VALUES (?,?,?,0,'unpaid',?,?,?,?,?,?,1)`)
        .run(r.project_id, r.project_name, r.service_amount, r.payment_type, r.comment, thisMonth, r.currency||'TJS', r.client_name||'', r.client_phone||'');
    }
  });
  if (recurring.length) console.log(`[Финансы] Скопировано повторяющихся записей: ${recurring.length} → ${thisMonth}`);
}

function checkFinanceOverdue() {
  // Use Dushanbe local time for 7-day boundary
  const cutoffLocal = new Date(Date.now() + 5*3600000 - 7*24*3600000)
    .toISOString().slice(0,19).replace('T',' ');
  const overdue = db.prepare(`
    SELECT f.*, u.telegram_id FROM finance f
    JOIN users u ON u.role='admin'
    WHERE f.status IN ('unpaid','partial')
      AND f.overdue_notified = 0
      AND f.updated_at < ?
    LIMIT 10
  `).all(cutoffLocal);
  overdue.forEach(f => {
    const msg = `💰 *Задолженность*\n\nПроект: *${f.project_name}*\nОстаток: *${(f.service_amount - f.paid_amount).toLocaleString()} ${f.currency||'TJS'}*\nМесяц: ${f.month}\n\nСтатус: ${f.status === 'partial' ? 'Частично оплачено' : 'Не оплачено'}`;
    if (f.telegram_id) sendTelegramNotification(f.telegram_id, msg);
    db.prepare('UPDATE finance SET overdue_notified=1 WHERE id=?').run(f.id);
  });
  if (overdue.length) console.log(`[Финансы] Отправлено напоминаний о задолженности: ${overdue.length}`);
}

async function sendDailyReport() {
  try {
    const admins = db.prepare(
      "SELECT telegram_id FROM users WHERE role = 'admin' AND telegram_id IS NOT NULL AND telegram_id != ''"
    ).all();
    if (!admins.length) return;

    const data  = buildSummaryData(1);
    const buf   = await generateSummaryPDF(data);
    const today = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
    const fname = `daily-report-${today}.pdf`;
    const g     = data.global;
    const eff   = g.total > 0 ? Math.round(g.done / g.total * 100) : 0;
    const caption = `📊 *Ежедневный отчёт MindsBar*\n${today}\n\nВсего задач: *${g.total}* | Выполнено: *${g.done}* (${eff}%) | Просрочено: *${g.overdue}*`;

    admins.forEach(a => sendTelegramDocument(a.telegram_id, buf, fname, caption));
    console.log(`[Отчёт] Ежедневный PDF отправлен ${admins.length} администратору(ам)`);
  } catch (err) {
    console.error('[Отчёт] Ошибка генерации PDF:', err.message);
  }
}

function startScheduler(sseClients) {
  setSseClients(sseClients);
  cron.schedule('*/30 * * * *', checkDeadlines);
  cron.schedule('0 2 * * *', backupDB);               // 02:00 UTC
  cron.schedule('0 9 * * 1', checkFinanceOverdue);    // Пн 09:00 UTC
  cron.schedule('0 8 1 * *', copyRecurringFinance);   // 1-е числа 08:00 UTC
  cron.schedule('0 15 * * *', sendDailyReport);       // 20:00 Душанбе (UTC+5 = 15:00 UTC)
  console.log('⏰ Планировщик запущен (проверка каждые 30 минут)');
}

module.exports = { startScheduler };
