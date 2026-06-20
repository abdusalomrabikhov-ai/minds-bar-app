/* ═══════════════════════════════════════════════════════════════
   TeamTask — Frontend App
═══════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('tt_token'),
  user: JSON.parse(localStorage.getItem('tt_user') || 'null'),
  currentPage: 'dashboard',
  currentProjectId: null,
  currentEmployeeId: null,
  projects: [],
  users: [],
  notifCount: 0,
};

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DEL = (p) => api('DELETE', p);

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  const toastIcon = type === 'success' ? svgI(SVG_PATHS.check) : type === 'error' ? svgI(SVG_PATHS.xmark) : svgI(SVG_PATHS.info);
  el.innerHTML = `<span style="display:inline-flex;align-items:center">${toastIcon}</span> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(html, onClose) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" id="modal-overlay">${html}</div>`;
  const overlay = root.querySelector('.modal-overlay');
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  if (onClose) overlay._onClose = onClose;
}
function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay?._onClose) overlay._onClose();
  document.getElementById('modal-root').innerHTML = '';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function initials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function updateSidebarAvatar(u) {
  const av = document.getElementById('sidebar-avatar');
  if (!av) return;
  av.style.background = u.avatar_color || '#6366f1';
  if (u.avatar_img) {
    av.innerHTML = `<img src="${u.avatar_img}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block">`;
  } else {
    av.textContent = initials(u.name);
  }
}

function avatar(name, color, cls = '', imgUrl = '') {
  if (imgUrl) return `<div class="avatar ${cls}" style="background:${color||'#6366f1'};padding:0;overflow:hidden"><img src="${imgUrl}" style="width:100%;height:100%;object-fit:cover;display:block"></div>`;
  return `<div class="avatar ${cls}" style="background:${color || '#6366f1'}">${initials(name)}</div>`;
}

function fmtDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}

function taskPlural(n) {
  if (n % 10 === 1 && n % 100 !== 11) return n + ' задача';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return n + ' задачи';
  return n + ' задач';
}

function fmtDateShort(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  const now = new Date();
  const opts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleString('ru-RU', opts);
}

// For date-only deadlines (no time component) treat expiry as end of that day in local time
function parseDeadline(dt) {
  if (!dt) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(dt) ? new Date(dt + 'T23:59:59') : new Date(dt);
}

function deadlineClass(dt, status) {
  if (!dt || status === 'done') return 'deadline-ok';
  const diff = parseDeadline(dt) - Date.now();
  if (diff < 0) return 'deadline-overdue';
  if (diff < 24 * 60 * 60 * 1000) return 'deadline-soon';
  return 'deadline-ok';
}

function priorityBadge(p) {
  const map = {
    high:   [colorDot('#DC2626'), 'Высокий', 'badge-priority-high'],
    medium: [colorDot('#D97706'), 'Средний',  'badge-priority-medium'],
    low:    [colorDot('#059669'), 'Низкий',   'badge-priority-low'],
  };
  const [icon, label, cls] = map[p] || map.medium;
  return `<span class="badge ${cls}" style="gap:5px">${icon} ${label}</span>`;
}

function statusBadge(s) {
  const map = {
    new:         [colorDot('#3B82F6'), 'Новая',   'status-new'],
    in_progress: [colorDot('#D97706'), 'В работе','status-in_progress'],
    done:        [colorDot('#059669'), 'Готово',  'status-done'],
  };
  const [icon, label, cls] = map[s] || map.new;
  return `<span class="status-badge ${cls}" style="gap:5px">${icon} ${label}</span>`;
}

function projectBadge(name, color) {
  if (!name) return '';
  const bg = color + '22';
  return `<span class="project-badge" style="background:${bg};color:${color}">${name}</span>`;
}

function deadlineFmt(dt, status) {
  if (!dt) return '';
  const cls = deadlineClass(dt, status);
  const icon = cls === 'deadline-overdue'
    ? svgI(SVG_PATHS.warning)
    : cls === 'deadline-soon'
    ? svgI(SVG_PATHS.clock)
    : svgI(SVG_PATHS.cal);
  return `<span class="task-meta-item ${cls}" style="display:inline-flex;align-items:center;gap:4px">${icon} ${fmtDateShort(dt)}</span>`;
}

function recurrenceBadge(r) {
  if (!r || r === 'none') return '';
  const labels = { daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно' };
  return `<span class="recur-badge" style="display:inline-flex;align-items:center;gap:4px">${svgI(SVG_PATHS.repeat)} ${labels[r] || r}</span>`;
}

// ─── SVG Icon helpers ─────────────────────────────────────────────────────────
function svgI(d, size = 14, extra = '') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0" ${extra}>${d}</svg>`;
}
function colorDot(color, size = 8) {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${color};flex-shrink:0;vertical-align:middle"></span>`;
}

const SVG_PATHS = {
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  clock:   '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  cal:     '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  repeat:  '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
  check:   '<polyline points="20 6 9 17 4 12"/>',
  edit:    '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash:   '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
  comment: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  user:    '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users:   '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
  bars:    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>',
  folder:  '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
  clip:    '<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  send:    '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  key:     '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  crown:   '<path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/>',
  xmark:   '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  eye:     '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eye_off: '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>',
  camera:  '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
};

const COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#06b6d4'];

function colorPicker(selected, onChange) {
  const id = 'cp_' + Math.random().toString(36).slice(2);
  setTimeout(() => {
    document.querySelectorAll(`#${id} .color-dot`).forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll(`#${id} .color-dot`).forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        onChange(dot.dataset.color);
      });
    });
  }, 0);
  return `<div class="color-options" id="${id}">${COLORS.map(c =>
    `<div class="color-dot ${c === selected ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>`
  ).join('')}</div>`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  btn.textContent = 'Вхожу...';
  btn.disabled = true;
  try {
    const { token, user } = await POST('/auth/login', {
      email: document.getElementById('login-email').value,
      password: document.getElementById('login-password').value
    });
    state.token = token;
    state.user = user;
    localStorage.setItem('tt_token', token);
    localStorage.setItem('tt_user', JSON.stringify(user));
    initApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Войти';
    btn.disabled = false;
  }
});

function logout() {
  localStorage.removeItem('tt_token');
  localStorage.removeItem('tt_user');
  location.reload();
}

// ─── Permissions ──────────────────────────────────────────────────────────────
function can(perm) {
  if (state.user?.role === 'admin') return true;
  const perms = state.user?.permissions || {};
  return perms[perm] === true;
}

function roleLabel(user) {
  if (user.role === 'admin') return { text: 'Администратор', cls: 'role-admin' };
  const p = user.permissions || {};
  const active = [
    p.reports && 'отчёты',
    p.manage_projects && 'проекты',
    p.assign_tasks && 'задачи',
    p.manage_team && 'команда',
  ].filter(Boolean);
  if (active.length === 0) return { text: 'Сотрудник', cls: 'role-employee' };
  return { text: 'Менеджер', cls: 'role-manager' };
}

// ─── App Init ─────────────────────────────────────────────────────────────────
async function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').classList.remove('hidden');

  // Fetch fresh user data (including permissions)
  try {
    const me = await GET('/auth/me');
    state.user = { ...state.user, ...me };
    localStorage.setItem('tt_user', JSON.stringify(state.user));
  } catch {}

  const u = state.user;

  // Show/hide nav items by permission
  const showAdmin = u.role === 'admin';
  document.querySelectorAll('[data-perm]').forEach(el => {
    const perm = el.dataset.perm;
    el.classList.toggle('hidden', !can(perm));
  });
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !showAdmin);
  });
  if (showAdmin) {
    const navActivity = document.getElementById('nav-activity');
    if (navActivity) navActivity.style.display = '';
  }

  document.getElementById('sidebar-name').textContent = u.name;
  document.getElementById('sidebar-role').textContent = roleLabel(u).text;
  const av = document.getElementById('sidebar-avatar');
  updateSidebarAvatar(u);

  await loadSharedData();
  setupNavigation();
  setupProjectsToggle();
  setupSSE();
  setupNotifButton();
  checkNotifCount();

  document.getElementById('new-task-btn')?.addEventListener('click', () => openTaskModal());
  document.getElementById('add-project-btn')?.addEventListener('click', () => {
    if (can('manage_projects')) openProjectModal();
  });

  const saved = (() => { try { return sessionStorage.getItem('mb_page'); } catch { return null; } })();
  if (saved && saved.startsWith('project:')) {
    navigateTo('project', saved.split(':')[1]);
  } else if (saved && saved.startsWith('employee:')) {
    state.currentEmployeeId = parseInt(saved.split(':')[1]);
    navigateTo('employee');
  } else if (saved && saved.startsWith('user_activity:')) {
    const parts = saved.split(':');
    userActivityPeriod = parseInt(parts[2]) || 30;
    navigateTo('activity');
    openUserActivityPage(parseInt(parts[1]), userActivityPeriod);
  } else {
    navigateTo(saved && PAGE_TITLES[saved] ? saved : 'dashboard');
  }
}

async function loadSharedData() {
  try {
    [state.projects, state.users] = await Promise.all([GET('/projects'), GET('/users')]);
    renderSidebarProjects();
  } catch {}
}

function renderSidebarProjects() {
  const list = document.getElementById('sidebar-projects-list');
  list.innerHTML = state.projects.map(p => `
    <div class="project-tree-item" data-page="project" data-id="${p.id}">
      <span class="project-dot" style="background:${p.color}"></span>
      <span class="label">${p.name}</span>
      ${p.task_count > 0 ? `<span class="project-count">${p.done_count || 0}/${p.task_count}</span>` : ''}
    </div>
  `).join('');
  list.querySelectorAll('.project-tree-item').forEach(item => {
    item.addEventListener('click', () => navigateTo('project', item.dataset.id));
  });
}

function setupProjectsToggle() {
  const toggle = document.getElementById('sidebar-projects-toggle');
  const wrapper = document.getElementById('sidebar-projects-wrapper');
  const expanded = localStorage.getItem('mb_projects_expanded') !== 'false';
  if (!expanded) {
    toggle.classList.add('collapsed');
    wrapper.classList.add('collapsed');
  }
  toggle.addEventListener('click', () => {
    const isCollapsed = toggle.classList.toggle('collapsed');
    wrapper.classList.toggle('collapsed', isCollapsed);
    localStorage.setItem('mb_projects_expanded', String(!isCollapsed));
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('[data-page]').forEach(btn => {
    const page = btn.dataset.page;
    if (page === 'project') return;
    btn.addEventListener('click', () => {
      if (page === 'tasks') {
        tasksFilter = { status: '', priority: '', search: '', assignee_id: '', overdue: false };
      }
      navigateTo(page);
    });
  });
}

const PAGE_TITLES = {
  dashboard: 'Дашборд',
  tasks: 'Все задачи',
  mytasks: 'Мои задачи',
  team: 'Команда',
  reports: 'Отчёты',
  settings: 'Настройки',
  employee: 'Профиль сотрудника',
  activity: 'Активность',
};

function navigateTo(page, projectId = null) {
  state.currentPage = page;
  state.currentProjectId = projectId;
  try {
    const key = page === 'project' ? `project:${projectId}`
              : page === 'employee' ? `employee:${state.currentEmployeeId}`
              : page;
    sessionStorage.setItem('mb_page', key);
  } catch {}


  document.querySelectorAll('.nav-item, .project-tree-item').forEach(el => el.classList.remove('active'));
  if (page === 'project') {
    document.querySelectorAll(`[data-page="project"][data-id="${projectId}"]`).forEach(el => el.classList.add('active'));
  } else {
    document.querySelectorAll(`[data-page="${page}"]`).forEach(el => el.classList.add('active'));
  }

  const project = projectId ? state.projects.find(p => String(p.id) === String(projectId)) : null;
  document.getElementById('page-title').textContent = project ? project.name : (PAGE_TITLES[page] || page);

  const mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.scrollTop = 0;

  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';

  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'tasks':
      myTasksMode = false;
      renderTasksPage();
      break;
    case 'mytasks':
      myTasksMode = true;
      tasksFilter = { status: '', priority: '', search: '', assignee_id: String(state.user.id), overdue: false };
      renderTasksPage();
      break;
    case 'project': renderProjectPage(projectId); break;
    case 'team': renderTeamPage(); break;
    case 'reports': renderReportsPage(); break;
    case 'settings': renderSettingsPage(); break;
    case 'employee': renderEmployeeProfile(state.currentEmployeeId); break;
    case 'activity': renderActivityPage(); break;
  }
}

// ─── SSE ─────────────────────────────────────────────────────────────────────
function setupSSE() {
  setupSSEWithAuth();
}

function setupSSEWithAuth() {
  let reconnectDelay = 1000;
  function connect() {
    const xhr = new XMLHttpRequest();
    let lastIndex = 0;
    xhr.open('GET', '/api/events');
    xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.onreadystatechange = function() {
      if (xhr.readyState >= 3) {
        const chunk = xhr.responseText.slice(lastIndex);
        lastIndex = xhr.responseText.length;
        chunk.split('\n').forEach(line => {
          if (line.startsWith('data: ')) {
            try { handleSSEEvent(JSON.parse(line.slice(6))); } catch {}
          }
        });
      }
      if (xhr.readyState === 4) {
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
      }
    };
    xhr.send();
  }
  connect();
}

function handleSSEEvent(event) {
  switch (event.type) {
    case 'new_task':
    case 'notification':
      checkNotifCount();
      toast(event.message || 'Новое уведомление', 'success');
      if (state.currentPage === 'dashboard') renderDashboard();
      if (state.currentPage === 'tasks' || state.currentPage === 'mytasks') renderTasksPage();
      break;
    case 'task_updated':
      checkNotifCount();
      if (state.currentPage === 'dashboard') renderDashboard();
      if (state.currentPage === 'tasks' || state.currentPage === 'mytasks') renderTasksPage();
      if (state.currentPage === 'project') renderProjectPage(state.currentProjectId);
      break;
    case 'status_changed':
      checkNotifCount();
      toast(event.message || 'Статус задачи изменён');
      if (state.currentPage === 'dashboard') renderDashboard();
      if (state.currentPage === 'tasks' || state.currentPage === 'mytasks') renderTasksPage();
      if (state.currentPage === 'project') renderProjectPage(state.currentProjectId);
      break;
    case 'task_deleted':
      if (state.currentPage === 'dashboard') renderDashboard();
      if (state.currentPage === 'tasks' || state.currentPage === 'mytasks') renderTasksPage();
      if (state.currentPage === 'project') renderProjectPage(state.currentProjectId);
      break;
    case 'project_created':
    case 'project_updated':
    case 'project_deleted':
      loadSharedData().then(() => {
        if (state.currentPage === 'dashboard') renderDashboard();
        if (event.type === 'project_deleted' && String(state.currentProjectId) === String(event.id)) navigateTo('dashboard');
      });
      break;
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function checkNotifCount() {
  try {
    const { count } = await GET('/notifications/unread-count');
    state.notifCount = count;
    const dot = document.getElementById('notif-dot');
    if (count > 0) dot.classList.remove('hidden');
    else dot.classList.add('hidden');
    const btn = document.getElementById('notif-btn');
    if (btn) btn.title = count > 0 ? `Уведомления (${count})` : 'Уведомления';
  } catch {}
}

function setupNotifButton() {
  document.getElementById('notif-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const panel = document.getElementById('notif-panel');
    if (!panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="notif-empty">Загрузка...</div>';
    try {
      const notifs = await GET('/notifications');
      await PUT('/notifications/read-all');
      checkNotifCount();
      panel.innerHTML = `
        <div class="notif-panel-header">
          <span class="notif-panel-title" style="display:inline-flex;align-items:center;gap:6px">${svgI('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',15)} Уведомления</span>
          <button onclick="document.getElementById('notif-panel').classList.add('hidden')" class="btn btn-ghost btn-sm">✕</button>
        </div>
        ${notifs.length === 0 ? '<div class="notif-empty">Уведомлений нет</div>' :
          notifs.map(n => `
            <div class="notif-item ${n.read ? '' : 'unread'}">
              <div class="notif-item-msg">${n.message}</div>
              <div class="notif-item-time">${fmtDate(n.created_at)}</div>
            </div>
          `).join('')}
      `;
    } catch {
      panel.innerHTML = '<div class="notif-empty">Ошибка загрузки</div>';
    }
    document.addEventListener('click', function hidePanel(e) {
      if (!panel.contains(e.target) && e.target.id !== 'notif-btn') {
        panel.classList.add('hidden');
        document.removeEventListener('click', hidePanel);
      }
    });
  });
}

// ─── Dashboard Charts ─────────────────────────────────────────────────────────
function countUp(el, target, duration = 850, suffix = '') {
  if (!el) return;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min((now - t0) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * ease) + suffix;
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target + suffix;
  };
  requestAnimationFrame(step);
}

function renderMyTasksSummary(tasks) {
  const total = tasks.length;
  const done  = tasks.filter(t => t.status === 'done').length;
  const inp   = tasks.filter(t => t.status === 'in_progress').length;
  const nw    = tasks.filter(t => t.status === 'new').length;
  const ov    = tasks.filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) < new Date()).length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;

  const donutSlices = [
    { key: 'new',         label: 'Новые',    v: nw,  c: '#3B82F6' },
    { key: 'in_progress', label: 'В работе', v: inp, c: '#D97706' },
    { key: 'done',        label: 'Готово',   v: done,c: '#059669' },
  ];

  const bars = [
    { label: 'Новые',    v: nw,   c: '#3B82F6' },
    { label: 'В работе', v: inp,  c: '#D97706' },
    { label: 'Готово',   v: done, c: '#059669' },
    { label: 'Просрочено', v: ov, c: '#EF4444' },
  ];

  // Build project breakdown
  const projMap = {};
  tasks.forEach(t => {
    if (!t.project_name) return;
    if (!projMap[t.project_id]) projMap[t.project_id] = { name: t.project_name, color: t.project_color || '#881337', id: t.project_id, total: 0, done: 0, inp: 0, nw: 0, ov: 0, nextDeadline: null, nextDeadlineDt: null };
    const s = projMap[t.project_id];
    s.total++;
    if (t.status === 'done') s.done++;
    else if (t.status === 'in_progress') s.inp++;
    else s.nw++;
    if (t.status !== 'done' && t.deadline) {
      const dl = parseDeadline(t.deadline);
      if (dl < new Date()) s.ov++;
      else if (!s.nextDeadlineDt || dl < s.nextDeadlineDt) { s.nextDeadlineDt = dl; s.nextDeadline = t.deadline; }
    }
  });
  const projs = Object.values(projMap).sort((a, b) => (b.total - b.done) - (a.total - a.done));

  // Upcoming tasks: not done, deadline within 30 days from now
  const now = Date.now();
  const in30 = now + 30 * 24 * 60 * 60 * 1000;
  const upcoming = tasks
    .filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) > now && parseDeadline(t.deadline) <= in30)
    .sort((a, b) => parseDeadline(a.deadline) - parseDeadline(b.deadline));

  const fmtDayMonth = dt => {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(dt) ? new Date(dt + 'T00:00:00') : new Date(dt);
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short' });
  };
  const daysLeft = dt => Math.ceil((parseDeadline(dt) - now) / (1000 * 60 * 60 * 24));

  return `
    <div class="dash-stat-cards">
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({status:'new'})" title="Новые задачи">
        <div class="dsc-label">Всего задач</div>
        <div class="dsc-value"><span data-count="${total}">0</span></div>
        <div class="dsc-sub"><span data-count="${nw}">0</span> новых</div>
      </div>
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({status:'done'})" title="Выполненные задачи">
        <div class="dsc-label">Выполнено</div>
        <div class="dsc-value dsc-value--green"><span data-count="${pct}" data-suffix="%">0%</span></div>
        <div class="dsc-sub"><span data-count="${done}">0</span> из ${total}</div>
      </div>
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({overdue:true})" title="Просроченные задачи">
        <div class="dsc-label">Просрочено</div>
        <div class="dsc-value ${ov > 0 ? 'dsc-value--red' : ''}"><span data-count="${ov}">0</span></div>
        <div class="dsc-sub">${ov > 0 ? 'требуют внимания' : 'всё в порядке'}</div>
      </div>
    </div>

    <div class="mytasks-charts">
      <div class="chart-panel donut-wrap">
        <div class="chart-title">Статусы</div>
        ${svgDonut(donutSlices, total, 130)}
        <div class="donut-legend">
          ${[...donutSlices, { label: 'Просрочено', v: ov, c: '#EF4444' }].map(s => `
            <div class="donut-legend-item">
              <span class="donut-legend-dot" style="background:${s.c}"></span>
              <span>${s.label}</span>
              <span class="donut-legend-val">${s.v}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="chart-panel" style="display:flex;flex-direction:column;justify-content:space-between">
        <div>
          <div class="chart-title">Разбивка по статусам</div>
          ${total === 0
            ? '<div style="color:#94A3B8;font-size:12.5px;padding:8px 0">Задач нет</div>'
            : [
                { label: 'Новые',      v: nw,   c: '#3B82F6' },
                { label: 'В работе',   v: inp,  c: '#D97706' },
                { label: 'Готово',     v: done, c: '#059669' },
                { label: 'Просрочено', v: ov,   c: '#EF4444' },
              ].map(b => {
                const w = total > 0 ? Math.round(b.v / total * 100) : 0;
                const isOv = b.label === 'Просрочено';
                return `<div class="stat-bar-row">
                  <span class="stat-bar-label">
                    <span style="width:8px;height:8px;border-radius:50%;background:${b.c};display:inline-block;flex-shrink:0"></span>
                    ${b.label}
                  </span>
                  <div class="stat-bar-track">
                    <div class="stat-bar-fill" style="width:0%;background:${b.c}" data-bar-to="${w}%"></div>
                  </div>
                  <span class="stat-bar-count" style="${isOv && b.v > 0 ? 'color:#EF4444;font-weight:700' : ''}">${taskPlural(b.v)}</span>
                </div>`;
              }).join('')}
        </div>
        ${upcoming.length > 0 ? `
          <div class="stat-bar-footer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Дедлайн · ${fmtDayMonth(upcoming[0].deadline)}
            <span style="width:7px;height:7px;border-radius:50%;background:#059669;display:inline-block;margin-left:auto"></span>
            <span class="stat-bar-footer-pct">${pct}%</span>
          </div>
        ` : ''}
      </div>
    </div>

    ${projs.length > 0 ? `
    <div class="mytasks-proj-section">
      <div class="mytasks-proj-section-title">Мои проекты</div>
      <div class="mytasks-proj-cards">
        ${projs.map(s => {
          const p = s.total > 0 ? Math.round(s.done / s.total * 100) : 0;
          return `
            <div class="mytasks-proj-card" onclick="navigateTo('project',${s.id})" style="--proj-color:${s.color}">

              <div class="mpc-header" style="background:${s.color}">
                <div class="mpc-header-top">
                  <div class="mpc-title-row">
                    <span class="mpc-dot-white"></span>
                    <span class="mpc-proj-name">${s.name}</span>
                  </div>
                  ${s.nextDeadline ? `<span class="mpc-date-badge">${fmtDayMonth(s.nextDeadline)}</span>` : ''}
                </div>
                <div class="mpc-big-count">
                  <span class="mpc-big-done">${s.done}</span>
                  <span class="mpc-big-total">/${s.total}</span>
                </div>
                <div class="mpc-count-label">задач выполнено</div>
                <div class="mpc-prog-track">
                  <div class="mpc-prog-fill" style="width:${p}%"></div>
                </div>
              </div>

              <div class="mpc-stats-grid">
                <div class="mpc-sgrid-cell">
                  <div class="mpc-sgrid-num">${s.nw}</div>
                  <div class="mpc-sgrid-lbl">новых</div>
                </div>
                <div class="mpc-sgrid-cell mpc-sgrid-mid">
                  <div class="mpc-sgrid-num" style="color:#1D9E75">${s.done}</div>
                  <div class="mpc-sgrid-lbl" style="color:#0F6E56">готово</div>
                </div>
                <div class="mpc-sgrid-cell">
                  <div class="mpc-sgrid-num" style="color:${s.ov > 0 ? '#D85A30' : 'var(--text-muted)'}">${s.ov}</div>
                  <div class="mpc-sgrid-lbl" style="color:${s.ov > 0 ? '#993C1D' : 'var(--text-light)'}">просроч.</div>
                </div>
              </div>

              <div class="mpc-footer">
                <div class="mpc-prog-wrap">
                  <div class="mpc-prog-circle" style="border-color:${s.color};color:${s.color}">${p}%</div>
                  <span class="mpc-prog-label">прогресс</span>
                </div>
                ${s.ov > 0
                  ? `<div class="mpc-ov-pill" style="background:#FEE2E2;color:#DC2626"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${s.ov} просрочено</div>`
                  : s.inp > 0
                    ? `<div class="mpc-inp-pill">${s.inp} в работе</div>`
                    : s.total > 0 && s.done === s.total ? `<div class="mpc-ok-pill">✓ всё готово</div>` : ''
                }
              </div>

            </div>`;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <div class="upc-block">
      <div id="upc-cal-wrapper">${renderUpcomingCalendar()}</div>

      <div class="upc-section-title">Предстоящие задачи</div>

      ${upcoming.length === 0
        ? '<div class="upc-empty">Нет задач с дедлайном в ближайшие 30 дней</div>'
        : `<div class="upc-cards-list">
          ${upcoming.map(t => {
            const dl = daysLeft(t.deadline);
            const urgCls = dl <= 3 ? 'upc-days-urgent' : dl <= 7 ? 'upc-days-soon' : '';
            const label = dl === 0 ? 'Сегодня' : dl === 1 ? '1 день осталось' : dl + ' дней осталось';
            const initials = t.assignee_name ? t.assignee_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() : '';
            return `
              <div class="upc-card" onclick="openTaskDetail(${t.id})">
                <div class="upc-card-top">
                  <span class="upc-card-title">${t.title}</span>
                  ${initials ? `<div class="upc-card-avatar" style="background:${t.assignee_color || '#881337'}" title="${t.assignee_name}">${initials}</div>` : ''}
                </div>
                <div class="upc-card-meta">
                  <span class="upc-card-deadline ${urgCls}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    ${label}
                  </span>
                  <span class="upc-card-proj">
                    <span style="width:6px;height:6px;border-radius:50%;background:${t.project_color||'#881337'};display:inline-block;flex-shrink:0"></span>
                    ${t.project_name || '—'}
                  </span>
                </div>
              </div>`;
          }).join('')}
        </div>`}
    </div>
  `;
}

function triggerDashAnimations() {
  // Animate count-up numbers
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseFloat(el.dataset.count) || 0;
    const suffix = el.dataset.suffix || '';
    countUp(el, target, 850, suffix);
  });
  // Animate progress bars + SVG chart bars (two rAF so browser paints 0-state first)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('[data-bar-to]').forEach(el => {
      el.style.width = el.dataset.barTo;
    });
    document.querySelectorAll('.anim-bar').forEach(el => {
      el.style.transform = 'scaleY(1)';
    });
  }));
  // Animate donut arcs — slide each arc from start to end via dashoffset
  setTimeout(() => {
    document.querySelectorAll('.donut-arc').forEach((el, i) => {
      setTimeout(() => {
        el.setAttribute('stroke-dashoffset', el.dataset.offset);
      }, i * 140);
    });
    const countEl = document.querySelector('.donut-count');
    if (countEl) countUp(countEl, parseFloat(countEl.dataset.count) || 0, 900, '%');
  }, 60);
}

function renderUpcomingCalendar() {
  const today = new Date();
  const pivot = new Date(today);
  pivot.setDate(today.getDate() + upcomingWeekOffset * 7);
  const dow = pivot.getDay();
  const weekStart = new Date(pivot);
  weekStart.setDate(pivot.getDate() - dow);

  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DAYS   = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  const days = Array.from({length: 7}, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
  });

  // dominant month in the displayed week
  const monthCounts = {};
  days.forEach(d => { const k = d.getMonth(); monthCounts[k] = (monthCounts[k]||0)+1; });
  const domMonth = +Object.entries(monthCounts).sort((a,b)=>b[1]-a[1])[0][0];
  const year = days.find(d => d.getMonth() === domMonth).getFullYear();

  const todayStr = today.toDateString();

  return `
    <div class="upc-cal-header">
      <button class="upc-cal-arrow" onclick="shiftUpcomingWeek(-1)">&#8249;</button>
      <span class="upc-cal-month">${MONTHS[domMonth]} ${year}</span>
      <button class="upc-cal-arrow" onclick="shiftUpcomingWeek(1)">&#8250;</button>
    </div>
    <div class="upc-cal-row upc-cal-daynames">
      ${DAYS.map(d => `<div>${d}</div>`).join('')}
    </div>
    <div class="upc-cal-row upc-cal-dates">
      ${days.map(d => {
        const isToday = d.toDateString() === todayStr;
        const dim = d.getMonth() !== domMonth;
        return `<div class="upc-cal-date${isToday?' upc-cal-today':''}${dim?' upc-cal-dim':''}">${d.getDate()}</div>`;
      }).join('')}
    </div>
  `;
}

function shiftUpcomingWeek(delta) {
  upcomingWeekOffset += delta;
  const wrapper = document.getElementById('upc-cal-wrapper');
  if (wrapper) wrapper.innerHTML = renderUpcomingCalendar();
}

function svgDonut(slices, total, size = 150) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 18, sw = 20;
  const C = 2 * Math.PI * r;
  if (total === 0) {
    return `<svg width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#E2E8F0" stroke-width="${sw}"/><text x="${cx}" y="${cy+5}" text-anchor="middle" fill="#94A3B8" font-size="11" font-family="system-ui">—</text></svg>`;
  }
  let cum = 0;
  const arcs = slices.filter(s => s.v > 0).map(s => {
    const len = (s.v / total) * C;
    const dash = (len - 2).toFixed(1), gap = (C - len + 2).toFixed(1);
    const finalOffset = (C * 0.25 - cum).toFixed(1);
    const initOffset  = (C * 0.25 - cum + len).toFixed(1); // shift arc past its end → invisible
    const g = `<circle class="donut-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.c}" stroke-width="${sw}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${initOffset}" stroke-linecap="round" data-offset="${finalOffset}" style="transition:stroke-dashoffset 0.85s cubic-bezier(0.4,0,0.2,1)"/>`;
    cum += len;
    return g;
  });
  const donePct = total > 0 ? Math.round((slices.find(s => s.key === 'done')?.v || 0) / total * 100) : 0;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs.join('')}<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#0F172A" font-size="20" font-weight="800" font-family="system-ui"><tspan class="donut-count" data-count="${donePct}">0%</tspan></text><text x="${cx}" y="${cy + 13}" text-anchor="middle" fill="#94A3B8" font-size="10" font-family="system-ui">выполнено</text></svg>`;
}

function renderDashboardCharts(tasks) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const inp = tasks.filter(t => t.status === 'in_progress').length;
  const nw = tasks.filter(t => t.status === 'new').length;
  const ov = tasks.filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) < new Date()).length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  const donutSlices = [
    { key: 'new', label: 'Новые', v: nw, c: '#3B82F6' },
    { key: 'in_progress', label: 'В работе', v: inp, c: '#D97706' },
    { key: 'done', label: 'Готово', v: done, c: '#059669' },
  ];

  // Project stats
  const projMap = {};
  tasks.forEach(t => {
    if (!t.project_name) return;
    if (!projMap[t.project_name]) projMap[t.project_name] = { total: 0, done: 0, color: t.project_color || '#881337', id: t.project_id };
    projMap[t.project_name].total++;
    if (t.status === 'done') projMap[t.project_name].done++;
  });
  const projs = Object.entries(projMap).sort((a, b) => b[1].total - a[1].total);
  const maxP = projs.length ? Math.max(...projs.map(([, s]) => s.total)) : 1;

  // Employee stats
  const empMap = {};
  tasks.forEach(t => {
    if (!t.assignee_name) return;
    if (!empMap[t.assignee_name]) empMap[t.assignee_name] = { total: 0, done: 0, color: t.assignee_color || '#881337', id: t.assignee_id };
    empMap[t.assignee_name].total++;
    if (t.status === 'done') empMap[t.assignee_name].done++;
  });
  const emps = Object.entries(empMap).sort((a, b) => b[1].total - a[1].total);

  return `
    <div class="dash-stat-cards">
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({status:'new'})" title="Новые задачи">
        <div class="dsc-label">Всего задач</div>
        <div class="dsc-value"><span data-count="${total}">0</span></div>
        <div class="dsc-sub"><span data-count="${nw}">0</span> новых</div>
      </div>
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({status:'done'})" title="Выполненные задачи">
        <div class="dsc-label">Выполнено</div>
        <div class="dsc-value dsc-value--green"><span data-count="${pct}" data-suffix="%">0%</span></div>
        <div class="dsc-sub"><span data-count="${done}">0</span> из ${total}</div>
      </div>
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({overdue:true})" title="Просроченные задачи">
        <div class="dsc-label">Просрочено</div>
        <div class="dsc-value ${ov > 0 ? 'dsc-value--red' : ''}"><span data-count="${ov}">0</span></div>
        <div class="dsc-sub">${ov > 0 ? 'требуют внимания' : 'всё в порядке'}</div>
      </div>
    </div>

    <div class="dash-charts">
      <div class="chart-panel donut-wrap">
        <div class="chart-title">Статусы</div>
        ${svgDonut(donutSlices, total)}
        <div class="donut-legend">
          ${donutSlices.map(s => `
            <div class="donut-legend-item">
              <span class="donut-legend-dot" style="background:${s.c}"></span>
              <span>${s.label}</span>
              <span class="donut-legend-val">${s.v}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="chart-panel" style="display:flex;flex-direction:column">
        <div class="chart-title">По проектам</div>
        <div class="chart-scroll">
          ${projs.length === 0
            ? '<div style="color:#94A3B8;font-size:12.5px;padding:8px 0">Нет данных по проектам</div>'
            : projs.map(([name, s]) => {
                const p = s.total > 0 ? Math.round(s.done / s.total * 100) : 0;
                return `<div class="proj-bar-row" style="cursor:pointer" onclick="navigateTo('project',${s.id})">
                  <div class="proj-bar-top">
                    <span class="proj-bar-name">${name}</span>
                    <span class="proj-bar-count">${s.done}/${s.total}</span>
                  </div>
                  <div class="proj-bar-track">
                    <div class="proj-bar-fill" style="width:0%;background:${s.color};transition:width 0.8s cubic-bezier(0.22,1,0.36,1)" data-bar-to="${p}%"></div>
                  </div>
                </div>`;
              }).join('')}
        </div>
      </div>

      <div class="chart-panel" style="display:flex;flex-direction:column">
        <div class="chart-title">Сотрудники</div>
        <div class="chart-scroll">
          ${emps.length === 0
            ? '<div style="color:#94A3B8;font-size:12.5px;padding:8px 0">Нет данных</div>'
            : emps.map(([name, s]) => {
                const p = s.total > 0 ? Math.round(s.done / s.total * 100) : 0;
                const col = p >= 80 ? '#059669' : p >= 50 ? '#D97706' : '#DC2626';
                return `<div class="emp-row" style="cursor:pointer" onclick="openEmployeeProfile(${s.id})">
                  <div class="emp-avatar-sm" style="background:${s.color}">${initials(name)}</div>
                  <div class="emp-info">
                    <div class="emp-name">${name}</div>
                    <div class="emp-bar-track">
                      <div class="emp-bar-fill" style="width:0%;background:${col};transition:width 0.8s cubic-bezier(0.22,1,0.36,1)" data-bar-to="${p}%"></div>
                    </div>
                  </div>
                  <span class="emp-pct" style="color:${col}"><span data-count="${p}" data-suffix="%">0%</span></span>
                </div>`;
              }).join('')}
        </div>
      </div>
    </div>
  `;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  dashTasksLimit = 10;
  try {
    const tasks = await GET('/tasks');
    const urgent = tasks.filter(t => t.status !== 'done' && t.deadline &&
      parseDeadline(t.deadline) - Date.now() < 24 * 60 * 60 * 1000 && parseDeadline(t.deadline) > Date.now()
    ).slice(0, 5);

    const pStart = periodStart(dashPeriod);
    dashRecentTasks = tasks.filter(t => t.status !== 'done' && new Date(t.created_at) >= pStart);

    const periodNames = [['week','Неделя'],['month','Месяц'],['3month','3 мес.'],['6month','6 мес.'],['year','1 год']];
    const periodLabels = { week: 'за неделю', month: 'за месяц', '3month': 'за 3 месяца', '6month': 'за 6 месяцев', year: 'за год' };

    document.getElementById('page-content').innerHTML = `
      ${renderDashboardCharts(tasks)}

      ${urgent.length > 0 ? `
        <div class="section-header">
          <div class="section-title" style="display:inline-flex;align-items:center;gap:6px">${svgI(SVG_PATHS.warning,15)} Срочные задачи (до 24ч)</div>
        </div>
        <div class="tasks-list" style="margin-bottom:28px">
          ${urgent.map(t => taskCard(t)).join('')}
        </div>
      ` : ''}

      <div class="section-header">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div class="section-title" style="display:inline-flex;align-items:center;gap:6px">${svgI(SVG_PATHS.clip,15)} Активные задачи</div>
          <div class="period-filter">
            ${periodNames.map(([p,l]) => `<button class="period-btn ${dashPeriod===p?'active':''}" onclick="setDashPeriod('${p}')">${l}</button>`).join('')}
          </div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="navigateTo('tasks')">Все задачи →</button>
      </div>
      ${dashRecentTasks.length === 0
        ? `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.check,44)}</div><h3>Нет активных задач ${periodLabels[dashPeriod]}</h3><p>Создайте новую или выберите другой период</p></div>`
        : `<div id="dash-tasks-container"></div>`
      }
    `;
    renderDashTasksList();
    attachTaskCardListeners();
    triggerDashAnimations();
  } catch (err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.warning,44)}</div><h3>Ошибка загрузки</h3><p>${err.message}</p></div>`;
  }
}

function renderDashTasksList() {
  const container = document.getElementById('dash-tasks-container');
  if (!container) return;
  const visible   = dashRecentTasks.slice(0, dashTasksLimit);
  const remaining = dashRecentTasks.length - dashTasksLimit;
  container.innerHTML = `
    <div class="tasks-list">${visible.map(t => taskCard(t)).join('')}</div>
    ${remaining > 0 ? `
      <div class="tasks-show-more">
        <button class="tasks-show-more-btn" onclick="showMoreDashTasks()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          Показать ещё ${Math.min(remaining, 10)} задач
          <span class="tasks-show-more-count">${remaining} осталось</span>
        </button>
      </div>
    ` : dashRecentTasks.length > 10 ? `<div class="tasks-all-shown">Показаны все ${dashRecentTasks.length} задач</div>` : ''}
  `;
  attachTaskCardListeners();
}

function showMoreDashTasks() {
  dashTasksLimit += 10;
  renderDashTasksList();
}

// ─── Tasks Page ───────────────────────────────────────────────────────────────
let tasksFilter = { status: '', priority: '', search: '', assignee_id: '', overdue: false };
let myTasksMode = false;
let dashPeriod = 'month';
let upcomingWeekOffset = 0;
let tasksDisplayLimit = 10;
let allFetchedTasks = [];
let dashTasksLimit = 10;
let dashRecentTasks = [];

function periodStart(p) {
  const d = new Date();
  if (p === 'week')    d.setDate(d.getDate() - 7);
  else if (p === 'month')  d.setDate(d.getDate() - 30);
  else if (p === '3month') d.setDate(d.getDate() - 90);
  else if (p === '6month') d.setDate(d.getDate() - 180);
  else if (p === 'year')   d.setDate(d.getDate() - 365);
  return d;
}
function setDashPeriod(p) { dashPeriod = p; renderDashboard(); }

function navigateToTasksWithFilter(filter) {
  if (myTasksMode) {
    applyMyTasksFilter(filter);
    return;
  }
  myTasksMode = false;
  tasksFilter = { status: '', priority: '', search: '', assignee_id: '', overdue: false, ...filter };
  navigateTo('tasks');
}

function applyMyTasksFilter(filter) {
  tasksFilter = { status: '', priority: '', search: '', assignee_id: String(state.user.id), overdue: false, ...filter };
  tasksDisplayLimit = 10;

  // Update active filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const s = btn.getAttribute('onclick') || '';
    let isActive = false;
    if (filter.overdue)              isActive = s.includes('overdue');
    else if (filter.status === 'new')         isActive = s.includes("'new'");
    else if (filter.status === 'in_progress') isActive = s.includes("'in_progress'");
    else if (filter.status === 'done')        isActive = s.includes("'done'");
    else if (filter.priority === 'high')      isActive = s.includes("'high'");
    else isActive = s.includes("setTaskFilter('status','')");
    btn.classList.toggle('active', isActive);
  });

  loadAndRenderTasks();

  setTimeout(() => {
    const el = document.getElementById('tasks-list-container');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 150);
}

async function renderTasksPage() {
  tasksDisplayLimit = 10;
  const isAdmin = state.user.role === 'admin';
  const showEmployeeFilter = isAdmin && !myTasksMode;
  const employeeOptions = showEmployeeFilter
    ? `<option value="">Все сотрудники</option>` +
      state.users.map(u =>
        `<option value="${u.id}" ${tasksFilter.assignee_id === String(u.id) ? 'selected' : ''}>${u.name}</option>`
      ).join('')
    : '';

  document.getElementById('page-content').innerHTML = `
    ${myTasksMode ? '<div id="mytasks-summary"></div>' : ''}
    <div class="filters">
      <div class="search-wrap">
        <input class="search-input" id="task-search" placeholder="Поиск задач..." value="${tasksFilter.search}">
      </div>
      <button class="filter-btn ${!tasksFilter.status && !tasksFilter.overdue ? 'active' : ''}" onclick="setTaskFilter('status','')">Все</button>
      <button class="filter-btn ${tasksFilter.status==='new' ? 'active' : ''}" onclick="setTaskFilter('status','new')" style="display:inline-flex;align-items:center;gap:5px">${colorDot('#3B82F6')} Новые</button>
      <button class="filter-btn ${tasksFilter.status==='in_progress' ? 'active' : ''}" onclick="setTaskFilter('status','in_progress')" style="display:inline-flex;align-items:center;gap:5px">${colorDot('#D97706')} В работе</button>
      <button class="filter-btn ${tasksFilter.status==='done' ? 'active' : ''}" onclick="setTaskFilter('status','done')" style="display:inline-flex;align-items:center;gap:5px">${colorDot('#059669')} Готово</button>
      <button class="filter-btn ${tasksFilter.overdue ? 'active' : ''}" onclick="setTaskFilter('overdue',true)" style="display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.warning)} Просрочено</button>
      <button class="filter-btn ${tasksFilter.priority==='high' ? 'active' : ''}" onclick="setTaskFilter('priority','high')" style="display:inline-flex;align-items:center;gap:5px">${colorDot('#DC2626')} Срочные</button>
      ${showEmployeeFilter ? `
        <div class="employee-filter">
          <select id="employee-filter-select">
            ${employeeOptions}
          </select>
        </div>
      ` : ''}
    </div>
    <div id="tasks-list-container"><div style="text-align:center;padding:40px;color:#9ca3af">Загрузка...</div></div>
  `;
  document.getElementById('task-search').addEventListener('input', e => {
    tasksFilter.search = e.target.value;
    loadAndRenderTasks();
  });
  document.getElementById('employee-filter-select')?.addEventListener('change', e => {
    tasksFilter.assignee_id = e.target.value;
    loadAndRenderTasks();
  });
  loadAndRenderTasks();
}

function setTaskFilter(key, val) {
  if (key === 'status') tasksFilter.overdue = false;
  if (key === 'overdue' && val) tasksFilter.status = '';
  tasksFilter[key] = val;
  if (myTasksMode) tasksFilter.assignee_id = String(state.user.id);
  renderTasksPage();
}

async function loadAndRenderTasks() {
  try {
    if (myTasksMode) {
      const allUserTasks = await GET('/tasks?assignee_id=' + state.user.id);
      const summaryEl = document.getElementById('mytasks-summary');
      if (summaryEl) {
        summaryEl.innerHTML = renderMyTasksSummary(allUserTasks);
        triggerDashAnimations();
      }
    }

    let url = '/tasks';
    const params = [];
    if (tasksFilter.status) params.push('status=' + tasksFilter.status);
    if (tasksFilter.assignee_id) params.push('assignee_id=' + tasksFilter.assignee_id);
    if (params.length) url += '?' + params.join('&');
    let tasks = await GET(url);
    if (tasksFilter.overdue) tasks = tasks.filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) < new Date());
    if (tasksFilter.priority) tasks = tasks.filter(t => t.priority === tasksFilter.priority);
    if (tasksFilter.search) {
      const q = tasksFilter.search.toLowerCase();
      tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    }
    allFetchedTasks = tasks;
    renderTasksList();
  } catch {}
}

function renderTasksList() {
  const container = document.getElementById('tasks-list-container');
  if (!container) return;

  if (allFetchedTasks.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.clip,44)}</div><h3>Задач нет</h3><p>Попробуйте изменить фильтры</p></div>`;
    return;
  }

  const visible   = allFetchedTasks.slice(0, tasksDisplayLimit);
  const remaining = allFetchedTasks.length - tasksDisplayLimit;

  container.innerHTML = `
    <div class="tasks-list">${visible.map(t => taskCard(t)).join('')}</div>
    ${remaining > 0 ? `
      <div class="tasks-show-more">
        <button class="tasks-show-more-btn" onclick="showMoreTasks()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          Показать ещё ${Math.min(remaining, 10)} задач
          <span class="tasks-show-more-count">${remaining} осталось</span>
        </button>
      </div>
    ` : allFetchedTasks.length > 10 ? `<div class="tasks-all-shown">Показаны все ${allFetchedTasks.length} задач</div>` : ''}
  `;
  attachTaskCardListeners();
}

function showMoreTasks() {
  tasksDisplayLimit += 10;
  renderTasksList();
}

// ─── Project Page ─────────────────────────────────────────────────────────────
let projectFilter = { assignee_id: '' };
let projectActiveTab = 'tasks';
function cpRestoreTab(projectId) {
  try {
    const savedId  = sessionStorage.getItem('proj_tab_id');
    const savedTab = sessionStorage.getItem('proj_tab');
    projectActiveTab = (savedTab && String(savedId) === String(projectId)) ? savedTab : 'tasks';
  } catch { projectActiveTab = 'tasks'; }
}
let cpYear = new Date().getFullYear();
let cpMonth = new Date().getMonth();

function cpSaveNav() {
  try { sessionStorage.setItem('cp_ym', cpYear + '-' + cpMonth); } catch {}
}
function cpRestoreNav() {
  try {
    const s = sessionStorage.getItem('cp_ym');
    if (s) {
      const [y, m] = s.split('-');
      const sy = parseInt(y), sm = parseInt(m);
      // Only restore if saved year matches current year (don't carry over stale year)
      if (sy === new Date().getFullYear()) { cpYear = sy; cpMonth = sm; }
      else sessionStorage.removeItem('cp_ym');
    }
  } catch {}
}

const CP_TYPES = {
  post:  { label: 'ПОСТ',   color: '#3B82F6', bg: '#EFF6FF' },
  reel:  { label: 'РИЛС',   color: '#F97316', bg: '#FFF7ED' },
  story: { label: 'СТОРИС', color: '#22C55E', bg: '#F0FDF4' },
};
const CP_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

async function renderProjectPage(projectId) {
  cpRestoreTab(projectId);
  const project = state.projects.find(p => String(p.id) === String(projectId));
  const isAdmin = state.user.role === 'admin';
  const canEdit = isAdmin || state.user.role === 'manager';
  try {
    // Consolidate duplicate content tasks BEFORE loading, so task list shows merged results
    if (canEdit) await api('POST', `/projects/${projectId}/sync-content-tasks`, {}).catch(() => {});

    const [allTasks, members] = await Promise.all([
      GET('/tasks?project_id=' + projectId),
      GET('/projects/' + projectId + '/members')
    ]);
    const doneCount = allTasks.filter(t => t.status === 'done').length;
    const progress = allTasks.length > 0 ? Math.round((doneCount / allTasks.length) * 100) : 0;

    const membersHtml = `
      <div class="proj-members-row">
        <span class="proj-members-label">Участники контент-плана</span>
        <div class="proj-members-avatars">
          ${members.map(m => `
            <div class="proj-member-wrap" data-user-id="${m.id}" title="${m.name}">
              ${avatar(m.name, m.avatar_color, 'avatar-sm', m.avatar_img || '')}
              ${canEdit ? `<button class="proj-member-remove" onclick="cpRemoveMember(${projectId},${m.id},event)" title="Удалить из проекта">×</button>` : ''}
            </div>`).join('')}
          ${canEdit ? `<button class="proj-member-add-btn" onclick="cpOpenMemberAdd(${projectId},this)" title="Добавить участника">+</button>` : ''}
          ${members.length === 0 && !canEdit ? `<span style="font-size:12px;color:#9ca3af">Нет участников</span>` : ''}
        </div>
      </div>`;

    document.getElementById('page-content').innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
          <div style="width:14px;height:14px;border-radius:4px;background:${project?.color || '#6366f1'}"></div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:700">${project?.name || 'Проект'}</div>
            ${project?.description ? `<div style="font-size:13px;color:#6b7280;margin-top:2px">${project.description}</div>` : ''}
          </div>
          ${isAdmin ? `<button class="btn btn-outline btn-sm" onclick="openProjectModal(${projectId})" style="display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.edit,13)} Изменить</button>` : ''}
        </div>
        <div class="progress-bar" style="margin-bottom:6px">
          <div class="progress-fill" style="width:${progress}%;background:${project?.color || '#6366f1'}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280">
          <span>${doneCount} из ${allTasks.length} задач выполнено</span>
          <span>${progress}%</span>
        </div>
        ${membersHtml}
      </div>

      <div class="proj-tabs">
        <button class="proj-tab ${projectActiveTab==='tasks'?'active':''}" onclick="switchProjectTab('tasks',${projectId})">
          ${svgI(SVG_PATHS.clip,14)} Задачи <span class="proj-tab-count">${allTasks.length}</span>
        </button>
        <button class="proj-tab ${projectActiveTab==='content'?'active':''}" onclick="switchProjectTab('content',${projectId})">
          ${svgI('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',14)} Контент-план
        </button>
      </div>

      <div id="proj-tab-panel"></div>
    `;

    if (projectActiveTab === 'tasks') {
      renderProjectTasksTab(projectId, allTasks, isAdmin);
    } else {
      renderProjectContentTab(projectId);
    }

  } catch (err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.warning,44)}</div><h3>Ошибка</h3><p>${err.message}</p></div>`;
  }
}

function switchProjectTab(tab, projectId) {
  projectActiveTab = tab;
  try { sessionStorage.setItem('proj_tab', tab); sessionStorage.setItem('proj_tab_id', projectId); } catch {}
  document.querySelectorAll('.proj-tab').forEach(b => b.classList.remove('active'));
  event?.currentTarget?.classList?.add('active');
  if (tab === 'tasks') {
    renderProjectPage(projectId);
  } else {
    renderProjectContentTab(projectId);
  }
}

function renderProjectTasksTab(projectId, allTasks, isAdmin) {
  const employeeOptions = isAdmin
    ? `<option value="">Все сотрудники</option>` +
      state.users.map(u =>
        `<option value="${u.id}" ${projectFilter.assignee_id === String(u.id) ? 'selected' : ''}>${u.name}</option>`
      ).join('')
    : '';
  let tasks = allTasks;
  if (projectFilter.assignee_id) tasks = tasks.filter(t => String(t.assignee_id) === projectFilter.assignee_id);
  const panel = document.getElementById('proj-tab-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="section-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="section-title">Задачи проекта</div>
        ${isAdmin ? `<div class="employee-filter"><select id="project-employee-filter">${employeeOptions}</select></div>` : ''}
      </div>
      ${isAdmin ? `<button class="btn btn-blue btn-sm" onclick="openTaskModal(null,${projectId})">＋ Добавить задачу</button>` : ''}
    </div>
    <div id="project-tasks-list">
      ${tasks.length === 0
        ? `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.clip,44)}</div><h3>Задач нет</h3><p>Нажмите «Добавить задачу», чтобы начать</p></div>`
        : `<div class="tasks-list">${tasks.map(t => taskCard(t)).join('')}</div>`
      }
    </div>
  `;
  document.getElementById('project-employee-filter')?.addEventListener('change', e => {
    projectFilter.assignee_id = e.target.value;
    renderProjectPage(projectId);
  });
  attachTaskCardListeners();
}

async function renderProjectContentTab(projectId) {
  const panel = document.getElementById('proj-tab-panel');
  if (!panel) return;
  const isAdmin = state.user.role === 'admin';
  const canEdit = state.user.role === 'admin' || state.user.role === 'manager';
  panel.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">Загрузка...</div>';
  try {
    cpRestoreNav();
    const items = await GET('/projects/' + projectId + '/content');
    const ym = `${cpYear}-${String(cpMonth + 1).padStart(2, '0')}`;
    const monthItems = items.filter(i => i.date.startsWith(ym));
    const posts   = monthItems.reduce((s, i) => i.type === 'post'  ? s + 1 : s, 0);
    const reels   = monthItems.reduce((s, i) => i.type === 'reel'  ? s + 1 : s, 0);
    const stories = monthItems.reduce((s, i) => i.type === 'story' ? s + (i.quantity || 1) : s, 0);
    const total   = posts + reels + monthItems.filter(i => i.type === 'story').length;

    panel.innerHTML = `
      <div class="cp-toolbar">
        <div class="cp-nav">
          <button class="cp-nav-btn" onclick="cpChangeMonth(-1,${projectId})">&#8249;</button>
          <span class="cp-nav-title">${CP_MONTHS[cpMonth]} ${cpYear}</span>
          <button class="cp-nav-btn" onclick="cpChangeMonth(1,${projectId})">&#8250;</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${isAdmin ? `
            <label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px">
              ${svgI('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',14)} Импорт Excel
              <input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="importContentExcel(this,${projectId})">
            </label>
            ${monthItems.length > 0 ? `<button class="btn btn-outline btn-sm" style="color:#EF4444;border-color:#EF4444" onclick="clearCpMonth(${projectId})">Очистить месяц</button>` : ''}
          ` : ''}
        </div>
      </div>

      ${buildContentCalendar(monthItems, cpYear, cpMonth, projectId, canEdit)}

      <div class="cp-footer">
        <span class="cp-stat" style="color:${CP_TYPES.post.color}">
          <span class="cp-stat-dot" style="background:${CP_TYPES.post.color}"></span>
          ${posts} ${posts === 1 ? 'пост' : posts < 5 ? 'поста' : 'постов'}
        </span>
        <span class="cp-stat" style="color:${CP_TYPES.reel.color}">
          <span class="cp-stat-dot" style="background:${CP_TYPES.reel.color}"></span>
          ${reels} ${reels === 1 ? 'рилс' : reels < 5 ? 'рилса' : 'рилсов'}
        </span>
        <span class="cp-stat" style="color:${CP_TYPES.story.color}">
          <span class="cp-stat-dot" style="background:${CP_TYPES.story.color}"></span>
          ${stories} сторис
        </span>
        <span class="cp-stat-total">Всего: ${total} единиц контента</span>
      </div>
    `;
    if (canEdit) initCpDragDrop(projectId);
  } catch(e) {
    panel.innerHTML = `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${e.message}</p></div>`;
  }
}

function buildContentCalendar(items, year, month, projectId, canEdit) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const todayStr = new Date().toISOString().slice(0, 10);

  const byDate = {};
  items.forEach(item => {
    if (!byDate[item.date]) byDate[item.date] = [];
    byDate[item.date].push(item);
  });

  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const weeks = [];
  let week = new Array(7).fill(null);
  let day = 1;
  for (let d = startOffset; d < 7 && day <= daysInMonth; d++) week[d] = day++;
  weeks.push(week);
  while (day <= daysInMonth) {
    week = new Array(7).fill(null);
    for (let d = 0; d < 7 && day <= daysInMonth; d++) week[d] = day++;
    weeks.push(week);
  }

  const rows = weeks.map((week, wi) => {
    const cells = week.map((d, di) => {
      if (!d) return `<td class="cp-cell cp-empty"></td>`;
      const ds = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayItems = byDate[ds] || [];
      const isToday = ds === todayStr;
      const isWeekend = di >= 5;
      const chipsHtml = dayItems.map(item => {
        const t = CP_TYPES[item.type] || CP_TYPES.post;
        const qty = item.type === 'story' && item.quantity > 1 ? ` ×${item.quantity}` : '';
        const safeTitle = (item.title || '').replace(/"/g, '&quot;');
        const dragAttrs = canEdit
          ? `draggable="true" data-item-id="${item.id}" data-type="${item.type}" data-title="${safeTitle}" data-qty="${item.quantity || 1}" onclick="cpOpenEdit(event,this,${projectId})"`
          : '';
        return `<div class="cp-chip" ${dragAttrs} style="background:${t.bg};border-left:3px solid ${t.color}${canEdit?';cursor:pointer':''}">
          <span class="cp-chip-type" style="color:${t.color}">${t.label}${qty}</span>
          ${item.title ? `<span class="cp-chip-title">${item.title}</span>` : ''}
        </div>`;
      }).join('');
      const addBtn = canEdit ? `<button class="cp-add-btn" onclick="cpOpenAdd(this,'${ds}',${projectId})" title="Добавить публикацию">+</button>` : '';
      const dropAttrs = canEdit ? `data-date="${ds}"` : '';
      return `<td class="cp-cell${isToday?' cp-today':''}${isWeekend?' cp-weekend':''}${dayItems.length?' cp-has-items':''}" ${dropAttrs}>
        <div class="cp-day-num">${d}${addBtn}</div>
        ${chipsHtml}
      </td>`;
    }).join('');
    return `<tr><td class="cp-week-label">Нед. ${wi + 1}</td>${cells}</tr>`;
  }).join('');

  return `
    <div class="cp-scroll-wrap">
      <table class="cp-table">
        <thead><tr>
          <th class="cp-week-col">Неделя</th>
          ${dayNames.map(n => `<th>${n}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function cpChangeMonth(delta, projectId) {
  cpMonth += delta;
  if (cpMonth > 11) { cpMonth = 0; cpYear++; }
  if (cpMonth < 0)  { cpMonth = 11; cpYear--; }
  cpSaveNav();
  renderProjectContentTab(projectId);
}

async function clearCpMonth(projectId) {
  const ym = `${cpYear}-${String(cpMonth + 1).padStart(2, '0')}`;
  if (!confirm(`Удалить весь контент за ${CP_MONTHS[cpMonth]} ${cpYear}?`)) return;
  await api('DELETE', `/projects/${projectId}/content/month/${ym}`);
  renderProjectContentTab(projectId);
}

let _cpJustDragged = false;

function initCpDragDrop(projectId) {
  let dragId = null;

  document.querySelectorAll('.cp-chip[draggable]').forEach(chip => {
    chip.addEventListener('dragstart', e => {
      dragId = chip.dataset.itemId;
      _cpJustDragged = false;
      cpCloseEdit();
      cpCloseAdd();
      chip.classList.add('cp-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('cp-dragging');
      _cpJustDragged = true;
      setTimeout(() => { _cpJustDragged = false; }, 200);
      document.querySelectorAll('.cp-drag-over').forEach(el => el.classList.remove('cp-drag-over'));
    });
  });

  document.querySelectorAll('.cp-cell[data-date]').forEach(cell => {
    cell.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cell.classList.add('cp-drag-over');
    });
    cell.addEventListener('dragleave', e => {
      if (!cell.contains(e.relatedTarget)) cell.classList.remove('cp-drag-over');
    });
    cell.addEventListener('drop', async e => {
      e.preventDefault();
      cell.classList.remove('cp-drag-over');
      if (!dragId) return;
      const newDate = cell.dataset.date;
      try {
        await api('PUT', `/content/${dragId}`, { date: newDate });
        dragId = null;
        renderProjectContentTab(projectId);
      } catch(err) {
        toast('Ошибка перемещения: ' + err.message, 'error');
      }
    });
  });
}

let _cpAddPopup = null;

function cpOpenAdd(btn, dateStr, projectId) {
  if (_cpAddPopup) { _cpAddPopup.remove(); _cpAddPopup = null; }

  const popup = document.createElement('div');
  popup.className = 'cp-add-popup';
  popup.innerHTML = `
    <div class="cp-add-popup-title">Новая публикация · ${dateStr.split('-').reverse().join('.')}</div>
    <select id="cp-add-type" class="form-control" style="margin-bottom:8px">
      <option value="post">ПОСТ</option>
      <option value="reel">РИЛС</option>
      <option value="story">СТОРИС</option>
    </select>
    <input id="cp-add-title" class="form-control" placeholder="Заголовок (необязательно)" style="margin-bottom:8px">
    <div style="display:flex;gap:6px">
      <button class="btn btn-blue btn-sm" style="flex:1" onclick="cpSubmitAdd('${dateStr}',${projectId})">Добавить</button>
      <button class="btn btn-outline btn-sm" onclick="cpCloseAdd()">Отмена</button>
    </div>
  `;

  const rect = btn.closest('.cp-day-num').getBoundingClientRect();
  popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  popup.style.left = (rect.left + window.scrollX) + 'px';
  document.body.appendChild(popup);
  _cpAddPopup = popup;

  setTimeout(() => {
    document.addEventListener('mousedown', _cpAddOutside, { once: true });
  }, 0);
}

function _cpAddOutside(e) {
  if (_cpAddPopup && !_cpAddPopup.contains(e.target)) cpCloseAdd();
}

function cpCloseAdd() {
  if (_cpAddPopup) { _cpAddPopup.remove(); _cpAddPopup = null; }
  document.removeEventListener('mousedown', _cpAddOutside);
}

async function cpSubmitAdd(dateStr, projectId) {
  const type  = document.getElementById('cp-add-type')?.value || 'post';
  const title = (document.getElementById('cp-add-title')?.value || '').trim();
  cpCloseAdd();
  try {
    await api('POST', `/projects/${projectId}/content/item`, { date: dateStr, type, title, quantity: 1 });
    renderProjectContentTab(projectId);
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

let _cpEditPopup = null;

function cpOpenEdit(e, chip, projectId) {
  if (_cpJustDragged) return;
  e.stopPropagation();
  if (_cpEditPopup) { _cpEditPopup.remove(); _cpEditPopup = null; }
  if (_cpAddPopup)  { _cpAddPopup.remove();  _cpAddPopup  = null; }

  const itemId = chip.dataset.itemId;
  const type   = chip.dataset.type || 'post';
  const title  = chip.dataset.title || '';
  const qty    = parseInt(chip.dataset.qty) || 1;
  const t      = CP_TYPES[type] || CP_TYPES.post;

  const popup = document.createElement('div');
  popup.className = 'cp-add-popup';
  popup.innerHTML = `
    <div class="cp-add-popup-title" style="color:${t.color}">Редактировать публикацию</div>
    <select id="cp-edit-type" class="form-control" style="margin-bottom:8px">
      ${Object.entries(CP_TYPES).map(([k,v]) => `<option value="${k}"${k===type?' selected':''}>${v.label}</option>`).join('')}
    </select>
    <input id="cp-edit-title" class="form-control" placeholder="Заголовок" value="${title.replace(/"/g,'&quot;')}" style="margin-bottom:8px">
    <div id="cp-edit-qty-row" style="margin-bottom:8px;${type==='story'?'':'display:none'}">
      <label style="font-size:12px;color:#64748b;margin-bottom:4px;display:block">Количество сторис</label>
      <input id="cp-edit-qty" type="number" min="1" max="50" class="form-control" value="${qty}">
    </div>
    <div style="display:flex;gap:6px;margin-top:4px">
      <button class="btn btn-blue btn-sm" style="flex:1" onclick="cpSubmitEdit('${itemId}',${projectId})">Сохранить</button>
      <button class="btn btn-outline btn-sm" style="color:#EF4444;border-color:#EF4444" onclick="cpDeleteItem('${itemId}',${projectId})">Удалить</button>
      <button class="btn btn-outline btn-sm" onclick="cpCloseEdit()">✕</button>
    </div>
  `;

  // Show/hide qty row when type changes
  popup.querySelector('#cp-edit-type').addEventListener('change', function() {
    popup.querySelector('#cp-edit-qty-row').style.display = this.value === 'story' ? '' : 'none';
  });

  const rect = chip.getBoundingClientRect();
  popup.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  popup.style.left = Math.min(rect.left + window.scrollX, window.innerWidth - 250) + 'px';
  document.body.appendChild(popup);
  _cpEditPopup = popup;

  setTimeout(() => {
    document.addEventListener('mousedown', _cpEditOutside, { once: true });
  }, 0);
}

function _cpEditOutside(e) {
  if (_cpEditPopup && !_cpEditPopup.contains(e.target)) cpCloseEdit();
}

function cpCloseEdit() {
  if (_cpEditPopup) { _cpEditPopup.remove(); _cpEditPopup = null; }
  document.removeEventListener('mousedown', _cpEditOutside);
}

async function cpSubmitEdit(itemId, projectId) {
  const type  = document.getElementById('cp-edit-type')?.value;
  const title = (document.getElementById('cp-edit-title')?.value || '').trim();
  const qty   = parseInt(document.getElementById('cp-edit-qty')?.value) || 1;
  cpCloseEdit();
  try {
    await api('PUT', `/content/${itemId}`, { type, title, quantity: type === 'story' ? qty : 1 });
    renderProjectContentTab(projectId);
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function cpDeleteItem(itemId, projectId) {
  cpCloseEdit();
  try {
    await api('DELETE', `/content/${itemId}`);
    renderProjectContentTab(projectId);
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

// ─── Project Member Management ────────────────────────────────────────────────

let _cpMemberPopup = null;

function cpOpenMemberAdd(projectId, btn) {
  if (_cpMemberPopup) { _cpMemberPopup.remove(); _cpMemberPopup = null; }
  if (_cpAddPopup)    { _cpAddPopup.remove();    _cpAddPopup    = null; }
  if (_cpEditPopup)   { _cpEditPopup.remove();   _cpEditPopup   = null; }

  const currentIds = new Set([...document.querySelectorAll('.proj-member-wrap[data-user-id]')].map(el => el.dataset.userId));
  const available = state.users.filter(u => !currentIds.has(String(u.id)));

  if (available.length === 0) { toast('Все пользователи уже добавлены в проект', 'info'); return; }

  const popup = document.createElement('div');
  popup.className = 'cp-add-popup';
  popup.style.minWidth = '210px';
  popup.innerHTML = `
    <div class="cp-add-popup-title">Добавить участника</div>
    ${available.map(u => `
      <div class="proj-member-option" onclick="cpAddMember(${projectId},${u.id})">
        ${avatar(u.name, u.avatar_color, 'avatar-sm', u.avatar_img || '')}
        <div>
          <div style="font-size:13px;font-weight:600">${u.name}</div>
          <div style="font-size:11px;color:#9ca3af">${u.role === 'admin' ? 'Администратор' : u.role === 'manager' ? 'Менеджер' : 'Сотрудник'}</div>
        </div>
      </div>`).join('')}
  `;

  const rect = btn.getBoundingClientRect();
  popup.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
  popup.style.left = Math.min(rect.left + window.scrollX, window.innerWidth - 230) + 'px';
  document.body.appendChild(popup);
  _cpMemberPopup = popup;
  setTimeout(() => document.addEventListener('mousedown', _cpMemberOutside, { once: true }), 0);
}

function _cpMemberOutside(e) {
  if (_cpMemberPopup && !_cpMemberPopup.contains(e.target)) { _cpMemberPopup.remove(); _cpMemberPopup = null; }
}

async function cpAddMember(projectId, userId) {
  if (_cpMemberPopup) { _cpMemberPopup.remove(); _cpMemberPopup = null; }
  try {
    await api('POST', `/projects/${projectId}/members`, { user_id: userId });
    const user = state.users.find(u => u.id === userId);
    toast(`${user?.name || 'Участник'} добавлен в проект`, 'success');
    renderProjectPage(projectId);
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function cpRemoveMember(projectId, userId, e) {
  e.stopPropagation();
  const user = state.users.find(u => u.id === userId);
  if (!confirm(`Удалить ${user?.name || 'участника'} из проекта?\nВсе контент-задачи этого участника по данному проекту будут удалены.`)) return;
  try {
    await api('DELETE', `/projects/${projectId}/members/${userId}`);
    toast(`${user?.name || 'Участник'} удалён из проекта`, 'success');
    renderProjectPage(projectId);
  } catch(e2) {
    toast('Ошибка: ' + e2.message, 'error');
  }
}

async function importContentExcel(input, projectId) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  if (typeof XLSX === 'undefined') { toast('Библиотека Excel не загружена', 'error'); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'DD.MM.YYYY' });

    // Detect format: calendar (has "Неделя" + day headers) vs table (date|type|title columns)
    const isCalendar = rows.slice(0, 4).some(r =>
      (r || []).some(c => String(c || '').toLowerCase().includes('неделя')) &&
      (r || []).some(c => /^(пн|пт|вт|ср|чт|сб|вс)$/i.test(String(c || '').trim()))
    );

    const items = isCalendar ? parseCpCalendar(rows) : parseCpRows(rows);
    if (items.length === 0) {
      toast('Не удалось распознать данные. Поддерживаются: календарный формат (Неделя/Пн-Вс) и табличный (Дата|Тип|Заголовок)', 'error');
      return;
    }
    const result = await api('POST', `/projects/${projectId}/content/import`, { items });
    toast(`Импортировано ${result.count} позиций`, 'success');
    // Navigate calendar to the month of imported data
    if (items[0]?.date) {
      const d = new Date(items[0].date + 'T00:00:00');
      cpYear = d.getFullYear(); cpMonth = d.getMonth();
      cpSaveNav();
    }
    renderProjectContentTab(projectId);
  } catch(e) {
    toast('Ошибка импорта: ' + e.message, 'error');
  }
}

const CP_MONTHS_RU = {
  'январь':0,'февраль':1,'март':2,'апрель':3,'май':4,'июнь':5,
  'июль':6,'август':7,'сентябрь':8,'октябрь':9,'ноябрь':10,'декабрь':11
};

function parseCpCalendar(rows) {
  // ── Extract year + month from title row (e.g. "Контент-план · ZSCD · Июнь 2025") ──
  let year = new Date().getFullYear(), month = new Date().getMonth();
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    const cell = String((rows[i] || [])[0] || '');
    const m = cell.match(/([а-яё]+)\s+(\d{4})/i);
    if (m) {
      const mn = CP_MONTHS_RU[m[1].toLowerCase()];
      if (mn !== undefined) month = mn;
      year = parseInt(m[2]);
      break;
    }
  }

  // ── Find header row: has "Неделя" + day-of-week columns ──
  let hdrIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.some(c => /^неделя$/i.test(String(c || '').trim())) &&
        r.some(c => /^(пн|вт|ср|чт|пт|сб|вс)$/i.test(String(c || '').trim()))) {
      hdrIdx = i; break;
    }
  }
  if (hdrIdx < 0) return [];

  const items = [];

  for (let ri = hdrIdx + 1; ri < rows.length; ri++) {
    const row = rows[ri] || [];
    if (!String(row[0] || '').toLowerCase().includes('неделя')) continue;

    // Columns 1–7 = Пн–Вс
    for (let ci = 1; ci <= 7; ci++) {
      const cell = String(row[ci] || '').trim();
      if (!cell) continue;

      const lines = cell.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      const dayNum = parseInt(lines[0]);
      if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;

      const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;

      // Group remaining lines into content items
      // Each content item: a type-line (has emoji/ПОСТ/РИЛС/СТОРИ) + optional title line
      let current = null;
      for (let li = 1; li < lines.length; li++) {
        const line = lines[li];
        const typeInfo = detectCpType(line);
        if (typeInfo) {
          if (current) items.push(buildCpItem(dateStr, current));
          current = { type: typeInfo.type, quantity: typeInfo.quantity, title: '' };
        } else if (current) {
          current.title = line;
          // Extract story count from title "(2 сторис)" / "(3 сторис)"
          if (current.type === 'story') {
            const qm = line.match(/\((\d+)\s*стори/i);
            if (qm) current.quantity = parseInt(qm[1]);
          }
        }
      }
      if (current) items.push(buildCpItem(dateStr, current));
    }
  }
  return items;
}

function detectCpType(line) {
  // Only match if emoji OR type keyword is at the START of the line
  const s = line.toUpperCase().trimStart();
  let type = null;
  let quantity = 1;
  if (/^📄/.test(line) || /^ПОСТ[\s\d]/.test(s))  type = 'post';
  else if (/^🎬/.test(line) || /^РИЛС[\s\d]/.test(s))   type = 'reel';
  else if (/^📱/.test(line) || /^СТОРИ[СЙ\s\d]/.test(s)) type = 'story';
  if (!type) return null;
  if (type === 'story') {
    const rm = s.match(/СТОРИ\S*\s+(\d+)[–\-](\d+)/);
    if (rm) quantity = parseInt(rm[2]) - parseInt(rm[1]) + 1;
  }
  return { type, quantity };
}

function buildCpItem(date, { type, title, quantity }) {
  return { date, type, title: title || '', quantity: quantity || 1 };
}

function parseCpRows(rows) {
  if (!rows || rows.length === 0) return [];

  // ── 1. Find header row (look for keywords «дата» + «тип») ──
  let startRow = 0;
  let dateCol = -1, typeCol = -1, titleCol = -1, qtyCol = -1;
  let headerFound = false;

  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').toLowerCase().trim());
    const dIdx = r.findIndex(h => h.includes('дат') || h === 'date');
    const tIdx = r.findIndex(h => h.includes('тип') || h === 'type');
    if (dIdx >= 0 && tIdx >= 0) {
      dateCol  = dIdx;
      typeCol  = tIdx;
      titleCol = r.findIndex(h => /загол|описан|назван|title|content|текст/.test(h));
      qtyCol   = r.findIndex(h => /кол|qty|шт|количест/.test(h));
      startRow = i + 1;
      headerFound = true;
      break;
    }
  }

  // ── 2. No header → auto-detect columns from first data row ──
  if (!headerFound) {
    for (let ri = 0; ri < Math.min(rows.length, 5); ri++) {
      const row = rows[ri] || [];
      let dC = -1, tC = -1;
      for (let ci = 0; ci < row.length; ci++) {
        if (dC < 0 && parseCpDate(row[ci])) dC = ci;
        const s = String(row[ci] ?? '').toUpperCase();
        if (tC < 0 && /ПОСТ|РИЛС|СТОРИ|POST|REEL|STORY/.test(s)) tC = ci;
        if (dC >= 0 && tC >= 0) break;
      }
      if (dC >= 0 && tC >= 0) {
        dateCol  = dC;
        typeCol  = tC;
        startRow = ri;
        break;
      }
    }
    // Fallback positional
    if (dateCol < 0) dateCol = 0;
    if (typeCol < 0) typeCol = 1;
  }

  if (titleCol < 0) titleCol = typeCol + 1 <= 3 ? typeCol + 1 : 2;
  if (qtyCol  < 0) qtyCol  = titleCol + 1;

  // ── 3. Parse data rows ──
  const items = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === null || c === undefined || c === '')) continue;
    const rawDate = row[dateCol];
    const rawType = String(row[typeCol] ?? '').trim().toUpperCase();
    const title   = String(row[titleCol] ?? '').trim();
    const qty     = parseInt(row[qtyCol]) || 1;
    if (!rawDate || !rawType) continue;
    const date = parseCpDate(rawDate);
    if (!date) continue;
    let type = null;
    if (rawType.includes('ПОСТ') || rawType.includes('POST'))  type = 'post';
    else if (rawType.includes('РИЛС') || rawType.includes('REEL'))   type = 'reel';
    else if (rawType.includes('СТОРИ') || rawType.includes('STORY'))  type = 'story';
    if (!type) continue;
    items.push({ date, type, title, quantity: qty });
  }
  return items;
}

function parseCpDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  // JS Date object (cellDates: true)
  if (raw instanceof Date) return isNaN(raw) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  // Excel serial number (integer 40000–60000 ≈ years 2009–2064)
  const num = Number(s);
  if (!isNaN(num) && num > 40000 && num < 60000 && s === String(Math.floor(num))) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY.MM.DD / YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;
  // Last resort: Date.parse (handles "Jun 16 2025" etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// ─── Task Card ────────────────────────────────────────────────────────────────
function taskCard(t) {
  const dl = deadlineFmt(t.deadline, t.status);
  const ma = t.multi_assignees;
  const isMulti = ma && ma.length > 0;

  let avatarsHtml = '';
  let myDoneHtml = '';
  let assigneeMetaHtml = '';

  if (isMulti) {
    const doneCount = ma.filter(a => a.done).length;
    const myEntry = ma.find(a => a.id === state.user.id);
    const shown = ma.slice(0, 3);
    const extra = ma.length - shown.length;
    avatarsHtml = `
      <div class="ma-avatars">
        ${shown.map(a => `<div class="ma-avatar-wrap${a.done ? ' ma-done' : ''}" title="${a.name}${a.done ? ' ✓' : ''}">${avatar(a.name, a.color, 'avatar-sm', a.img || '')}</div>`).join('')}
        ${extra > 0 ? `<div class="ma-extra">+${extra}</div>` : ''}
      </div>
      ${ma.length > 1 ? `<span class="ma-progress" title="${doneCount} из ${ma.length} выполнено">${doneCount}/${ma.length}</span>` : ''}
    `;
    if (myEntry) {
      myDoneHtml = `<button class="ma-done-btn ${myEntry.done ? 'done' : ''}" onclick="event.stopPropagation();toggleMyDone(${t.id},${!myEntry.done},undefined,this)" title="${myEntry.done ? 'Отменить выполнение' : 'Моя часть выполнена'}">${svgI('<polyline points="20 6 9 17 4 12"/>',13)}</button>`;
    }
    if (ma.length > 1) {
      assigneeMetaHtml = `<span class="task-meta-item" style="display:inline-flex;align-items:center;gap:4px">${svgI(SVG_PATHS.user)} ${ma.length} исполнителя</span>`;
    } else if (ma.length === 1) {
      assigneeMetaHtml = `<span class="task-meta-item" style="display:inline-flex;align-items:center;gap:4px">${svgI(SVG_PATHS.user)} ${ma[0].name}</span>`;
    }
  } else if (t.assignee_name) {
    const assigneeUser = state.users.find(u => u.id === t.assignee_id);
    const assigneeImg = t.assignee_img || assigneeUser?.avatar_img || '';
    avatarsHtml = avatar(t.assignee_name, t.assignee_color, 'avatar-sm', assigneeImg);
    assigneeMetaHtml = `<span class="task-meta-item" style="display:inline-flex;align-items:center;gap:4px">${svgI(SVG_PATHS.user)} ${t.assignee_name}</span>`;
  }

  return `
    <div class="task-card ${t.status === 'done' ? 'done' : ''}" data-task-id="${t.id}">
      <div class="task-card-left">
        <div class="task-card-top">
          ${priorityBadge(t.priority)}
          ${t.project_name ? projectBadge(t.project_name, t.project_color) : ''}
          ${recurrenceBadge(t.recurrence)}
          ${t.source_content_id ? `<span class="cp-task-badge">Контент-план</span>` : ''}
        </div>
        <div class="task-title">${t.title}</div>
        <div class="task-meta" style="margin-top:6px">
          ${assigneeMetaHtml}
          ${dl}
          ${t.creator_name && state.user.role === 'admin' ? `<span class="task-meta-item" style="color:#d1d5db">от ${t.creator_name}</span>` : ''}
        </div>
      </div>
      <div class="task-card-right">
        ${statusBadge(t.status)}
        ${myDoneHtml}
        ${avatarsHtml}
      </div>
    </div>
  `;
}

async function toggleMyDone(taskId, done, userId, btn) {
  // Optimistic in-place update
  if (btn) {
    btn.disabled = true;
    if (btn.classList.contains('ma-det-check')) {
      btn.classList.toggle('done', done);
      btn.innerHTML = `${svgI('<polyline points="20 6 9 17 4 12"/>',13)} ${done ? 'Готово' : 'В работе'}`;
      // Flip onclick so next click toggles in the opposite direction
      btn.onclick = function() { toggleMyDone(taskId, !done, userId, btn); };
    } else {
      btn.classList.toggle('done', done);
    }
  }
  try {
    const body = { done };
    if (userId !== undefined) body.user_id = userId;
    const result = await api('PATCH', `/tasks/${taskId}/my-done`, body);

    if (btn) btn.disabled = false;

    // Update status badge inside modal without closing
    const statusEl = document.getElementById('td-status');
    if (statusEl && result.status) statusEl.innerHTML = statusBadge(result.status);

    if (result.status === 'done') toast('Задача выполнена всеми исполнителями! ✅', 'success');

    // Re-render background page (modal stays open)
    if (state.currentPage === 'dashboard') renderDashboard();
    else if (state.currentPage === 'tasks' || state.currentPage === 'mytasks') renderTasksPage();
    else if (state.currentPage === 'project') renderProjectPage(state.currentProjectId);
  } catch(e) {
    // Revert optimistic update on error
    if (btn) {
      btn.disabled = false;
      if (btn.classList.contains('ma-det-check')) {
        btn.classList.toggle('done', !done);
        btn.innerHTML = `${svgI('<polyline points="20 6 9 17 4 12"/>',13)} ${!done ? 'Готово' : 'В работе'}`;
        // Revert onclick back to original direction
        btn.onclick = function() { toggleMyDone(taskId, done, userId, btn); };
      } else {
        btn.classList.toggle('done', !done);
      }
    }
    toast(e.message, 'error');
  }
}

function attachTaskCardListeners() {
  document.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', () => openTaskDetail(el.dataset.taskId));
  });
}

// ─── Task Detail Modal ────────────────────────────────────────────────────────
async function openTaskDetail(taskId) {
  try {
    const [tasks, comments] = await Promise.all([
      GET('/tasks?_force=1'),
      GET('/tasks/' + taskId + '/comments')
    ]);
    const t = tasks.find(t => String(t.id) === String(taskId));
    if (!t) return;
    const _aUser = state.users.find(u => u.id === t.assignee_id);
    if (!t.assignee_img && _aUser?.avatar_img) t.assignee_img = _aUser.avatar_img;

    const isAdmin = state.user.role === 'admin';
    const ma = t.multi_assignees;
    const isMultiAssignee = ma && ma.length > 0;
    const isMyTask = isMultiAssignee
      ? ma.some(a => a.id === state.user.id)
      : t.assignee_id === state.user.id;
    const canEdit = isAdmin || isMyTask;

    openModal(`
      <div class="modal modal-lg">
        <div class="task-detail-header">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                ${priorityBadge(t.priority)}
                ${t.project_name ? projectBadge(t.project_name, t.project_color) : ''}
              </div>
              <div style="font-size:18px;font-weight:700;line-height:1.3">${t.title}</div>
              ${t.description ? `<div style="font-size:13.5px;color:#6b7280;margin-top:8px;line-height:1.5">${t.description}</div>` : ''}
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
        </div>
        <div class="modal-body">
          <div class="task-detail-meta">
            <div class="task-detail-meta-item">
              <div class="label">Статус</div>
              <div class="value" id="td-status">
                ${isMultiAssignee ? statusBadge(t.status) : canEdit ? `
                  <div class="status-select" id="status-select">
                    ${['new','in_progress','done'].map(s => `
                      <div class="status-option ${s} ${t.status === s ? 'selected' : ''}" data-status="${s}">
                        ${s === 'new' ? `${colorDot('#3B82F6',7)} Новая` : s === 'in_progress' ? `${colorDot('#D97706',7)} В работе` : `${colorDot('#059669',7)} Готово`}
                      </div>
                    `).join('')}
                  </div>
                ` : statusBadge(t.status)}
              </div>
            </div>
            <div class="task-detail-meta-item">
              <div class="label">Дедлайн</div>
              <div class="value ${deadlineClass(t.deadline, t.status)}">${t.deadline ? fmtDate(t.deadline) : '—'}</div>
            </div>
            <div class="task-detail-meta-item" style="grid-column:1/-1">
              <div class="label">Исполнители</div>
              <div class="value">
                ${isMultiAssignee ? `
                  <div class="ma-detail-list">
                    ${ma.map(a => {
                      const canToggle = isAdmin || a.id === state.user.id;
                      return `<div class="ma-detail-item">
                        ${avatar(a.name, a.color, 'avatar-sm', a.img || '')}
                        <span class="ma-detail-name">${a.name}</span>
                        ${canToggle
                          ? `<button class="ma-det-check ${a.done ? 'done' : ''}" onclick="toggleMyDone(${t.id},${!a.done},${a.id},this)">
                               ${svgI('<polyline points="20 6 9 17 4 12"/>',13)}
                               ${a.done ? 'Готово' : 'В работе'}
                             </button>`
                          : `<span class="ma-det-status ${a.done ? 'done' : ''}">${a.done ? '✓ Готово' : '⋯ В работе'}</span>`}
                      </div>`;
                    }).join('')}
                  </div>
                ` : `<div style="display:flex;align-items:center;gap:8px">
                  ${t.assignee_name ? avatar(t.assignee_name, t.assignee_color, 'avatar-sm', t.assignee_img || '') : ''}
                  ${t.assignee_name || '—'}
                </div>`}
              </div>
            </div>
            <div class="task-detail-meta-item">
              <div class="label">Создана</div>
              <div class="value">${fmtDate(t.created_at)}</div>
            </div>
          </div>

          ${canEdit && isAdmin ? `
            <div style="display:flex;gap:10px;margin-bottom:20px">
              <button class="btn btn-outline btn-sm" onclick="closeModal();openTaskModal(${t.id})" style="display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.edit)} Редактировать</button>
              <button class="btn btn-danger btn-sm" onclick="deleteTask(${t.id})" style="display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.trash)} Удалить</button>
            </div>
          ` : ''}

          <div class="comments-section">
            <div class="comments-title" style="display:flex;align-items:center;gap:6px">${svgI(SVG_PATHS.comment)} Комментарии (${comments.length})</div>
            <div class="comment-list">
              ${comments.length === 0
                ? '<div style="font-size:13px;color:#9ca3af;padding:8px 0">Комментариев нет</div>'
                : comments.map(c => {
                    const _cu = state.users.find(u => u.id === c.user_id);
                    const _cImg = c.avatar_img || _cu?.avatar_img || '';
                    return `
                  <div class="comment">
                    ${avatar(c.user_name, c.avatar_color, 'avatar-sm', _cImg)}
                    <div class="comment-body">
                      <div style="display:flex;align-items:center;gap:8px">
                        <span class="comment-author">${c.user_name}</span>
                        <span class="comment-time">${fmtDate(c.created_at)}</span>
                      </div>
                      <div class="comment-text">${c.text}</div>
                    </div>
                  </div>
                `; }).join('')}
            </div>
            <div class="comment-input-row">
              <input class="comment-input" id="comment-input" placeholder="Написать комментарий...">
              <button class="btn btn-blue btn-sm" onclick="submitComment(${t.id})">Отправить</button>
            </div>
          </div>
        </div>
      </div>
    `);

    // Status change listeners
    document.querySelectorAll('.status-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        const newStatus = opt.dataset.status;
        try {
          await PUT('/tasks/' + t.id, { status: newStatus });
          toast('Статус обновлён', 'success');
          closeModal();
          if (state.currentPage === 'dashboard') renderDashboard();
          else if (state.currentPage === 'tasks') renderTasksPage();
          else if (state.currentPage === 'project') renderProjectPage(state.currentProjectId);
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    document.getElementById('comment-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitComment(t.id);
    });

  } catch (err) { toast(err.message, 'error'); }
}

async function submitComment(taskId) {
  const input = document.getElementById('comment-input');
  if (!input?.value.trim()) return;
  try {
    await POST('/tasks/' + taskId + '/comments', { text: input.value.trim() });
    openTaskDetail(taskId);
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTask(taskId) {
  if (!confirm('Удалить задачу?')) return;
  try {
    await DEL('/tasks/' + taskId);
    closeModal();
    toast('Задача удалена', 'success');
    if (state.currentPage === 'dashboard') renderDashboard();
    else if (state.currentPage === 'tasks') renderTasksPage();
    else if (state.currentPage === 'project') renderProjectPage(state.currentProjectId);
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Task Create/Edit Modal ───────────────────────────────────────────────────
function initCustomDatepicker(inputId, initial) {
  const trigger = document.getElementById('cdp-trig-' + inputId);
  const dp      = document.getElementById('cdp-drop-' + inputId);
  const hidden  = document.getElementById(inputId);
  if (!trigger || !dp || !hidden) return;

  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const WDS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  let sel  = initial ? new Date(initial) : null;
  let vy   = sel ? sel.getFullYear() : new Date().getFullYear();
  let vm   = sel ? sel.getMonth()    : new Date().getMonth();
  let isOpen = false;
  let hour = sel ? sel.getHours()   : 9;
  let min  = sel ? sel.getMinutes() : 0;

  const p2 = n => String(n).padStart(2,'0');
  const toISO = d => d ? `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` : '';
  const fmtD  = d => `${p2(d.getDate())}.${p2(d.getMonth()+1)}.${d.getFullYear()}  ${p2(d.getHours())}:${p2(d.getMinutes())}`;

  function updateTrigger() {
    const txt = trigger.querySelector('.cdp-trigger-text');
    txt.innerHTML = sel ? fmtD(sel) : '<span class="cdp-placeholder">Выберите дату и время</span>';
    hidden.value = toISO(sel);
  }

  function renderCal() {
    const today  = new Date();
    const firstDow = (new Date(vy, vm, 1).getDay() + 6) % 7;
    const dim    = new Date(vy, vm + 1, 0).getDate();
    const prevDim = new Date(vy, vm, 0).getDate();
    let cells = '';

    for (let i = 0; i < firstDow; i++) {
      const d = prevDim - firstDow + 1 + i;
      const pm = vm === 0 ? 11 : vm - 1, py = vm === 0 ? vy - 1 : vy;
      cells += `<button class="cdp-day other-m" data-d="${d}" data-m="${pm}" data-y="${py}">${d}</button>`;
    }
    for (let d = 1; d <= dim; d++) {
      const isT = d === today.getDate() && vm === today.getMonth() && vy === today.getFullYear();
      const isS = sel && d === sel.getDate() && vm === sel.getMonth() && vy === sel.getFullYear();
      cells += `<button class="cdp-day${isT?' today':''}${isS?' selected':''}" data-d="${d}" data-m="${vm}" data-y="${vy}">${d}</button>`;
    }
    const total = Math.ceil((firstDow + dim) / 7) * 7;
    for (let i = 1, nm = vm===11?0:vm+1, ny = vm===11?vy+1:vy; firstDow+dim+i-1 < total; i++) {
      cells += `<button class="cdp-day other-m" data-d="${i}" data-m="${nm}" data-y="${ny}">${i}</button>`;
    }

    const upSvg = svgI('<polyline points="18 15 12 9 6 15"/>',9);
    const dnSvg = svgI('<polyline points="6 9 12 15 18 9"/>',9);

    dp.innerHTML = `
      <div class="cdp-nav-row">
        <button class="cdp-nav-btn" id="cdp-prev-${inputId}">${svgI('<polyline points="15 18 9 12 15 6"/>',12)}</button>
        <span class="cdp-month-lbl">${MONTHS[vm]} ${vy}</span>
        <button class="cdp-nav-btn" id="cdp-next-${inputId}">${svgI('<polyline points="9 18 15 12 9 6"/>',12)}</button>
      </div>
      <div class="cdp-grid">
        ${WDS.map(w=>`<div class="cdp-wd">${w}</div>`).join('')}${cells}
      </div>
      <div class="cdp-divider"></div>
      <div class="cdp-time-row">
        <span class="cdp-time-lbl">${svgI(SVG_PATHS.clock,12)} Время</span>
        <div class="cdp-tctrl">
          <button class="cdp-tbtn" id="cdp-hu-${inputId}">${upSvg}</button>
          <input class="cdp-tnum" id="cdp-h-${inputId}" type="text" value="${p2(hour)}" maxlength="2">
          <button class="cdp-tbtn" id="cdp-hd-${inputId}">${dnSvg}</button>
        </div>
        <span class="cdp-tsep">:</span>
        <div class="cdp-tctrl">
          <button class="cdp-tbtn" id="cdp-mu-${inputId}">${upSvg}</button>
          <input class="cdp-tnum" id="cdp-m-${inputId}" type="text" value="${p2(min)}" maxlength="2">
          <button class="cdp-tbtn" id="cdp-md-${inputId}">${dnSvg}</button>
        </div>
      </div>
      <div class="cdp-foot">
        <button class="cdp-clear-btn" id="cdp-clr-${inputId}">Очистить</button>
        <button class="cdp-ok-btn"    id="cdp-ok-${inputId}">Готово</button>
      </div>
    `;

    const sp = e => e.stopPropagation();
    const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
    function syncTime() {
      const hEl = dp.querySelector(`#cdp-h-${inputId}`);
      const mEl = dp.querySelector(`#cdp-m-${inputId}`);
      hour = clamp(parseInt(hEl.value)||0, 0, 23);
      min  = clamp(parseInt(mEl.value)||0, 0, 59);
      hEl.value = p2(hour); mEl.value = p2(min);
      if (sel) { sel.setHours(hour, min); updateTrigger(); }
    }

    dp.querySelectorAll('.cdp-day').forEach(btn => btn.addEventListener('click', () => {
      sel = new Date(+btn.dataset.y, +btn.dataset.m, +btn.dataset.d, hour, min);
      vy = +btn.dataset.y; vm = +btn.dataset.m;
      updateTrigger(); renderCal();
    }));
    dp.querySelector(`#cdp-prev-${inputId}`).addEventListener('click', e => { sp(e); vm--; if(vm<0){vm=11;vy--;} renderCal(); });
    dp.querySelector(`#cdp-next-${inputId}`).addEventListener('click', e => { sp(e); vm++; if(vm>11){vm=0;vy++;} renderCal(); });
    dp.querySelector(`#cdp-hu-${inputId}`).addEventListener('click', e => { sp(e); hour=(hour+1)%24; dp.querySelector(`#cdp-h-${inputId}`).value=p2(hour); syncTime(); });
    dp.querySelector(`#cdp-hd-${inputId}`).addEventListener('click', e => { sp(e); hour=(hour+23)%24; dp.querySelector(`#cdp-h-${inputId}`).value=p2(hour); syncTime(); });
    dp.querySelector(`#cdp-mu-${inputId}`).addEventListener('click', e => { sp(e); min=(min+5)%60; dp.querySelector(`#cdp-m-${inputId}`).value=p2(min); syncTime(); });
    dp.querySelector(`#cdp-md-${inputId}`).addEventListener('click', e => { sp(e); min=(min+55)%60; dp.querySelector(`#cdp-m-${inputId}`).value=p2(min); syncTime(); });
    dp.querySelector(`#cdp-h-${inputId}`).addEventListener('change', syncTime);
    dp.querySelector(`#cdp-m-${inputId}`).addEventListener('change', syncTime);
    dp.querySelector(`#cdp-clr-${inputId}`).addEventListener('click', e => { sp(e); sel=null; updateTrigger(); renderCal(); });
    dp.querySelector(`#cdp-ok-${inputId}`).addEventListener('click',  e => { sp(e); closeDp(); });
  }

  function positionDp() {
    const r = trigger.getBoundingClientRect();
    dp.style.left = r.left + 'px';
    dp.style.top  = (window.innerHeight - r.bottom < 330) ? (r.top - 342) + 'px' : (r.bottom + 4) + 'px';
  }

  function openDp()  { isOpen=true;  positionDp(); dp.classList.remove('hidden'); trigger.classList.add('open'); renderCal(); }
  function closeDp() { isOpen=false; dp.classList.add('hidden'); trigger.classList.remove('open'); }

  trigger.addEventListener('click', e => { e.stopPropagation(); isOpen ? closeDp() : openDp(); });
  document.addEventListener('click', e => {
    if (!document.contains(trigger)) return;
    if (isOpen && !dp.contains(e.target) && !trigger.contains(e.target)) closeDp();
  });

  updateTrigger();
}

async function openTaskModal(taskId = null, defaultProjectId = null) {
  const isAdmin = state.user.role === 'admin';
  let task = null;
  if (taskId) {
    try {
      const tasks = await GET('/tasks');
      task = tasks.find(t => String(t.id) === String(taskId));
    } catch {}
  }

  const projectOptions = state.projects.map(p =>
    `<option value="${p.id}" ${(task?.project_id === p.id || String(defaultProjectId) === String(p.id)) ? 'selected' : ''}>${p.name}</option>`
  ).join('');

  const selectedIds = new Set(
    task?.multi_assignees?.map(a => a.id) ||
    (task?.assignee_id ? [task.assignee_id] : [])
  );

  const deadline = task?.deadline ? new Date(task.deadline).toISOString().slice(0,16) : '';

  openModal(`
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${task ? 'Редактировать задачу' : '＋ Новая задача'}</div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Название задачи *</label>
          <input id="f-title" placeholder="Что нужно сделать?" value="${task?.title || ''}">
        </div>
        <div class="field">
          <label>Описание</label>
          <textarea id="f-desc" placeholder="Подробности задачи...">${task?.description || ''}</textarea>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Проект</label>
            <select id="f-project">
              <option value="">— Без проекта —</option>
              ${projectOptions}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Исполнители <span style="font-size:11px;color:#9ca3af;font-weight:400">(можно выбрать несколько)</span></label>
          <div class="assignee-picker" id="f-assignees">
            ${state.users.map(u => `
              <div class="assignee-chip ${selectedIds.has(u.id) ? 'selected' : ''}" data-uid="${u.id}" onclick="this.classList.toggle('selected')">
                ${avatar(u.name, u.avatar_color, 'avatar-xs', u.avatar_img || '')}
                <span>${u.name}</span>
              </div>`).join('')}
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Приоритет</label>
            <select id="f-priority">
              <option value="low" ${task?.priority==='low' ? 'selected':''}>Низкий</option>
              <option value="medium" ${!task || task?.priority==='medium' ? 'selected':''}>Средний</option>
              <option value="high" ${task?.priority==='high' ? 'selected':''}>Высокий</option>
            </select>
          </div>
          <div class="field">
            <label>Дедлайн</label>
            <div class="cdp-wrap">
              <button type="button" class="cdp-trigger" id="cdp-trig-f-deadline">
                ${svgI(SVG_PATHS.cal, 13, 'style="color:var(--text-muted);flex-shrink:0"')}
                <span class="cdp-trigger-text"></span>
                <span class="cdp-chevron">${svgI('<polyline points="6 9 12 15 18 9"/>',12)}</span>
              </button>
              <div class="cdp-dropdown hidden" id="cdp-drop-f-deadline"></div>
              <input type="hidden" id="f-deadline">
            </div>
          </div>
        </div>
        <div class="field">
          <label>Повторение</label>
          <select id="f-recurrence">
            <option value="none" ${!task?.recurrence || task?.recurrence==='none' ? 'selected':''}>Не повторяется</option>
            <option value="daily" ${task?.recurrence==='daily' ? 'selected':''}>Каждый день</option>
            <option value="weekly" ${task?.recurrence==='weekly' ? 'selected':''}>Каждую неделю</option>
            <option value="monthly" ${task?.recurrence==='monthly' ? 'selected':''}>Каждый месяц</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn btn-blue" id="save-task-btn">${task ? 'Сохранить' : 'Создать задачу'}</button>
      </div>
    </div>
  `);

  initCustomDatepicker('f-deadline', deadline);

  document.getElementById('save-task-btn').addEventListener('click', async () => {
    const title = document.getElementById('f-title').value.trim();
    if (!title) { toast('Укажите название задачи', 'error'); return; }
    const btn = document.getElementById('save-task-btn');
    btn.disabled = true; btn.textContent = 'Сохраняю...';
    try {
      const assignee_ids = [...document.querySelectorAll('#f-assignees .assignee-chip.selected')].map(el => parseInt(el.dataset.uid));
      const payload = {
        title,
        description: document.getElementById('f-desc').value.trim(),
        project_id: document.getElementById('f-project').value || null,
        assignee_ids,
        priority: document.getElementById('f-priority').value,
        deadline: document.getElementById('f-deadline').value || null,
        recurrence: document.getElementById('f-recurrence').value || 'none',
      };
      if (task) await PUT('/tasks/' + taskId, payload);
      else await POST('/tasks', payload);
      closeModal();
      toast(task ? 'Задача обновлена' : 'Задача создана', 'success');
      if (state.currentPage === 'dashboard') renderDashboard();
      else if (state.currentPage === 'tasks') renderTasksPage();
      else if (state.currentPage === 'project') renderProjectPage(state.currentProjectId);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = task ? 'Сохранить' : 'Создать задачу';
    }
  });
}

// ─── Project Modal ────────────────────────────────────────────────────────────
async function openProjectModal(projectId = null) {
  let project = null;
  if (projectId) project = state.projects.find(p => String(p.id) === String(projectId));
  let selectedColor = project?.color || '#6366f1';

  openModal(`
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${project ? 'Изменить проект' : '＋ Новый проект'}</div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Название клиента / проекта *</label>
          <input id="pf-name" placeholder="Название компании клиента" value="${project?.name || ''}">
        </div>
        <div class="field">
          <label>Описание</label>
          <input id="pf-desc" placeholder="Краткое описание (необязательно)" value="${project?.description || ''}">
        </div>
        <div class="field">
          <label>Цвет проекта</label>
          <div id="color-picker-wrap"></div>
        </div>
      </div>
      <div class="modal-footer">
        ${project ? `<button class="btn btn-danger" onclick="deleteProject(${project.id})" style="margin-right:auto;display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.trash)} Удалить</button>` : ''}
        <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn btn-blue" id="save-project-btn">${project ? 'Сохранить' : 'Создать'}</button>
      </div>
    </div>
  `);

  document.getElementById('color-picker-wrap').innerHTML = colorPicker(selectedColor, c => { selectedColor = c; });

  document.getElementById('save-project-btn').addEventListener('click', async () => {
    const name = document.getElementById('pf-name').value.trim();
    if (!name) { toast('Укажите название', 'error'); return; }
    const btn = document.getElementById('save-project-btn');
    btn.disabled = true;
    try {
      const payload = { name, color: selectedColor, description: document.getElementById('pf-desc').value.trim() };
      if (project) await PUT('/projects/' + project.id, payload);
      else await POST('/projects', payload);
      await loadSharedData();
      closeModal();
      toast(project ? 'Проект обновлён' : 'Проект создан', 'success');
      if (state.currentPage === 'dashboard') renderDashboard();
      else if (state.currentPage === 'project') renderProjectPage(state.currentProjectId);
      else renderTasksPage();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

async function deleteProject(id) {
  if (!confirm('Удалить проект и все его задачи?')) return;
  try {
    await DEL('/projects/' + id);
    await loadSharedData();
    closeModal();
    toast('Проект удалён', 'success');
    navigateTo('dashboard');
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Reports Page ────────────────────────────────────────────────────────────
// ─── Activity Page ────────────────────────────────────────────────────────────
async function renderActivityPage() {
  document.getElementById('page-content').innerHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px">
      <div id="act-chart-block" style="flex:1;min-width:280px"><div style="color:#94a3b8;font-size:13px">Загрузка...</div></div>
      <div id="act-users-block" style="width:300px;flex-shrink:0"><div style="color:#94a3b8;font-size:13px">Загрузка...</div></div>
    </div>
    <div id="act-log-block"><div style="color:#94a3b8;font-size:13px">Загрузка...</div></div>
  `;

  try {
    const [logs, chart, users] = await Promise.all([
      GET('/activity?limit=100'),
      GET('/activity/chart'),
      GET('/users/last-seen'),
    ]);
    renderActivityChart(chart);
    renderActivityUsers(users);
    renderActivityLog(logs);
  } catch (e) {
    document.getElementById('page-content').innerHTML =
      `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${e.message}</p></div>`;
  }
}

function renderActivityChart(chart) {
  const el = document.getElementById('act-chart-block');
  if (!el) return;

  // Build 30-day map
  const today = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const map = {};
  chart.forEach(r => { map[r.day] = r; });
  const maxEvents = Math.max(...days.map(d => map[d]?.events || 0), 1);

  const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

  const bars = days.map(d => {
    const row = map[d] || { events: 0, users: 0 };
    const h = Math.round((row.events / maxEvents) * 100);
    const date = new Date(d + 'T00:00:00');
    const label = date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()];
    const isToday = d === today.toISOString().slice(0, 10);
    const color = row.events === 0 ? '#E2E8F0' : row.users >= 5 ? '#059669' : row.users >= 3 ? '#3B82F6' : '#D97706';
    return `
      <div class="act-bar-col" title="${label}: ${row.events} событий, ${row.users} польз.">
        <div class="act-bar-wrap">
          <div class="act-bar" style="height:${h}%;background:${color};${isToday?'outline:2px solid #0F172A;outline-offset:1px':''}"></div>
        </div>
        <div class="act-bar-lbl${isToday?' act-bar-today':''}">${date.getDate()}</div>
      </div>`;
  }).join('');

  const totalEvents = chart.reduce((s, r) => s + r.events, 0);
  const activeDays = chart.filter(r => r.events > 0).length;

  el.innerHTML = `
    <div class="chart-panel" style="height:100%">
      <div class="chart-title">Активность за 30 дней</div>
      <div style="display:flex;gap:14px;margin-bottom:16px;flex-wrap:wrap">
        <div class="act-mini-stat"><div class="act-mini-val">${totalEvents}</div><div class="act-mini-lbl">событий</div></div>
        <div class="act-mini-stat"><div class="act-mini-val">${activeDays}</div><div class="act-mini-lbl">активных дней</div></div>
        <div style="display:flex;align-items:center;gap:10px;margin-left:auto;font-size:11px;color:var(--text-muted)">
          <span><span class="act-legend-dot" style="background:#059669"></span> 5+ польз.</span>
          <span><span class="act-legend-dot" style="background:#3B82F6"></span> 3–4</span>
          <span><span class="act-legend-dot" style="background:#D97706"></span> 1–2</span>
        </div>
      </div>
      <div class="act-chart">${bars}</div>
    </div>
  `;
}

function renderActivityUsers(users) {
  const el = document.getElementById('act-users-block');
  if (!el) return;

  const ACTION_LABELS = {
    login: 'Вход в систему', task_created: 'Создал задачу',
    task_status: 'Изменил статус', task_updated: 'Обновил задачу', comment: 'Написал комментарий',
  };

  const toUtc = dt => dt ? new Date(dt.endsWith('Z') ? dt : dt + 'Z') : null;
  const timeAgo = dt => {
    if (!dt) return 'никогда';
    const diff = Date.now() - toUtc(dt);
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'только что';
    if (m < 60) return m + ' мин. назад';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ч. назад';
    const day = Math.floor(h / 24);
    if (day < 7) return day + ' дн. назад';
    return toUtc(dt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Dushanbe' });
  };

  el.innerHTML = `
    <div class="chart-panel">
      <div class="chart-title">Сотрудники</div>
      <div class="act-users-list">
        ${users.map(u => {
          const online = u.last_seen && (Date.now() - toUtc(u.last_seen)) < 5 * 60000;
          const initials = u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
          return `
            <div class="act-user-row" style="cursor:pointer" onclick="openUserActivityPage(${u.id})">
              <div class="act-user-avatar" style="background:${u.avatar_color || '#6366f1'}">
                ${u.avatar_img ? `<img src="${u.avatar_img}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : initials}
                <span class="act-online-dot" style="background:${online ? '#22c55e' : '#94a3b8'}"></span>
              </div>
              <div class="act-user-info">
                <div class="act-user-name">${u.name}</div>
                <div class="act-user-last">
                  ${u.last_activity_at
                    ? `${ACTION_LABELS[u.last_action] || u.last_action} · ${timeAgo(u.last_activity_at)}`
                    : 'Нет активности'}
                </div>
              </div>
              <div class="act-user-seen" title="Последний вход">${timeAgo(u.last_seen)}</div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function renderActivityLog(logs) {
  const el = document.getElementById('act-log-block');
  if (!el) return;

  const ACTION_ICON = {
    login:        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
    task_created: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    task_status:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    task_updated: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    comment:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
  };
  const ACTION_COLOR = { login:'#6366f1', task_created:'#3B82F6', task_status:'#059669', task_updated:'#D97706', comment:'#8B5CF6' };
  const ACTION_TEXT = {
    login: 'вошёл в систему', task_created: 'создал задачу', task_status: 'изменил статус',
    task_updated: 'обновил задачу', comment: 'написал комментарий к',
  };

  const toUtcLog = dt => dt ? new Date(dt.endsWith('Z') ? dt : dt + 'Z') : null;
  const fmtTime = dt => {
    const d = toUtcLog(dt);
    if (!d) return '—';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' });
  };

  const initials = name => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  el.innerHTML = `
    <div class="chart-panel">
      <div class="chart-title">Лог активности <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-light);margin-left:4px">· последние ${logs.length} событий</span></div>
      ${logs.length === 0 ? '<div style="color:#94a3b8;font-size:13px;padding:8px 0">Активности нет — она появится после входа и работы сотрудников</div>' : ''}
      <div class="act-log-list">
        ${logs.map(log => {
          const color = ACTION_COLOR[log.action] || '#94a3b8';
          const icon  = ACTION_ICON[log.action]  || ACTION_ICON.task_updated;
          const text  = ACTION_TEXT[log.action]  || log.action;
          return `
            <div class="act-log-row">
              <div class="act-log-avatar" style="background:${log.user_color || '#6366f1'}">
                ${log.user_avatar
                  ? `<img src="${log.user_avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
                  : initials(log.user_name)}
              </div>
              <div class="act-log-body">
                <div class="act-log-text">
                  <span class="act-log-username">${log.user_name}</span>
                  ${text}
                  ${log.entity_title ? `<span class="act-log-entity">«${log.entity_title}»</span>` : ''}
                  ${log.detail ? `<span class="act-log-detail">${log.detail}</span>` : ''}
                </div>
                <div class="act-log-time">${fmtTime(log.created_at)}</div>
              </div>
              <div class="act-log-icon" style="background:${color}1a;color:${color}">${icon}</div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ─── User Activity Page ───────────────────────────────────────────────────────
let userActivityPeriod = 30;

async function openUserActivityPage(userId, days) {
  days = days || userActivityPeriod;
  userActivityPeriod = days;
  try { sessionStorage.setItem('mb_page', `user_activity:${userId}:${days}`); } catch {}
  document.getElementById('page-title').textContent = 'Активность сотрудника';

  const PERIODS = [[7,'7 дней'],[14,'14 дней'],[30,'1 месяц'],[90,'3 месяца'],[180,'6 месяцев'],[365,'1 год']];

  document.getElementById('page-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="renderActivityPage()" style="display:inline-flex;align-items:center;gap:6px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Назад
      </button>
      <div class="period-filter">
        ${PERIODS.map(([d,l]) => `<button class="period-btn ${days===d?'active':''}" onclick="openUserActivityPage(${userId},${d})">${l}</button>`).join('')}
      </div>
    </div>
    <div id="uap-content"><div style="text-align:center;padding:40px;color:#94a3b8">Загрузка...</div></div>
  `;

  try {
    const data = await GET(`/activity/user/${userId}?days=${days}`);
    renderUserActivityContent(userId, data, days);
  } catch(e) {
    document.getElementById('uap-content').innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${e.message}</p></div>`;
  }
}

function renderUserActivityContent(userId, data, days) {
  const { user, logs, chart, actions } = data;
  const el = document.getElementById('uap-content');
  if (!el) return;

  const toUtc = dt => dt ? new Date(dt.endsWith('Z') ? dt : dt + 'Z') : null;
  const fmtT  = dt => {
    const d = toUtc(dt); if (!d) return '—';
    return d.toLocaleString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Dushanbe' });
  };
  const timeAgo = dt => {
    if (!dt) return 'никогда';
    const diff = Date.now() - toUtc(dt);
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'только что';
    if (m < 60) return m + ' мин. назад';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ч. назад';
    const day = Math.floor(h / 24);
    if (day < 7) return day + ' дн. назад';
    return toUtc(dt).toLocaleString('ru-RU', { day:'numeric', month:'short', timeZone:'Asia/Dushanbe' });
  };

  const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const initials = n => n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const online   = user.last_seen && (Date.now() - toUtc(user.last_seen)) < 5 * 60000;

  // Build chart days array
  const today = new Date();
  const chartDays = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    chartDays.push(d.toISOString().slice(0, 10));
  }
  const chartMap = {};
  chart.forEach(r => { chartMap[r.day] = r.events; });
  const maxEv = Math.max(...chartDays.map(d => chartMap[d] || 0), 1);

  // Determine label density based on period
  const showLabelEvery = days <= 14 ? 1 : days <= 30 ? 3 : days <= 90 ? 7 : days <= 180 ? 14 : 30;

  const bars = chartDays.map((d, i) => {
    const ev = chartMap[d] || 0;
    const h  = Math.round((ev / maxEv) * 100);
    const date = new Date(d + 'T00:00:00');
    const label = date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()];
    const isToday = d === today.toISOString().slice(0, 10);
    const color = ev === 0 ? '#E2E8F0' : ev >= 10 ? '#059669' : ev >= 4 ? '#3B82F6' : '#D97706';
    const showLbl = i % showLabelEvery === 0;
    return `
      <div class="act-bar-col" title="${label}: ${ev} событий" style="min-width:0">
        <div class="act-bar-wrap">
          <div class="act-bar" style="height:${Math.max(h,ev>0?4:0)}%;background:${color};${isToday?'outline:2px solid #0F172A;outline-offset:1px':''}"></div>
        </div>
        <div class="act-bar-lbl${isToday?' act-bar-today':''}" style="${showLbl?'':'visibility:hidden'}">${date.getDate()}</div>
      </div>`;
  }).join('');

  // Stats from actions
  const actionMap = {}; actions.forEach(a => { actionMap[a.action] = a.count; });
  const totalEv   = logs.length;
  const loginCnt  = actionMap.login        || 0;
  const tasksCnt  = actionMap.task_created || 0;
  const statusCnt = actionMap.task_status  || 0;
  const commentCnt= actionMap.comment      || 0;

  // Action labels for log
  const ACTION_TEXT = {
    login:'вошёл в систему', task_created:'создал задачу', task_status:'изменил статус',
    task_updated:'обновил задачу', comment:'прокомментировал',
  };
  const ACTION_COLOR = { login:'#6366f1', task_created:'#3B82F6', task_status:'#059669', task_updated:'#D97706', comment:'#8B5CF6' };
  const ACTION_ICON  = {
    login:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
    task_created:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    task_status:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    task_updated:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    comment:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
  };

  el.innerHTML = `
    <!-- Employee card -->
    <div class="uap-user-card">
      <div class="uap-avatar" style="background:${user.avatar_color||'#6366f1'}">
        ${user.avatar_img ? `<img src="${user.avatar_img}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : initials(user.name)}
        <span class="act-online-dot" style="background:${online?'#22c55e':'#94a3b8'}"></span>
      </div>
      <div style="flex:1">
        <div class="uap-user-name">${user.name}</div>
        <div class="uap-user-meta">
          ${user.role === 'admin' ? 'Администратор' : 'Сотрудник'}
          · последний вход: ${timeAgo(user.last_seen)}
        </div>
      </div>
    </div>

    <!-- Mini stats -->
    <div class="dash-stat-cards" style="margin-bottom:16px">
      <div class="dash-stat-card">
        <div class="dsc-label">Событий за период</div>
        <div class="dsc-value">${totalEv}</div>
        <div class="dsc-sub">${loginCnt} входов в систему</div>
      </div>
      <div class="dash-stat-card">
        <div class="dsc-label">Задачи</div>
        <div class="dsc-value dsc-value--green">${tasksCnt}</div>
        <div class="dsc-sub">${statusCnt} смен статуса</div>
      </div>
      <div class="dash-stat-card">
        <div class="dsc-label">Комментарии</div>
        <div class="dsc-value" style="color:#8B5CF6">${commentCnt}</div>
        <div class="dsc-sub">за выбранный период</div>
      </div>
    </div>

    <!-- Chart -->
    <div class="chart-panel" style="margin-bottom:16px">
      <div class="chart-title">График активности по дням</div>
      <div class="act-chart" style="height:120px">${bars}</div>
      <div style="display:flex;gap:14px;margin-top:10px;font-size:11px;color:var(--text-muted)">
        <span><span class="act-legend-dot" style="background:#059669"></span> 10+ событий</span>
        <span><span class="act-legend-dot" style="background:#3B82F6"></span> 4–9</span>
        <span><span class="act-legend-dot" style="background:#D97706"></span> 1–3</span>
        <span><span class="act-legend-dot" style="background:#E2E8F0"></span> нет активности</span>
      </div>
    </div>

    <!-- Log -->
    <div class="chart-panel">
      <div class="chart-title">Лог активности <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-light);margin-left:4px">· ${logs.length} событий</span></div>
      ${logs.length === 0
        ? '<div style="color:#94a3b8;font-size:13px;padding:8px 0">Нет активности за выбранный период</div>'
        : `<div class="act-log-list">
          ${logs.map(log => {
            const color = ACTION_COLOR[log.action] || '#94a3b8';
            const icon  = ACTION_ICON[log.action]  || ACTION_ICON.task_updated;
            const text  = ACTION_TEXT[log.action]  || log.action;
            return `
              <div class="act-log-row">
                <div class="act-log-body">
                  <div class="act-log-text">
                    ${text}
                    ${log.entity_title ? `<span class="act-log-entity">«${log.entity_title}»</span>` : ''}
                    ${log.detail ? `<span class="act-log-detail">${log.detail}</span>` : ''}
                  </div>
                  <div class="act-log-time">${fmtT(log.created_at)}</div>
                </div>
                <div class="act-log-icon" style="background:${color}1a;color:${color}">${icon}</div>
              </div>`;
          }).join('')}
        </div>`}
    </div>
  `;
}

async function renderReportsPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  document.getElementById('page-content').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:15px;font-weight:700">Эффективность команды</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px">Статистика по задачам за выбранный месяц</div>
      </div>
      <div class="report-month-picker">
        <span style="font-size:13px;color:#6b7280">Месяц:</span>
        <input type="month" id="report-month" value="${currentMonth}">
        <button class="btn btn-blue btn-sm" onclick="loadReport()">Показать</button>
      </div>
    </div>
    <div id="report-content"><div style="text-align:center;padding:40px;color:#9ca3af">Загрузка...</div></div>
  `;
  loadReport();
}

async function loadReport() {
  const month = document.getElementById('report-month')?.value || '';
  try {
    const data = await GET('/reports' + (month ? '?month=' + month : ''));
    const container = document.getElementById('report-content');
    if (!container) return;

    if (data.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.users,44)}</div><h3>Нет сотрудников</h3><p>Добавьте сотрудников в разделе «Команда»</p></div>`;
      return;
    }

    // Summary row
    const totalAll = data.reduce((s, u) => s + (u.stats.total || 0), 0);
    const doneAll = data.reduce((s, u) => s + (u.stats.done || 0), 0);
    const overdueAll = data.reduce((s, u) => s + (u.stats.overdue || 0), 0);

    container.innerHTML = `
      <div class="stats-grid" style="margin-bottom:24px">
        <div class="stat-card">
          <div class="stat-icon" style="border-color:#64748B"></div>
          <div><div class="stat-value">${totalAll}</div><div class="stat-label">Всего задач</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="border-color:#059669"></div>
          <div><div class="stat-value">${doneAll}</div><div class="stat-label">Выполнено</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="border-color:#DC2626"></div>
          <div><div class="stat-value">${overdueAll}</div><div class="stat-label">Просрочено</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="border-color:#881337"></div>
          <div><div class="stat-value">${totalAll > 0 ? Math.round(doneAll / totalAll * 100) : 0}%</div><div class="stat-label">Общая эффективность</div></div>
        </div>
      </div>

      <div class="report-grid">
        ${data.map(u => {
          const s = u.stats;
          const total = s.total || 0;
          const done = s.done || 0;
          const pct = total > 0 ? Math.round(done / total * 100) : 0;
          const effColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444';

          return `
            <div class="report-card" onclick="openEmployeeProfile(${u.id})">
              <div class="report-card-header">
                ${avatar(u.name, u.avatar_color, 'avatar-lg', u.avatar_img || '')}
                <div>
                  <div class="report-card-name">${u.name}</div>
                  ${s.overdue > 0
                    ? `<span class="overdue-badge" style="display:inline-flex;align-items:center;gap:4px">${svgI(SVG_PATHS.warning)} ${s.overdue} просрочено</span>`
                    : `<span style="font-size:11px;color:#16a34a;display:inline-flex;align-items:center;gap:4px">${svgI(SVG_PATHS.check, 12, 'stroke="#16a34a"')} Без просрочек</span>`}
                </div>
              </div>
              <div class="report-card-body">
                <div class="report-stats">
                  <div class="report-stat">
                    <div class="report-stat-val">${total}</div>
                    <div class="report-stat-lbl">Всего задач</div>
                  </div>
                  <div class="report-stat">
                    <div class="report-stat-val" style="color:#22c55e">${done}</div>
                    <div class="report-stat-lbl">Выполнено</div>
                  </div>
                  <div class="report-stat">
                    <div class="report-stat-val" style="color:#ca8a04">${s.in_progress || 0}</div>
                    <div class="report-stat-lbl">В работе</div>
                  </div>
                  <div class="report-stat">
                    <div class="report-stat-val" style="color:#2563eb">${s.new_count || 0}</div>
                    <div class="report-stat-lbl">Новых</div>
                  </div>
                </div>

                <div class="report-efficiency">
                  <span class="report-efficiency-label">Эффективность</span>
                  <div class="report-efficiency-bar">
                    <div class="report-efficiency-fill" style="width:${pct}%;background:${effColor}"></div>
                  </div>
                  <span class="report-efficiency-pct" style="color:${effColor}">${pct}%</span>
                </div>

                ${u.byProject.length > 0 ? `
                  <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">По проектам</div>
                  <div class="report-projects">
                    ${u.byProject.map(p => `
                      <div class="report-project-row">
                        <div class="report-project-dot" style="background:${p.color}"></div>
                        <span class="report-project-name">${p.name}</span>
                        <span class="report-project-count">${p.done}/${p.total}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : '<div style="font-size:12px;color:#9ca3af">Нет задач в этом периоде</div>'}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    document.getElementById('report-content').innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`;
  }
}

const PERM_LABELS = {
  reports:         { icon: svgI(SVG_PATHS.bars, 13),   text: 'Отчёты' },
  manage_projects: { icon: svgI(SVG_PATHS.folder, 13), text: 'Проекты' },
  assign_tasks:    { icon: svgI(SVG_PATHS.clip, 13),   text: 'Назначать задачи' },
  manage_team:     { icon: svgI(SVG_PATHS.users, 13),  text: 'Команда' },
};

function permTags(perms) {
  if (!perms) return '';
  return Object.entries(PERM_LABELS)
    .filter(([k]) => perms[k])
    .map(([k, v]) => `<span class="perm-tag">${v.icon} ${v.text}</span>`)
    .join('');
}

// ─── Employee Profile ──────────────────────────────────────────────────────────
function openEmployeeProfile(userId) {
  state.currentEmployeeId = userId;
  const user = state.users.find(u => u.id === userId);
  if (user) PAGE_TITLES.employee = user.name;
  navigateTo('employee');
}

function svgMonthlyBars(months) {
  const W = 600, H = 120, padL = 10, padR = 10, padT = 24, padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = months.length;
  const maxVal = Math.max(1, ...months.map(d => d.total));
  const bw = Math.floor((innerW - (n - 1) * 12) / n);
  const baseY = padT + innerH;

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible;display:block" preserveAspectRatio="none">
    ${months.map((d, i) => {
      const x = padL + i * (bw + 12);
      const cx = x + bw / 2;
      const totalH = Math.round((d.total / maxVal) * innerH);
      const doneH  = Math.round((d.done  / maxVal) * innerH);
      const delay  = i * 70;
      return `
        <rect class="anim-bar" x="${x}" y="${baseY - totalH}" width="${bw}" height="${totalH || 0}" fill="#E2E8F0" rx="4"
          style="transform-origin:${cx}px ${baseY}px;transform:scaleY(0);transition:transform 0.7s cubic-bezier(0.22,1,0.36,1) ${delay}ms"/>
        <rect class="anim-bar" x="${x}" y="${baseY - doneH}" width="${bw}" height="${doneH || 0}" fill="#881337" rx="4"
          style="transform-origin:${cx}px ${baseY}px;transform:scaleY(0);transition:transform 0.7s cubic-bezier(0.22,1,0.36,1) ${delay + 80}ms"/>
        <text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#94A3B8" font-family="sans-serif">${d.label}</text>
        ${d.total > 0 ? `<text x="${cx}" y="${baseY - totalH - 5}" text-anchor="middle" font-size="11" fill="#475569" font-weight="600" font-family="sans-serif">${d.total}</text>` : ''}
      `;
    }).join('')}
  </svg>`;
}

async function renderEmployeeProfile(userId) {
  try {
    const [users, allTasks] = await Promise.all([GET('/users'), GET('/tasks')]);
    const u = users.find(u => u.id === userId);
    if (!u) {
      document.getElementById('page-content').innerHTML = '<div class="empty-state"><h3>Сотрудник не найден</h3></div>';
      return;
    }

    const tasks = allTasks.filter(t => t.assignee_id === userId);
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const inProg = tasks.filter(t => t.status === 'in_progress').length;
    const newCnt = tasks.filter(t => t.status === 'new').length;
    const overdue = tasks.filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) < new Date()).length;
    const pct = total > 0 ? Math.round(done / total * 100) : 0;
    const effColor = pct >= 80 ? '#059669' : pct >= 50 ? '#D97706' : pct > 0 ? '#DC2626' : '#94A3B8';

    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('ru-RU', { month: 'short' }), total: 0, done: 0 };
    });
    tasks.forEach(t => {
      const cd = new Date(t.created_at);
      const idx = months.findIndex(m => m.year === cd.getFullYear() && m.month === cd.getMonth());
      if (idx >= 0) { months[idx].total++; if (t.status === 'done') months[idx].done++; }
    });

    const byProject = {};
    tasks.forEach(t => {
      const key = t.project_id || 0;
      if (!byProject[key]) byProject[key] = { name: t.project_name || 'Без проекта', color: t.project_color || '#94A3B8', total: 0, done: 0 };
      byProject[key].total++;
      if (t.status === 'done') byProject[key].done++;
    });
    const projects = Object.values(byProject).sort((a, b) => b.total - a.total);
    const rl = roleLabel(u);

    document.getElementById('page-content').innerHTML = `
      <button class="btn btn-outline btn-sm" style="margin-bottom:18px" onclick="navigateTo('team')">← Назад к команде</button>

      <!-- Header card: full width -->
      <div class="emp-profile-header">
        <div class="emp-profile-avatar" style="background:${u.avatar_color || '#6366f1'}">${initials(u.name)}</div>
        <div class="emp-profile-info">
          <div class="emp-profile-name">${u.name}</div>
          <div class="emp-profile-email">${u.email}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
            <span class="member-role ${rl.cls}">${rl.text}</span>
            ${u.role !== 'admin' ? permTags(u.permissions) : ''}
          </div>
        </div>
        <div class="emp-profile-eff">
          <div class="emp-profile-eff-val" style="color:${effColor}"><span data-count="${pct}" data-suffix="%">0%</span></div>
          <div class="emp-profile-eff-lbl">Эффективность</div>
          <div class="emp-profile-eff-bar">
            <div style="width:0%;background:${effColor};height:100%;border-radius:4px;transition:width 0.9s cubic-bezier(0.22,1,0.36,1)" data-bar-to="${pct}%"></div>
          </div>
        </div>
      </div>

      <!-- Stats: 4 cards full width -->
      <div class="stats-grid" style="margin:20px 0;grid-template-columns:repeat(4,1fr)">
        <div class="stat-card">
          <div class="stat-icon" style="border-color:#64748B"></div>
          <div><div class="stat-value"><span data-count="${total}">0</span></div><div class="stat-label">Всего задач</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="border-color:#059669"></div>
          <div><div class="stat-value"><span data-count="${done}">0</span></div><div class="stat-label">Завершено</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="border-color:#D97706"></div>
          <div><div class="stat-value"><span data-count="${inProg}">0</span></div><div class="stat-label">В работе</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="border-color:#DC2626"></div>
          <div><div class="stat-value"><span data-count="${overdue}">0</span></div><div class="stat-label">Просрочено</div></div>
        </div>
      </div>

      <!-- Charts: 3-column grid (chart wider, projects, empty stats) -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:24px">
        <div class="chart-panel" style="grid-column:1/3">
          <div class="chart-title">Задачи по месяцам</div>
          ${svgMonthlyBars(months)}
          <div style="display:flex;gap:14px;margin-top:10px">
            <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)">
              <div style="width:10px;height:10px;background:#E2E8F0;border-radius:2px;flex-shrink:0"></div>Всего
            </div>
            <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)">
              <div style="width:10px;height:10px;background:#881337;border-radius:2px;flex-shrink:0"></div>Выполнено
            </div>
          </div>
        </div>
        <div class="chart-panel">
          <div class="chart-title">По проектам</div>
          ${projects.length === 0
            ? '<div style="color:var(--text-muted);font-size:12px;padding:16px 0">Нет задач</div>'
            : projects.map(p => {
                const ppct = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
                return `
                  <div class="proj-bar-row">
                    <div class="proj-bar-top">
                      <div style="display:flex;align-items:center;gap:6px">
                        <div style="width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0"></div>
                        <span class="proj-bar-name">${p.name}</span>
                      </div>
                      <span class="proj-bar-count">${p.done}/${p.total}</span>
                    </div>
                    <div class="proj-bar-track">
                      <div class="proj-bar-fill" style="width:0%;background:${p.color};transition:width 0.8s cubic-bezier(0.22,1,0.36,1)" data-bar-to="${ppct}%"></div>
                    </div>
                  </div>
                `;
              }).join('')
          }
        </div>
      </div>

      <!-- Task list: full width -->
      <div class="section-header" style="margin-bottom:14px">
        <div class="section-title">Все задачи сотрудника</div>
      </div>
      ${tasks.length === 0
        ? `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.clip,44)}</div><h3>Нет задач</h3><p>Задачи не назначены</p></div>`
        : `<div class="tasks-list">${tasks.map(t => taskCard(t)).join('')}</div>`
      }
    `;
    attachTaskCardListeners();
    triggerDashAnimations();
  } catch (err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${err.message}</p></div>`;
  }
}

// ─── Team Page ────────────────────────────────────────────────────────────────
async function renderTeamPage() {
  const isAdmin = state.user.role === 'admin';
  try {
    const [users, tasks] = await Promise.all([GET('/users'), GET('/tasks')]);
    state.users = users;

    // Group task counts by assignee
    const tasksByUser = {};
    tasks.forEach(t => {
      if (!t.assignee_id) return;
      if (!tasksByUser[t.assignee_id]) tasksByUser[t.assignee_id] = { total: 0, done: 0, in_progress: 0, new_count: 0 };
      const s = tasksByUser[t.assignee_id];
      s.total++;
      if (t.status === 'done') s.done++;
      else if (t.status === 'in_progress') s.in_progress++;
      else s.new_count++;
    });

    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div class="section-title">Участники команды (${users.length})</div>
        ${isAdmin ? `<button class="btn btn-blue btn-sm" onclick="openUserModal()">＋ Добавить сотрудника</button>` : ''}
      </div>
      <div class="team-grid">
        ${users.map(u => {
          const rl = roleLabel(u);
          const tags = u.role !== 'admin' ? permTags(u.permissions) : '';
          const s = tasksByUser[u.id] || { total: 0, done: 0, in_progress: 0, new_count: 0 };
          const pct = s.total > 0 ? Math.round(s.done / s.total * 100) : 0;
          const effColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : pct > 0 ? '#ef4444' : '#d1d5db';
          return `
          <div class="member-card clickable" onclick="openEmployeeProfile(${u.id})">
            ${avatar(u.name, u.avatar_color, 'avatar-lg', u.avatar_img || '')}
            <div class="member-name">${u.name}</div>
            <div class="member-email">${u.email}</div>
            <span class="member-role ${rl.cls}">${rl.text}</span>
            ${tags ? `<div class="perm-tags">${tags}</div>` : ''}
            ${s.total > 0 ? `
              <div class="member-progress">
                <div class="member-task-counts">
                  <div class="member-task-count"><span class="member-task-count-val" style="color:#2563eb">${s.new_count}</span><span class="member-task-count-lbl">Новые</span></div>
                  <div class="member-task-count"><span class="member-task-count-val" style="color:#ca8a04">${s.in_progress}</span><span class="member-task-count-lbl">В работе</span></div>
                  <div class="member-task-count"><span class="member-task-count-val" style="color:#16a34a">${s.done}</span><span class="member-task-count-lbl">Готово</span></div>
                </div>
                <div class="member-progress-bar" style="margin-top:8px">
                  <div class="member-progress-fill" style="width:${pct}%;background:${effColor}"></div>
                </div>
                <div style="font-size:11px;color:${effColor};font-weight:600;margin-top:2px">${pct}% выполнено</div>
              </div>
            ` : '<div style="font-size:11.5px;color:#9ca3af">Нет задач</div>'}
            ${isAdmin && u.telegram_id ? `<div class="member-tg" style="display:flex;align-items:center;gap:4px">${svgI(SVG_PATHS.send,12,'stroke="#059669"')} Telegram подключён</div>` : isAdmin && !u.telegram_id ? '<div style="font-size:11.5px;color:#9ca3af">Telegram не подключён</div>' : ''}
            ${isAdmin && u.role !== 'admin' ? `
              <div class="member-actions" onclick="event.stopPropagation()">
                <button class="btn btn-outline btn-sm" onclick="openUserModal(${u.id})" style="display:inline-flex;align-items:center;gap:4px">${svgI(SVG_PATHS.edit,13)} Права</button>
                <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})" style="display:inline-flex;align-items:center;gap:4px">${svgI(SVG_PATHS.trash,13)}</button>
              </div>
            ` : ''}
          </div>
        `}).join('')}
      </div>
    `;
  } catch (err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`;
  }
}

async function openUserModal(userId = null) {
  let user = null;
  if (userId) {
    try { user = state.users.find(u => u.id === userId); } catch {}
  }
  const p = user?.permissions || {};

  const permFields = Object.entries(PERM_LABELS).map(([key, { icon, text }]) => `
    <label class="perm-checkbox-row">
      <input type="checkbox" id="perm-${key}" ${p[key] ? 'checked' : ''}>
      <span class="perm-checkbox-icon">${icon}</span>
      <span class="perm-checkbox-text">${text}</span>
    </label>
  `).join('');

  openModal(`
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${user ? 'Редактировать сотрудника' : '＋ Новый сотрудник'}</div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="field">
            <label>Имя *</label>
            <input id="uf-name" placeholder="Имя Фамилия" value="${user?.name || ''}">
          </div>
          <div class="field">
            <label>Email *</label>
            <input id="uf-email" type="email" placeholder="email@company.com" value="${user?.email || ''}">
          </div>
        </div>
        <div class="field">
          <label>${user ? 'Новый пароль (оставьте пустым, если не менять)' : 'Пароль *'}</label>
          <input id="uf-pass" type="password" placeholder="${user ? '••••••••' : 'Минимум 6 символов'}">
        </div>

        <div class="field">
          <label>Доступ к разделам</label>
          <div class="perm-checkboxes">
            <label class="perm-checkbox-row perm-checkbox-disabled">
              <input type="checkbox" checked disabled>
              <span class="perm-checkbox-icon">${svgI(SVG_PATHS.bars,13)}</span>
              <span class="perm-checkbox-text">Дашборд (всегда включён)</span>
            </label>
            ${permFields}
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn btn-blue" id="save-user-btn">${user ? 'Сохранить' : 'Добавить сотрудника'}</button>
      </div>
    </div>
  `);

  document.getElementById('save-user-btn').addEventListener('click', async () => {
    const name = document.getElementById('uf-name').value.trim();
    const email = document.getElementById('uf-email').value.trim();
    const pass = document.getElementById('uf-pass').value;
    if (!name || !email || (!user && !pass)) { toast('Заполните все обязательные поля', 'error'); return; }

    const permissions = {};
    Object.keys(PERM_LABELS).forEach(key => {
      permissions[key] = document.getElementById('perm-' + key)?.checked || false;
    });

    const btn = document.getElementById('save-user-btn');
    btn.disabled = true;
    try {
      const payload = { name, email, permissions, ...(pass ? { password: pass } : {}) };
      if (user) await PUT('/users/' + userId, payload);
      else await POST('/users', payload);
      await loadSharedData();
      closeModal();
      toast(user ? 'Права обновлены' : 'Сотрудник добавлен', 'success');
      renderTeamPage();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

async function deleteUser(userId) {
  if (!confirm('Удалить сотрудника?')) return;
  try {
    await DEL('/users/' + userId);
    await loadSharedData();
    toast('Сотрудник удалён', 'success');
    renderTeamPage();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Settings Page ────────────────────────────────────────────────────────────
async function renderSettingsPage() {
  try {
    const me = await GET('/auth/me');
    state.user = { ...state.user, ...me };

    document.getElementById('page-content').innerHTML = `
      <div class="settings-grid">

        <div class="settings-section">
          <h3 style="display:inline-flex;align-items:center;gap:7px">${svgI(SVG_PATHS.user,16)} Профиль</h3>
          <p>Ваши данные для входа в систему</p>
          <div class="card">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
              <div style="position:relative;cursor:pointer" onclick="document.getElementById('avatar-upload').click()" title="Загрузить фото">
                ${avatar(me.name, me.avatar_color, 'avatar-lg', me.avatar_img || '')}
                <div style="position:absolute;bottom:0;right:0;width:22px;height:22px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white">
                  ${svgI(SVG_PATHS.camera,11,'stroke="white"')}
                </div>
              </div>
              <input type="file" id="avatar-upload" accept="image/*" style="display:none">
              <div>
                <div style="font-size:16px;font-weight:700">${me.name}</div>
                <div style="font-size:13px;color:#6b7280">${me.email}</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:2px;display:flex;align-items:center;gap:4px">${me.role === 'admin' ? svgI(SVG_PATHS.crown,12)+' Администратор' : svgI(SVG_PATHS.user,12)+' Сотрудник'}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:3px">Нажмите на фото для замены (макс. 2 МБ)</div>
              </div>
            </div>
            <div class="form-row">
              <div class="field">
                <label>Имя</label>
                <input id="s-name" value="${me.name}">
              </div>
              <div class="field">
                <label>Email</label>
                <input id="s-email" value="${me.email}">
              </div>
            </div>
            <div class="field">
              <label>Новый пароль (оставьте пустым, если не менять)</label>
              <div style="position:relative">
                <input id="s-pass" type="password" placeholder="Новый пароль..." style="padding-right:40px">
                <button type="button" id="s-pass-eye" onclick="togglePassVis('s-pass','s-pass-eye')" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;padding:2px">
                  ${svgI(SVG_PATHS.eye,16)}
                </button>
              </div>
            </div>
            <button class="btn btn-blue" onclick="saveProfile()">Сохранить изменения</button>
          </div>
        </div>

        <div class="settings-section">
          <h3 style="display:inline-flex;align-items:center;gap:7px">${svgI(SVG_PATHS.send,16)} Telegram уведомления</h3>
          <p>Получайте мгновенные уведомления о задачах прямо в Telegram</p>
          <div class="tg-connect-box">
            <div class="tg-icon">${svgI(SVG_PATHS.send,22)}</div>
            <div style="flex:1">
              ${me.telegram_id ? `
                <h4>Telegram подключён</h4>
                <div class="tg-connected" style="display:flex;align-items:center;gap:5px">${svgI(SVG_PATHS.check,14,'stroke="#059669"')} Аккаунт привязан к Telegram</div>
                <button class="btn btn-danger btn-sm" style="margin-top:10px" onclick="disconnectTelegram()">Отключить</button>
              ` : `
                <h4>Подключить Telegram</h4>
                <p>Нажмите кнопку, получите код и отправьте его боту</p>
                <button class="btn btn-blue btn-sm" style="margin-top:10px" onclick="connectTelegram()">Получить код подключения</button>
                <div id="tg-code-block" style="margin-top:12px;display:none">
                  <div style="font-size:12.5px;color:#6b7280;margin-bottom:6px">Отправьте этот код боту:</div>
                  <div class="tg-code" id="tg-code"></div>
                  <div style="font-size:12.5px;color:#6b7280;margin-top:8px">Найдите бота и напишите ему: <strong>/start КОД</strong></div>
                  <a id="tg-link" href="#" target="_blank" class="btn btn-blue btn-sm" style="margin-top:8px;display:inline-flex">Открыть бота →</a>
                </div>
              `}
            </div>
          </div>
        </div>

        <div class="settings-section settings-section--full" style="padding-top:8px;border-top:1px solid #e5e7eb">
          <button class="btn btn-danger" onclick="logout()" style="display:inline-flex;align-items:center;gap:6px">${svgI('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',15)} Выйти из системы</button>
        </div>

      </div>
    `;

    document.getElementById('avatar-upload')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast('Файл превышает 2 МБ', 'error'); e.target.value=''; return; }
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          await POST('/profile/avatar', { avatar_img: ev.target.result });
          state.user.avatar_img = ev.target.result;
          toast('Аватар обновлён', 'success');
          renderSettingsPage();
          updateSidebarAvatar(state.user);
        } catch (err) { toast(err.message, 'error'); }
      };
      reader.readAsDataURL(file);
    });
  } catch (err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`;
  }
}

function togglePassVis(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp || !btn) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = svgI(show ? SVG_PATHS.eye_off : SVG_PATHS.eye, 16);
}

async function saveProfile() {
  const name = document.getElementById('s-name')?.value.trim();
  const email = document.getElementById('s-email')?.value.trim();
  const pass = document.getElementById('s-pass')?.value;
  if (!name || !email) { toast('Имя и email обязательны', 'error'); return; }
  try {
    await PUT('/users/' + state.user.id, { name, email, ...(pass ? { password: pass } : {}) });
    state.user.name = name;
    localStorage.setItem('tt_user', JSON.stringify(state.user));
    document.getElementById('sidebar-name').textContent = name;
    updateSidebarAvatar(state.user);
    toast('Профиль сохранён', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function connectTelegram() {
  try {
    const { token, link } = await POST('/telegram/token');
    document.getElementById('tg-code-block').style.display = 'block';
    document.getElementById('tg-code').textContent = token;
    const linkEl = document.getElementById('tg-link');
    if (link && !link.includes('ваш_бот')) {
      linkEl.href = link;
    } else {
      linkEl.style.display = 'none';
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function disconnectTelegram() {
  if (!confirm('Отключить Telegram уведомления?')) return;
  try {
    await POST('/telegram/disconnect');
    toast('Telegram отключён', 'success');
    renderSettingsPage();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
if (state.token && state.user) {
  initApp();
} else {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').classList.add('hidden');
}
