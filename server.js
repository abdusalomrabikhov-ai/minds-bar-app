require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { google } = require('googleapis');
const { db, initDB } = require('./database');
const { sendTelegramNotification, processWebhookUpdate, WEBHOOK_PATH } = require('./bot');
const { startScheduler } = require('./scheduler');
const webpush = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:abdusalomrabikhov@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ─── Google OAuth2 client ─────────────────────────────────────────────────────
const GOOGLE_REDIRECT = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT
  );
}

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set in .env — using insecure default. Set a random 256-bit secret in production.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'teamtask-secret-key-change-me';

// Timezone helpers — Dushanbe is UTC+5
const TZ_OFFSET = 5;
const localNow    = () => new Date(Date.now() + TZ_OFFSET*3600000).toISOString().slice(0,19).replace('T',' '); // for DB storage
const localNowT   = () => new Date(Date.now() + TZ_OFFSET*3600000).toISOString().slice(0,19);                  // for deadline comparison (T separator)
const localToday  = () => new Date(Date.now() + TZ_OFFSET*3600000).toISOString().slice(0,10);
const localMonth  = () => new Date(Date.now() + TZ_OFFSET*3600000).toISOString().slice(0,7);

// SSE clients: Map<userId, res[]>
const sseClients = new Map();

function sendSSE(userId, data) {
  const clients = sseClients.get(userId) || [];
  clients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

function sendSSEAll(data) {
  sseClients.forEach(clients => clients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`)));
}
function updateReviewBadgeSSE() {
  // Notify all admins to refresh their review badge
  db.prepare("SELECT id FROM users WHERE role = 'admin'").all().forEach(a => {
    sendSSE(a.id, { type: 'review_badge_update' });
  });
}

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Middleware ───────────────────────────────────────────────────────────────

const lastSeenMap = new Map();
function logActivity(userId, action, entityType = null, entityId = null, entityTitle = null, detail = null) {
  try {
    db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, entity_title, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, action, entityType, entityId, entityTitle, detail);
  } catch {}
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const row = db.prepare('SELECT role, permissions FROM users WHERE id = ?').get(decoded.id);
    if (!row) return res.status(401).json({ error: 'Пользователь не найден' });
    req.user = { ...decoded, role: row.role, permissions: row.permissions || '{}' };
    // Throttled last_seen — update at most once per minute per user
    const now = Date.now();
    if (!lastSeenMap.get(decoded.id) || now - lastSeenMap.get(decoded.id) > 60000) {
      db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(decoded.id);
      lastSeenMap.set(decoded.id, now);
    }
    next();
  } catch {
    res.status(401).json({ error: 'Токен недействителен' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  next();
}

function parsePerms(raw) {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function can(req, perm) {
  if (req.user.role === 'admin') return true;
  return parsePerms(req.user.permissions)[perm] === true;
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!can(req, perm)) return res.status(403).json({ error: 'Нет доступа к этому разделу' });
    next();
  };
}

// ─── Telegram Webhook ─────────────────────────────────────────────────────────
app.post(WEBHOOK_PATH, (req, res) => {
  processWebhookUpdate(req.body);
  res.sendStatus(200);
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
});

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
  logActivity(user.id, 'login');
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email, avatar_color: user.avatar_color, permissions: parsePerms(user.permissions) } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, avatar_color, avatar_img, telegram_id, permissions FROM users WHERE id = ?').get(req.user.id);
  res.json({ ...user, permissions: parsePerms(user.permissions) });
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
});

app.post('/api/auth/reset-request', resetLimiter, (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email обязателен' });
  const user = db.prepare('SELECT id, telegram_id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !user.telegram_id) {
    // Don't reveal whether user exists; just say no Telegram
    return res.status(400).json({ error: 'Telegram не привязан к этому аккаунту. Обратитесь к администратору.' });
  }
  const code = String(crypto.randomInt(100000, 999999));
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET reset_code = ?, reset_code_expires = ? WHERE id = ?').run(code, expires, user.id);
  sendTelegramNotification(user.telegram_id, `🔐 Ваш код для сброса пароля: *${code}*\n\nКод действителен 15 минут. Никому не передавайте его.`);
  res.json({ ok: true });
});

app.post('/api/auth/reset-confirm', resetLimiter, (req, res) => {
  const { email, code, password } = req.body;
  if (!email || !code || !password) return res.status(400).json({ error: 'Все поля обязательны' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const user = db.prepare('SELECT id, reset_code, reset_code_expires FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !user.reset_code) return res.status(400).json({ error: 'Код недействителен' });
  if (user.reset_code !== String(code).trim()) return res.status(400).json({ error: 'Неверный код' });
  if (new Date(user.reset_code_expires) < new Date()) return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ?, reset_code = NULL, reset_code_expires = NULL WHERE id = ?').run(hashed, user.id);
  res.json({ ok: true });
});

// ─── Projects ─────────────────────────────────────────────────────────────────

app.get('/api/projects', auth, (req, res) => {
  const showArchived = req.query.archived === '1';
  const projects = db.prepare(`
    SELECT p.*,
      COUNT(t.id) as task_count,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_count
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE p.archived = ${showArchived ? 1 : 0}
    GROUP BY p.id
    ORDER BY p.name
  `).all();
  res.json(projects);
});

app.put('/api/projects/:id/archive', auth, requirePerm('manage_projects'), (req, res) => {
  const { archived } = req.body;
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE projects SET archived = ? WHERE id = ?').run(archived ? 1 : 0, req.params.id);
  sendSSEAll({ type: archived ? 'project_deleted' : 'project_created', id: parseInt(req.params.id) });
  logActivity(req.user.id, archived ? 'project_archived' : 'project_unarchived', 'project', parseInt(req.params.id), proj?.name);
  res.json({ ok: true });
});

app.post('/api/projects', auth, requirePerm('manage_projects'), (req, res) => {
  const { name, color, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
  const result = db.prepare('INSERT INTO projects (name, color, description) VALUES (?, ?, ?)')
    .run(name.trim(), color || '#6366f1', description || '');
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  sendSSEAll({ type: 'project_created', project });
  logActivity(req.user.id, 'project_created', 'project', project.id, project.name);
  res.json(project);
});

app.put('/api/projects/:id', auth, requirePerm('manage_projects'), (req, res) => {
  const { name, color, description } = req.body;
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Проект не найден' });
  db.prepare('UPDATE projects SET name = ?, color = ?, description = ? WHERE id = ?')
    .run(name || existing.name, color || existing.color, description ?? existing.description, req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  sendSSEAll({ type: 'project_updated', project });
  logActivity(req.user.id, 'project_updated', 'project', project.id, project.name);
  res.json(project);
});

app.delete('/api/projects/:id', auth, requirePerm('manage_projects'), (req, res) => {
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(req.params.id);
  // Notify assigned employees before cascade-deletion so they know why tasks disappeared
  const affectedUsers = db.prepare(`
    SELECT DISTINCT ta.user_id FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id WHERE t.project_id = ?
  `).all(req.params.id);
  db.prepare('DELETE FROM notifications WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM tasks WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  sendSSEAll({ type: 'project_deleted', id: parseInt(req.params.id) });
  affectedUsers.forEach(({ user_id }) => {
    if (user_id !== req.user.id) {
      sendSSE(user_id, { type: 'project_deleted_notify', message: `Проект «${proj?.name}» был удалён, связанные задачи удалены` });
    }
  });
  logActivity(req.user.id, 'project_deleted', 'project', parseInt(req.params.id), proj?.name);
  res.json({ ok: true });
});

// ─── Telegram helpers ─────────────────────────────────────────────────────────

function sendTelegramNewTask(telegramId, task) {
  const dl = task.deadline
    ? `\n📅 *Дедлайн:* ${new Date(task.deadline).toLocaleString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}`
    : '';
  const proj = task.project_name ? `\n📁 *Проект:* ${task.project_name}` : '';
  const prio = { low: '🟢 Низкий', medium: '🟡 Средний', high: '🔴 Высокий' }[task.priority] || task.priority;
  const desc = task.description ? `\n\n${task.description}` : '';
  sendTelegramNotification(telegramId,
    `📋 *Свежак, ещё тёплый. Веселее*\n\n*${task.title}*${desc}${proj}\n⚡ *Приоритет:* ${prio}${dl}`
  );
}

// ─── Content Plan ─────────────────────────────────────────────────────────────

function cpLabel(type) {
  return { post: 'ПОСТ', reel: 'РИЛС', story: 'СТОРИС' }[type] || type.toUpperCase();
}

function getContentTypeMembers(projectId, type) {
  const anyConfig = db.prepare('SELECT 1 FROM content_type_assignees WHERE project_id = ?').get(projectId);
  if (!anyConfig) {
    return db.prepare('SELECT user_id FROM project_members WHERE project_id = ?').all(projectId);
  }
  return db.prepare('SELECT user_id FROM content_type_assignees WHERE project_id = ? AND content_type = ?').all(projectId, type);
}

function syncTasksForItem(item, projectId, createdBy) {
  const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
  const members = getContentTypeMembers(projectId, item.type);
  const label = cpLabel(item.type);
  const title = item.title ? `${label}: ${item.title}` : label;
  const desc = `Контент-план · ${project?.name || ''}`;

  if (!members.length) {
    db.prepare('DELETE FROM tasks WHERE source_content_id = ?').run(item.id);
    return;
  }

  // Find ALL tasks for this content item (old code may have created one per member)
  const allTasks = db.prepare('SELECT id FROM tasks WHERE source_content_id = ?').all(item.id);

  let taskId;
  if (allTasks.length === 0) {
    const r = db.prepare(`INSERT INTO tasks (title,description,project_id,assignee_id,created_by,status,priority,deadline,source_content_id) VALUES (?,?,?,?,?,'new','medium',?,?)`)
      .run(title, desc, projectId, members[0].user_id, createdBy || 1, item.date, item.id);
    taskId = r.lastInsertRowid;
  } else {
    taskId = allTasks[0].id;
    // Consolidate: delete any duplicate tasks created by old per-member logic
    for (let i = 1; i < allTasks.length; i++) {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(allTasks[i].id);
    }
    db.prepare('UPDATE tasks SET title=?, deadline=? WHERE id=?').run(title, item.date, taskId);
  }

  // Sync task_assignees to match current project members; track who is newly added
  const existingAssignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(taskId).map(r => r.user_id);
  members.forEach(m => {
    db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(taskId, m.user_id);
  });
  const memberIds = members.map(m => m.user_id);
  const ph = memberIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM task_assignees WHERE task_id = ? AND user_id NOT IN (${ph})`).run(taskId, ...memberIds);

  // Send Telegram only to newly added assignees
  const newMembers = members.filter(m => !existingAssignees.includes(m.user_id));
  if (newMembers.length > 0) {
    const fullTask = enrichTasksWithAssignees(getTaskQuery(' AND t.id = ?', [taskId]))[0];
    if (fullTask) {
      newMembers.forEach(m => {
        const u = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(m.user_id);
        if (u?.telegram_id) sendTelegramNewTask(u.telegram_id, fullTask);
      });
    }
  }
}

function syncTasksForMember(projectId, userId, createdBy) {
  // Re-sync all content items — consolidates duplicates and adds new member to each task
  const items = db.prepare('SELECT * FROM content_plan WHERE project_id = ?').all(projectId);
  items.forEach(item => syncTasksForItem(item, projectId, createdBy));
}

app.get('/api/projects/:id/content', auth, (req, res) => {
  const items = db.prepare('SELECT * FROM content_plan WHERE project_id = ? ORDER BY date, type').all(req.params.id);
  res.json(items);
});

// ─── Project Members ──────────────────────────────────────────────────────────

app.get('/api/projects/:id/members', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.avatar_color, u.avatar_img, u.role
    FROM project_members pm JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ? ORDER BY u.name
  `).all(req.params.id);
  res.json(rows);
});

app.post('/api/projects/:id/members', auth, requirePerm('manage_projects'), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Нет user_id' });
  const already = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?').get(req.params.id, user_id);
  if (!already) {
    db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)').run(req.params.id, user_id);
    syncTasksForMember(req.params.id, user_id, req.user.id);
  }
  res.json({ ok: true });
});

app.delete('/api/projects/:id/members/:userId', auth, requirePerm('manage_projects'), (req, res) => {
  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  db.prepare('DELETE FROM content_type_assignees WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  // Remove user from assignees on all content tasks in this project
  db.prepare(`DELETE FROM task_assignees WHERE user_id = ? AND task_id IN (
    SELECT id FROM tasks WHERE project_id = ? AND source_content_id IS NOT NULL
  )`).run(req.params.userId, req.params.id);
  // Delete tasks that now have no remaining assignees
  db.prepare(`DELETE FROM tasks WHERE project_id = ? AND source_content_id IS NOT NULL
    AND id NOT IN (SELECT DISTINCT task_id FROM task_assignees)`).run(req.params.id);
  res.json({ ok: true });
});

// ─── Content-type assignees (per post/reel/story subsets) ────────────────────

app.get('/api/projects/:id/content-assignees', auth, (req, res) => {
  const rows = db.prepare('SELECT user_id, content_type FROM content_type_assignees WHERE project_id = ?').all(req.params.id);
  const result = { post: [], reel: [], story: [] };
  rows.forEach(r => { if (result[r.content_type]) result[r.content_type].push(r.user_id); });
  res.json(result);
});

app.put('/api/projects/:id/content-assignees/:type', auth, requirePerm('manage_projects'), (req, res) => {
  const { type } = req.params;
  if (!['post', 'reel', 'story'].includes(type)) return res.status(400).json({ error: 'Неверный тип' });
  const userIds = Array.isArray(req.body.user_ids) ? req.body.user_ids : [];
  db.prepare('DELETE FROM content_type_assignees WHERE project_id = ? AND content_type = ?').run(req.params.id, type);
  userIds.forEach(uid => {
    db.prepare('INSERT OR IGNORE INTO content_type_assignees (project_id, user_id, content_type) VALUES (?,?,?)').run(req.params.id, uid, type);
  });
  const items = db.prepare('SELECT * FROM content_plan WHERE project_id = ? AND type = ?').all(req.params.id, type);
  items.forEach(item => syncTasksForItem(item, req.params.id, req.user.id));
  res.json({ ok: true });
});

// ─── Content CRUD ─────────────────────────────────────────────────────────────

app.post('/api/projects/:id/content/item', auth, requirePerm('manage_projects'), (req, res) => {
  const { date, type, title, quantity, description } = req.body;
  if (!date || !type) return res.status(400).json({ error: 'Нет данных' });
  const r = db.prepare('INSERT INTO content_plan (project_id, date, type, title, quantity, description) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, date, type, title || '', quantity || 1, description || '');
  const item = db.prepare('SELECT * FROM content_plan WHERE id = ?').get(r.lastInsertRowid);
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(req.params.id);
  syncTasksForItem(item, req.params.id, req.user.id);
  logActivity(req.user.id, 'content_created', 'project', parseInt(req.params.id), proj?.name, `${date} · ${type}${title ? ' · ' + title : ''}`);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put('/api/content/:id', auth, requirePerm('manage_projects'), (req, res) => {
  const row = db.prepare('SELECT * FROM content_plan WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  const { date, type, title, quantity, description } = req.body;
  db.prepare('UPDATE content_plan SET date=?, type=?, title=?, quantity=?, description=? WHERE id=?')
    .run(date ?? row.date, type ?? row.type, title !== undefined ? title : row.title, quantity ?? row.quantity, description !== undefined ? description : (row.description || ''), req.params.id);
  const updated = db.prepare('SELECT * FROM content_plan WHERE id = ?').get(req.params.id);
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(row.project_id);
  syncTasksForItem(updated, row.project_id, req.user.id);
  logActivity(req.user.id, 'content_updated', 'project', row.project_id, proj?.name, `${updated.date} · ${updated.type}${updated.title ? ' · ' + updated.title : ''}`);
  res.json({ ok: true });
});

app.delete('/api/content/:id', auth, requirePerm('manage_projects'), (req, res) => {
  const row = db.prepare('SELECT cp.*, p.name as proj_name FROM content_plan cp LEFT JOIN projects p ON p.id = cp.project_id WHERE cp.id = ?').get(req.params.id);
  db.prepare('DELETE FROM tasks WHERE source_content_id = ?').run(req.params.id);
  db.prepare('DELETE FROM content_plan WHERE id = ?').run(req.params.id);
  if (row) logActivity(req.user.id, 'content_deleted', 'project', row.project_id, row.proj_name, `${row.date} · ${row.type}`);
  res.json({ ok: true });
});

app.post('/api/projects/:id/content/import', auth, requirePerm('manage_projects'), (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Нет данных' });
  const months = [...new Set(items.map(i => i.date.slice(0, 7)))];
  months.forEach(m => {
    const toDelete = db.prepare("SELECT id FROM content_plan WHERE project_id = ? AND strftime('%Y-%m', date) = ?").all(req.params.id, m);
    toDelete.forEach(ci => db.prepare('DELETE FROM tasks WHERE source_content_id = ?').run(ci.id));
    db.prepare("DELETE FROM content_plan WHERE project_id = ? AND strftime('%Y-%m', date) = ?").run(req.params.id, m);
  });
  const stmt = db.prepare('INSERT INTO content_plan (project_id, date, type, title, quantity, description) VALUES (?, ?, ?, ?, ?, ?)');
  let count = 0;
  items.forEach(item => {
    if (!item.date || !item.type) return;
    const r = stmt.run(req.params.id, item.date, item.type, item.title || '', item.quantity || 1, item.description || '');
    const inserted = db.prepare('SELECT * FROM content_plan WHERE id = ?').get(r.lastInsertRowid);
    syncTasksForItem(inserted, req.params.id, req.user.id);
    count++;
  });
  res.json({ ok: true, count });
});

app.post('/api/projects/:id/sync-content-tasks', auth, requirePerm('manage_projects'), (req, res) => {
  const items = db.prepare('SELECT * FROM content_plan WHERE project_id = ?').all(req.params.id);
  items.forEach(item => syncTasksForItem(item, req.params.id, req.user.id));
  res.json({ ok: true });
});

app.delete('/api/projects/:id/content/month/:ym', auth, requirePerm('manage_projects'), (req, res) => {
  const toDelete = db.prepare("SELECT id FROM content_plan WHERE project_id = ? AND strftime('%Y-%m', date) = ?").all(req.params.id, req.params.ym);
  toDelete.forEach(ci => db.prepare('DELETE FROM tasks WHERE source_content_id = ?').run(ci.id));
  db.prepare("DELETE FROM content_plan WHERE project_id = ? AND strftime('%Y-%m', date) = ?")
    .run(req.params.id, req.params.ym);
  res.json({ ok: true });
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

function setTaskAssignees(taskId, userIds) {
  db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
  userIds.forEach(uid => {
    db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(taskId, uid);
  });
  db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ?').run(userIds[0] ?? null, taskId);
}

function recomputeTaskStatus(taskId) {
  const rows = db.prepare('SELECT done FROM task_assignees WHERE task_id = ?').all(taskId);
  if (!rows.length) return;
  const allDone = rows.every(r => r.done === 1);
  const anyDone = rows.some(r => r.done === 1);
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
    .run(allDone ? 'done' : anyDone ? 'in_progress' : 'new', localNow(), taskId);
}

function enrichTasksWithAssignees(tasks) {
  if (!tasks.length) return tasks;
  const ids = tasks.map(t => t.id);
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ta.task_id, ta.user_id as id, ta.done, ta.done_at,
           u.name, u.avatar_color as color, u.avatar_img as img
    FROM task_assignees ta JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id IN (${ph}) ORDER BY ta.id
  `).all(...ids);
  const byTask = {};
  rows.forEach(r => {
    (byTask[r.task_id] = byTask[r.task_id] || []).push(
      { id: r.id, name: r.name, color: r.color, img: r.img, done: r.done === 1, done_at: r.done_at }
    );
  });
  return tasks.map(t => ({ ...t, multi_assignees: byTask[t.id] || null }));
}

