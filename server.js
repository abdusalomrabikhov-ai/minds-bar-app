require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, initDB } = require('./database');
const { sendTelegramNotification, processWebhookUpdate, WEBHOOK_PATH } = require('./bot');
const { startScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'teamtask-secret-key-change-me';

// SSE clients: Map<userId, res[]>
const sseClients = new Map();

function sendSSE(userId, data) {
  const clients = sseClients.get(userId) || [];
  clients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

function sendSSEAll(data) {
  sseClients.forEach(clients => clients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`)));
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
    req.user = { ...decoded, role: row?.role || decoded.role, permissions: row?.permissions || '{}' };
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

app.post('/api/auth/login', (req, res) => {
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
  db.prepare('DELETE FROM notifications WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM tasks WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  sendSSEAll({ type: 'project_deleted', id: parseInt(req.params.id) });
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
    `📋 *Новая задача*\n\n*${task.title}*${desc}${proj}\n⚡ *Приоритет:* ${prio}${dl}`
  );
}

// ─── Content Plan ─────────────────────────────────────────────────────────────

function cpLabel(type) {
  return { post: 'ПОСТ', reel: 'РИЛС', story: 'СТОРИС' }[type] || type.toUpperCase();
}

function syncTasksForItem(item, projectId, createdBy) {
  const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
  const members = db.prepare('SELECT user_id FROM project_members WHERE project_id = ?').all(projectId);
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
  // Remove user from assignees on all content tasks in this project
  db.prepare(`DELETE FROM task_assignees WHERE user_id = ? AND task_id IN (
    SELECT id FROM tasks WHERE project_id = ? AND source_content_id IS NOT NULL
  )`).run(req.params.userId, req.params.id);
  // Delete tasks that now have no remaining assignees
  db.prepare(`DELETE FROM tasks WHERE project_id = ? AND source_content_id IS NOT NULL
    AND id NOT IN (SELECT DISTINCT task_id FROM task_assignees)`).run(req.params.id);
  res.json({ ok: true });
});

// ─── Content CRUD ─────────────────────────────────────────────────────────────

app.post('/api/projects/:id/content/item', auth, requirePerm('manage_projects'), (req, res) => {
  const { date, type, title, quantity } = req.body;
  if (!date || !type) return res.status(400).json({ error: 'Нет данных' });
  const r = db.prepare('INSERT INTO content_plan (project_id, date, type, title, quantity) VALUES (?,?,?,?,?)')
    .run(req.params.id, date, type, title || '', quantity || 1);
  const item = db.prepare('SELECT * FROM content_plan WHERE id = ?').get(r.lastInsertRowid);
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(req.params.id);
  syncTasksForItem(item, req.params.id, req.user.id);
  logActivity(req.user.id, 'content_created', 'project', parseInt(req.params.id), proj?.name, `${date} · ${type}${title ? ' · ' + title : ''}`);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put('/api/content/:id', auth, requirePerm('manage_projects'), (req, res) => {
  const row = db.prepare('SELECT * FROM content_plan WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  const { date, type, title, quantity } = req.body;
  db.prepare('UPDATE content_plan SET date=?, type=?, title=?, quantity=? WHERE id=?')
    .run(date ?? row.date, type ?? row.type, title !== undefined ? title : row.title, quantity ?? row.quantity, req.params.id);
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
  const stmt = db.prepare('INSERT INTO content_plan (project_id, date, type, title, quantity) VALUES (?, ?, ?, ?, ?)');
  let count = 0;
  items.forEach(item => {
    if (!item.date || !item.type) return;
    const r = stmt.run(req.params.id, item.date, item.type, item.title || '', item.quantity || 1);
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
  db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(allDone ? 'done' : anyDone ? 'in_progress' : 'new', taskId);
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

app.get('/api/tasks', auth, (req, res) => {
  const { project_id, assignee_id, status } = req.query;
  let where = '';
  const params = [];

  const userPerms = JSON.parse(req.user.permissions || '{}');
  if (req.user.role !== 'admin' && !userPerms.manage_team) {
    where += ' AND (t.assignee_id = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))';
    params.push(req.user.id, req.user.id);
  }
  if (project_id) { where += ' AND t.project_id = ?'; params.push(project_id); }
  if (assignee_id) {
    where += ' AND (t.assignee_id = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))';
    params.push(assignee_id, assignee_id);
  }
  if (status) { where += ' AND t.status = ?'; params.push(status); }

  res.json(enrichTasksWithAssignees(getTaskQuery(where, params)));
});

function calcNextDeadline(deadline, recurrence) {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (recurrence === 'daily') d.setDate(d.getDate() + 1);
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  else return null;
  return d.toISOString();
}

app.post('/api/tasks', auth, (req, res) => {
  const { title, description, project_id, assignee_id, assignee_ids, priority, deadline, recurrence } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Название задачи обязательно' });

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
  if (req.user.role !== 'admin' && !isAssigned) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  const { title, description, project_id, assignee_id, assignee_ids, priority, deadline, status, recurrence } = req.body;
  const newIds = Array.isArray(assignee_ids) ? assignee_ids.map(Number).filter(Boolean) : null;
  const newStatus = status || existing.status;
  const newAssignee = newIds ? (newIds[0] || null) : (assignee_id !== undefined ? (assignee_id || null) : existing.assignee_id);
  const newRecurrence = recurrence !== undefined ? (recurrence || 'none') : (existing.recurrence || 'none');

  db.prepare(`
    UPDATE tasks SET
      title = ?, description = ?, project_id = ?, assignee_id = ?,
      priority = ?, deadline = ?, status = ?, recurrence = ?, updated_at = CURRENT_TIMESTAMP
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
    const statusLabels = { new: 'Новая', in_progress: 'В работе', done: 'Готово ✅' };
    const message = `Статус задачи «${task.title}» изменён на: ${statusLabels[status] || status}`;
    const notifyIds = new Set();
    if (existing.created_by && existing.created_by !== req.user.id) notifyIds.add(existing.created_by);
    db.prepare("SELECT id FROM users WHERE role = 'admin'").all().forEach(a => {
      if (a.id !== req.user.id) notifyIds.add(a.id);
    });
    notifyIds.forEach(uid => {
      db.prepare(`INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, 'status_change', ?)`)
        .run(uid, task.id, message);
      sendSSE(uid, { type: 'status_changed', task, message });
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
      const recurLabels = { daily: 'ежедневная', weekly: 'еженедельная', monthly: 'ежемесячная' };
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

  const statusLabels = { new: 'Новая', in_progress: 'В работе', done: 'Готово' };
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
    .run(done ? 1 : 0, done ? new Date().toISOString() : null, req.params.id, targetId);
  recomputeTaskStatus(req.params.id);
  const task = enrichTasksWithAssignees(getTaskQuery(' AND t.id = ?', [req.params.id]))[0];
  if (done && task) {
    const allDone = (task.multi_assignees || []).every(a => a.done);
    const statusLabel = allDone ? 'Задача полностью выполнена ✅' : 'выполнил(а) свою часть';
    const actor = db.prepare('SELECT name FROM users WHERE id = ?').get(targetId);
    const message = allDone
      ? `Задача «${task.title}» выполнена всеми исполнителями ✅`
      : `${actor?.name} выполнил(а) свою часть задачи «${task.title}»`;
    const notifyIds = new Set();
    if (task.created_by && task.created_by !== targetId) notifyIds.add(task.created_by);
    db.prepare("SELECT id FROM users WHERE role = 'admin'").all().forEach(a => { if (a.id !== targetId) notifyIds.add(a.id); });
    notifyIds.forEach(uid => {
      db.prepare('INSERT INTO notifications (user_id, task_id, type, message) VALUES (?, ?, ?, ?)').run(uid, task.id, 'status_change', message);
      sendSSE(uid, { type: 'status_changed', task, message });
    });
  }
  res.json({ ok: true, status: task?.status });
});

app.delete('/api/tasks/:id', auth, adminOnly, (req, res) => {
  const task = db.prepare('SELECT title FROM tasks WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM notifications WHERE task_id = ?').run(req.params.id);
  db.prepare('DELETE FROM comments WHERE task_id = ?').run(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  sendSSEAll({ type: 'task_deleted', id: parseInt(req.params.id) });
  logActivity(req.user.id, 'task_deleted', 'task', parseInt(req.params.id), task?.title);
  res.json({ ok: true });
});

// ─── Task History ─────────────────────────────────────────────────────────────
app.get('/api/tasks/:id/history', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.params.id);
  res.json(rows);
});

// ─── Comments ─────────────────────────────────────────────────────────────────

app.get('/api/tasks/:id/comments', auth, (req, res) => {
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
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Текст обязателен' });
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
      const matched = allUsers.find(u =>
        u.name.toLowerCase().startsWith(mention.toLowerCase()) && u.id !== req.user.id
      );
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
  const permsJson = permissions !== undefined ? JSON.stringify(permissions) : user.permissions;
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
  const base64Data = avatar_img.replace(/^data:image\/\w+;base64,/, '');
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
    dateWhere = " AND strftime('%Y-%m', t.created_at) = ?";
    dateParams.push(month);
  }

  const employees = db.prepare(
    "SELECT id, name, avatar_color FROM users WHERE role = 'employee' ORDER BY name"
  ).all();

  const report = employees.map(user => {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN status != 'done' AND deadline IS NOT NULL AND (length(deadline) > 10 AND deadline < datetime('now') OR length(deadline) <= 10 AND deadline < date('now')) THEN 1 ELSE 0 END) as overdue
      FROM tasks t
      WHERE t.assignee_id = ? ${dateWhere}
    `).get(user.id, ...dateParams);

    const byProject = db.prepare(`
      SELECT p.name, p.color,
        COUNT(*) as total,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? ${dateWhere}
      GROUP BY p.id
      ORDER BY total DESC
    `).all(user.id, ...dateParams);

    return { ...user, stats: stats || { total: 0, done: 0, in_progress: 0, new_count: 0, overdue: 0 }, byProject };
  });

  res.json(report);
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
  const rows = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
  res.json(rows);
});

// ─── Best Employee ────────────────────────────────────────────────────────────
app.get('/api/best-employee', auth, (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  function calcMonth(m) {
    const users = db.prepare("SELECT id, name, avatar_color, avatar_img FROM users WHERE role='employee' ORDER BY name").all();
    return users.map(u => {
      // All tasks assigned to this user with deadline in month m
      const rows = db.prepare(`
        SELECT DISTINCT t.id, t.status, t.deadline, t.updated_at
        FROM tasks t
        LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
        WHERE (t.assignee_id = ? OR ta.user_id = ?)
          AND t.deadline IS NOT NULL AND t.deadline != ''
          AND strftime('%Y-%m', t.deadline) = ?
      `).all(u.id, u.id, u.id, m);

      const total       = rows.length;
      const doneOnTime  = rows.filter(t => t.status === 'done' && t.updated_at <= t.deadline).length;
      const doneLate    = rows.filter(t => t.status === 'done' && t.updated_at > t.deadline).length;
      const overdue     = rows.filter(t => t.status !== 'done').length;
      const done        = doneOnTime + doneLate;
      // Score: on-time fully weighted, late partially, overdue penalised
      const score = total > 0
        ? Math.round((doneOnTime * 100 + doneLate * 50) / total)
        : null; // null = no tasks assigned that month

      return { ...u, total, done, doneOnTime, doneLate, overdue, score };
    }).filter(u => u.total > 0) // only include employees with tasks that month
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.doneOnTime - a.doneOnTime || a.overdue - b.overdue);
  }

  // Current selected month
  const current = calcMonth(month);

  // History: last 12 months, find winner of each
  const history = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.toISOString().slice(0, 7);
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
  const { day, class_id, start_time, end_time, title, comment = '' } = req.body;
  if (day === undefined || class_id === undefined || !start_time || !end_time || !title)
    return res.status(400).json({ error: 'Заполните все поля' });
  if (start_time >= end_time)
    return res.status(400).json({ error: 'Время окончания должно быть позже начала' });
  const result = db.prepare(
    'INSERT INTO schedule (day, class_id, start_time, end_time, title, comment) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(day, class_id, start_time, end_time, title, comment);
  const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  logActivity(req.user.id, 'schedule_created', 'schedule', result.lastInsertRowid, title, `${days[day]} ${start_time}–${end_time}`);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/schedule/:id', auth, requirePerm('manage_schedule'), (req, res) => {
  const { day, class_id, start_time, end_time, title, comment = '' } = req.body;
  if (start_time >= end_time)
    return res.status(400).json({ error: 'Время окончания должно быть позже начала' });
  db.prepare(
    'UPDATE schedule SET day=?, class_id=?, start_time=?, end_time=?, title=?, comment=? WHERE id=?'
  ).run(day, class_id, start_time, end_time, title, comment, req.params.id);
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

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

initDB();
startScheduler(sseClients);
app.listen(PORT, () => {
  console.log(`\n🚀 TeamTask запущен → http://localhost:${PORT}`);
  console.log('   Логин: admin@teamtask.com | Пароль: admin123\n');
});
