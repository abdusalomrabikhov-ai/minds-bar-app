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
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA cache_size = -32000'); // 32MB cache
db.exec('PRAGMA temp_store = MEMORY');

function initDB() {
  // Indexes for frequently queried columns
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_date ON activity_log(created_at)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)'); } catch {}

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
  try { db.exec("ALTER TABLE content_plan ADD COLUMN description TEXT DEFAULT ''"); } catch {}
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
  try { db.exec("ALTER TABLE schedule ADD COLUMN teacher TEXT DEFAULT ''"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE projects ADD COLUMN archived INTEGER DEFAULT 0"); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    q1 INTEGER, q2 INTEGER, q3 INTEGER, q4 INTEGER, q5 INTEGER,
    q6 INTEGER, q7 INTEGER, q8 INTEGER, q9 INTEGER, q10 INTEGER,
    suggestion TEXT DEFAULT '',
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec("ALTER TABLE feedback ADD COLUMN archived INTEGER DEFAULT 0"); } catch {}
  // Finance enhancements
  try { db.exec("ALTER TABLE finance ADD COLUMN currency TEXT DEFAULT 'TJS'"); } catch {}
  try { db.exec("ALTER TABLE finance ADD COLUMN client_name TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE finance ADD COLUMN client_phone TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE finance ADD COLUMN is_recurring INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE finance ADD COLUMN overdue_notified INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE finance ADD COLUMN direction TEXT DEFAULT ''"); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS finance_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finance_id INTEGER NOT NULL REFERENCES finance(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    payment_type TEXT DEFAULT 'cash',
    payment_date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS finance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finance_id INTEGER NOT NULL REFERENCES finance(id) ON DELETE CASCADE,
    user_id INTEGER,
    user_name TEXT,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS ideahast_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#6366f1',
    status TEXT DEFAULT 'active',
    start_date TEXT NOT NULL,
    end_date TEXT DEFAULT '',
    client TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS finance_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    section TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT DEFAULT '',
    entity_id INTEGER DEFAULT NULL,
    entity_title TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    amount REAL DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}

  // Generic course tables — used by both B2C and Kids via `section` param
  try { db.exec(`CREATE TABLE IF NOT EXISTS kids_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    teacher TEXT DEFAULT '',
    teacher_phone TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS kids_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES kids_courses(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    course_amount REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    status TEXT DEFAULT 'unpaid',
    payment_method TEXT DEFAULT 'cash',
    received_by TEXT DEFAULT '',
    payment_date TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    receipt_img TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS b2c_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    teacher TEXT DEFAULT '',
    teacher_phone TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec("ALTER TABLE b2c_courses ADD COLUMN teacher_phone TEXT DEFAULT ''"); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS b2c_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES b2c_courses(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    course_amount REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    status TEXT DEFAULT 'unpaid',
    payment_method TEXT DEFAULT 'cash',
    received_by TEXT DEFAULT '',
    payment_date TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    receipt_img TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec("ALTER TABLE b2c_payments ADD COLUMN course_amount REAL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE b2c_payments ADD COLUMN receipt_img TEXT DEFAULT ''"); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    category TEXT DEFAULT 'other',
    comment TEXT DEFAULT '',
    month TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS finance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    project_name TEXT NOT NULL,
    service_amount REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'unpaid',
    payment_type TEXT DEFAULT 'cash',
    comment TEXT DEFAULT '',
    month TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
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

  try { db.exec(`CREATE TABLE IF NOT EXISTS payment_checklist_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    order_idx  INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS payment_checklist_checks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id         INTEGER NOT NULL REFERENCES payment_checklist_items(id) ON DELETE CASCADE,
    month           TEXT NOT NULL,
    checked         INTEGER DEFAULT 0,
    checked_at      TEXT,
    checked_by_id   INTEGER,
    checked_by_name TEXT,
    UNIQUE(item_id, month)
  )`); } catch {}

  // Seed default checklist items if table is empty
  const checklistCount = db.prepare('SELECT COUNT(*) as c FROM payment_checklist_items').get();
  if (checklistCount.c === 0) {
    const insert = db.prepare('INSERT INTO payment_checklist_items (name, order_idx) VALUES (?, ?)');
    ['Электроэнергия', 'Вода', 'Интернет', 'Вывоз мусора', 'Аренда'].forEach((name, i) => insert.run(name, i));
  }

  // ── HR Module ────────────────────────────────────────────────────────────────
  try { db.exec(`CREATE TABLE IF NOT EXISTS hr_employees (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    full_name          TEXT NOT NULL,
    position           TEXT NOT NULL DEFAULT '',
    hire_date          TEXT,
    termination_date   TEXT,
    termination_reason TEXT DEFAULT '',
    salary             REAL DEFAULT 0,
    status             TEXT DEFAULT 'active',
    notes              TEXT DEFAULT '',
    created_at         TEXT DEFAULT (datetime('now')),
    updated_at         TEXT DEFAULT (datetime('now'))
  )`); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS hr_position_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
    position    TEXT NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT,
    notes       TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  )`); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS hr_salary_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id    INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
    salary         REAL NOT NULL,
    effective_date TEXT NOT NULL,
    notes          TEXT DEFAULT '',
    created_at     TEXT DEFAULT (datetime('now'))
  )`); } catch {}

  // Password reset via Telegram
  try { db.exec("ALTER TABLE users ADD COLUMN reset_code TEXT DEFAULT NULL"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN reset_code_expires TEXT DEFAULT NULL"); } catch {}

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