function getTaskQuery(extraWhere = '', params = []) {
  return db.prepare(`
    SELECT t.*,
      u.name as assignee_name, u.avatar_color as assignee_color, u.avatar_img as assignee_img,
      p.name as project_name, p.color as project_color,
      creator.name as creator_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN users creator ON creator.id = t.created_by
    WHERE 1=1 ${extraWhere}
    ORDER BY
      CASE WHEN t.status = 'done' THEN 1 ELSE 0 END ASC,
      t.deadline ASC NULLS LAST,
      t.created_at DESC
  `).all(...params);
}

function getTaskCount(extraWhere = '', params = []) {
  return db.prepare(`
    SELECT COUNT(*) as cnt FROM tasks t
    WHERE 1=1 ${extraWhere}
  `).get(...params).cnt;
}

function getTaskQueryPaged(extraWhere = '', params = [], limit = 20, offset = 0) {
  return db.prepare(`
    SELECT t.*,
      u.name as assignee_name, u.avatar_color as assignee_color, u.avatar_img as assignee_img,
      p.name as project_name, p.color as project_color,
      creator.name as creator_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN users creator ON creator.id = t.created_by
    WHERE 1=1 ${extraWhere}
    ORDER BY
      CASE WHEN t.status = 'done' THEN 1 ELSE 0 END ASC,
      t.deadline ASC NULLS LAST,
      t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

app.get('/api/dashboard', auth, (req, res) => {
  const isAdmin   = req.user.role === 'admin';
  const userPerms = JSON.parse(req.user.permissions || '{}');
  const hasReports = userPerms.reports;
  const hasTeam    = userPerms.manage_team;
  const hasAssign  = userPerms.assign_tasks;
  const uid = req.user.id;
  const monthParam = req.query.month;

  let where = '';
  const params = [];

  if (!isAdmin && !hasTeam && !hasAssign) {
    where += ' AND (t.assignee_id = ? OR t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))';
    params.push(uid, uid, uid);
  }
  if (monthParam && monthParam !== 'all') {
    where += " AND (CASE WHEN t.deadline IS NOT NULL AND t.deadline != '' THEN strftime('%Y-%m', t.deadline) ELSE strftime('%Y-%m', t.created_at) END) = ?";
    params.push(monthParam);
  }

  const now = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 5 * 3600000 + 86400000).toISOString().slice(0, 10);

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status != 'done' AND deadline IS NOT NULL AND deadline != '' AND substr(deadline,1,10) < ? THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN status != 'done' AND deadline IS NOT NULL AND deadline != '' AND substr(deadline,1,10) = ? THEN 1 ELSE 0 END) as today,
      SUM(CASE WHEN status != 'done' AND deadline IS NOT NULL AND deadline != '' AND substr(deadline,1,10) = ? THEN 1 ELSE 0 END) as tomorrow_count
    FROM tasks t WHERE 1=1 ${where}
  `).get(...[now, now, tomorrow, ...params]);

  const urgentWhere = where + ` AND status != 'done' AND deadline IS NOT NULL AND deadline != '' AND substr(deadline,1,10) <= ?`;
  const urgentTasks = enrichTasksWithAssignees(
    db.prepare(`SELECT t.*, u.name as assignee_name, u.avatar_color as assignee_color, u.avatar_img as assignee_img, p.name as project_name, p.color as project_color, creator.name as creator_name
      FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users creator ON creator.id = t.created_by
      WHERE 1=1 ${urgentWhere} ORDER BY t.deadline ASC LIMIT 50`).all(...params, tomorrow)
  );

  const recentWhere = where + ` AND status != 'done'`;
  const recentTasks = enrichTasksWithAssignees(
    db.prepare(`SELECT t.*, u.name as assignee_name, u.avatar_color as assignee_color, u.avatar_img as assignee_img, p.name as project_name, p.color as project_color, creator.name as creator_name
      FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users creator ON creator.id = t.created_by
      WHERE 1=1 ${recentWhere} ORDER BY t.deadline ASC NULLS LAST, t.created_at DESC LIMIT 30`).all(...params)
  );

  const byProject = isAdmin || hasReports || hasTeam ? db.prepare(`
    SELECT p.name, p.color, COUNT(*) as total, SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) as done
    FROM tasks t JOIN projects p ON p.id = t.project_id WHERE 1=1 ${where} GROUP BY p.id ORDER BY total DESC LIMIT 10
  `).all(...params) : [];

  const byEmployee = isAdmin || hasReports || hasTeam ? db.prepare(`
    SELECT u.name, u.avatar_color as color,
      COUNT(*) as total, SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) as done
    FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id JOIN users u ON u.id = ta.user_id
    WHERE 1=1 ${where.replace(/t\./g, 't.')} GROUP BY u.id ORDER BY total DESC LIMIT 10
  `).all(...params) : [];

  res.json({ stats, urgentTasks, recentTasks, byProject, byEmployee });
});

app.get('/api/tasks', auth, (req, res) => {
  const { project_id, assignee_id, status, my_tasks } = req.query;
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  let where = '';
  const params = [];

  const userPerms = JSON.parse(req.user.permissions || '{}');
  const isAdmin      = req.user.role === 'admin';
  const hasTeam      = userPerms.manage_team;
  const hasAssign    = userPerms.assign_tasks;

  if (my_tasks === '1') {
    // "Мои задачи" — always filter to current user only, regardless of role
    where += ' AND (t.assignee_id = ? OR t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))';
    params.push(req.user.id, req.user.id, req.user.id);
  } else if (!isAdmin && !hasTeam && !hasAssign) {
    // Regular employee — show own tasks only
    where += ' AND (t.assignee_id = ? OR t.created_by = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))';
    params.push(req.user.id, req.user.id, req.user.id);
  }
  // Admin, manage_team, assign_tasks — no restriction, sees all tasks
  if (project_id) { where += ' AND t.project_id = ?'; params.push(project_id); }
  if (assignee_id) {
    where += ' AND (t.assignee_id = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))';
    params.push(assignee_id, assignee_id);
  }
  if (status) { where += ' AND t.status = ?'; params.push(status); }
  if (req.query.created_month && req.query.created_month !== 'all') {
    // Show tasks whose deadline falls in the selected month; if no deadline, fall back to created_at
    where += " AND (CASE WHEN t.deadline IS NOT NULL AND t.deadline != '' THEN strftime('%Y-%m', t.deadline) ELSE strftime('%Y-%m', t.created_at) END) = ?";
    params.push(req.query.created_month);
  }

  if (req.query.all === '1') {
    // Legacy: return flat array for dashboard, reports, employee page, etc.
    return res.json(enrichTasksWithAssignees(getTaskQuery(where, params)));
  }

  const total = getTaskCount(where, params);
  const tasks = enrichTasksWithAssignees(getTaskQueryPaged(where, params, limit, offset));
  res.json({ tasks, total, page, pages: Math.ceil(total / limit) || 1 });
});

function calcNextDeadline(deadline, recurrence) {
  // Use local Dushanbe time as base; if no deadline, use tomorrow at 09:00
  const DSH = 5 * 3600000;
  let base;
  if (deadline) {
    // Parse stored local time as Dushanbe
    const clean = deadline.replace(' ', 'T');
    base = clean.endsWith('Z') || clean.includes('+')
      ? new Date(clean)
      : new Date(new Date(clean).getTime() - DSH); // stored as local, convert to UTC
  } else {
    base = new Date(Date.now() + DSH); // current Dushanbe time in UTC
  }

  const days = { daily: 1, every2days: 2, weekly: 7 };
  if (days[recurrence]) {
    base = new Date(base.getTime() + days[recurrence] * 86400000);
  } else if (recurrence === 'monthly') {
    // Add 1 month in local time
    const local = new Date(base.getTime() + DSH);
    local.setMonth(local.getMonth() + 1);
    base = new Date(local.getTime() - DSH);
  } else {
    return null;
  }

  // Return as local Dushanbe time string (no timezone suffix)
  const localDt = new Date(base.getTime() + DSH);
  return localDt.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

app.post('/api/tasks', auth, (req, res) => {
  const { title, description, project_id, assignee_id, assignee_ids, priority, deadline, recurrence } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Название задачи обязательно' });
  if (title.trim().length > 500) return res.status(400).json({ error: 'Название слишком длинное (макс. 500 символов)' });
  if ((description || '').length > 10000) return res.status(400).json({ error: 'Описание слишком длинное (макс. 10 000 символов)' });

  const ids = Array.isArray(assignee_ids) && assignee_ids.length > 0
    ? assignee_ids.map(Number).filter(Boolean)
    : (assignee_id ? [Number(assignee_id)] : []);

  const result = db.prepare(`
    INSERT INTO tasks (title, description, project_id, assignee_id, created_by, priority, deadline, recurrence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title.trim(), description || '', project_id || null, ids[0] || null, req.user.id, priority || 'medium', deadline || null, recurrence || 'none');

  if (ids.length > 0) setTaskAssignees(result.lastInsertRowid, ids);

  const task = enrichTasksWithAssignees(getTaskQuery(' AND t.id = ?', [result.lastInsertRowid]))[0];

  ids.forEach(uid => {
    const message = `Вам назначена задача: «${task.title}»`;
    db.prepare(`INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'new_task', ?)`)
      .run(uid, task.id, message);
    sendSSE(uid, { type: 'new_task', task, message });
    const assignee = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(uid);
    if (assignee?.telegram_id) {
      sendTelegramNewTask(assignee.telegram_id, task);
    }
  });

  logActivity(req.user.id, 'task_created', 'task', task.id, task.title);
  res.json(task);
});

app.put('/api/tasks/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Задача не найдена' });

  const isMulti = !!db.prepare('SELECT 1 FROM task_assignees WHERE task_id = ?').get(req.params.id);
  const isAssigned = isMulti
    ? !!db.prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?').get(req.params.id, req.user.id)
    : existing.assignee_id === req.user.id;
  const perms = JSON.parse(req.user.permissions || '{}');
  const canManageTeam  = perms.manage_team;
  const canAssignTasks = perms.assign_tasks;
  if (req.user.role !== 'admin' && !isAssigned && !canManageTeam && !canAssignTasks) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  const { title, description, project_id, assignee_id, assignee_ids, priority, deadline, status, recurrence } = req.body;
  const newIds = Array.isArray(assignee_ids) ? assignee_ids.map(Number).filter(Boolean) : null;

  // ── Review gate: if task was created by admin and employee marks as done → pending_review ──
  let newStatus = status || existing.status;
  if (status === 'done' && existing.status !== 'done' && req.user.role !== 'admin') {
    const creator = db.prepare('SELECT role FROM users WHERE id = ?').get(existing.created_by);
    if (creator?.role === 'admin') newStatus = 'pending_review';
  }
  const newAssignee = newIds ? (newIds[0] || null) : (assignee_id !== undefined ? (assignee_id || null) : existing.assignee_id);
  const newRecurrence = recurrence !== undefined ? (recurrence || 'none') : (existing.recurrence || 'none');

  db.prepare(`
    UPDATE tasks SET
      title = ?, description = ?, project_id = ?, assignee_id = ?,
      priority = ?, deadline = ?, status = ?, recurrence = ?, updated_at = ?
    WHERE id = ?
  `).run(
    title || existing.title,
    description ?? existing.description,
    project_id !== undefined ? (project_id || null) : existing.project_id,
    newAssignee,
    priority || existing.priority,
    deadline !== undefined ? (deadline || null) : existing.deadline,
    newStatus,
    newRecurrence,
    localNow(),
    req.params.id
  );

  if (newIds) setTaskAssignees(req.params.id, newIds);

  const task = enrichTasksWithAssignees(getTaskQuery(' AND t.id = ?', [req.params.id]))[0];

  // Notify new assignees (Telegram only for new task assignment)
  const prevAssigneeId = existing.assignee_id;
  const notifyNew = newIds ? newIds.filter(uid => uid !== prevAssigneeId) : (assignee_id && assignee_id !== prevAssigneeId ? [assignee_id] : []);
  notifyNew.forEach(uid => {
    const message = `Вам назначена задача: «${task.title}»`;
    db.prepare(`INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'new_task', ?)`)
      .run(uid, task.id, message);
    sendSSE(uid, { type: 'new_task', task, message });
    const assignee = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(uid);
    if (assignee?.telegram_id) {
      sendTelegramNewTask(assignee.telegram_id, task);
    }
  });

  // Notify creator + all admins on status change (in-app only, no Telegram)
  if (status && status !== existing.status) {
    const statusLabels = { new: 'Новая', in_progress: 'В работе', done: 'Готово ✅', pending_review: 'На проверке' };
    const actualStatus = newStatus; // may have been redirected to pending_review
    const message = newStatus === 'pending_review'
      ? `Задача «${task.title}» выполнена и ожидает вашего принятия`
      : `Статус задачи «${task.title}» изменён на: ${statusLabels[status] || status}`;
    const notifyIds = new Set();
    if (existing.created_by && existing.created_by !== req.user.id) notifyIds.add(existing.created_by);
    if (newStatus !== 'pending_review') {
      db.prepare("SELECT id FROM users WHERE role = 'admin'").all().forEach(a => {
        if (a.id !== req.user.id) notifyIds.add(a.id);
      });
    }
    notifyIds.forEach(uid => {
      db.prepare(`INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'status_change', ?)`)
        .run(uid, task.id, message);
      sendSSE(uid, { type: newStatus === 'pending_review' ? 'pending_review' : 'status_changed', task, message });
    });
  }

  // Spawn next recurring task when done
  if (newStatus === 'done' && existing.status !== 'done' && newRecurrence !== 'none') {
    const nextDl = calcNextDeadline(existing.deadline, newRecurrence);
    const nextResult = db.prepare(`
      INSERT INTO tasks (title, description, project_id, assignee_id, created_by, priority, deadline, recurrence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(existing.title, existing.description, existing.project_id, existing.assignee_id,
           existing.created_by, existing.priority, nextDl, newRecurrence);

    if (existing.assignee_id) {
      const recurLabels = { daily: 'ежедневная', every2days: 'каждые 2 дня', weekly: 'еженедельная', monthly: 'ежемесячная' };
      const msg = `🔄 Создана новая ${recurLabels[newRecurrence] || ''} задача: «${existing.title}»`;
      db.prepare(`INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'recurring', ?)`)
        .run(existing.assignee_id, nextResult.lastInsertRowid, msg);
      sendSSE(existing.assignee_id, { type: 'new_task', message: msg });

      const assignee = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(existing.assignee_id);
      if (assignee?.telegram_id) {
        const recurTask = enrichTasksWithAssignees(getTaskQuery(' AND t.id = ?', [nextResult.lastInsertRowid]))[0];
        if (recurTask) sendTelegramNewTask(assignee.telegram_id, recurTask);
      }
    }
  }

  const statusLabels = { new: 'Новая', in_progress: 'В работе', done: 'Готово', pending_review: 'На проверке' };
  if (existing.status !== newStatus) {
    logActivity(req.user.id, 'task_status', 'task', task.id, task.title,
      (statusLabels[existing.status] || existing.status) + ' → ' + (statusLabels[newStatus] || newStatus));
  } else if (title && title !== existing.title) {
    logActivity(req.user.id, 'task_updated', 'task', task.id, task.title);
  }

  // Task history log
  const actor = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
  const actorName = actor?.name || 'Неизвестно';
  const histFields = [
    { field: 'status',   oldV: existing.status,   newV: newStatus,     labels: statusLabels },
    { field: 'priority', oldV: existing.priority, newV: priority || existing.priority, labels: { low:'Низкий', medium:'Средний', high:'Высокий' } },
    { field: 'title',    oldV: existing.title,    newV: title || existing.title },
    { field: 'deadline', oldV: existing.deadline || '', newV: (deadline !== undefined ? (deadline||'') : (existing.deadline||'')) },
    { field: 'assignee', oldV: String(existing.assignee_id||''), newV: String(newAssignee||'') },
  ];
  histFields.forEach(({ field, oldV, newV, labels }) => {
    const resolvedOld = labels ? (labels[oldV] || oldV || '—') : (oldV || '—');
    const resolvedNew = labels ? (labels[newV] || newV || '—') : (newV || '—');
    if (String(oldV) !== String(newV)) {
      db.prepare('INSERT INTO task_history (task_id, user_id, user_name, field, old_value, new_value) VALUES (?,?,?,?,?,?)')
        .run(task.id, req.user.id, actorName, field, resolvedOld, resolvedNew);
    }
  });

  sendSSE(task.assignee_id, { type: 'task_updated', task });
  res.json(task);
});

