require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'teamtask.db');
const db = new DatabaseSync(DB_PATH);

// Compatibility wrapper to match better-sqlite3-style API
function wrap(stmt) {
  return {
    run: (...args) => stmt.run(...args),
    get: (...args) => stmt.get(...args),
    all: (...args) => stmt.all(...args),
  };
}

// Patch db.prepare to return wrapped statement
const _prepare = db.prepare.bind(db);
db.prepare = (sql) => wrap(_prepare(sql));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'employee',
      avatar_color TEXT DEFAULT '#6366f1',
      telegram_id TEXT,
      telegram_token TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'new',
      priority TEXT DEFAULT 'medium',
      deadline TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT,
      message TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations
  try { db.exec("ALTER TABLE tasks ADD COLUMN recurrence TEXT DEFAULT 'none'"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '{}'"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN avatar_img TEXT DEFAULT NULL"); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS content_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT DEFAULT '',
    quantity INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, user_id)
  )`); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN source_content_id INTEGER REFERENCES content_plan(id) ON DELETE SET NULL"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_seen TEXT DEFAULT NULL"); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    entity_type TEXT DEFAULT NULL,
    entity_id INTEGER DEFAULT NULL,
    entity_title TEXT DEFAULT NULL,
    detail TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS task_assignees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    done INTEGER DEFAULT 0,
    done_at TEXT,
    UNIQUE(task_id, user_id)
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day INTEGER NOT NULL,
    class_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    title TEXT NOT NULL,
    comment TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  // Migration for existing installs that had schedule without comment column
  try { db.exec("ALTER TABLE schedule ADD COLUMN comment TEXT DEFAULT ''"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE projects ADD COLUMN archived INTEGER DEFAULT 0"); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    q1 INTEGER, q2 INTEGER, q3 INTEGER, q4 INTEGER, q5 INTEGER,
    q6 INTEGER, q7 INTEGER, q8 INTEGER, q9 INTEGER, q10 INTEGER,
    suggestion TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS task_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER,
    user_name TEXT,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}

  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (!admin) {
    db.prepare(`
      INSERT INTO users (name, email, password, role, avatar_color)
      VALUES (?, ?, ?, 'admin', '#6366f1')
    `).run('Администратор', 'admin@teamtask.com', bcrypt.hashSync('admin123', 10));
    console.log('✅ Создан администратор: admin@teamtask.com / пароль: admin123');
  }
}

module.exports = { db, initDB };