app.patch('/api/tasks/:id/my-done', auth, (req, res) => {
  const { done, user_id } = req.body;
  const targetId = (req.user.role === 'admin' && user_id) ? Number(user_id) : req.user.id;
  const row = db.prepare('SELECT * FROM task_assignees WHERE task_id = ? AND user_id = ?').get(req.params.id, targetId);
  if (!row) return res.status(403).json({ error: 'Вы не являетесь исполнителем этой задачи' });
  db.prepare('UPDATE task_assignees SET done = ?, done_at = ? WHERE task_id = ? AND user_id = ?')
    .run(done ? 1 : 0, done ? localNow() : null, req.params.id, targetId);
  recomputeTaskStatus(req.params.id);

  // ── Review gate: if all done and task created by admin and actor is not admin → pending_review ──
  if (done && req.user.role !== 'admin') {
    const taskRow = db.prepare('SELECT created_by, status FROM tasks WHERE id = ?').get(req.params.id);
    if (taskRow?.status === 'done') {
      const creator = db.prepare('SELECT role FROM users WHERE id = ?').get(taskRow.created_by);
      if (creator?.role === 'admin') {
        db.prepare("UPDATE tasks SET status = 'pending_review', updated_at = ? WHERE id = ?").run(localNow(), req.params.id);
      }
    }
  }

  const task = enrichTasksWithAssignees(getTaskQuery(' AND t.id = ?', [req.params.id]))[0];
  if (done && task) {
    const allDone = (task.multi_assignees || []).every(a => a.done);
    const actor = db.prepare('SELECT name FROM users WHERE id = ?').get(targetId);
    const isPendingReview = task.status === 'pending_review';
    const message = isPendingReview
      ? `Задача «${task.title}» выполнена и ожидает вашего принятия`
      : allDone
        ? `Задача «${task.title}» выполнена всеми исполнителями ✅`
        : `${actor?.name} выполнил(а) свою часть задачи «${task.title}»`;
    const notifyIds = new Set();
    if (task.created_by && task.created_by !== targetId) notifyIds.add(task.created_by);
    if (!isPendingReview) {
      db.prepare("SELECT id FROM users WHERE role = 'admin'").all().forEach(a => { if (a.id !== targetId) notifyIds.add(a.id); });
    }
    notifyIds.forEach(uid => {
      db.prepare('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, ?, ?)').run(uid, task.id, 'status_change', message);
      sendSSE(uid, { type: isPendingReview ? 'pending_review' : 'status_changed', task, message });
    });
    if (isPendingReview) updateReviewBadgeSSE();
  }
  res.json({ ok: true, status: task?.status });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  const perms = parsePerms(req.user.permissions);
  if (req.user.role !== 'admin' && !perms.assign_tasks) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const task = db.prepare('SELECT id, title, created_by FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });
  // Non-admin with assign_tasks can only delete tasks they created or are assigned to
  if (req.user.role !== 'admin') {
    const isAssigned = !!db.prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    const isCreator = task.created_by === req.user.id;
    if (!isAssigned && !isCreator) return res.status(403).json({ error: 'Можно удалять только свои задачи' });
  }
  db.prepare('DELETE FROM notifications WHERE task_id = ?').run(req.params.id);
  db.prepare('DELETE FROM comments WHERE task_id = ?').run(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  sendSSEAll({ type: 'task_deleted', id: parseInt(req.params.id) });
  logActivity(req.user.id, 'task_deleted', 'task', parseInt(req.params.id), task?.title);
  res.json({ ok: true });
});

// ─── Task Review (Approve / Reject) ───────────────────────────────────────────
app.get('/api/tasks/pending-review', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
  const tasks = enrichTasksWithAssignees(
    getTaskQuery(" AND t.status = 'pending_review' AND t.created_by = ?", [req.user.id])
  );
  res.json(tasks);
});

app.post('/api/tasks/:id/approve', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Не найдено' });
  if (existing.status !== 'pending_review') return res.status(400).json({ error: 'Задача не ожидает проверки' });

  db.prepare("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?").run(localNow(), req.params.id);
  const task = enrichTasksWithAssignees(getTaskQuery(' AND t.id = ?', [req.params.id]))[0];

  const message = `Задача «${task.title}» принята и отмечена как выполненная`;
  const notifyIds = new Set();
  if (existing.assignee_id) notifyIds.add(existing.assignee_id);
  db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(req.params.id)
    .forEach(r => notifyIds.add(r.user_id));
  notifyIds.forEach(uid => {
    db.prepare("INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'status_change', ?)")
      .run(uid, task.id, message);
    sendSSE(uid, { type: 'task_approved', task, message });
  });

  logActivity(req.user.id, 'task_status', 'task', task.id, task.title, 'На проверке → Готово ✅');
  sendSSEAll({ type: 'task_updated', task });
  res.json({ ok: true, task });
});

app.post('/api/tasks/:id/reject', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Нет доступа' });
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Не найдено' });
  if (existing.status !== 'pending_review') return res.status(400).json({ error: 'Задача не ожидает проверки' });

  const { comment } = req.body;
  db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(localNow(), req.params.id);
  const task = enrichTasksWithAssignees(getTaskQuery(' AND t.id = ?', [req.params.id]))[0];

  // Add reject comment to task comments
  if (comment && comment.trim()) {
    const commentText = `↩ Возвращено на доработку: ${comment.trim()}`;
    db.prepare('INSERT INTO comments (task_id, user_id, text) VALUES (?, ?, ?)').run(req.params.id, req.user.id, commentText);
  }

  const message = comment
    ? `Задача «${task.title}» возвращена на доработку: ${comment}`
    : `Задача «${task.title}» возвращена на доработку`;
  const notifyIds = new Set();
  if (existing.assignee_id) notifyIds.add(existing.assignee_id);
  db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(req.params.id)
    .forEach(r => notifyIds.add(r.user_id));
  notifyIds.forEach(uid => {
    db.prepare("INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'status_change', ?)")
      .run(uid, task.id, message);
    sendSSE(uid, { type: 'task_rejected', task, message });
  });

  logActivity(req.user.id, 'task_status', 'task', task.id, task.title, 'На проверке → В работе');
  sendSSEAll({ type: 'task_updated', task });
  res.json({ ok: true, task });
});

// ─── Task access guard — used by history/comments endpoints ──────────────────
function canAccessTask(req, taskId) {
  if (req.user.role === 'admin') return true;
  const perms = parsePerms(req.user.permissions);
  if (perms.manage_team || perms.assign_tasks) return true;
  const isAssigned = !!db.prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?').get(taskId, req.user.id);
  if (isAssigned) return true;
  const task = db.prepare('SELECT created_by, assignee_id FROM tasks WHERE id = ?').get(taskId);
  return task && (task.created_by === req.user.id || task.assignee_id === req.user.id);
}

// ─── Task History ─────────────────────────────────────────────────────────────
app.get('/api/tasks/:id/history', auth, (req, res) => {
  if (!canAccessTask(req, req.params.id)) return res.status(403).json({ error: 'Нет доступа' });
  const rows = db.prepare(
    'SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.params.id);
  res.json(rows);
});

// ─── Comments ─────────────────────────────────────────────────────────────────

app.get('/api/tasks/:id/comments', auth, (req, res) => {
  if (!canAccessTask(req, req.params.id)) return res.status(403).json({ error: 'Нет доступа' });
  const comments = db.prepare(`
    SELECT c.*, u.name as user_name, u.avatar_color, u.avatar_img
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.id);
  res.json(comments);
});

app.post('/api/tasks/:id/comments', auth, (req, res) => {
  if (!canAccessTask(req, req.params.id)) return res.status(403).json({ error: 'Нет доступа' });
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Текст обязателен' });
  if (text.trim().length > 2000) return res.status(400).json({ error: 'Комментарий слишком длинный (макс. 2000 символов)' });
  const result = db.prepare('INSERT INTO comments (task_id, user_id, text) VALUES (?, ?, ?)')
    .run(req.params.id, req.user.id, text.trim());
  const comment = db.prepare(`
    SELECT c.*, u.name as user_name, u.avatar_color, u.avatar_img
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?
  `).get(result.lastInsertRowid);
  const taskRow = db.prepare('SELECT title FROM tasks WHERE id = ?').get(req.params.id);
  logActivity(req.user.id, 'comment', 'task', Number(req.params.id), taskRow?.title, text.trim().slice(0, 120));

  // @mention notifications
  const mentions = [...text.matchAll(/@([\wА-ЯЁа-яё]+(?:\s+[\wА-ЯЁа-яё]+)?)/gu)].map(m => m[1].trim());
  if (mentions.length) {
    const allUsers = db.prepare('SELECT id, name, telegram_id FROM users').all();
    const sender = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
    const notified = new Set();
    mentions.forEach(mention => {
      // Require exact full-name or exact first-name match to avoid accidental partial-prefix notifications
      const mentionLower = mention.toLowerCase();
      const matched = allUsers.find(u => {
        const nameLower = u.name.toLowerCase();
        const firstName = nameLower.split(' ')[0];
        return u.id !== req.user.id && (nameLower === mentionLower || firstName === mentionLower);
      });
      if (matched && !notified.has(matched.id)) {
        notified.add(matched.id);
        const msg = `${sender?.name} упомянул вас в комментарии к задаче «${taskRow?.title}»`;
        db.prepare('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?,?,?,?)')
          .run(matched.id, req.params.id, 'mention', msg);
        sendSSE(matched.id, { type: 'notification', message: msg });
        if (matched.telegram_id) {
          sendTelegramNotification(matched.telegram_id,
            `💬 *Вас упомянули в комментарии*\n\n*Задача:* ${taskRow?.title}\n*Комментарий:* ${text.trim().slice(0,150)}`);
        }
      }
    });
  }

  res.json(comment);
});

// ─── Users ────────────────────────────────────────────────────────────────────

app.get('/api/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, avatar_color, avatar_img, telegram_id, permissions FROM users ORDER BY name').all();
  res.json(users.map(u => ({ ...u, permissions: parsePerms(u.permissions) })));
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { name, email, password, role, permissions } = req.body;
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Имя, email и пароль обязательны' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(400).json({ error: 'Email уже используется' });

  const colors = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#06b6d4'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const permsJson = JSON.stringify(permissions || {});

  const result = db.prepare('INSERT INTO users (name, email, password, role, avatar_color, permissions) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), email.toLowerCase().trim(), bcrypt.hashSync(password, 10), role || 'employee', color, permsJson);
  const user = db.prepare('SELECT id, name, email, role, avatar_color, permissions FROM users WHERE id = ?').get(result.lastInsertRowid);
  logActivity(req.user.id, 'user_created', 'user', user.id, user.name);
  res.json({ ...user, permissions: parsePerms(user.permissions) });
});

app.put('/api/users/:id', auth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const { name, email, password, permissions } = req.body;
  // Only admins may change the permissions field — employees cannot self-escalate
  const permsJson = (permissions !== undefined && req.user.role === 'admin')
    ? JSON.stringify(permissions)
    : user.permissions;
  db.prepare('UPDATE users SET name = ?, email = ?, password = ?, permissions = ? WHERE id = ?').run(
    name || user.name,
    email || user.email,
    password ? bcrypt.hashSync(password, 10) : user.password,
    permsJson,
    req.params.id
  );
  logActivity(req.user.id, 'user_updated', 'user', parseInt(req.params.id), name || user.name);
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Нельзя удалить себя' });
  }
  const deletedUser = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logActivity(req.user.id, 'user_deleted', 'user', parseInt(req.params.id), deletedUser?.name);
  res.json({ ok: true });
});

app.post('/api/profile/avatar', auth, (req, res) => {
  const { avatar_img } = req.body;
  if (!avatar_img) return res.status(400).json({ error: 'Нет изображения' });
  const mimeMatch = avatar_img.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,/);
  if (!mimeMatch) return res.status(400).json({ error: 'Допустимые форматы: JPEG, PNG, GIF, WebP (SVG запрещён)' });
  const base64Data = avatar_img.slice(mimeMatch[0].length);
  const sizeBytes = Math.ceil(base64Data.length * 0.75);
  if (sizeBytes > 2 * 1024 * 1024) return res.status(400).json({ error: 'Файл превышает 2 МБ' });
  db.prepare('UPDATE users SET avatar_img = ? WHERE id = ?').run(avatar_img, req.user.id);
  res.json({ ok: true, avatar_img });
});

// ─── Telegram ─────────────────────────────────────────────────────────────────

app.post('/api/telegram/token', auth, (req, res) => {
  const token = Math.random().toString(36).substring(2, 8).toUpperCase();
  db.prepare('UPDATE users SET telegram_token = ? WHERE id = ?').run(token, req.user.id);
  const botName = process.env.TELEGRAM_BOT_USERNAME || 'ваш_бот';
  res.json({ token, link: `https://t.me/${botName}?start=${token}` });
});

app.post('/api/telegram/disconnect', auth, (req, res) => {
  db.prepare('UPDATE users SET telegram_id = NULL, telegram_token = NULL WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ─── Notifications ────────────────────────────────────────────────────────────

app.get('/api/notifications', auth, (req, res) => {
  const notifications = db.prepare(`
    SELECT n.*, t.title as task_title, p.name as project_name, p.color as project_color
    FROM notifications n
    LEFT JOIN tasks t ON t.id = n.task_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 50
  `).all(req.user.id);
  res.json(notifications);
});

app.get('/api/notifications/unread-count', auth, (req, res) => {
  const result = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id);
  res.json({ count: result.count });
});

app.put('/api/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.put('/api/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ─── Reports ──────────────────────────────────────────────────────────────────

app.get('/api/reports', auth, requirePerm('reports'), (req, res) => {
  const { month } = req.query; // format: 2026-06

  let dateWhere = '';
  const dateParams = [];
  if (month) {
    dateWhere = " AND (CASE WHEN t.deadline IS NOT NULL AND t.deadline != '' THEN strftime('%Y-%m', t.deadline) ELSE strftime('%Y-%m', t.created_at) END) = ?";
    dateParams.push(month);
  }

  // For efficiency score: filter by deadline month (same as /api/best-employee)
  const dlDateWhere = month ? " AND strftime('%Y-%m', t.deadline) = ?" : '';
  const dlDateParams = month ? [month] : [];

  // Current local time (Dushanbe UTC+5) as ISO string for correct deadline comparison
  // Keep 'T' separator to match deadline strings like "2026-06-23T11:30"
  const nowLocal   = new Date(Date.now() + 5*3600000).toISOString().slice(0,19); // "2026-06-23T13:03:40"
  const todayLocal = nowLocal.slice(0,10);                                         // "2026-06-23"

  const employees = db.prepare(
    "SELECT id, name, avatar_color, avatar_img FROM users WHERE role = 'employee' ORDER BY name"
  ).all();

  const report = employees.map(user => {
    // Include both single-assignee AND multi-assignee tasks
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT t.id) as total,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN t.status = 'new' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN t.status != 'done' AND t.deadline IS NOT NULL AND
          (length(t.deadline) > 10 AND t.deadline < ? OR length(t.deadline) <= 10 AND t.deadline < ?)
        THEN 1 ELSE 0 END) as overdue
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
      WHERE (t.assignee_id = ? OR ta.user_id = ?) ${dateWhere}
    `).get(nowLocal, todayLocal, user.id, user.id, user.id, ...dateParams);

    // On-time/late breakdown — filter by deadline month (same as /api/best-employee)
    const dlRows = db.prepare(`
      SELECT DISTINCT t.id, t.status, t.deadline, t.updated_at,
        ta.done AS my_done, ta.done_at AS my_done_at
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
      WHERE (t.assignee_id = ? OR ta.user_id = ?)
        AND t.deadline IS NOT NULL AND t.deadline != '' ${dlDateWhere}
    `).all(user.id, user.id, user.id, ...dlDateParams);

    let doneOnTime = 0, doneLate = 0;
    for (const t of dlRows) {
      const isDone   = t.status === 'done' || t.my_done === 1;
      const doneAt   = t.status === 'done' ? t.updated_at : (t.my_done === 1 ? t.my_done_at : null);
      const dlNorm   = (t.deadline.replace(' ', 'T').length <= 10)
        ? t.deadline.replace(' ', 'T') + 'T23:59:59'
        : t.deadline.replace(' ', 'T');
      const doneNorm = doneAt ? doneAt.replace(' ', 'T') : null;
      if (isDone && doneNorm && doneNorm <= dlNorm) doneOnTime++;
      else if (isDone && doneNorm && doneNorm > dlNorm) doneLate++;
    }
    const dlTotal = dlRows.length;
    const score = dlTotal > 0 ? Math.round((doneOnTime * 100 + doneLate * 50) / dlTotal) : null;

    const byProject = db.prepare(`
      SELECT p.name, p.color,
        COUNT(DISTINCT t.id) as total,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
      JOIN projects p ON p.id = t.project_id
      WHERE (t.assignee_id = ? OR ta.user_id = ?) ${dateWhere}
      GROUP BY p.id
      ORDER BY total DESC
    `).all(user.id, user.id, user.id, ...dateParams);

    const baseStats = stats || { total: 0, done: 0, in_progress: 0, new_count: 0, overdue: 0 };
    return { ...user, stats: { ...baseStats, doneOnTime, doneLate, dlTotal, score }, byProject };
  });

  // Global unique task counts — no double-counting of multi-assignee tasks
  const globalWhere = month ? "WHERE (CASE WHEN t.deadline IS NOT NULL AND t.deadline != '' THEN strftime('%Y-%m', t.deadline) ELSE strftime('%Y-%m', t.created_at) END) = ?" : '';
  const globalParams = month ? [nowLocal, todayLocal, month] : [nowLocal, todayLocal];
  const globalStats = db.prepare(`
    SELECT
      COUNT(DISTINCT t.id) as total,
      COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) as done,
      COALESCE(SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END), 0) as in_progress,
      COALESCE(SUM(CASE WHEN t.status = 'new' THEN 1 ELSE 0 END), 0) as new_count,
      COALESCE(SUM(CASE WHEN t.status != 'done' AND t.deadline IS NOT NULL AND
        (length(t.deadline) > 10 AND t.deadline < ? OR length(t.deadline) <= 10 AND t.deadline < ?)
      THEN 1 ELSE 0 END), 0) as overdue
    FROM tasks t
    ${globalWhere}
  `).get(...globalParams);

  res.json({ global: globalStats, employees: report });
});

// ─── Summary Report (period-based) ───────────────────────────────────────────

const { buildSummaryData, generateSummaryPDF, generateAnalyticsPDF } = require('./reports');

app.get('/api/reports/summary', auth, requirePerm('reports'), (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.period || '7'), 1), 365);
  const from = req.query.from || null;
  const to   = req.query.to   || null;
  res.json(buildSummaryData(days, from, to));
});

app.get('/api/reports/summary/pdf', auth, requirePerm('reports'), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.period || '7'), 1), 365);
    const from = req.query.from || null;
    const to   = req.query.to   || null;
    const data   = buildSummaryData(days, from, to);
    const buf    = await generateSummaryPDF(data);
    const fname  = `report-${from||days+'d'}-${data.generatedAt.slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.end(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Analytics Report ─────────────────────────────────────────────────────────

app.get('/api/reports/analytics', auth, requirePerm('reports'), (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.period || '30'), 7), 365);
  const TZ = 5 * 3600000;
  const nowLocal = req.query.to
    ? new Date(req.query.to + 'T23:59:59+05:00')
    : new Date(Date.now() + TZ);
  const fromDate = req.query.from
    ? new Date(req.query.from + 'T00:00:00+05:00').toISOString().slice(0, 10)
    : new Date(nowLocal.getTime() - days * 86400000).toISOString().slice(0, 10);
  const toDate = nowLocal.toISOString().slice(0, 10);

  // Average completion time (created_at → updated_at for done tasks), in hours
  const avgRows = db.prepare(`
    SELECT t.created_at, t.updated_at
    FROM tasks t
    WHERE t.status = 'done'
      AND date(t.created_at) >= ? AND date(t.created_at) <= ?
      AND t.updated_at IS NOT NULL
  `).all(fromDate, toDate);

  let avgHours = null;
  if (avgRows.length > 0) {
    const total = avgRows.reduce((sum, r) => {
      const diff = (new Date(r.updated_at.replace(' ', 'T')) - new Date(r.created_at.replace(' ', 'T'))) / 3600000;
      return sum + (diff > 0 ? diff : 0);
    }, 0);
    avgHours = Math.round(total / avgRows.length);
  }

  // Weekly trend: tasks created and done per week within [fromDate, toDate]
  const fromMs  = new Date(fromDate).getTime();
  const toMs    = new Date(toDate).getTime();
  const spanMs  = toMs - fromMs;
  const weekCount = Math.max(1, Math.ceil(spanMs / (7 * 86400000)));
  const weeks = [];
  for (let w = weekCount - 1; w >= 0; w--) {
    const wEnd   = new Date(toMs - w * 7 * 86400000);
    const wStart = new Date(wEnd.getTime() - 7 * 86400000);
    const wStartStr = wStart.toISOString().slice(0, 10);
    const wEndStr   = wEnd.toISOString().slice(0, 10);
    const label = wStartStr.slice(5);

    const created = db.prepare(
      `SELECT COUNT(*) as cnt FROM tasks WHERE date(created_at) > ? AND date(created_at) <= ?`
    ).get(wStartStr, wEndStr).cnt;

    const done = db.prepare(
      `SELECT COUNT(*) as cnt FROM tasks WHERE status='done' AND date(updated_at) > ? AND date(updated_at) <= ?`
    ).get(wStartStr, wEndStr).cnt;

    weeks.push({ label, created, done });
  }

  // Burndown: cumulative open tasks over time within period
  const burndown = [];
  const bucketDays = days <= 30 ? 1 : 7;
  const buckets = Math.ceil(days / bucketDays);
  for (let i = buckets - 1; i >= 0; i--) {
    const atDate = new Date(toMs - i * bucketDays * 86400000).toISOString().slice(0, 10);
    const open = db.prepare(`
      SELECT COUNT(*) as cnt FROM tasks
      WHERE date(created_at) <= ? AND date(created_at) >= ?
        AND (status != 'done' OR date(updated_at) > ?)
    `).get(atDate, fromDate, atDate).cnt;
    burndown.push({ label: atDate.slice(5), open });
  }

  // Status breakdown
  const statusBreak = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM tasks
    WHERE date(created_at) >= ? AND date(created_at) <= ? GROUP BY status
  `).all(fromDate, toDate);

  // Priority breakdown
  const priorityBreak = db.prepare(`
    SELECT priority, COUNT(*) as cnt FROM tasks
    WHERE date(created_at) >= ? AND date(created_at) <= ? GROUP BY priority
  `).all(fromDate, toDate);

  res.json({ avgHours, weeks, burndown, statusBreak, priorityBreak, days });
});

app.get('/api/reports/analytics/pdf', auth, requirePerm('reports'), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.period || '30'), 7), 365);
    const TZ = 5 * 3600000;
    const nowLocal = req.query.to
      ? new Date(req.query.to + 'T23:59:59+05:00')
      : new Date(Date.now() + TZ);
    const fromDate = req.query.from
      ? new Date(req.query.from + 'T00:00:00+05:00').toISOString().slice(0, 10)
      : new Date(nowLocal.getTime() - days * 86400000).toISOString().slice(0, 10);

    const avgRows = db.prepare(`SELECT t.created_at, t.updated_at FROM tasks t WHERE t.status='done' AND t.created_at>=? AND t.updated_at IS NOT NULL`).all(fromDate);
    let avgHours = null;
    if (avgRows.length > 0) {
      const total = avgRows.reduce((s, r) => {
        const diff = (new Date(r.updated_at.replace(' ','T')) - new Date(r.created_at.replace(' ','T'))) / 3600000;
        return s + (diff > 0 ? diff : 0);
      }, 0);
      avgHours = Math.round(total / avgRows.length);
    }

    const weekCount = Math.ceil(days / 7);
    const weeks = [];
    for (let w = weekCount-1; w >= 0; w--) {
      const wEnd   = new Date(nowLocal.getTime() - w*7*86400000);
      const wStart = new Date(wEnd.getTime() - 7*86400000);
      const ws = wStart.toISOString().slice(0,10), we = wEnd.toISOString().slice(0,10);
      const created = db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE date(created_at)>? AND date(created_at)<=?`).get(ws,we).cnt;
      const done    = db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE status='done' AND date(updated_at)>? AND date(updated_at)<=?`).get(ws,we).cnt;
      weeks.push({ label: ws.slice(5), created, done });
    }

    const statusBreak   = db.prepare(`SELECT status, COUNT(*) as cnt FROM tasks WHERE date(created_at)>=? GROUP BY status`).all(fromDate);
    const priorityBreak = db.prepare(`SELECT priority, COUNT(*) as cnt FROM tasks WHERE date(created_at)>=? GROUP BY priority`).all(fromDate);

    const buf = await generateAnalyticsPDF({ days, avgHours, weeks, burndown: [], statusBreak, priorityBreak });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${days}d.pdf"`);
    res.end(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SSE ──────────────────────────────────────────────────────────────────────

app.get('/api/events', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(':connected\n\n');

  const userId = req.user.id;
  if (!sseClients.has(userId)) sseClients.set(userId, []);
  sseClients.get(userId).push(res);

  const heartbeat = setInterval(() => res.write(':ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(userId) || [];
    sseClients.set(userId, clients.filter(c => c !== res));
  });
});

// ─── Activity ─────────────────────────────────────────────────────────────────

app.get('/api/activity', auth, requirePerm('view_activity'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const days  = Math.min(parseInt(req.query.days)  || 30,  365);
  const logs = db.prepare(`
    SELECT al.id, al.action, al.entity_type, al.entity_id, al.entity_title, al.detail, al.created_at,
           u.id as user_id, u.name as user_name, u.avatar_color as user_color, u.avatar_img as user_avatar
    FROM activity_log al
    JOIN users u ON u.id = al.user_id
    WHERE al.created_at >= date('now', '-${days} days')
    ORDER BY al.created_at DESC
    LIMIT ?
  `).all(limit);
  res.json(logs);
});

app.get('/api/activity/chart', auth, requirePerm('view_activity'), (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const rows = db.prepare(`
    SELECT date(created_at) as day,
           COUNT(*) as events,
           COUNT(DISTINCT user_id) as users
    FROM activity_log
    WHERE created_at >= date('now', '-${days} days')
    GROUP BY day
    ORDER BY day ASC
  `).all();
  res.json(rows);
});

app.get('/api/activity/user/:id', auth, requirePerm('view_activity'), (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const uid  = req.params.id;
  const user = db.prepare('SELECT id, name, avatar_color, avatar_img, role, last_seen FROM users WHERE id = ?').get(uid);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const logs = db.prepare(`
    SELECT * FROM activity_log
    WHERE user_id = ? AND created_at >= datetime('now', '-${days} days')
    ORDER BY created_at DESC LIMIT 300
  `).all(uid);

  const chart = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as events
    FROM activity_log
    WHERE user_id = ? AND created_at >= datetime('now', '-${days} days')
    GROUP BY day ORDER BY day ASC
  `).all(uid);

  const actions = db.prepare(`
    SELECT action, COUNT(*) as count
    FROM activity_log
    WHERE user_id = ? AND created_at >= datetime('now', '-${days} days')
    GROUP BY action ORDER BY count DESC
  `).all(uid);

  res.json({ user, logs, chart, actions });
});

app.get('/api/users/last-seen', auth, requirePerm('view_activity'), (req, res) => {
  const users = db.prepare(`
    SELECT id, name, avatar_color, avatar_img, role,
           last_seen,
           (SELECT action FROM activity_log WHERE user_id = users.id ORDER BY created_at DESC LIMIT 1) as last_action,
           (SELECT created_at FROM activity_log WHERE user_id = users.id ORDER BY created_at DESC LIMIT 1) as last_activity_at
    FROM users ORDER BY last_seen DESC NULLS LAST
  `).all();
  res.json(users);
});

// ─── Ideahast ─────────────────────────────────────────────────────────────────
app.get('/api/ideahast', auth, requirePerm('manage_ideahast'), (req, res) => {
  res.json(db.prepare('SELECT * FROM ideahast_projects ORDER BY start_date DESC').all());
});
app.post('/api/ideahast', auth, requirePerm('manage_ideahast'), (req, res) => {
  const { title, description='', color='#6366f1', status='active', start_date, end_date='', client='' } = req.body;
  if (!title?.trim() || !start_date) return res.status(400).json({ error: 'Введите название и дату начала' });
  const r = db.prepare('INSERT INTO ideahast_projects (title,description,color,status,start_date,end_date,client) VALUES (?,?,?,?,?,?,?)').run(title.trim(), description, color, status, start_date, end_date, client);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/ideahast/:id', auth, requirePerm('manage_ideahast'), (req, res) => {
  const { title, description='', color='#6366f1', status='active', start_date, end_date='', client='' } = req.body;
  db.prepare("UPDATE ideahast_projects SET title=?,description=?,color=?,status=?,start_date=?,end_date=?,client=?,updated_at=datetime('now') WHERE id=?").run(title, description, color, status, start_date, end_date||'', client, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/ideahast/:id', auth, requirePerm('manage_ideahast'), (req, res) => {
  db.prepare('DELETE FROM ideahast_projects WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Finance Activity Log ──────────────────────────────────────────────────────
function logFinance(userId, userName, section, action, entityType='', entityId=null, entityTitle='', detail='', amount=null) {
  // Skip empty/garbage entries
  if (!entityTitle?.trim() && !detail?.trim()) return;
  if (action.includes('delete') && (!amount || +amount <= 0) && !entityTitle?.trim()) return;
  try {
    db.prepare('INSERT INTO finance_activity_log (user_id,user_name,section,action,entity_type,entity_id,entity_title,detail,amount) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(userId, userName||'', section, action, entityType, entityId, entityTitle?.trim()||'', detail?.trim()||'', amount);
  } catch {}
}

app.delete('/api/finance-log/:id', auth, requirePerm('manage_finance_log'), (req, res) => {
  db.prepare('DELETE FROM finance_activity_log WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/finance-log', auth, requirePerm('manage_finance_log'), (req, res) => {
  const { section, days=30, limit=200 } = req.query;
  let where = `WHERE created_at >= datetime('now', '-${Math.min(+days,365)} days')`;
  const params = [];
  if (section) { where += ' AND section=?'; params.push(section); }
  const rows = db.prepare(`SELECT * FROM finance_activity_log ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, Math.min(+limit, 500));
  res.json(rows);
});

// ─── Kids Courses & Payments (same structure as B2C) ──────────────────────────
function kidsAuth(req, res, next) {
  if (req.user.role === 'admin') return next();
  const p = JSON.parse(req.user.permissions||'{}');
  if (p.manage_kids) return next();
  return res.status(403).json({ error: 'Нет доступа' });
}
app.get('/api/kids/courses', auth, kidsAuth, (req, res) => {
  const courses = db.prepare(`SELECT c.*, COUNT(p.id) as student_count,
    COALESCE(SUM(p.course_amount),0) as total_collected, COALESCE(SUM(p.amount),0) as total_paid
    FROM kids_courses c LEFT JOIN kids_payments p ON p.course_id=c.id
    WHERE c.archived=0 GROUP BY c.id ORDER BY c.created_at DESC`).all();
  res.json(courses);
});
app.post('/api/kids/courses', auth, kidsAuth, (req, res) => {
  const { title, teacher='', teacher_phone='', start_date='', end_date='' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Введите название' });
  const r = db.prepare('INSERT INTO kids_courses (title,teacher,teacher_phone,start_date,end_date) VALUES (?,?,?,?,?)').run(title.trim(), teacher, teacher_phone, start_date, end_date);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/kids/courses/:id', auth, kidsAuth, (req, res) => {
  const { title, teacher='', teacher_phone='', start_date='', end_date='' } = req.body;
  db.prepare('UPDATE kids_courses SET title=?,teacher=?,teacher_phone=?,start_date=?,end_date=? WHERE id=?').run(title, teacher, teacher_phone, start_date, end_date, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/kids/courses/:id', auth, kidsAuth, (req, res) => {
  const kc = db.prepare('SELECT title FROM kids_courses WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM kids_payments WHERE course_id=?').run(req.params.id);
  db.prepare('DELETE FROM kids_courses WHERE id=?').run(req.params.id);
  const _un = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  logFinance(req.user.id, _un, 'kids', 'delete_course', 'course', +req.params.id, kc?.title||'', `Удалён курс Kids: ${kc?.title||''}`);
  res.json({ ok: true });
});
app.get('/api/kids/courses/:id/payments', auth, kidsAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM kids_payments WHERE course_id=? ORDER BY created_at ASC').all(req.params.id));
});
app.post('/api/kids/courses/:id/payments', auth, kidsAuth, (req, res) => {
  const { student_name, phone='', course_amount=0, amount=0, payment_method='cash', received_by='', payment_date='', comment='', receipt_img='' } = req.body;
  if (!student_name?.trim()) return res.status(400).json({ error: 'Введите ФИО' });
  const ca=+course_amount||0, pa=+amount||0;
  const status = pa<=0?'unpaid': pa>=ca?'paid':'hybrid';
  const r = db.prepare('INSERT INTO kids_payments (course_id,student_name,phone,course_amount,amount,status,payment_method,received_by,payment_date,comment,receipt_img) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(req.params.id, student_name.trim(), phone, ca, pa, status, payment_method, received_by, payment_date, comment, receipt_img);
  const _un1=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  const _c1=db.prepare('SELECT title FROM kids_courses WHERE id=?').get(req.params.id);
  logFinance(req.user.id,_un1,'kids','add_student','payment',r.lastInsertRowid,student_name,'Курс: '+(_c1?.title||'')+', Сумма: '+ca+', Оплачено: '+pa+', '+payment_method,pa);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/kids/payments/:id', auth, kidsAuth, (req, res) => {
  const { student_name, phone='', course_amount=0, amount=0, payment_method='cash', received_by='', payment_date='', comment='', receipt_img='' } = req.body;
  const ca=+course_amount||0, pa=+amount||0;
  const status = pa<=0?'unpaid': pa>=ca?'paid':'hybrid';
  db.prepare("UPDATE kids_payments SET student_name=?,phone=?,course_amount=?,amount=?,status=?,payment_method=?,received_by=?,payment_date=?,comment=?,receipt_img=?,updated_at=datetime('now') WHERE id=?").run(student_name, phone, ca, pa, status, payment_method, received_by, payment_date, comment, receipt_img, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/kids/payments/:id', auth, kidsAuth, (req, res) => {
  const kp = db.prepare('SELECT p.student_name, p.amount, c.title FROM kids_payments p JOIN kids_courses c ON c.id=p.course_id WHERE p.id=?').get(req.params.id);
  db.prepare('DELETE FROM kids_payments WHERE id=?').run(req.params.id);
  const _un = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  if (kp) logFinance(req.user.id, _un, 'kids', 'delete_student', 'payment', +req.params.id, kp.student_name, `Удалён студент из курса "${kp.title}", сумма: ${kp.amount}`, +kp.amount||0);
  res.json({ ok: true });
});

// ─── B2C Courses & Payments ───────────────────────────────────────────────────
app.get('/api/b2c/courses', auth, requirePerm('manage_b2c'), (req, res) => {
  const courses = db.prepare(`
    SELECT c.*, COUNT(p.id) as student_count,
      COALESCE(SUM(p.course_amount),0) as total_collected,
      COALESCE(SUM(p.amount),0)        as total_paid
    FROM b2c_courses c LEFT JOIN b2c_payments p ON p.course_id=c.id
    WHERE c.archived=0 GROUP BY c.id ORDER BY c.created_at DESC`).all();
  res.json(courses);
});
app.post('/api/b2c/courses', auth, requirePerm('manage_b2c'), (req, res) => {
  const { title, teacher='', teacher_phone='', start_date='', end_date='' } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Введите название' });
  const r = db.prepare('INSERT INTO b2c_courses (title,teacher,teacher_phone,start_date,end_date) VALUES (?,?,?,?,?)').run(title.trim(), teacher, teacher_phone, start_date, end_date);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/b2c/courses/:id', auth, requirePerm('manage_b2c'), (req, res) => {
  const { title, teacher='', teacher_phone='', start_date='', end_date='' } = req.body;
  db.prepare('UPDATE b2c_courses SET title=?,teacher=?,teacher_phone=?,start_date=?,end_date=? WHERE id=?').run(title, teacher, teacher_phone, start_date, end_date, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/b2c/courses/:id', auth, requirePerm('manage_b2c'), (req, res) => {
  const bc = db.prepare('SELECT title FROM b2c_courses WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM b2c_payments WHERE course_id=?').run(req.params.id);
  db.prepare('DELETE FROM b2c_courses WHERE id=?').run(req.params.id);
  const _un = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  logFinance(req.user.id, _un, 'b2c', 'delete_course', 'course', +req.params.id, bc?.title||'', `Удалён курс В2С: ${bc?.title||''}`);
  res.json({ ok: true });
});
app.get('/api/b2c/courses/:id/payments', auth, requirePerm('manage_b2c'), (req, res) => {
  res.json(db.prepare('SELECT * FROM b2c_payments WHERE course_id=? ORDER BY created_at ASC').all(req.params.id));
});
app.post('/api/b2c/courses/:id/payments', auth, requirePerm('manage_b2c'), (req, res) => {
  const { student_name, phone='', course_amount=0, amount=0, payment_method='cash', received_by='', payment_date='', comment='', receipt_img='' } = req.body;
  if (!student_name?.trim()) return res.status(400).json({ error: 'Введите ФИО' });
  const ca = +course_amount||0, pa = +amount||0;
  const status = pa<=0?'unpaid': pa>=ca?'paid':'hybrid';
  const r = db.prepare('INSERT INTO b2c_payments (course_id,student_name,phone,course_amount,amount,status,payment_method,received_by,payment_date,comment,receipt_img) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(req.params.id, student_name.trim(), phone, ca, pa, status, payment_method, received_by, payment_date, comment, receipt_img);
  const _un2=db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  const _c2=db.prepare('SELECT title FROM b2c_courses WHERE id=?').get(req.params.id);
  logFinance(req.user.id,_un2,'b2c','add_student','payment',r.lastInsertRowid,student_name,'Курс: '+(_c2?.title||'')+', Сумма: '+ca+', Оплачено: '+pa+', '+payment_method,pa);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/b2c/payments/:id', auth, requirePerm('manage_b2c'), (req, res) => {
  const { student_name, phone='', course_amount=0, amount=0, payment_method='cash', received_by='', payment_date='', comment='', receipt_img='' } = req.body;
  const ca = +course_amount||0, pa = +amount||0;
  const status = pa<=0?'unpaid': pa>=ca?'paid':'hybrid';
  db.prepare("UPDATE b2c_payments SET student_name=?,phone=?,course_amount=?,amount=?,status=?,payment_method=?,received_by=?,payment_date=?,comment=?,receipt_img=?,updated_at=datetime('now') WHERE id=?").run(student_name, phone, ca, pa, status, payment_method, received_by, payment_date, comment, receipt_img, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/b2c/payments/:id', auth, requirePerm('manage_b2c'), (req, res) => {
  const bp = db.prepare('SELECT p.student_name, p.amount, c.title FROM b2c_payments p JOIN b2c_courses c ON c.id=p.course_id WHERE p.id=?').get(req.params.id);
  db.prepare('DELETE FROM b2c_payments WHERE id=?').run(req.params.id);
  const _un = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  if (bp) logFinance(req.user.id, _un, 'b2c', 'delete_student', 'payment', +req.params.id, bp.student_name, `Удалён студент из курса "${bp.title}", сумма: ${bp.amount}`, +bp.amount||0);
  res.json({ ok: true });
});

// ─── Expenses ─────────────────────────────────────────────────────────────────
app.get('/api/expenses', auth, requirePerm('manage_finance'), (req, res) => {
  const month = req.query.month || localMonth();
  res.json(db.prepare('SELECT * FROM expenses WHERE month=? ORDER BY created_at DESC').all(month));
});
app.get('/api/expenses/annual', auth, requirePerm('manage_finance'), (req, res) => {
  const year = req.query.year || new Date(Date.now()+5*3600000).getFullYear();
  res.json(db.prepare(`SELECT month, SUM(amount) as total, COUNT(*) as count FROM expenses WHERE month LIKE ? GROUP BY month ORDER BY month`).all(year + '-%'));
});
app.post('/api/expenses', auth, requirePerm('manage_finance'), (req, res) => {
  const { title, amount, category='other', comment='', color='', month } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Введите название' });
  const r = db.prepare('INSERT INTO expenses (title,amount,category,comment,color,month) VALUES (?,?,?,?,?,?)').run(title.trim(), amount||0, category, comment, color, month);
  const un = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  logFinance(req.user.id, un, 'finance', 'create_expense', 'expense', r.lastInsertRowid, title, `Категория: ${category}, Сумма: ${amount}`, +amount||0);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/expenses/:id', auth, requirePerm('manage_finance'), (req, res) => {
  const { title, amount, category='other', comment='', color='', month } = req.body;
  db.prepare("UPDATE expenses SET title=?,amount=?,category=?,comment=?,color=?,month=?,updated_at=datetime('now') WHERE id=?").run(title, amount||0, category, comment, color, month, req.params.id);
  const un = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  logFinance(req.user.id, un, 'finance', 'update_expense', 'expense', +req.params.id, title, `Сумма: ${amount}`, +amount||0);
  res.json({ ok: true });
});
app.delete('/api/expenses/:id', auth, requirePerm('manage_finance'), (req, res) => {
  const exp = db.prepare('SELECT title, amount FROM expenses WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
  const un = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  logFinance(req.user.id, un, 'finance', 'delete_expense', 'expense', +req.params.id, exp?.title||'', `Удалён расход ${exp?.amount||0}`);
  res.json({ ok: true });
});

// ─── Finance ──────────────────────────────────────────────────────────────────
app.get('/api/finance', auth, requirePerm('manage_finance'), (req, res) => {
  const { month, all_months, status, payment_type, search, direction } = req.query;
  const targetMonth = month || localMonth();
  let where = 'WHERE 1=1';
  const params = [];
  if (!all_months) { where += ' AND month=?'; params.push(targetMonth); }
  if (status)       { where += ' AND status=?'; params.push(status); }
  if (payment_type) { where += ' AND payment_type=?'; params.push(payment_type); }
  if (direction)    { where += ' AND direction=?'; params.push(direction); }
  if (search)       { where += ' AND (project_name LIKE ? OR client_name LIKE ?)'; params.push('%'+search+'%','%'+search+'%'); }
  const rows = db.prepare(`SELECT * FROM finance ${where} ORDER BY created_at DESC`).all(...params);
  // Attach payments
  const ids = rows.map(r=>r.id);
  const payments = ids.length ? db.prepare(`SELECT * FROM finance_payments WHERE finance_id IN (${ids.map(()=>'?').join(',')}) ORDER BY payment_date`).all(...ids) : [];
  const payMap = {};
  payments.forEach(p => { if (!payMap[p.finance_id]) payMap[p.finance_id]=[]; payMap[p.finance_id].push(p); });

  // Add virtual B2C row — aggregate by course start_date month
  if (!status && !payment_type && !search) {
    try {
      const b2cRow = db.prepare(`
        SELECT COALESCE(SUM(p.course_amount),0) as svc, COALESCE(SUM(p.amount),0) as paid,
               COUNT(p.id) as cnt
        FROM b2c_payments p
        JOIN b2c_courses c ON c.id=p.course_id
        WHERE strftime('%Y-%m', c.start_date)=?
      `).get(targetMonth);
      const svc = +b2cRow?.svc||0, paid = +b2cRow?.paid||0;
      if (svc > 0 || paid > 0) {
        const b2cStat = paid<=0?'unpaid': paid>=svc?'paid':'partial';
        rows.push({
          id: 'b2c', project_name:'Финансы В2С', project_id:null,
          service_amount: svc, paid_amount: paid,
          status: b2cStat, payment_type:'', comment:`Курсы начатые в ${targetMonth} · ${b2cRow?.cnt||0} студентов`,
          month: targetMonth, is_b2c: 1, payments:[], created_at: new Date().toISOString()
        });
      }
      // Kids row
      const kidsRow = db.prepare(`SELECT COALESCE(SUM(p.course_amount),0) as svc, COALESCE(SUM(p.amount),0) as paid, COUNT(p.id) as cnt FROM kids_payments p JOIN kids_courses c ON c.id=p.course_id WHERE strftime('%Y-%m', c.start_date)=?`).get(targetMonth);
      const ksvc = +kidsRow?.svc||0, kpaid = +kidsRow?.paid||0;
      if (ksvc > 0 || kpaid > 0) {
        const kidsStat = kpaid<=0?'unpaid': kpaid>=ksvc?'paid':'partial';
        rows.push({
          id: 'kids', project_name:'Финансы Kids', project_id:null,
          service_amount: ksvc, paid_amount: kpaid,
          status: kidsStat, payment_type:'', comment:`Курсы Kids начатые в ${targetMonth} · ${kidsRow?.cnt||0} студентов`,
          month: targetMonth, is_b2c: 2, payments:[], created_at: new Date().toISOString()
        });
      }
    } catch {}
  }

  res.json(rows.map(r => ({ ...r, payments: payMap[r.id]||[] })));
});

// Annual summary
app.get('/api/finance/annual', auth, requirePerm('manage_finance'), (req, res) => {
  const year = req.query.year || new Date(Date.now()+5*3600000).getFullYear();
  const rows = db.prepare(`SELECT month, SUM(service_amount) as total_service, SUM(paid_amount) as total_paid, COUNT(*) as count
    FROM finance WHERE month LIKE ? GROUP BY month ORDER BY month`).all(year + '-%');
  res.json(rows);
});

// Combined annual — Finance + B2C + Kids
app.get('/api/finance/annual-combined', auth, requirePerm('manage_finance'), (req, res) => {
  const year = req.query.year || new Date(Date.now()+5*3600000).getFullYear();
  const months12 = Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
  const fin  = db.prepare(`SELECT month, SUM(service_amount) as svc, SUM(paid_amount) as paid, COUNT(*) as cnt FROM finance WHERE month LIKE ? GROUP BY month`).all(year+'-%');
  const b2c  = db.prepare(`SELECT strftime('%Y-%m',c.start_date) as month, SUM(p.course_amount) as svc, SUM(p.amount) as paid, COUNT(p.id) as cnt FROM b2c_payments p JOIN b2c_courses c ON c.id=p.course_id WHERE strftime('%Y',c.start_date)=? GROUP BY month`).all(String(year));
  const kids = db.prepare(`SELECT strftime('%Y-%m',c.start_date) as month, SUM(p.course_amount) as svc, SUM(p.amount) as paid, COUNT(p.id) as cnt FROM kids_payments p JOIN kids_courses c ON c.id=p.course_id WHERE strftime('%Y',c.start_date)=? GROUP BY month`).all(String(year));
  const toMap = arr => { const m={}; arr.forEach(r=>{m[r.month]={svc:+r.svc||0,paid:+r.paid||0,cnt:+r.cnt||0}}); return m; };
  const finM=toMap(fin), b2cM=toMap(b2c), kidsM=toMap(kids);
  res.json(months12.map(m=>({
    month:m,
    fin_svc:finM[m]?.svc||0,   fin_paid:finM[m]?.paid||0,   fin_cnt:finM[m]?.cnt||0,
    b2c_svc:b2cM[m]?.svc||0,   b2c_paid:b2cM[m]?.paid||0,   b2c_cnt:b2cM[m]?.cnt||0,
    kids_svc:kidsM[m]?.svc||0, kids_paid:kidsM[m]?.paid||0, kids_cnt:kidsM[m]?.cnt||0,
    total_svc: (finM[m]?.svc||0)+(b2cM[m]?.svc||0)+(kidsM[m]?.svc||0),
    total_paid:(finM[m]?.paid||0)+(b2cM[m]?.paid||0)+(kidsM[m]?.paid||0),
  })));
});

// Summary by section for current month
app.get('/api/finance/section-summary', auth, requirePerm('manage_finance'), (req, res) => {
  const month = req.query.month || localMonth();
  const fin  = db.prepare(`SELECT SUM(service_amount) as svc, SUM(paid_amount) as paid, COUNT(*) as cnt FROM finance WHERE month=?`).get(month);
  const b2c  = db.prepare(`SELECT SUM(p.course_amount) as svc, SUM(p.amount) as paid, COUNT(p.id) as cnt FROM b2c_payments p JOIN b2c_courses c ON c.id=p.course_id WHERE strftime('%Y-%m',c.start_date)=?`).get(month);
  const kids = db.prepare(`SELECT SUM(p.course_amount) as svc, SUM(p.amount) as paid, COUNT(p.id) as cnt FROM kids_payments p JOIN kids_courses c ON c.id=p.course_id WHERE strftime('%Y-%m',c.start_date)=?`).get(month);
  res.json({
    finance: { svc:+fin?.svc||0, paid:+fin?.paid||0, cnt:+fin?.cnt||0 },
    b2c:     { svc:+b2c?.svc||0, paid:+b2c?.paid||0, cnt:+b2c?.cnt||0 },
    kids:    { svc:+kids?.svc||0,paid:+kids?.paid||0,cnt:+kids?.cnt||0 },
  });
});

// Project breakdown
app.get('/api/finance/chart', auth, requirePerm('manage_finance'), (req, res) => {
  const numMonths = Math.min(Math.max(parseInt(req.query.months || '12'), 1), 60);
  // Compute cutoff month string e.g. "2025-07"
  const now = new Date(Date.now() + 5 * 3600000);
  const cutoff = new Date(now.getFullYear(), now.getMonth() - numMonths + 1, 1);
  const cutoffStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0');

  // Income = service_amount (what was billed), filtered by month
  const incomeRows = db.prepare(`
    SELECT month, SUM(service_amount) as income
    FROM finance
    WHERE month >= ?
    GROUP BY month ORDER BY month
  `).all(cutoffStr);

  const expenseRows = db.prepare(`
    SELECT month, SUM(amount) as expenses
    FROM expenses
    WHERE month >= ?
    GROUP BY month ORDER BY month
  `).all(cutoffStr);

  const map = {};
  for (const r of incomeRows)  { map[r.month] = { month: r.month, income: r.income || 0, expenses: 0 }; }
  for (const r of expenseRows) {
    if (!map[r.month]) map[r.month] = { month: r.month, income: 0, expenses: 0 };
    map[r.month].expenses = r.expenses || 0;
  }
  const months = Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  res.json({ months });
});

app.get('/api/finance/by-project', auth, requirePerm('manage_finance'), (req, res) => {
  const rows = db.prepare(`SELECT project_name, SUM(service_amount) as total_service, SUM(paid_amount) as total_paid, COUNT(*) as count
    FROM finance GROUP BY project_name ORDER BY total_service DESC`).all();
  res.json(rows);
});

app.post('/api/finance', auth, requirePerm('manage_finance'), (req, res) => {
  const { project_id, project_name, service_amount, paid_amount, status, payment_type, comment, month, currency='TJS', client_name='', client_phone='', is_recurring=0, direction='' } = req.body;
  if (!project_name?.trim()) return res.status(400).json({ error: 'Укажите название проекта' });
  const result = db.prepare(`INSERT INTO finance (project_id,project_name,service_amount,paid_amount,status,payment_type,comment,month,currency,client_name,client_phone,is_recurring,direction)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(project_id||null, project_name.trim(), service_amount||0, paid_amount||0, status||'unpaid', payment_type||'cash', comment||'', month, currency, client_name, client_phone, is_recurring?1:0, direction);
  const uname = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  logFinance(req.user.id, uname, 'finance', 'create_record', 'record', result.lastInsertRowid, project_name, `Сумма: ${service_amount}, Оплачено: ${paid_amount}`, +service_amount||0);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/finance/:id', auth, requirePerm('manage_finance'), (req, res) => {
  const existing = db.prepare('SELECT * FROM finance WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Не найдено' });
  const { project_id, project_name, service_amount, paid_amount, status, payment_type, comment, month, currency='TJS', client_name='', client_phone='', is_recurring=0, direction='' } = req.body;
  // Log history for changed fields
  const actor = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  const fieldLabels = { service_amount:'Сумма услуги', paid_amount:'Сумма оплаты', status:'Статус', payment_type:'Тип оплаты', project_name:'Проект', currency:'Валюта' };
  const newVals = { service_amount, paid_amount, status, payment_type, project_name, currency };
  Object.keys(fieldLabels).forEach(f => {
    if (String(existing[f]||'') !== String(newVals[f]||'')) {
      db.prepare('INSERT INTO finance_history (finance_id,user_id,user_name,field,old_value,new_value) VALUES (?,?,?,?,?,?)')
        .run(req.params.id, req.user.id, actor?.name||'', fieldLabels[f], String(existing[f]||''), String(newVals[f]||''));
    }
  });
  db.prepare(`UPDATE finance SET project_id=?,project_name=?,service_amount=?,paid_amount=?,status=?,payment_type=?,comment=?,month=?,currency=?,client_name=?,client_phone=?,is_recurring=?,direction=?,updated_at=datetime('now') WHERE id=?`)
    .run(project_id||null, project_name, service_amount||0, paid_amount||0, status, payment_type, comment||'', month, currency, client_name||'', client_phone||'', is_recurring?1:0, direction, req.params.id);
  const unameU = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  logFinance(req.user.id, unameU, 'finance', 'update_record', 'record', +req.params.id, project_name, `Сумма: ${service_amount}, Оплачено: ${paid_amount}, Статус: ${status}`, +paid_amount||0);
  res.json({ ok: true });
});

app.delete('/api/finance/:id', auth, requirePerm('manage_finance'), (req, res) => {
  const delRec = db.prepare('SELECT project_name, service_amount FROM finance WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM finance_payments WHERE finance_id=?').run(req.params.id);
  db.prepare('DELETE FROM finance_history WHERE finance_id=?').run(req.params.id);
  db.prepare('DELETE FROM finance WHERE id=?').run(req.params.id);
  // Only log if real record with data
  if (delRec?.project_name && +delRec.service_amount > 0) {
    const unameD = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
    logFinance(req.user.id, unameD, 'finance', 'delete_record', 'record', +req.params.id, delRec.project_name, `Удалена запись: ${delRec.project_name} на сумму ${delRec.service_amount}`, +delRec.service_amount);
  }
  res.json({ ok: true });
});

// Payments (partial)
app.get('/api/finance/:id/payments', auth, requirePerm('manage_finance'), (req, res) => {
  res.json(db.prepare('SELECT * FROM finance_payments WHERE finance_id=? ORDER BY payment_date').all(req.params.id));
});
app.post('/api/finance/:id/payments', auth, requirePerm('manage_finance'), (req, res) => {
  const { amount, payment_type='cash', payment_date, note='' } = req.body;
  if (!amount || !payment_date) return res.status(400).json({ error: 'Укажите сумму и дату' });
  const r = db.prepare('INSERT INTO finance_payments (finance_id,amount,payment_type,payment_date,note) VALUES (?,?,?,?,?)')
    .run(req.params.id, amount, payment_type, payment_date, note);
  const total = db.prepare('SELECT SUM(amount) as t FROM finance_payments WHERE finance_id=?').get(req.params.id).t || 0;
  const fin = db.prepare('SELECT service_amount, project_name FROM finance WHERE id=?').get(req.params.id);
  const newStatus = total >= fin.service_amount ? 'paid' : total > 0 ? 'partial' : 'unpaid';
  db.prepare("UPDATE finance SET paid_amount=?, status=?, updated_at=datetime('now') WHERE id=?").run(total, newStatus, req.params.id);
  const unameP = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id)?.name;
  logFinance(req.user.id, unameP, 'finance', 'add_payment', 'payment', r.lastInsertRowid, fin?.project_name||'', `Платёж ${amount} · ${payment_type} · ${payment_date}`, +amount);
  res.json({ id: r.lastInsertRowid, paid_amount: total, status: newStatus });
});
app.delete('/api/finance/payments/:id', auth, requirePerm('manage_finance'), (req, res) => {
  const p = db.prepare('SELECT finance_id FROM finance_payments WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM finance_payments WHERE id=?').run(req.params.id);
  if (p) {
    const total = db.prepare('SELECT SUM(amount) as t FROM finance_payments WHERE finance_id=?').get(p.finance_id).t || 0;
    const fin = db.prepare('SELECT service_amount FROM finance WHERE id=?').get(p.finance_id);
    const newStatus = total >= (fin?.service_amount||0) ? 'paid' : total > 0 ? 'partial' : 'unpaid';
    db.prepare("UPDATE finance SET paid_amount=?, status=?, updated_at=datetime('now') WHERE id=?").run(total, newStatus, p.finance_id);
  }
  res.json({ ok: true });
});

// Clean up auto-copied recurring records beyond next month
app.delete('/api/finance/cleanup-future', auth, requirePerm('manage_finance'), (req, res) => {
  const nowLoc = new Date(Date.now() + 5*3600000);
  const nextMonth = new Date(nowLoc.getFullYear(), nowLoc.getMonth()+1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,'0')}`;
  // Delete auto-created (is_recurring=1, unpaid) records beyond next month
  const result = db.prepare(`DELETE FROM finance WHERE is_recurring=1 AND status='unpaid' AND paid_amount=0 AND month > ?`).run(nextMonthStr);
  res.json({ ok: true, deleted: result.changes });
});

// History
app.get('/api/finance/:id/history', auth, requirePerm('manage_finance'), (req, res) => {
  res.json(db.prepare('SELECT * FROM finance_history WHERE finance_id=? ORDER BY created_at DESC LIMIT 30').all(req.params.id));
});

// ─── Payment Checklist ────────────────────────────────────────────────────────

// GET all items with check state for a given month
app.get('/api/payment-checklist/:month', auth, requirePerm('manage_finance'), (req, res) => {
  const { month } = req.params;
  const rows = db.prepare(`
    SELECT i.id, i.name, i.order_idx,
      COALESCE(c.checked, 0)       as checked,
      c.checked_at,
      c.checked_by_name
    FROM payment_checklist_items i
    LEFT JOIN payment_checklist_checks c ON c.item_id = i.id AND c.month = ?
    ORDER BY i.order_idx, i.id
  `).all(month);
  res.json(rows);
});

// POST add a new checklist item
app.post('/api/payment-checklist/items', auth, requirePerm('manage_finance'), (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_idx),0)+1 as n FROM payment_checklist_items').get().n;
  const result = db.prepare('INSERT INTO payment_checklist_items (name, order_idx) VALUES (?, ?)').run(name.trim(), maxOrder);
  res.json(db.prepare('SELECT * FROM payment_checklist_items WHERE id = ?').get(result.lastInsertRowid));
});

// DELETE a checklist item (cascade removes all checks)
app.delete('/api/payment-checklist/items/:id', auth, requirePerm('manage_finance'), (req, res) => {
  db.prepare('DELETE FROM payment_checklist_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PATCH rename a checklist item
app.patch('/api/payment-checklist/items/:id', auth, requirePerm('manage_finance'), (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
  db.prepare('UPDATE payment_checklist_items SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM payment_checklist_items WHERE id = ?').get(req.params.id));
});

// PATCH toggle check state for item in a month
app.patch('/api/payment-checklist/:month/:itemId', auth, requirePerm('manage_finance'), (req, res) => {
  const { month, itemId } = req.params;
  const { checked } = req.body;
  if (checked) {
    const now = new Date(Date.now() + 5*3600000).toISOString().slice(0,16);
    db.prepare(`
      INSERT INTO payment_checklist_checks (item_id, month, checked, checked_at, checked_by_id, checked_by_name)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(item_id, month) DO UPDATE SET checked=1, checked_at=excluded.checked_at,
        checked_by_id=excluded.checked_by_id, checked_by_name=excluded.checked_by_name
    `).run(itemId, month, now, req.user.id, req.user.name);
  } else {
    db.prepare('DELETE FROM payment_checklist_checks WHERE item_id=? AND month=?').run(itemId, month);
  }
  res.json({ ok: true });
});

// ─── HR Module ────────────────────────────────────────────────────────────────

// GET all employees
app.get('/api/hr/employees', auth, requirePerm('manage_team'), (req, res) => {
  const { status } = req.query;
  let q = 'SELECT * FROM hr_employees';
  const params = [];
  if (status) { q += ' WHERE status = ?'; params.push(status); }
  q += ' ORDER BY status ASC, hire_date DESC';
  res.json(db.prepare(q).all(...params));
});

// POST create employee
app.post('/api/hr/employees', auth, requirePerm('manage_team'), (req, res) => {
  const { full_name, position='', hire_date='', termination_date='', termination_reason='', salary=0, status='active', notes='', user_id=null } = req.body;
  if (!full_name?.trim()) return res.status(400).json({ error: 'ФИО обязательно' });
  const now = new Date(Date.now()+5*3600000).toISOString().slice(0,16);
  const result = db.prepare(`
    INSERT INTO hr_employees (user_id,full_name,position,hire_date,termination_date,termination_reason,salary,status,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(user_id||null, full_name.trim(), position, hire_date||null, termination_date||null, termination_reason, +salary||0, status, notes, now, now);
  const emp = db.prepare('SELECT * FROM hr_employees WHERE id=?').get(result.lastInsertRowid);
  // Seed initial position and salary history
  if (position) db.prepare('INSERT INTO hr_position_history (employee_id,position,start_date,notes) VALUES (?,?,?,?)').run(emp.id, position, hire_date||now.slice(0,10), 'Начальная должность');
  if (+salary > 0) db.prepare('INSERT INTO hr_salary_history (employee_id,salary,effective_date,notes) VALUES (?,?,?,?)').run(emp.id, +salary, hire_date||now.slice(0,10), 'Начальный оклад');
  res.json(emp);
});

// GET single employee with history
app.get('/api/hr/employees/:id', auth, requirePerm('manage_team'), (req, res) => {
  const emp = db.prepare('SELECT * FROM hr_employees WHERE id=?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Не найдено' });
  emp.positions = db.prepare('SELECT * FROM hr_position_history WHERE employee_id=? ORDER BY start_date DESC').all(emp.id);
  emp.salaries  = db.prepare('SELECT * FROM hr_salary_history WHERE employee_id=? ORDER BY effective_date DESC').all(emp.id);
  res.json(emp);
});

// PATCH update employee
app.patch('/api/hr/employees/:id', auth, requirePerm('manage_team'), (req, res) => {
  const { full_name, position, hire_date, termination_date, termination_reason, salary, status, notes, user_id } = req.body;
  const emp = db.prepare('SELECT * FROM hr_employees WHERE id=?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Не найдено' });
  const now = new Date(Date.now()+5*3600000).toISOString().slice(0,16);
  db.prepare(`UPDATE hr_employees SET
    full_name=?, position=?, hire_date=?, termination_date=?, termination_reason=?,
    salary=?, status=?, notes=?, user_id=?, updated_at=? WHERE id=?
  `).run(
    full_name??emp.full_name, position??emp.position, hire_date??emp.hire_date,
    termination_date??emp.termination_date, termination_reason??emp.termination_reason,
    salary!=null?+salary:emp.salary, status??emp.status, notes??emp.notes,
    user_id!==undefined?user_id:emp.user_id, now, emp.id
  );
  res.json(db.prepare('SELECT * FROM hr_employees WHERE id=?').get(emp.id));
});

// DELETE employee
app.delete('/api/hr/employees/:id', auth, requirePerm('manage_team'), (req, res) => {
  db.prepare('DELETE FROM hr_employees WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST add position history entry
app.post('/api/hr/employees/:id/positions', auth, requirePerm('manage_team'), (req, res) => {
  const { position, start_date, end_date='', notes='' } = req.body;
  if (!position?.trim() || !start_date) return res.status(400).json({ error: 'Должность и дата обязательны' });
  const result = db.prepare('INSERT INTO hr_position_history (employee_id,position,start_date,end_date,notes) VALUES (?,?,?,?,?)').run(req.params.id, position.trim(), start_date, end_date||null, notes);
  // Update current position on employee record
  db.prepare('UPDATE hr_employees SET position=?, updated_at=? WHERE id=?').run(position.trim(), new Date(Date.now()+5*3600000).toISOString().slice(0,16), req.params.id);
  res.json(db.prepare('SELECT * FROM hr_position_history WHERE id=?').get(result.lastInsertRowid));
});

// DELETE position history entry
app.delete('/api/hr/positions/:id', auth, requirePerm('manage_team'), (req, res) => {
  db.prepare('DELETE FROM hr_position_history WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST add salary history entry
app.post('/api/hr/employees/:id/salaries', auth, requirePerm('manage_team'), (req, res) => {
  const { salary, effective_date, notes='' } = req.body;
  if (!salary || !effective_date) return res.status(400).json({ error: 'Оклад и дата обязательны' });
  const result = db.prepare('INSERT INTO hr_salary_history (employee_id,salary,effective_date,notes) VALUES (?,?,?,?)').run(req.params.id, +salary, effective_date, notes);
  // Update current salary on employee record
  db.prepare('UPDATE hr_employees SET salary=?, updated_at=? WHERE id=?').run(+salary, new Date(Date.now()+5*3600000).toISOString().slice(0,16), req.params.id);
  res.json(db.prepare('SELECT * FROM hr_salary_history WHERE id=?').get(result.lastInsertRowid));
});

// DELETE salary history entry
app.delete('/api/hr/salaries/:id', auth, requirePerm('manage_team'), (req, res) => {
  db.prepare('DELETE FROM hr_salary_history WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Workload ─────────────────────────────────────────────────────────────────
app.get('/api/workload', auth, (req, res) => {
  try {
    const users = db.prepare('SELECT id, name, avatar_color, avatar_img FROM users ORDER BY name').all();
    const projects = db.prepare('SELECT id, name, color FROM projects WHERE archived = 0 ORDER BY name').all();
    const memberships = db.prepare('SELECT user_id, project_id FROM project_members').all();
    const taskCounts = db.prepare(`
      SELECT user_id, COALESCE(project_id, 0) as project_id,
        COUNT(*) as total,
        SUM(done_flag) as done,
        SUM(active_flag) as active
      FROM (
        SELECT ta.user_id, t.project_id,
          CASE WHEN t.status='done' OR ta.done=1 THEN 1 ELSE 0 END as done_flag,
          CASE WHEN t.status='in_progress' THEN 1 ELSE 0 END as active_flag
        FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
        UNION ALL
        SELECT t.assignee_id as user_id, t.project_id,
          CASE WHEN t.status='done' THEN 1 ELSE 0 END as done_flag,
          CASE WHEN t.status='in_progress' THEN 1 ELSE 0 END as active_flag
        FROM tasks t
        WHERE t.assignee_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM task_assignees ta2 WHERE ta2.task_id = t.id)
      )
      GROUP BY user_id, project_id
    `).all();
    res.json({ users, projects, memberships, taskCounts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user-projects', auth, (req, res) => {
  try {
    const rows = db.prepare('SELECT pm.user_id, pm.project_id, p.name, p.color FROM project_members pm JOIN projects p ON p.id = pm.project_id').all();
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user-projects', auth, requirePerm('manage_team'), (req, res) => {
  try {
    const { user_id, project_id } = req.body;
    db.prepare('INSERT OR IGNORE INTO project_members (user_id, project_id) VALUES (?, ?)').run(user_id, project_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/user-projects', auth, requirePerm('manage_team'), (req, res) => {
  try {
    const { user_id, project_id } = req.body;
    db.prepare('DELETE FROM project_members WHERE user_id=? AND project_id=?').run(user_id, project_id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Feedback (anonymous) ─────────────────────────────────────────────────────
app.post('/api/feedback', auth, (req, res) => {
  const { q1,q2,q3,q4,q5,q6,q7,q8,q9,q10, suggestion='' } = req.body;
  const scores = [q1,q2,q3,q4,q5,q6,q7,q8,q9,q10];
  if (scores.some(s => s === undefined || s === null || s < 0 || s > 5))
    return res.status(400).json({ error: 'Оцените все вопросы от 0 до 5' });
  // Deliberately no user_id — fully anonymous
  db.prepare(`INSERT INTO feedback (q1,q2,q3,q4,q5,q6,q7,q8,q9,q10,suggestion)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...scores, suggestion.trim());
  res.json({ ok: true });
});

app.get('/api/feedback', auth, adminOnly, (req, res) => {
  const showArchived = req.query.archived === '1';
  const rows = db.prepare(`SELECT * FROM feedback WHERE archived = ${showArchived ? 1 : 0} ORDER BY created_at DESC`).all();
  res.json(rows);
});

app.patch('/api/feedback/:id/archive', auth, adminOnly, (req, res) => {
  const { archived } = req.body;
  db.prepare('UPDATE feedback SET archived = ? WHERE id = ?').run(archived ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/feedback/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Best Employee ────────────────────────────────────────────────────────────
app.get('/api/best-employee', auth, (req, res) => {
  const month = req.query.month || localMonth();

  function calcMonth(m) {
    const users = db.prepare("SELECT id, name, avatar_color, avatar_img FROM users WHERE role='employee' ORDER BY name").all();
    return users.map(u => {
      // Fetch tasks created in month m (same filter as /api/reports)
      const rows = db.prepare(`
        SELECT DISTINCT t.id, t.status, t.deadline, t.updated_at,
          ta.done     AS my_done,
          ta.done_at  AS my_done_at
        FROM tasks t
        LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
        WHERE (t.assignee_id = ? OR ta.user_id = ?)
          AND strftime('%Y-%m', t.created_at) = ?
      `).all(u.id, u.id, u.id, m);

      const nowIso = localNowT();

      // Determine effective completion for each task:
      // - multi-assignee: use ta.done + ta.done_at (this user's individual completion)
      // - single-assignee: use tasks.status + tasks.updated_at
      const enriched = rows.map(t => {
        const isDone   = t.status === 'done' || t.my_done === 1;
        const doneAt   = t.status === 'done' ? t.updated_at : (t.my_done === 1 ? t.my_done_at : null);
        const doneNorm = doneAt ? doneAt.replace(' ', 'T') : null;
        // onTime/late only possible when task has a deadline
        let onTime = false, late = false, overdue = false;
        if (t.deadline) {
          const dlRaw  = t.deadline.replace(' ', 'T');
          const dlNorm = dlRaw.length <= 10 ? dlRaw + 'T23:59:59' : dlRaw;
          onTime  = isDone && doneNorm !== null && doneNorm <= dlNorm;
          late    = isDone && doneNorm !== null && doneNorm > dlNorm;
          overdue = !isDone && dlNorm < nowIso;
        }
        return { ...t, isDone, onTime, late, overdue };
      });

      const total      = enriched.length;
      const doneOnTime = enriched.filter(t => t.onTime).length;
      const doneLate   = enriched.filter(t => t.late).length;
      const overdue    = enriched.filter(t => t.overdue).length;
      const done       = enriched.filter(t => t.isDone).length;
      // Efficiency same formula as /api/reports: based on tasks with deadline
      const dlTotal    = enriched.filter(t => t.deadline).length;
      const score = dlTotal > 0
        ? Math.round((doneOnTime * 100 + doneLate * 50) / dlTotal)
        : (total > 0 ? Math.round(done / total * 100) : null);

      // Ranking score = absolute completions × (1 + efficiency)
      // This rewards MORE tasks done even at lower %, over fewer tasks at 100%
      // Example: 9 done × (1 + 0.53) = 13.77 > 2 done × (1 + 1.0) = 4.0
      const rankScore = doneOnTime * (1 + (score || 0) / 100);

      return { ...u, total, done, doneOnTime, doneLate, overdue, score, rankScore };
    }).filter(u => u.total > 0)
      .sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1) || b.doneOnTime - a.doneOnTime || a.overdue - b.overdue);
  }

  // Current selected month
  const current = calcMonth(month);

  // History: last 12 months, find winner of each
  const history = [];
  const now = new Date(Date.now() + 5*3600000); // Dushanbe local time
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (m === month && i === 0) { history.push({ month: m, winner: current[0] || null }); continue; }
    const ranked = calcMonth(m);
    if (ranked.length > 0) history.push({ month: m, winner: ranked[0] });
  }

  res.json({ month, rankings: current, history });
});

// ─── Schedule ─────────────────────────────────────────────────────────────────
app.get('/api/schedule', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM schedule ORDER BY day, class_id, start_time').all();
  res.json(rows);
});

app.post('/api/auth/logout', auth, (req, res) => {
  logActivity(req.user.id, 'logout');
  res.json({ ok: true });
});

app.post('/api/schedule', auth, requirePerm('manage_schedule'), (req, res) => {
  const { day, class_id, start_time, end_time, title, comment = '', teacher = '' } = req.body;
  if (day === undefined || class_id === undefined || !start_time || !end_time || !title)
    return res.status(400).json({ error: 'Заполните все поля' });
  if (start_time >= end_time)
    return res.status(400).json({ error: 'Время окончания должно быть позже начала' });
  const result = db.prepare(
    'INSERT INTO schedule (day, class_id, start_time, end_time, title, comment, teacher) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(day, class_id, start_time, end_time, title, comment, teacher);
  const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  logActivity(req.user.id, 'schedule_created', 'schedule', result.lastInsertRowid, title, `${days[day]} ${start_time}–${end_time}`);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/schedule/:id', auth, requirePerm('manage_schedule'), (req, res) => {
  const { day, class_id, start_time, end_time, title, comment = '', teacher = '' } = req.body;
  if (start_time >= end_time)
    return res.status(400).json({ error: 'Время окончания должно быть позже начала' });
  db.prepare(
    'UPDATE schedule SET day=?, class_id=?, start_time=?, end_time=?, title=?, comment=?, teacher=? WHERE id=?'
  ).run(day, class_id, start_time, end_time, title, comment, teacher, req.params.id);
  const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  logActivity(req.user.id, 'schedule_updated', 'schedule', parseInt(req.params.id), title, `${days[day]} ${start_time}–${end_time}`);
  res.json({ ok: true });
});

app.delete('/api/schedule/:id', auth, requirePerm('manage_schedule'), (req, res) => {
  const ev = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM schedule WHERE id=?').run(req.params.id);
  if (ev) {
    const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    logActivity(req.user.id, 'schedule_deleted', 'schedule', parseInt(req.params.id), ev.title, `${days[ev.day]} ${ev.start_time}–${ev.end_time}`);
  }
  res.json({ ok: true });
});

// [seed endpoint removed after successful migration]
if (false) app.post('/api/_seed_once', (req, res) => {
  if (req.headers['x-seed-key'] !== 'MINDSBAR_SEED_2026') return res.status(403).end();
  const users = [{"id": 1, "name": "Abdusalom Rabikhov", "email": "abdusalom@agency.com", "password": "$2a$10$xUQLq5rAhZBoli5o07WqXOxjCTRCJpLTZx3L3LxDLyor3Ofju9/yK", "role": "admin", "avatar_color": "#6366f1", "telegram_id": "685071534", "telegram_token": "", "permissions": "{}"}, {"id": 2, "name": "\u041f\u0443\u043b\u0430\u0442\u043e\u0432\u0430 \u041a\u0430\u043c\u0438\u043b\u043b\u0430", "email": "kamilla@agency.com", "password": "$2a$10$9v2ofYa5t5wXawFuzeXkBeiTsLGzTGRQ0BZ1QItshehtw8qBxMX4u", "role": "employee", "avatar_color": "#8b5cf6", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":true,\"manage_projects\":true,\"assign_tasks\":true,\"manage_team\":true,\"view_activity\":true}"}, {"id": 6, "name": "\u0421\u0430\u043b\u043e\u043c\u043e\u0432\u0430 \u0411\u0443\u043d\u0430\u0444\u0448\u0430", "email": "bunafsha@agency.com", "password": "$2a$10$HuhboLIn8hGPZIzcdaVjku3n.Q.tQi6O2nDT5HietaOMujTklw3tW", "role": "employee", "avatar_color": "#3b82f6", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 7, "name": "\u0425\u0430\u043c\u0438\u0434\u043e\u0432\u0430 \u041c\u0435\u0445\u0440\u043e\u043d\u0430", "email": "mehrona@agency", "password": "$2a$10$0eLyUU5pkjpw3MdPmfI.QOqCxoTsjQUbAgOJK7aFUkymiTgSUNoSO", "role": "employee", "avatar_color": "#22c55e", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 8, "name": "\u0410\u0440\u0438\u043f\u043e\u0432\u0430 \u0421\u0430\u043b\u043e\u043c\u0430\u0442", "email": "salomat@agency.com", "password": "$2a$10$vSPdwxmJVJsQY/Rc7GaTq.9XMVf7c55TOjBfBYOnx3zJQf/7rN8le", "role": "employee", "avatar_color": "#06b6d4", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 9, "name": "\u041c\u0430\u0434\u043c\u0430\u0434\u0451\u0440\u043e\u0432\u0430 \u0424\u0430\u0440\u0437\u043e\u043d\u0430", "email": "farzona@agency.com", "password": "$2a$10$jGPa1b5FSrqN6i/agLwly.nI4PNWusmr4erv/3OGlLe27zR2CWa8q", "role": "employee", "avatar_color": "#3b82f6", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 10, "name": "\u041a\u0430\u0441\u044b\u043c\u043e\u0432\u0430 \u0414\u0438\u043b\u043d\u043e\u0437\u0430", "email": "dilnoza@agency.com", "password": "$2a$10$BDHMqZ8sndmlhZrkCKnRS.cZWBhPUbzAj.eezf/y9MhLwPLgN.1ZC", "role": "employee", "avatar_color": "#f43f5e", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 11, "name": "\u0421\u043e\u043b\u0438\u0435\u0432 \u0421\u0438\u043d\u043e", "email": "sino@agency.com", "password": "$2a$10$Xhs3/V4BVNDvvH3ai5WN..4yK3Ol.VtCHox6pH7UvHsM1KuFBjOPG", "role": "employee", "avatar_color": "#8b5cf6", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 12, "name": "\u041d\u0443\u0440\u0438\u0434\u0438\u043d\u043e\u0432 \u041c\u0443\u0445\u0441\u0438\u043d", "email": "muhsin@agency.com", "password": "$2a$10$J51Nl6FZO.VknCxUNO3dYOEH7tWxagCRwnWWHk38TOAVrztEdh4j6", "role": "employee", "avatar_color": "#6366f1", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 13, "name": "\u0421\u0430\u044a\u0434\u0438\u0437\u043e\u0434\u0430 \u0410\u0431\u0443\u0431\u0430\u043a\u0440", "email": "abubakr@agency.com", "password": "$2a$10$DTtmg4z4ZejhO/b/vRylI.AquPvyomoCCeAvV0YKhbZnIW82Hmmf2", "role": "employee", "avatar_color": "#14b8a6", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 14, "name": "\u0418\u0441\u043c\u0430\u0438\u043b\u043e\u0432\u0430 \u041c\u0430\u0445\u0432\u0430\u0448", "email": "mahvash@agency.com", "password": "$2a$10$t3WagDGfn9Yh499axrEjNOSETKiJv5.2kuWjRAREXBi37f9FSlYlm", "role": "employee", "avatar_color": "#3b82f6", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 15, "name": "\u0423\u043c\u0430\u0440\u043e\u0432 \u0410\u043c\u0438\u0440", "email": "amir@agency.com", "password": "$2a$10$Bf7Ae69.kMCwY3/QyFyMkeSwMxYXdoBmZBVIMJFvpLlgcQnwrZkgm", "role": "employee", "avatar_color": "#f43f5e", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 16, "name": "\u0421\u0430\u043b\u0438\u043c\u043e\u0432\u0430 \u0423\u043c\u0438\u044f", "email": "umiya@agency.com", "password": "$2a$10$fctyBGxGADsY3j5I8WUuH.AE3ZJFit5ahzItc9PVPdrAtB08Tcmna", "role": "employee", "avatar_color": "#f43f5e", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}, {"id": 17, "name": "\u041c\u0438\u0440\u0441\u0430\u0431\u0443\u0440\u043e\u0432\u0430 \u0410\u043c\u0430\u043d\u0438", "email": "amani@agency.com", "password": "$2a$10$wSW1nkzsjLsMatY6jPabdenpI1/Y3W0lTlfsX/mlwrVqwJijYcuWm", "role": "employee", "avatar_color": "#14b8a6", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false,\"view_activity\":false,\"manage_schedule\":true}"}, {"id": 18, "name": "\u0421\u043e\u044f\u0440\u043a\u0443\u043b\u043e\u0432 \u0423\u043c\u0435\u0434", "email": "umed@agency.com", "password": "$2a$10$CbPWKiVmKuQOG9gf2a9kGuSoxU0R3a/WtD80vHKW5eELgQL7s.6xK", "role": "employee", "avatar_color": "#14b8a6", "telegram_id": "", "telegram_token": "", "permissions": "{\"reports\":false,\"manage_projects\":false,\"assign_tasks\":false,\"manage_team\":false}"}];
  const projects = [{"id": 2, "name": "\u0421\u0422\u041e999", "color": "#f43f5e", "description": "\u0418\u0442\u0430\u043b\u044c\u044f\u043d\u0441\u043a\u043e\u0435 \u043a\u0430\u0444\u0435", "archived": 0}, {"id": 3, "name": "\u0415\u0432\u0440\u043e\u041c\u0435\u0434", "color": "#22c55e", "description": "\u0424\u0438\u0442\u043d\u0435\u0441-\u043a\u043b\u0443\u0431", "archived": 0}, {"id": 4, "name": "\u0421\u0442\u0440\u043e\u0439 \u0426\u0435\u043d\u0442\u0440", "color": "#f97316", "description": "", "archived": 0}, {"id": 5, "name": "Minds", "color": "#f43f5e", "description": "", "archived": 0}, {"id": 8, "name": "\u0421\u0438\u0442\u0438\u041a\u0430\u0440\u0434", "color": "#6366f1", "description": "", "archived": 0}, {"id": 9, "name": "\u0421\u0438\u0442\u0438 \u0421\u0435\u0440\u0432\u0438\u0441", "color": "#14b8a6", "description": "", "archived": 0}, {"id": 10, "name": "\u0421\u0438\u0451\u043c\u0430 \u041c\u043e\u043b\u043b", "color": "#f43f5e", "description": "", "archived": 0}, {"id": 11, "name": "\u041a\u043e\u0445\u0438 \u041f\u0430\u0440\u0444\u0435\u043d\u043e\u043d", "color": "#06b6d4", "description": "", "archived": 0}, {"id": 12, "name": "\u0410\u043a\u0438\u0430 \u0410\u0432\u0435\u0441\u0442\u043e", "color": "#3b82f6", "description": "", "archived": 0}, {"id": 13, "name": "\u041a\u041e\u0414", "color": "#eab308", "description": "", "archived": 0}, {"id": 14, "name": "\u041c\u0435\u0442\u0430\u043b\u043b\u0413\u0440\u0438\u0434", "color": "#14b8a6", "description": "", "archived": 0}, {"id": 15, "name": "ZSCD", "color": "#22c55e", "description": "", "archived": 0}, {"id": 16, "name": "MindsJunior", "color": "#f97316", "description": "", "archived": 0}, {"id": 17, "name": "\u0422\u0415\u0421\u0424", "color": "#ec4899", "description": "", "archived": 0}, {"id": 18, "name": "\u041f\u0430\u0439\u0432\u0430\u043d\u0434", "color": "#3b82f6", "description": "", "archived": 0}, {"id": 19, "name": "\u041e\u043b\u0443\u0447\u0430 \u0422\u0430\u043a\u0441\u0438", "color": "#f43f5e", "description": "", "archived": 0}, {"id": 20, "name": "\u0427\u0438\u043b\u0442\u0430\u043d", "color": "#6366f1", "description": "", "archived": 0}];
  let u=0, p=0;
  users.forEach(user => {
    try { db.prepare('INSERT OR IGNORE INTO users (id,name,email,password,role,avatar_color,telegram_id,telegram_token,permissions) VALUES (?,?,?,?,?,?,?,?,?)').run(user.id,user.name,user.email,user.password,user.role,user.avatar_color||'#6366f1',user.telegram_id||'',user.telegram_token||'',user.permissions||'{}'); u++; } catch(e){}
  });
  projects.forEach(proj => {
    try { db.prepare('INSERT OR IGNORE INTO projects (id,name,color,description,archived) VALUES (?,?,?,?,?)').run(proj.id,proj.name,proj.color||'#6366f1',proj.description||'',proj.archived||0); p++; } catch(e){}
  });
  res.json({ ok:true, users: db.prepare('SELECT COUNT(*) as c FROM users').get().c, projects: db.prepare('SELECT COUNT(*) as c FROM projects').get().c });
});

// ─── Admin Telegram Broadcast ─────────────────────────────────────────────────
app.post('/api/admin/broadcast', auth, adminOnly, (req, res) => {
  const { user_ids, message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Введите текст сообщения' });
  if (!Array.isArray(user_ids) || user_ids.length === 0) return res.status(400).json({ error: 'Выберите хотя бы одного сотрудника' });

  const sender = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  const text = `📢 *Сообщение от руководства*\n\n${message.trim()}\n\n— _${sender?.name || 'Администратор'}_`;

  let sent = 0, noTelegram = 0;
  user_ids.forEach(uid => {
    const user = db.prepare('SELECT name, telegram_id FROM users WHERE id=?').get(uid);
    if (user?.telegram_id) {
      sendTelegramNotification(user.telegram_id, text);
      sent++;
    } else {
      noTelegram++;
    }
  });

  res.json({ ok: true, sent, noTelegram });
});

// SPA fallback
// ─── Google Calendar ──────────────────────────────────────────────────────────
// ─── Local Calendar ───────────────────────────────────────────────────────────
function _calExpandRecurring(rows, timeMin, timeMax) {
  const events = [];
  const tMin = timeMin ? new Date(timeMin) : null;
  const tMax = timeMax ? new Date(timeMax) : null;
  for (const r of rows) {
    const push = (startDt, endDt) => {
      const s = new Date(startDt), e = new Date(endDt);
      if (tMin && e < tMin) return;
      if (tMax && s > tMax) return;
      events.push({
        id: r.id, summary: r.title, description: r.description,
        location: r.location, recurrence: r.recurrence,
        start: { dateTime: startDt }, end: { dateTime: endDt },
        creator: { name: r.creator_name, color: r.creator_color, img: r.creator_img },
        created_by: r.created_by,
        attendees: r.attendees_raw
          ? r.attendees_raw.split('|').map(a => { const [id,name,color]=a.split(':'); return {id:+id,name,color}; })
          : []
      });
    };
    const rec = r.recurrence || 'none';
    const origStart = new Date(r.start_dt), origEnd = new Date(r.end_dt);
    const duration = origEnd - origStart;
    if (rec === 'none') { push(r.start_dt, r.end_dt); continue; }
    // expand up to 1 year from original start, capped by recurrence_until
    const limit = new Date(origStart); limit.setFullYear(limit.getFullYear() + 1);
    const until = r.recurrence_until ? new Date(r.recurrence_until) : limit;
    let cur = new Date(origStart);
    while (cur <= limit && cur <= until) {
      const curEnd = new Date(cur.getTime() + duration);
      push(cur.toISOString(), curEnd.toISOString());
      if (rec === 'daily')        cur.setDate(cur.getDate() + 1);
      else if (rec === 'weekly')  cur.setDate(cur.getDate() + 7);
      else if (rec === 'monthly') cur.setMonth(cur.getMonth() + 1);
      else break;
      if (tMax && cur > tMax) break;
    }
  }
  return events;
}

app.get('/api/calendar/events', auth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const { timeMin, timeMax } = req.query;
  let sql = `
    SELECT e.*, u.name as creator_name, u.avatar_color as creator_color, u.avatar_img as creator_img,
      (SELECT GROUP_CONCAT(ce.user_id||':'||us.name||':'||COALESCE(us.avatar_color,'#6366f1'), '|')
       FROM calendar_attendees ce JOIN users us ON us.id=ce.user_id WHERE ce.event_id=e.id) as attendees_raw
    FROM calendar_events e
    LEFT JOIN users u ON u.id = e.created_by
    WHERE 1=1
  `;
  const params = [];
  if (!isAdmin) {
    sql += ` AND (e.created_by=? OR EXISTS (SELECT 1 FROM calendar_attendees WHERE event_id=e.id AND user_id=?))`;
    params.push(req.user.id, req.user.id);
  }
  sql += ' ORDER BY e.start_dt';
  const rows = db.prepare(sql).all(...params);
  res.json(_calExpandRecurring(rows, timeMin, timeMax));
});

app.post('/api/calendar/events', auth, (req, res) => {
  const { summary, description, location, start, end, attendees, recurrence } = req.body;
  if (!summary || !start || !end) return res.status(400).json({ error: 'summary/start/end required' });
  const r = db.prepare(`INSERT INTO calendar_events (title,description,location,start_dt,end_dt,created_by,recurrence)
    VALUES (?,?,?,?,?,?,?)`).run(summary, description||'', location||'', start, end, req.user.id, recurrence||'none');
  const id = r.lastInsertRowid;
  if (Array.isArray(attendees) && attendees.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO calendar_attendees (event_id,user_id) VALUES (?,?)');
    for (const uid of attendees) ins.run(id, uid);
    // Telegram notifications — notify all attendees including creator
    const creator = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
    const startFmt = new Date(start).toLocaleString('ru',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
    const notifyIds = new Set(attendees);
    notifyIds.add(req.user.id); // always notify creator too
    for (const uid of notifyIds) {
      const u = db.prepare('SELECT telegram_id FROM users WHERE id=?').get(uid);
      if (u?.telegram_id) {
        sendTelegramNotification(u.telegram_id,
          `📅 *Новое событие*\n\n*${summary}*\n🕐 ${startFmt}\n👤 Организатор: ${creator?.name||'—'}${location?'\n📍 '+location:''}`);
      }
    }
  }
  res.json({ id, ok: true });
});

app.patch('/api/calendar/events/:id', auth, (req, res) => {
  const ev = db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  if (ev.created_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { summary, description, location, start, end, attendees, recurrence } = req.body;
  db.prepare(`UPDATE calendar_events SET title=COALESCE(?,title), description=COALESCE(?,description),
    location=COALESCE(?,location), start_dt=COALESCE(?,start_dt), end_dt=COALESCE(?,end_dt),
    recurrence=COALESCE(?,recurrence), updated_at=datetime('now') WHERE id=?`)
    .run(summary||null, description??null, location??null, start||null, end||null, recurrence||null, req.params.id);
  if (Array.isArray(attendees)) {
    const oldAttendees = db.prepare('SELECT user_id FROM calendar_attendees WHERE event_id=?').all(req.params.id).map(r=>r.user_id);
    db.prepare('DELETE FROM calendar_attendees WHERE event_id=?').run(req.params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO calendar_attendees (event_id,user_id) VALUES (?,?)');
    const newSet = new Set(attendees);
    const oldSet = new Set(oldAttendees);
    for (const uid of attendees) ins.run(req.params.id, uid);
    // notify newly added attendees
    const updEv = db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id);
    const creator = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
    const startFmt = new Date(updEv.start_dt).toLocaleString('ru',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
    for (const uid of attendees) {
      if (oldSet.has(uid) || uid === req.user.id) continue;
      const u = db.prepare('SELECT telegram_id FROM users WHERE id=?').get(uid);
      if (u?.telegram_id) {
        sendTelegramNotification(u.telegram_id,
          `📅 *Вас добавили в событие*\n\n*${updEv.title}*\n🕐 ${startFmt}\n👤 Организатор: ${creator?.name||'—'}${updEv.location?'\n📍 '+updEv.location:''}`);
      }
    }
  }
  res.json({ ok: true });
});

app.delete('/api/calendar/events/:id', auth, (req, res) => {
  const ev = db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  if (ev.created_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { mode, from } = req.query;
  if (mode === 'this_and_following' && from && ev.recurrence && ev.recurrence !== 'none') {
    // set recurrence_until to one step before `from`
    const fromDate = new Date(from);
    // subtract 1 second so expansion stops before this occurrence
    const until = new Date(fromDate.getTime() - 1000);
    db.prepare("UPDATE calendar_events SET recurrence_until=? WHERE id=?").run(until.toISOString(), req.params.id);
  } else {
    db.prepare('DELETE FROM calendar_events WHERE id=?').run(req.params.id);
  }
  res.json({ ok: true });
});

// ─── Duty Schedule ────────────────────────────────────────────────────────────
app.get('/api/duty', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, u.avatar_color, u.avatar_img
    FROM duty_schedule d
    LEFT JOIN users u ON u.id = d.user_id
    ORDER BY d.week_start, d.employee_name
  `).all();
  // Group by week
  const weeks = {};
  for (const r of rows) {
    if (!weeks[r.week_start]) weeks[r.week_start] = [];
    weeks[r.week_start].push(r);
  }
  res.json({ weeks });
});

app.post('/api/duty', auth, requirePerm('manage_team'), (req, res) => {
  const { entries } = req.body; // [{week_start, employee_name, user_id, comment}]
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'entries required' });
  const ins = db.prepare('INSERT INTO duty_schedule (week_start, employee_name, user_id, comment) VALUES (?,?,?,?)');
  for (const e of entries) ins.run(e.week_start, e.employee_name, e.user_id || null, e.comment || '');
  res.json({ ok: true });
});

app.delete('/api/duty/:id', auth, requirePerm('manage_team'), (req, res) => {
  db.prepare('DELETE FROM duty_schedule WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Clear entire week and replace
app.put('/api/duty/week/:week_start', auth, requirePerm('manage_team'), (req, res) => {
  const { week_start } = req.params;
  const { entries } = req.body;
  db.prepare('DELETE FROM duty_schedule WHERE week_start=?').run(week_start);
  if (Array.isArray(entries) && entries.length > 0) {
    const ins = db.prepare('INSERT INTO duty_schedule (week_start, employee_name, user_id, comment) VALUES (?,?,?,?)');
    for (const e of entries) ins.run(week_start, e.employee_name, e.user_id || null, e.comment || '');
  }
  res.json({ ok: true });
});

// ─── Timesheet (Табель рабочего времени) ──────────────────────────────────────

// Helper: ensure users with role='employee' are in timesheet_employees
function syncTimesheetEmployees() {
  const users = db.prepare("SELECT id, name, avatar_color FROM users WHERE role='employee'").all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO timesheet_employees (user_id, name, color, is_active)
    VALUES (?, ?, ?, 1)
  `);
  for (const u of users) {
    const exists = db.prepare('SELECT id FROM timesheet_employees WHERE user_id=?').get(u.id);
    if (!exists) {
      insert.run(u.id, u.name, u.avatar_color || '#6366f1');
    }
  }
}

// Helper: ensure holidays are seeded for the year of a given month string (YYYY-MM)
function ensureHolidaysForYear(yearStr) {
  const yr = parseInt(yearStr, 10);
  if (!yr) return;
  const seeds = [
    ['01-01', 'Новый год'],
    ['03-08', '8 марта'],
    ['03-21', 'Навруз'],
    ['03-22', 'Навруз'],
    ['03-23', 'Навруз'],
    ['05-09', 'День Победы'],
    ['06-27', 'День национального единства'],
    ['09-09', 'День независимости'],
    ['11-06', 'День Конституции'],
    ['12-31', 'Новый год (канун)'],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO timesheet_holidays (date, name, is_custom) VALUES (?, ?, 0)');
  for (const [md, name] of seeds) {
    ins.run(`${yr}-${md}`, name);
  }
}

// GET /api/timesheet/employees
app.get('/api/timesheet/employees', auth, (req, res) => {
  syncTimesheetEmployees();
  const employees = db.prepare('SELECT * FROM timesheet_employees WHERE is_active=1 ORDER BY id').all();
  res.json(employees);
});

// POST /api/timesheet/employees
app.post('/api/timesheet/employees', auth, (req, res) => {
  const { name, position, salary, bonus, advance, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Имя обязательно' });
  const result = db.prepare(`
    INSERT INTO timesheet_employees (name, position, salary, bonus, advance, color, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(name.trim(), position || '', parseInt(salary) || 0, parseInt(bonus) || 0, parseInt(advance) || 0, color || '#6366f1');
  const emp = db.prepare('SELECT * FROM timesheet_employees WHERE id=?').get(result.lastInsertRowid);
  res.json(emp);
});

// PUT /api/timesheet/employees/:id
app.put('/api/timesheet/employees/:id', auth, (req, res) => {
  const { name, position, salary, bonus, advance, color } = req.body;
  const id = parseInt(req.params.id);
  if (!name) return res.status(400).json({ error: 'Имя обязательно' });
  db.prepare(`
    UPDATE timesheet_employees SET name=?, position=?, salary=?, bonus=?, advance=?, color=? WHERE id=?
  `).run(name.trim(), position || '', parseInt(salary) || 0, parseInt(bonus) || 0, parseInt(advance) || 0, color || '#6366f1', id);
  const emp = db.prepare('SELECT * FROM timesheet_employees WHERE id=?').get(id);
  res.json(emp);
});

// DELETE /api/timesheet/employees/:id
app.delete('/api/timesheet/employees/:id', auth, (req, res) => {
  db.prepare('UPDATE timesheet_employees SET is_active=0 WHERE id=?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// GET /api/timesheet/month?month=YYYY-MM
app.get('/api/timesheet/month', auth, (req, res) => {
  const month = req.query.month || localMonth();
  const [yearStr, moStr] = month.split('-');
  ensureHolidaysForYear(yearStr);
  syncTimesheetEmployees();

  const year = parseInt(yearStr);
  const mo = parseInt(moStr);
  const daysInMonth = new Date(year, mo, 0).getDate();

  // Build days array with weekend/holiday info
  const holidayRows = db.prepare(
    "SELECT date, name FROM timesheet_holidays WHERE date LIKE ?"
  ).all(`${month}%`);
  const holidayMap = {};
  for (const h of holidayRows) {
    holidayMap[h.date] = h.name;
  }

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, '0');
    const dateStr = `${month}-${dd}`;
    const dow = new Date(year, mo - 1, d).getDay(); // 0=Sun,6=Sat
    const isWeekend = dow === 0 || dow === 6;
    const holidayName = holidayMap[dateStr] || null;
    days.push({
      day: d,
      date: dateStr,
      dow,
      is_weekend: isWeekend ? 1 : 0,
      is_holiday: holidayName ? 1 : 0,
      holiday_name: holidayName,
    });
  }

  // Employees
  const employees = db.prepare('SELECT * FROM timesheet_employees WHERE is_active=1 ORDER BY id').all();

  // Records for the month
  const records = db.prepare(
    "SELECT employee_id, date, status, hours FROM timesheet_records WHERE date LIKE ?"
  ).all(`${month}%`);

  // Build records map: { employee_id: { 'YYYY-MM-DD': { status, hours } } }
  const recordsMap = {};
  for (const r of records) {
    if (!recordsMap[r.employee_id]) recordsMap[r.employee_id] = {};
    recordsMap[r.employee_id][r.date] = { status: r.status, hours: r.hours };
  }

  res.json({ month, employees, days, records: recordsMap });
});

// POST /api/timesheet/record — upsert a single day record
app.post('/api/timesheet/record', auth, (req, res) => {
  const { employee_id, date, status, hours } = req.body;
  if (!employee_id || !date || !status) return res.status(400).json({ error: 'employee_id, date, status обязательны' });
  const validStatuses = ['work', 'absent', 'holiday', 'weekend'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Неверный статус' });

  db.prepare(`
    INSERT INTO timesheet_records (employee_id, date, status, hours)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET status=excluded.status, hours=excluded.hours
  `).run(parseInt(employee_id), date, status, parseInt(hours) || 8);

  res.json({ ok: true });
});

// DELETE /api/timesheet/record — remove a record (reset to "not set")
app.delete('/api/timesheet/record', auth, (req, res) => {
  const { employee_id, date } = req.body;
  if (!employee_id || !date) return res.status(400).json({ error: 'employee_id, date обязательны' });
  db.prepare('DELETE FROM timesheet_records WHERE employee_id=? AND date=?').run(parseInt(employee_id), date);
  res.json({ ok: true });
});

// GET /api/timesheet/holidays
app.get('/api/timesheet/holidays', auth, (req, res) => {
  const holidays = db.prepare('SELECT * FROM timesheet_holidays ORDER BY date').all();
  res.json(holidays);
});

// POST /api/timesheet/holidays — add custom holiday
app.post('/api/timesheet/holidays', auth, (req, res) => {
  const { date, name } = req.body;
  if (!date || !name) return res.status(400).json({ error: 'date и name обязательны' });
  try {
    db.prepare('INSERT INTO timesheet_holidays (date, name, is_custom) VALUES (?, ?, 1)').run(date, name.trim());
    const row = db.prepare('SELECT * FROM timesheet_holidays WHERE date=?').get(date);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Праздник на эту дату уже существует' });
  }
});

// DELETE /api/timesheet/holidays/:id — only custom holidays
app.delete('/api/timesheet/holidays/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM timesheet_holidays WHERE id=?').get(parseInt(req.params.id));
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  if (!row.is_custom) return res.status(403).json({ error: 'Нельзя удалить системный праздник' });
  db.prepare('DELETE FROM timesheet_holidays WHERE id=?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// GET /api/timesheet/export?month=YYYY-MM — export Excel matching template format
app.get('/api/timesheet/export', auth, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const moStr = String(mo).padStart(2, '0');
    const fromStr = `01.${moStr}.${yr}`;
    const toStr = `${String(daysInMonth).padStart(2, '0')}.${moStr}.${yr}`;

    const holidays = db.prepare("SELECT date FROM timesheet_holidays").all().map(r => r.date);
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateStr = `${yr}-${moStr}-${String(day).padStart(2, '0')}`;
      const dow = new Date(yr, mo - 1, day).getDay();
      return { day, dateStr, isWeekend: dow === 0 || dow === 6, isHoliday: holidays.includes(dateStr) };
    });
    const workingDays = days.filter(d => !d.isWeekend && !d.isHoliday).length;

    const employees = db.prepare("SELECT * FROM timesheet_employees WHERE is_active=1 ORDER BY id").all();
    const recRows = db.prepare("SELECT * FROM timesheet_records WHERE strftime('%Y-%m', date)=?").all(month);
    const records = {};
    recRows.forEach(r => { if (!records[r.employee_id]) records[r.employee_id] = {}; records[r.employee_id][r.date] = r; });

    // Column layout (1-based, no hidden merge cols):
    // A=№, B=ФИО, C=Должность, D..=дни, then Р/Д, Часов, Всего, Оклад, Аванс, ЗП, БО, ОТ
    const C_NUM  = 1;
    const C_FIO  = 2;
    const C_POS  = 3;
    const C_DAY  = 4;
    const C_LAST = C_DAY + daysInMonth - 1;
    const C_RD   = C_LAST + 1;
    const C_HRS  = C_LAST + 2;
    const C_DAYS = C_LAST + 3;
    const C_OKL  = C_LAST + 4;
    const C_AVN  = C_LAST + 5;
    const C_ZP   = C_LAST + 6;
    const C_BO   = C_LAST + 7;
    const C_OT   = C_LAST + 8;
    const LAST_COL = C_OT;

    const wb = new ExcelJS.Workbook();
    const MONTH_NAMES_RU = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
    const ws = wb.addWorksheet(MONTH_NAMES_RU[mo-1] + ' ' + yr, {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });

    const bt = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
    const hF  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9D9D9'} };
    const wkF = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEEEEEE'} };
    const hdr = { bold:true, size:8 };
    const base= { size:9 };
    const ca  = { horizontal:'center', vertical:'middle', wrapText:true };
    const la  = { horizontal:'left',   vertical:'middle', wrapText:true };

    const sc = (row, col, val, font, fill, align, border) => {
      const c = row.getCell(col);
      c.value = val;
      if (font)   c.font      = font;
      if (fill)   c.fill      = fill;
      if (align)  c.alignment = align;
      if (border) c.border    = border;
      return c;
    };
    const mc = (r1, c1, r2, c2) => ws.mergeCells(r1, c1, r2, c2);

    // Col widths
    ws.getColumn(C_NUM).width  = 4;
    ws.getColumn(C_FIO).width  = 16;
    ws.getColumn(C_POS).width  = 11;
    for (let i = 0; i < daysInMonth; i++) ws.getColumn(C_DAY + i).width = 2.8;
    ws.getColumn(C_RD).width   = 5;
    ws.getColumn(C_HRS).width  = 6;
    ws.getColumn(C_DAYS).width = 6;
    ws.getColumn(C_OKL).width  = 8;
    ws.getColumn(C_AVN).width  = 6;
    ws.getColumn(C_ZP).width   = 8;
    ws.getColumn(C_BO).width   = 5;
    ws.getColumn(C_OT).width   = 5;

    // ── ROW 1: Title ──
    ws.addRow([]).height = 16;
    const rT = ws.lastRow;
    sc(rT, C_NUM, `1. Учет рабочего времени сотрудников`, {bold:true,size:11}, null, la, null);
    mc(1, C_NUM, 1, C_DAYS);
    sc(rT, C_OKL, `с ${fromStr} по ${toStr}`, {bold:true,size:10}, null, {horizontal:'right',vertical:'middle'}, null);
    mc(1, C_OKL, 1, LAST_COL);

    // ── ROW 2: Header row 1 — labels ──
    ws.addRow([]).height = 28;
    const rH1 = ws.lastRow; const H1 = rH1.number;
    sc(rH1, C_NUM, '№',         hdr, hF, ca, bt); mc(H1,C_NUM, H1+1,C_NUM);
    sc(rH1, C_FIO, 'ФИО',       hdr, hF, ca, bt); mc(H1,C_FIO, H1+1,C_FIO);
    sc(rH1, C_POS, 'Должность', hdr, hF, ca, bt); mc(H1,C_POS, H1+1,C_POS);
    sc(rH1, C_DAY, 'Отметки о явках и неявках на работу по числам месяца', hdr, hF, ca, bt);
    mc(H1, C_DAY, H1, C_LAST);
    sc(rH1, C_RD, 'Итого отработано за месяц часов', hdr, hF, ca, bt);
    mc(H1, C_RD, H1, LAST_COL);

    // ── ROW 3: Header row 2 — day numbers + sub-col labels ──
    ws.addRow([]).height = 13;
    const rH2 = ws.lastRow;
    for (let i = 0; i < daysInMonth; i++) {
      const d = days[i];
      const wk = d.isWeekend || d.isHoliday;
      const c = rH2.getCell(C_DAY + i);
      c.value = d.day; c.fill = hF; c.border = bt; c.alignment = ca;
      c.font = wk ? {bold:true, color:{argb:'FFCC0000'}, size:8} : hdr;
    }
    sc(rH2, C_RD,   'Р/Д',        hdr, hF, ca, bt);
    sc(rH2, C_HRS,  'Часов',       hdr, hF, ca, bt);
    sc(rH2, C_DAYS, 'Всего\nдней', hdr, hF, ca, bt);
    sc(rH2, C_OKL,  'Оклад',       hdr, hF, ca, bt);
    sc(rH2, C_AVN,  'Аванс',       hdr, hF, ca, bt);
    sc(rH2, C_ZP,   'ЗП',          hdr, hF, ca, bt);
    sc(rH2, C_BO,   'БО',          hdr, hF, ca, bt);
    sc(rH2, C_OT,   'ОТ',          hdr, hF, ca, bt);

    // ── Employee rows ──
    let totalEarned = 0;
    employees.forEach((emp, idx) => {
      const empRec = records[emp.id] || {};
      let workedDays = 0, workedHours = 0;
      const dayVals = days.map(d => {
        const rec = empRec[d.dateStr];
        if (rec?.status === 'work') { workedDays++; workedHours += rec.hours || 8; return rec.hours || 8; }
        if (rec?.status === 'absent') return 'Н';
        return null;
      });
      const earned = workingDays > 0 ? Math.round((emp.salary || 0) * workedDays / workingDays) : 0;
      totalEarned += earned;

      // Top row: work hours
      ws.addRow([]).height = 12;
      const rW = ws.lastRow; const RW = rW.number;
      sc(rW, C_NUM, idx+1, {bold:true,size:9}, null, ca, bt); mc(RW,C_NUM,RW+1,C_NUM);
      sc(rW, C_FIO, emp.name, base, null, la, bt);             mc(RW,C_FIO,RW+1,C_FIO);
      sc(rW, C_POS, emp.position||'', base, null, ca, bt);    mc(RW,C_POS,RW+1,C_POS);

      for (let i = 0; i < daysInMonth; i++) {
        const d = days[i]; const v = dayVals[i];
        const wk = d.isWeekend || d.isHoliday;
        const c = rW.getCell(C_DAY + i);
        c.value = wk ? null : v;
        c.border = bt; c.alignment = ca;
        c.font = { size:9, bold: typeof v === 'number' };
        if (wk) c.fill = wkF;
      }
      sc(rW, C_RD,   workingDays,     base, null, ca, bt); mc(RW,C_RD,  RW+1,C_RD);
      sc(rW, C_HRS,  workedHours,     base, null, ca, bt); mc(RW,C_HRS, RW+1,C_HRS);
      sc(rW, C_DAYS, workedDays,      base, null, ca, bt); mc(RW,C_DAYS,RW+1,C_DAYS);
      sc(rW, C_OKL,  emp.salary||0,   base, null, ca, bt); mc(RW,C_OKL, RW+1,C_OKL);
      sc(rW, C_AVN,  0,               base, null, ca, bt); mc(RW,C_AVN, RW+1,C_AVN);
      sc(rW, C_ZP,   earned,          {bold:true,size:9}, null, ca, bt); mc(RW,C_ZP,RW+1,C_ZP);
      sc(rW, C_BO,   0,               base, null, ca, bt); mc(RW,C_BO,  RW+1,C_BO);
      sc(rW, C_OT,   0,               base, null, ca, bt); mc(RW,C_OT,  RW+1,C_OT);

      // Bottom row: В for weekends
      ws.addRow([]).height = 10;
      const rB = ws.lastRow;
      for (let i = 0; i < daysInMonth; i++) {
        const d = days[i]; const wk = d.isWeekend || d.isHoliday;
        const v = dayVals[i];
        const c = rB.getCell(C_DAY + i);
        c.value = wk ? 'В' : null;
        c.border = bt; c.alignment = ca;
        c.font = { size:8, color:{ argb: wk ? 'FF0070C0' : 'FFCC0000'} };
        if (wk) c.fill = wkF;
      }
    });

    // ── Total row ──
    ws.addRow([]).height = 15;
    const rTot = ws.lastRow;
    sc(rTot, C_DAYS, 'Итого:', {bold:true,size:10}, null, {horizontal:'right',vertical:'middle'}, null);
    mc(rTot.number, C_NUM, rTot.number, C_DAYS);
    sc(rTot, C_ZP, totalEarned, {bold:true,size:11,color:{argb:'FF006400'}}, null, ca, null);
    mc(rTot.number, C_OKL, rTot.number, LAST_COL);

    res.setHeader('Content-Disposition', `attachment; filename="tabel_${month}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});


app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ─── Push Notifications ────────────────────────────────────────────────────────

app.get('/api/push/vapid-public-key', auth, (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

app.post('/api/push/subscribe', auth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
  db.prepare(`INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)`).run(req.user.id, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

app.delete('/api/push/subscribe', auth, (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(req.user.id, endpoint);
  res.json({ ok: true });
});

function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(userId);
  for (const s of subs) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload))
      .catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(s.endpoint);
        }
      });
  }
}
module.exports = { sendPushToUser };

initDB();
startScheduler(sseClients);
app.listen(PORT, () => {
  console.log(`\n🚀 TeamTask запущен → http://localhost:${PORT}`);
  console.log('   Логин: admin@teamtask.com | Пароль: admin123\n');
});
