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
  if (res.status === 401) {
    // Token expired or invalid — auto logout and show login
    localStorage.removeItem('tt_token');
    localStorage.removeItem('tt_user');
    location.reload();
    return;
  }
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

const TZ = 'Asia/Dushanbe';

const _DSH_OFFSET = 5 * 3600000; // UTC+5 in ms

function _parseLocalDt(dt) {
  if (!dt) return null;
  const s = (dt + '').trim();
  try {
    // Already has timezone info — parse as-is
    if (s.endsWith('Z') || /[+\-]\d{2}:\d{2}$/.test(s)) return new Date(s);

    // Date-only "YYYY-MM-DD" → midnight Dushanbe = UTC - 5h
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y,mo,d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, mo-1, d, 0, 0, 0) - _DSH_OFFSET);
    }

    // Datetime "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD HH:MM[:SS]" → Dushanbe local time
    const clean = s.replace(' ', 'T');
    const parts = clean.split('T');
    const [y,mo,d] = parts[0].split('-').map(Number);
    const timeParts = (parts[1] || '00:00:00').split(':').map(Number);
    const [h=0, m=0, sec=0] = timeParts;
    return new Date(Date.UTC(y, mo-1, d, h, m, sec) - _DSH_OFFSET);
  } catch { return new Date(NaN); }
}

function fmtDate(dt) {
  if (!dt) return '—';
  const d = _parseLocalDt(dt);
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dt);
  const opts = isDateOnly
    ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }
    : { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ };
  return d.toLocaleString('ru-RU', opts).replace(',', '');
}

function taskPlural(n) {
  if (n % 10 === 1 && n % 100 !== 11) return n + ' задача';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return n + ' задачи';
  return n + ' задач';
}

function fmtDateShort(dt) {
  if (!dt) return '—';
  const d = _parseLocalDt(dt);
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dt);
  const now = new Date();
  const opts = isDateOnly
    ? { day: '2-digit', month: 'short', timeZone: TZ }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleString('ru-RU', opts);
}

// Parse deadline stored as Dushanbe local time (UTC+5)
function parseDeadline(dt) {
  if (!dt) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dt.trim())) {
    // Date-only → end of that day in Dushanbe (23:59:59 UTC+5)
    const [y,mo,d] = dt.trim().split('-').map(Number);
    return new Date(Date.UTC(y, mo-1, d, 23, 59, 59) - _DSH_OFFSET);
  }
  return _parseLocalDt(dt);
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
    new:            [colorDot('#3B82F6'), 'Новая',        'status-new'],
    in_progress:    [colorDot('#D97706'), 'В работе',     'status-in_progress'],
    done:           [colorDot('#059669'), 'Готово',       'status-done'],
    pending_review: [colorDot('#8B5CF6'), 'На проверке',  'status-pending_review'],
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

function countdownFmt(dt, status) {
  if (!dt || status === 'done') return '';
  const diff = parseDeadline(dt) - Date.now();
  const abs   = Math.abs(diff);
  const days  = Math.floor(abs / 864e5);
  const hours = Math.floor((abs % 864e5) / 36e5);
  const mins  = Math.floor((abs % 36e5) / 6e4);
  if (diff < 0) {
    const txt = days > 0 ? `${days}д ${hours}ч` : hours > 0 ? `${hours}ч ${mins}м` : `${mins}м`;
    return `<span class="countdown countdown-overdue">Просрочено: ${txt}</span>`;
  }
  if (diff > 7 * 864e5) return ''; // дальше недели — не показываем
  const txt = days > 0 ? `${days}д ${hours}ч` : hours > 0 ? `${hours}ч ${mins}м` : `${mins}м`;
  const cls  = diff < 864e5 ? 'countdown-urgent' : 'countdown-soon';
  return `<span class="countdown ${cls}">До дедлайна: ${txt}</span>`;
}

function recurrenceBadge(r) {
  if (!r || r === 'none') return '';
  const labels = { daily: 'Ежедневно', every2days: 'Каждые 2 дня', weekly: 'Еженедельно', monthly: 'Ежемесячно' };
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
    const today = new Date().toDateString();
    const lastSeen = localStorage.getItem('tt_welcomed_' + user.id);
    await initApp();
    if (lastSeen !== today) {
      localStorage.setItem('tt_welcomed_' + user.id, today);
      showWelcomeModal();
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Войти';
    btn.disabled = false;
  }
});

function logout() {
  POST('/auth/logout').catch(() => {});
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
function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  const moon = document.getElementById('theme-icon-moon');
  const sun  = document.getElementById('theme-icon-sun');
  if (moon) moon.style.display = dark ? 'none'  : '';
  if (sun)  sun.style.display  = dark ? '' : 'none';
}

function toggleTheme() {
  const isDark = !document.body.classList.contains('dark');
  localStorage.setItem('tt_dark', isDark ? '1' : '0');
  applyTheme(isDark);
}

async function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').classList.remove('hidden');
  applyTheme(localStorage.getItem('tt_dark') === '1');

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
    // Support multiple permissions separated by space: "perm1 perm2" → visible if any
    const perms = el.dataset.perm.split(' ').map(p => p.trim()).filter(Boolean);
    el.classList.toggle('hidden', !perms.some(p => can(p)));
  });
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !showAdmin);
  });
  if (showAdmin || can('view_activity')) {
    const navActivity = document.getElementById('nav-activity');
    if (navActivity) navActivity.style.display = '';
  }
  if (showAdmin) {
    const navReview = document.getElementById('nav-review');
    if (navReview) navReview.style.display = '';
    updateReviewBadge();
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

  // Browser Back/Forward button support
  window.addEventListener('popstate', e => {
    const s = e.state;
    if (!s) { navigateTo('dashboard', null, false); return; }
    if (s.employeeId && s.page === 'employee') {
      state.currentEmployeeId = s.employeeId;
    }
    navigateTo(s.page, s.projectId || null, false);
  });

  // Push initial state so first Back doesn't exit the app
  try {
    const initState = { page: state.currentPage || 'dashboard', projectId: null };
    history.replaceState(initState, '', window.location.pathname);
  } catch {}

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const inInput = e.target.matches('input,textarea,select,[contenteditable]');

    if (e.key === 'Escape') {
      const detail = document.getElementById('fb-detail-overlay');
      if (detail) { detail.remove(); return; }
      const search = document.getElementById('global-search-overlay');
      if (search) { search.remove(); return; }
      closeWelcomeModal();
      closeModal();
      return;
    }

    // Cmd+K / Ctrl+K — global search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openGlobalSearch();
      return;
    }

    // Enter — submit topmost modal (not in textarea or select)
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (e.target.matches('textarea')) return; // allow Enter in textarea
      if (e.target.matches('select')) return;   // allow Enter in select

      // Global search — already handled by its own keydown
      if (document.getElementById('global-search-overlay')) return;

      // Feedback detail overlay
      const detail = document.getElementById('fb-detail-overlay');
      if (detail) {
        detail.querySelector('.btn-blue')?.click();
        return;
      }

      // Regular modal
      const modalRoot = document.getElementById('modal-root');
      if (modalRoot && modalRoot.children.length > 0) {
        // Don't auto-submit from input inside comment fields
        if (e.target.id === 'comment-input') return;
        const primaryBtn = modalRoot.querySelector('.btn-blue:not([disabled])');
        if (primaryBtn) { e.preventDefault(); primaryBtn.click(); }
        return;
      }
    }

    if (!inInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTaskModal(); }
    }
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

async function openArchivedProjects() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:520px">
      <div class="modal-header"><div class="modal-title">Архив проектов</div>
        <button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="modal-body" id="archive-modal-body">
        <div style="text-align:center;color:#9ca3af;padding:20px">Загрузка...</div>
      </div>
    </div></div>`;
  try {
    const archived = await GET('/projects?archived=1');
    const body = document.getElementById('archive-modal-body');
    if (!archived.length) {
      body.innerHTML = '<div class="empty-state" style="padding:30px 0"><h3>Архив пуст</h3><p>Архивированные проекты появятся здесь</p></div>';
      return;
    }
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding-bottom:8px">
      ${archived.map(p => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid var(--border);border-radius:10px;background:var(--bg)">
          <span style="width:12px;height:12px;border-radius:50%;background:${p.color};flex-shrink:0"></span>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600;color:var(--text)">${p.name}</div>
            <div style="font-size:12px;color:var(--text-muted)">${p.task_count||0} задач · ${p.done_count||0} выполнено</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="unarchiveProject(${p.id})">Восстановить</button>
        </div>`).join('')}
    </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

async function unarchiveProject(id) {
  try {
    await PUT(`/projects/${id}/archive`, { archived: false });
    await loadSharedData();
    toast('Проект восстановлен', 'success');
    openArchivedProjects();
  } catch (err) { toast(err.message, 'error'); }
}

async function archiveProject(id) {
  if (!confirm('Архивировать проект? Задачи сохранятся, проект скроется из списка.')) return;
  try {
    await PUT(`/projects/${id}/archive`, { archived: true });
    await loadSharedData();
    toast('Проект архивирован', 'success');
    navigateTo('dashboard');
  } catch (err) { toast(err.message, 'error'); }
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
  'team-tasks': 'Задачи сотрудников',
  'finance-log': 'Активность финансов',
  'ideahast': 'Ideahast',
  'kids': 'Финансы Kids',
  'b2c': 'Финансы В2С',
  finance: 'Финансы',
  dashboard: 'Дашборд',
  tasks: 'Все задачи',
  mytasks: 'Мои задачи',
  team: 'Команда',
  reports: 'Отчёты',
  'best-employee': 'Лучший сотрудник',
  schedule: 'Расписание',
  settings: 'Настройки',
  employee: 'Профиль сотрудника',
  activity: 'Активность',
  review: 'Задачи для проверки',
};

function navigateTo(page, projectId = null, pushHistory = true) {
  state.currentPage = page;
  state.currentProjectId = projectId;
  try {
    const key = page === 'project' ? `project:${projectId}`
              : page === 'employee' ? `employee:${state.currentEmployeeId}`
              : page;
    sessionStorage.setItem('mb_page', key);
  } catch {}

  // Push browser history state so Back button works within the app
  if (pushHistory) {
    const stateObj = { page, projectId: projectId || null, employeeId: state.currentEmployeeId || null };
    const url = '/' + (page === 'dashboard' ? '' : page + (projectId ? '/' + projectId : ''));
    try { history.pushState(stateObj, '', url); } catch {}
  }


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
      tasksFilter = { status: '', priority: '', search: '', assignee_id: '', overdue: false };
      renderTasksPage();
      break;
    case 'project': renderProjectPage(projectId); break;
    case 'team-tasks': renderTeamTasksPage(); break;
    case 'team': renderTeamPage(); break;
    case 'reports': renderReportsPage(); break;
    case 'settings': renderSettingsPage(); break;
    case 'employee': renderEmployeeProfile(state.currentEmployeeId); break;
    case 'activity': renderActivityPage(); break;
    case 'review': renderReviewPage(); break;
    case 'finance-log': renderFinanceLogPage(); break;
    case 'ideahast': renderIdeahastPage(); break;
    case 'kids': renderSectionPage('kids'); break;
    case 'b2c': renderB2CPage(); break;
    case 'finance': renderFinancePage(); break;
    case 'best-employee': renderBestEmployeePage(); break;
    case 'schedule': renderSchedulePage(); break;
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
    case 'review_badge_update':
      updateReviewBadge();
      if (state.currentPage === 'review') renderReviewPage();
      break;
    case 'pending_review':
      checkNotifCount();
      toast(event.message || 'Задача ожидает вашего принятия', 'info');
      updateReviewBadge();
      if (state.currentPage === 'review') renderReviewPage();
      break;
    case 'task_approved':
    case 'task_rejected':
      checkNotifCount();
      toast(event.message || (event.type === 'task_approved' ? 'Задача принята' : 'Задача возвращена на доработку'), event.type === 'task_approved' ? 'success' : 'info');
      if (state.currentPage === 'dashboard') renderDashboard();
      if (state.currentPage === 'tasks' || state.currentPage === 'mytasks') renderTasksPage();
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
            <div class="notif-item ${n.read ? '' : 'unread'} ${n.task_id ? 'notif-item-clickable' : ''}"
              ${n.task_id ? `onclick="document.getElementById('notif-panel').classList.add('hidden'); openTaskDetail(${n.task_id})"` : ''}>
              <div class="notif-item-msg">${n.message}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                <div class="notif-item-time">${fmtDate(n.created_at)}</div>
                ${n.task_id ? `<span class="notif-item-link">Открыть задачу →</span>` : ''}
              </div>
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
  const uid = state.user.id;
  // Personal done: overall done OR user marked their part done in multi-assignee
  const myDone = t => {
    if (t.status === 'done') return true;
    const ma = t.multi_assignees;
    if (ma && ma.length > 0) return ma.find(a => a.id === uid)?.done === 1;
    return false;
  };
  const total = tasks.length;
  const done  = tasks.filter(t => myDone(t)).length;
  const inp   = tasks.filter(t => !myDone(t) && t.status === 'in_progress').length;
  const nw    = tasks.filter(t => !myDone(t) && t.status === 'new').length;
  const ov    = tasks.filter(t => !myDone(t) && t.deadline && parseDeadline(t.deadline) < new Date()).length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;
  const effColor = pct >= 80 ? '#059669' : pct >= 50 ? '#D97706' : pct > 0 ? '#DC2626' : '#94A3B8';

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
    <div class="dash-stat-cards-header">
      <div class="dsc-username">${state.user.name}</div>
      <div class="dsc-eff-wrap">
        <span class="dsc-eff-pct" style="color:${effColor}"><span data-count="${pct}" data-suffix="%">0%</span></span>
        <span class="dsc-eff-lbl">эффективность</span>
      </div>
    </div>
    <div class="dsc-eff-bar-bg" style="margin-bottom:12px">
      <div class="dsc-eff-bar-fill" style="width:${pct}%;background:${effColor}"></div>
    </div>

    <div class="dash-stat-cards">
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({status:'new'})" title="Новые задачи">
        <div class="dsc-label">Всего задач</div>
        <div class="dsc-value"><span data-count="${total}">0</span></div>
        <div class="dsc-sub"><span data-count="${nw}">0</span> новых</div>
      </div>
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({status:'done'})" title="Завершённые задачи">
        <div class="dsc-label">Завершено</div>
        <div class="dsc-value dsc-value--green"><span data-count="${done}">0</span></div>
        <div class="dsc-sub">из ${total} задач</div>
      </div>
      <div class="dash-stat-card dash-stat-card--click" onclick="navigateToTasksWithFilter({status:'in_progress'})" title="Задачи в работе">
        <div class="dsc-label">В работе</div>
        <div class="dsc-value" style="color:#D97706"><span data-count="${inp}">0</span></div>
        <div class="dsc-sub">${inp > 0 ? 'активных' : 'нет активных'}</div>
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
                  <div class="mpc-sgrid-num">${s.total}</div>
                  <div class="mpc-sgrid-lbl">всего</div>
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
  const svgAttrs = `width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="max-width:100%;height:auto;display:block"`;
  if (total === 0) {
    return `<svg ${svgAttrs}><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#E2E8F0" stroke-width="${sw}"/><text x="${cx}" y="${cy+5}" text-anchor="middle" fill="#94A3B8" font-size="11" font-family="system-ui">—</text></svg>`;
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
  return `<svg ${svgAttrs}>${arcs.join('')}<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="20" font-weight="800" font-family="system-ui" class="donut-pct-text"><tspan class="donut-count" data-count="${donePct}">0%</tspan></text><text x="${cx}" y="${cy + 13}" text-anchor="middle" fill="#94A3B8" font-size="10" font-family="system-ui">выполнено</text></svg>`;
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

// ─── Employee Dashboard ───────────────────────────────────────────────────────
async function renderEmployeeDashboard() {
  const content = document.getElementById('page-content');
  try {
    const tasks = await GET('/tasks');
    const uid = state.user.id;
    const myTasks = tasks.filter(t =>
      t.assignee_id === uid || (t.multi_assignees || []).some(a => a.id === uid)
    );

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const todayEnd   = new Date(now); todayEnd.setHours(23,59,59,999);
    const weekStart  = new Date(now); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay()+6)%7)); weekStart.setHours(0,0,0,0);

    const overdueMe  = myTasks.filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) < todayStart);
    const todayMe    = myTasks.filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) >= todayStart && parseDeadline(t.deadline) <= todayEnd);
    const inProgress = myTasks.filter(t => t.status === 'in_progress');
    const doneWeek   = myTasks.filter(t => t.status === 'done' && new Date(t.updated_at) >= weekStart);
    const totalActive = myTasks.filter(t => t.status !== 'done').length;
    const weekPct = (doneWeek.length + totalActive) > 0 ? Math.round(doneWeek.length / (doneWeek.length + totalActive) * 100) : 0;

    const newMe = myTasks.filter(t => t.status === 'new');

    content.innerHTML = `
      <div class="emp-dash">
        <!-- Stats row -->
        <div class="emp-stats-row">
          <div class="emp-stat-card">
            <div class="emp-stat-num ${overdueMe.length ? 'emp-stat-danger' : ''}">${overdueMe.length}</div>
            <div class="emp-stat-lbl">Просрочено</div>
          </div>
          <div class="emp-stat-card">
            <div class="emp-stat-num emp-stat-today">${todayMe.length}</div>
            <div class="emp-stat-lbl">На сегодня</div>
          </div>
          <div class="emp-stat-card">
            <div class="emp-stat-num">${inProgress.length}</div>
            <div class="emp-stat-lbl">В работе</div>
          </div>
          <div class="emp-stat-card">
            <div class="emp-stat-num emp-stat-done">${doneWeek.length}</div>
            <div class="emp-stat-lbl">Выполнено за неделю</div>
          </div>
        </div>

        <!-- Weekly progress -->
        <div class="emp-progress-card">
          <div class="emp-progress-header">
            <span class="emp-progress-title">Прогресс недели</span>
            <span class="emp-progress-pct">${weekPct}%</span>
          </div>
          <div class="emp-progress-bar-bg">
            <div class="emp-progress-bar-fill" style="width:${weekPct}%"></div>
          </div>
          <div class="emp-progress-sub">${doneWeek.length} выполнено · ${totalActive} активных · всего ${myTasks.length}</div>
        </div>

        <!-- Today's tasks -->
        ${overdueMe.length + todayMe.length > 0 ? `
        <div class="section-header" style="margin-top:24px">
          <div class="section-title" style="display:flex;align-items:center;gap:6px">
            ${svgI(SVG_PATHS.warning,15)} Требуют внимания
          </div>
        </div>
        ${overdueMe.length ? `<div style="font-size:12px;font-weight:700;color:#dc2626;margin:8px 0 4px;padding:0 24px">Просрочены</div>
          <div class="tasks-list" style="padding:0 24px">${overdueMe.map(t=>taskCard(t,'overdue')).join('')}</div>` : ''}
        ${todayMe.length ? `<div style="font-size:12px;font-weight:700;color:#d97706;margin:8px 0 4px;padding:0 24px">На сегодня</div>
          <div class="tasks-list" style="padding:0 24px">${todayMe.map(t=>taskCard(t,'today')).join('')}</div>` : ''}
        ` : ''}

        <!-- In progress -->
        ${inProgress.length ? `
        <div class="section-header" style="margin-top:16px">
          <div class="section-title" style="display:flex;align-items:center;gap:6px">${svgI(SVG_PATHS.repeat,15)} В работе</div>
        </div>
        <div class="tasks-list" style="padding:0 24px">${inProgress.map(t=>taskCard(t)).join('')}</div>
        ` : ''}

        <!-- New tasks -->
        ${newMe.length ? `
        <div class="section-header" style="margin-top:16px">
          <div class="section-title" style="display:flex;align-items:center;gap:6px">${svgI(SVG_PATHS.clip,15)} Новые задачи</div>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('mytasks')">Все мои задачи →</button>
        </div>
        <div class="tasks-list" style="padding:0 24px">${newMe.slice(0,5).map(t=>taskCard(t)).join('')}</div>
        ${newMe.length > 5 ? `<div style="padding:8px 24px"><button class="btn btn-outline btn-sm" onclick="navigateTo('mytasks')">Ещё ${newMe.length-5} задач →</button></div>` : ''}
        ` : ''}

        ${myTasks.length === 0 ? `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.check,44)}</div><h3>Задач нет</h3><p>Руководитель ещё не назначил вам задачи</p></div>` : ''}
      </div>`;

    attachTaskCardListeners();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${err.message}</p></div>`;
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  // Employees without special permissions get a personalized view
  if (state.user?.role !== 'admin' && !can('reports') && !can('manage_projects') && !can('assign_tasks')) {
    return renderEmployeeDashboard();
  }
  dashTasksLimit = 10;
  try {
    const tasks = await GET('/tasks');
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);
    const active = tasks.filter(t => t.status !== 'done' && t.deadline);
    const overdueT  = active.filter(t => parseDeadline(t.deadline) < todayStart);
    const todayT    = active.filter(t => { const d = parseDeadline(t.deadline); return d >= todayStart && d <= todayEnd; });
    const tomorrowT = active.filter(t => { const d = parseDeadline(t.deadline); return d > todayEnd && d <= tomorrowEnd; });
    const totalUrgent = overdueT.length + todayT.length + tomorrowT.length;

    const urgentIds = new Set([...overdueT, ...todayT, ...tomorrowT].map(t => t.id));
    const pStart = periodStart(dashPeriod);
    dashRecentTasks = tasks.filter(t => t.status !== 'done' && new Date(t.created_at) >= pStart && !urgentIds.has(t.id));

    const periodNames = [['week','Неделя'],['month','Месяц'],['3month','3 мес.'],['6month','6 мес.'],['year','1 год']];
    const periodLabels = { week: 'за неделю', month: 'за месяц', '3month': 'за 3 месяца', '6month': 'за 6 месяцев', year: 'за год' };

    document.getElementById('page-content').innerHTML = `
      ${renderDashboardCharts(tasks)}

      ${totalUrgent > 0 ? `
        <div class="urgent-section">
          <div class="urgent-section-hdr">
            <span class="urgent-section-title">${svgI(SVG_PATHS.warning,16)} Требуют внимания</span>
            <span class="urgent-total-badge">${totalUrgent}</span>
            ${overdueT.length  ? `<span class="urgent-pill urgent-pill-overdue">${overdueT.length} просрочено</span>`  : ''}
            ${todayT.length    ? `<span class="urgent-pill urgent-pill-today">${todayT.length} сегодня</span>`         : ''}
            ${tomorrowT.length ? `<span class="urgent-pill urgent-pill-tomorrow">${tomorrowT.length} завтра</span>`    : ''}
          </div>
          ${overdueT.length ? `
            <div class="urgent-group-hdr urgent-overdue-hdr">${svgI(SVG_PATHS.warning,13)} Просрочены · ${overdueT.length}</div>
            <div class="tasks-list urgent-tasks-list">${overdueT.map(t => taskCard(t,'overdue')).join('')}</div>
          ` : ''}
          ${todayT.length ? `
            <div class="urgent-group-hdr urgent-today-hdr">${svgI(SVG_PATHS.clock,13)} Срок сегодня · ${todayT.length}</div>
            <div class="tasks-list urgent-tasks-list">${todayT.map(t => taskCard(t,'today')).join('')}</div>
          ` : ''}
          ${tomorrowT.length ? `
            <div class="urgent-group-hdr urgent-tomorrow-hdr">${svgI(SVG_PATHS.cal,13)} Срок завтра · ${tomorrowT.length}</div>
            <div class="tasks-list urgent-tasks-list">${tomorrowT.map(t => taskCard(t,'tomorrow')).join('')}</div>
          ` : ''}
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
let activityDays = 30;
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
  if (myTasksMode) tasksFilter.assignee_id = ''; // server already filters by user (assignee OR creator)
  renderTasksPage();
}

async function loadAndRenderTasks() {
  try {
    if (myTasksMode) {
      // my_tasks=1 ensures only current user's own tasks (even for manage_team users)
      const allUserTasks = await GET('/tasks?my_tasks=1');
      const summaryEl = document.getElementById('mytasks-summary');
      if (summaryEl) {
        summaryEl.innerHTML = renderMyTasksSummary(allUserTasks);
        triggerDashAnimations();
      }
    }

    let url = '/tasks';
    const params = [];
    if (tasksFilter.status) params.push('status=' + tasksFilter.status);
    if (myTasksMode) {
      params.push('my_tasks=1'); // always show only current user's own tasks
    } else if (tasksFilter.assignee_id) {
      params.push('assignee_id=' + tasksFilter.assignee_id);
    }
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
  const isAdmin = state.user.role === 'admin' || can('manage_projects');
  const canEdit = isAdmin;
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
          ${isAdmin ? `
            <button class="btn btn-outline btn-sm" onclick="openProjectModal(${projectId})" style="display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.edit,13)} Изменить</button>
            <button class="btn btn-outline btn-sm" onclick="archiveProject(${projectId})" style="display:inline-flex;align-items:center;gap:5px;color:#9ca3af">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg> Архивировать
            </button>` : ''}
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
  const isAdmin  = state.user.role === 'admin' || can('manage_projects');
  const canEdit  = isAdmin;
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
            <button class="btn btn-outline btn-sm" style="display:inline-flex;align-items:center;gap:5px" onclick="cpDownloadTemplate(${projectId})" title="Скачать шаблон Excel для заполнения">
              ${svgI('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',14)} Шаблон
            </button>
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
  const todayStr = new Date(Date.now()+5*3600000).toISOString().slice(0,10);

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
        const safeDesc = (item.description || '').replace(/"/g, '&quot;');
        const hasDesc = !!(item.description || '').trim();
        const dragAttrs = canEdit
          ? `draggable="true" data-item-id="${item.id}" data-type="${item.type}" data-title="${safeTitle}" data-qty="${item.quantity || 1}" data-description="${safeDesc}" onclick="cpOpenEdit(event,this,${projectId})"`
          : `data-item-id="${item.id}" data-type="${item.type}" data-title="${safeTitle}" data-description="${safeDesc}" onclick="cpViewItem(event,this)"`;
        return `<div class="cp-chip" ${dragAttrs} style="background:${t.bg};border-left:3px solid ${t.color};cursor:pointer">
          <span class="cp-chip-type" style="color:${t.color}">${t.label}${qty}</span>
          ${item.title ? `<span class="cp-chip-title">${_escHtml(item.title)}</span>` : ''}
          ${hasDesc ? `<span class="cp-chip-has-desc" title="${safeDesc.slice(0,80).replace(/"/g,'&quot;')}${safeDesc.length>80?'…':''}"></span>` : ''}
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

function cpOpenAdd(btn, dateStr, projectId) {
  const [y, m, d] = dateStr.split('-');
  const dateLabel = `${d}.${m}.${y}`;
  openModal(`
    <div class="modal cp-pub-modal">
      <div class="modal-header">
        <div>
          <div class="modal-title">Новая публикация</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px">${dateLabel}</div>
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="cp-pub-type-row">
          ${Object.entries(CP_TYPES).map(([k,v]) => `
            <label class="cp-pub-type-btn" data-val="${k}">
              <input type="radio" name="cp-add-type-r" value="${k}" ${k==='post'?'checked':''} style="display:none">
              <span class="cp-pub-type-dot" style="background:${v.color}"></span>${v.label}
            </label>`).join('')}
        </div>
        <div class="field" style="margin-top:14px">
          <label class="field-label">Заголовок <span style="color:#9ca3af;font-weight:400">(необязательно)</span></label>
          <input id="cp-add-title" class="form-control" placeholder="Например: Пост про новый продукт">
        </div>
        <div class="field">
          <label class="field-label">Текст / описание публикации</label>
          <textarea id="cp-add-desc" class="form-control cp-pub-desc-area" placeholder="Напишите текст публикации, тезисы или любые детали..."></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn btn-primary" onclick="cpSubmitAdd('${dateStr}',${projectId})">Добавить публикацию</button>
      </div>
    </div>
  `);
  // highlight selected type
  document.querySelectorAll('.cp-pub-type-btn').forEach(lbl => {
    lbl.classList.toggle('active', lbl.dataset.val === 'post');
    lbl.querySelector('input').addEventListener('change', () => {
      document.querySelectorAll('.cp-pub-type-btn').forEach(l => l.classList.toggle('active', l.dataset.val === lbl.dataset.val));
    });
  });
}

function cpCloseAdd() { closeModal(); }

async function cpSubmitAdd(dateStr, projectId) {
  const typeInput = document.querySelector('input[name="cp-add-type-r"]:checked');
  const type  = typeInput?.value || 'post';
  const title = (document.getElementById('cp-add-title')?.value || '').trim();
  const description = (document.getElementById('cp-add-desc')?.value || '').trim();
  closeModal();
  try {
    await api('POST', `/projects/${projectId}/content/item`, { date: dateStr, type, title, quantity: 1, description });
    renderProjectContentTab(projectId);
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

function cpOpenEdit(e, chip, projectId) {
  if (_cpJustDragged) return;
  e.stopPropagation();

  const itemId = chip.dataset.itemId;
  const type   = chip.dataset.type || 'post';
  const title  = chip.dataset.title || '';
  const qty    = parseInt(chip.dataset.qty) || 1;
  const desc   = chip.dataset.description || '';
  const t      = CP_TYPES[type] || CP_TYPES.post;

  openModal(`
    <div class="modal cp-pub-modal">
      <div class="modal-header">
        <div>
          <div class="modal-title">Редактировать публикацию</div>
          <div style="font-size:12px;color:${t.color};margin-top:2px;font-weight:600">${t.label}</div>
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="cp-pub-type-row">
          ${Object.entries(CP_TYPES).map(([k,v]) => `
            <label class="cp-pub-type-btn${k===type?' active':''}" data-val="${k}">
              <input type="radio" name="cp-edit-type-r" value="${k}" ${k===type?'checked':''} style="display:none">
              <span class="cp-pub-type-dot" style="background:${v.color}"></span>${v.label}
            </label>`).join('')}
        </div>
        <div id="cp-edit-qty-row" class="field" style="margin-top:14px;${type==='story'?'':'display:none'}">
          <label class="field-label">Количество сторис</label>
          <input id="cp-edit-qty" type="number" min="1" max="50" class="form-control" value="${qty}" style="max-width:120px">
        </div>
        <div class="field" style="margin-top:14px">
          <label class="field-label">Заголовок <span style="color:#9ca3af;font-weight:400">(необязательно)</span></label>
          <input id="cp-edit-title" class="form-control" placeholder="Заголовок публикации" value="${title.replace(/"/g,'&quot;')}">
        </div>
        <div class="field">
          <label class="field-label">Текст / описание публикации</label>
          <textarea id="cp-edit-desc" class="form-control cp-pub-desc-area" placeholder="Напишите текст публикации, тезисы или любые детали...">${desc.replace(/</g,'&lt;')}</textarea>
        </div>
      </div>
      <div class="modal-footer" style="justify-content:space-between">
        <button class="btn btn-outline" style="color:#EF4444;border-color:#EF4444" onclick="cpDeleteItem('${itemId}',${projectId})">Удалить</button>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
          <button class="btn btn-primary" onclick="cpSubmitEdit('${itemId}',${projectId})">Сохранить</button>
        </div>
      </div>
    </div>
  `);

  document.querySelectorAll('.cp-pub-type-btn').forEach(lbl => {
    lbl.querySelector('input').addEventListener('change', () => {
      document.querySelectorAll('.cp-pub-type-btn').forEach(l => l.classList.toggle('active', l.dataset.val === lbl.dataset.val));
      const isStory = lbl.dataset.val === 'story';
      document.getElementById('cp-edit-qty-row').style.display = isStory ? '' : 'none';
    });
  });
}

function cpCloseEdit() { closeModal(); }

async function cpSubmitEdit(itemId, projectId) {
  const typeInput = document.querySelector('input[name="cp-edit-type-r"]:checked');
  const type  = typeInput?.value || 'post';
  const title = (document.getElementById('cp-edit-title')?.value || '').trim();
  const qty   = parseInt(document.getElementById('cp-edit-qty')?.value) || 1;
  const description = (document.getElementById('cp-edit-desc')?.value || '').trim();
  closeModal();
  try {
    await api('PUT', `/content/${itemId}`, { type, title, quantity: type === 'story' ? qty : 1, description });
    renderProjectContentTab(projectId);
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function cpDeleteItem(itemId, projectId) {
  closeModal();
  try {
    await api('DELETE', `/content/${itemId}`);
    renderProjectContentTab(projectId);
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

function cpViewItem(e, chip) {
  e.stopPropagation();
  const type  = chip.dataset.type || 'post';
  const title = chip.dataset.title || '';
  const desc  = chip.dataset.description || '';
  const t     = CP_TYPES[type] || CP_TYPES.post;

  openModal(`
    <div class="modal cp-pub-modal">
      <div class="modal-header">
        <div>
          <span class="cp-pub-type-badge" style="background:${t.bg};color:${t.color};border:1.5px solid ${t.color}">${t.label}</span>
          ${title ? `<div class="modal-title" style="margin-top:6px">${title.replace(/</g,'&lt;')}</div>` : ''}
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        ${desc
          ? `<div class="cp-pub-desc-view">${desc.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>`
          : `<div style="color:#9ca3af;font-size:14px;padding:12px 0">Описание не добавлено</div>`}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Закрыть</button>
      </div>
    </div>
  `);
}

// ─── Project Member Management ────────────────────────────────────────────────

let _cpMemberPopup = null;

function cpOpenMemberAdd(projectId, btn) {
  if (_cpMemberPopup) { _cpMemberPopup.remove(); _cpMemberPopup = null; }
  closeModal();

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

function buildCpItem(date, { type, title, quantity, description }) {
  return { date, type, title: title || '', description: description || '', quantity: quantity || 1 };
}

function parseCpRows(rows) {
  if (!rows || rows.length === 0) return [];

  // ── 1. Find header row (look for keywords «дата» + «тип») ──
  let startRow = 0;
  let dateCol = -1, typeCol = -1, titleCol = -1, descCol = -1, qtyCol = -1;
  let headerFound = false;

  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').toLowerCase().trim());
    const dIdx = r.findIndex(h => h.includes('дат') || h === 'date');
    const tIdx = r.findIndex(h => h.includes('тип') || h === 'type');
    if (dIdx >= 0 && tIdx >= 0) {
      dateCol  = dIdx;
      typeCol  = tIdx;
      descCol  = r.findIndex(h => /^описани|описание публик|description|текст публик/.test(h));
      titleCol = r.findIndex(h => /загол|назван|title/.test(h));
      // fallback: if no separate title col, allow «текст» to be title (legacy)
      if (titleCol < 0 && descCol < 0) titleCol = r.findIndex(h => /описан|content|текст/.test(h));
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
    // Fallback positional: Дата | Тип | Заголовок | Описание | Кол
    if (dateCol < 0) dateCol = 0;
    if (typeCol < 0) typeCol = 1;
  }

  if (titleCol < 0) titleCol = typeCol + 1;
  if (descCol  < 0) descCol  = titleCol + 1;
  if (qtyCol   < 0) qtyCol   = descCol  + 1;

  // ── 3. Parse data rows ──
  const items = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === null || c === undefined || c === '')) continue;
    const rawDate = row[dateCol];
    const rawType = String(row[typeCol] ?? '').trim().toUpperCase();
    const title   = String(row[titleCol] ?? '').trim();
    const desc    = String(row[descCol]  ?? '').trim();
    const qty     = parseInt(row[qtyCol]) || 1;
    if (!rawDate || !rawType) continue;
    const date = parseCpDate(rawDate);
    if (!date) continue;
    let type = null;
    if (rawType.includes('ПОСТ') || rawType.includes('POST'))   type = 'post';
    else if (rawType.includes('РИЛС') || rawType.includes('REEL'))  type = 'reel';
    else if (rawType.includes('СТОРИ') || rawType.includes('STORY')) type = 'story';
    if (!type) continue;
    items.push({ date, type, title, description: desc, quantity: qty });
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

// ─── Content Plan Template Download ──────────────────────────────────────────
function cpDownloadTemplate(projectId) {
  const a = document.createElement('a');
  a.href = '/templates/content-plan-template.xlsx';
  a.download = 'Контент-план_Шаблон.xlsx';
  a.click();
  toast('Шаблон скачан', 'success');
}

// ─── Task Card ────────────────────────────────────────────────────────────────
function taskCard(t, urgencyLevel = null) {
  const dl = deadlineFmt(t.deadline, t.status);
  const cd = countdownFmt(t.deadline, t.status);
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

  const urgentBorder = { overdue: '#DC2626', today: '#EA580C', tomorrow: '#D97706' }[urgencyLevel] || '';
  return `
    <div class="task-card ${t.status === 'done' ? 'done' : ''}" data-task-id="${t.id}"${urgentBorder ? ` style="border-left:3px solid ${urgentBorder};border-radius:0 10px 10px 0"` : ''}>
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
          ${cd}
          ${t.creator_name && t.created_by !== state.user.id ? `<span class="task-meta-item" style="color:#94a3b8;font-size:11px">от ${t.creator_name}</span>` : ''}
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
    if (result.status === 'pending_review') toast('Задача отправлена руководителю на проверку', 'info');

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
    const [tasks, comments, history] = await Promise.all([
      GET('/tasks?_force=1'),
      GET('/tasks/' + taskId + '/comments'),
      GET('/tasks/' + taskId + '/history').catch(() => []),
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
    const canEdit = isAdmin || isMyTask || can('assign_tasks') || can('manage_team');

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
              <div class="value" id="td-status">${statusBadge(t.status)}</div>
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
            ${t.creator_name ? `
            <div class="task-detail-meta-item">
              <div class="label">Постановщик</div>
              <div class="value" style="display:flex;align-items:center;gap:6px">
                ${(() => { const cu = state.users?.find(u=>u.id===t.created_by); return avatar(t.creator_name, cu?.avatar_color||'#6366f1', 'avatar-xs', cu?.avatar_img||''); })()}
                ${t.creator_name}
              </div>
            </div>` : ''}
          </div>

          ${canEdit ? `
            <div style="display:flex;gap:10px;margin-bottom:20px">
              <button class="btn btn-outline btn-sm" onclick="closeModal();openTaskModal(${t.id})" style="display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.edit)} Редактировать</button>
              ${isAdmin || can('assign_tasks') ? `<button class="btn btn-danger btn-sm" onclick="deleteTask(${t.id})" style="display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.trash)} Удалить</button>` : ''}
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
                      <div class="comment-text">${c.text.replace(/@([\wА-ЯЁа-яё]+(?:\s+[\wА-ЯЁа-яё]+)?)/gu, '<span class="comment-mention">@$1</span>')}</div>
                    </div>
                  </div>
                `; }).join('')}
            </div>
            <div class="comment-input-row">
              <input class="comment-input" id="comment-input" placeholder="Написать комментарий...">
              <button class="btn btn-blue btn-sm" onclick="submitComment(${t.id})">Отправить</button>
            </div>
          </div>

          ${history.length > 0 ? `
          <div class="task-history-section">
            <div class="task-history-title">${svgI(SVG_PATHS.clock,14)} История изменений</div>
            <div class="task-history-list">
              ${history.map(h => {
                const fieldNames = { status:'Статус', priority:'Приоритет', title:'Название', deadline:'Дедлайн', assignee:'Исполнитель' };
                return `<div class="task-history-item">
                  <div class="task-history-dot"></div>
                  <div class="task-history-body">
                    <span class="task-history-who">${h.user_name}</span>
                    изменил <span class="task-history-field">${fieldNames[h.field] || h.field}</span>:
                    <span class="task-history-old">${h.old_value}</span> → <span class="task-history-new">${h.new_value}</span>
                    <span class="task-history-time">${fmtDate(h.created_at)}</span>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>
    `);


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
    const dpH = 400; // calendar + time picker height
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    // Open upward if not enough space below, but enough above
    const openUp = spaceBelow < dpH && spaceAbove > spaceBelow;
    dp.style.left = Math.min(r.left, window.innerWidth - 270) + 'px';
    dp.style.top  = openUp ? Math.max(8, r.top - dpH - 4) + 'px' : (r.bottom + 4) + 'px';
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
          <input id="assignee-search" class="input" placeholder="Поиск по имени..." style="margin-bottom:8px;padding:7px 12px;font-size:13px"
            oninput="filterAssigneeChips(this.value)">
          <div class="assignee-picker" id="f-assignees">
            ${state.users.map(u => `
              <div class="assignee-chip ${selectedIds.has(u.id) ? 'selected' : ''}" data-uid="${u.id}" data-name="${u.name.toLowerCase()}" onclick="this.classList.toggle('selected')">
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
            <option value="every2days" ${task?.recurrence==='every2days' ? 'selected':''}>Каждые 2 дня</option>
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
const ACTIVITY_PERIODS = [
  { label: '7 дней',    days: 7   },
  { label: '14 дней',   days: 14  },
  { label: '1 месяц',   days: 30  },
  { label: '3 месяца',  days: 90  },
  { label: '6 месяцев', days: 180 },
  { label: '1 год',     days: 365 },
];

// ─── Review Page ──────────────────────────────────────────────────────────────

async function updateReviewBadge() {
  try {
    const tasks = await GET('/tasks/pending-review');
    const badge = document.getElementById('nav-review-badge');
    if (!badge) return;
    if (tasks.length > 0) {
      badge.textContent = tasks.length;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  } catch {}
}

async function renderReviewPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';
  try {
    const tasks = await GET('/tasks/pending-review');
    updateReviewBadge();

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text);margin:0">Задачи для проверки</h2>
          <p style="font-size:13px;color:#6b7280;margin:4px 0 0">Сотрудники выполнили эти задачи — примите или верните на доработку</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="background:#f3f0ff;color:#7c3aed;padding:6px 14px;border-radius:99px;font-size:13px;font-weight:700">
            ${tasks.length} ${tasks.length===1?'задача':tasks.length>=2&&tasks.length<=4?'задачи':'задач'}
          </span>
        </div>
      </div>

      ${tasks.length === 0
        ? `<div class="empty-state">
            <div class="empty-icon">${svgI('<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',44)}</div>
            <h3>Всё проверено</h3>
            <p>Нет задач, ожидающих вашего принятия</p>
          </div>`
        : `<div class="review-tasks-list">
            ${tasks.map(t => reviewTaskCard(t)).join('')}
           </div>`
      }
    `;
    attachTaskCardListeners();
  } catch(err) {
    content.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`;
  }
}

function reviewTaskCard(t) {
  const dl = deadlineFmt(t.deadline, t.status);
  const cd = countdownFmt(t.deadline, t.status);
  const assigneeNames = (t.multi_assignees && t.multi_assignees.length > 0)
    ? t.multi_assignees.map(a => a.name).join(', ')
    : (t.assignee_name || '—');

  return `
    <div class="review-task-card">
      <div class="review-task-top">
        <div class="review-task-badges">
          ${t.priority ? `<span class="priority-badge priority-${t.priority}">${{low:'Низкий',medium:'Средний',high:'Высокий'}[t.priority]||t.priority}</span>` : ''}
          ${t.project_name ? `<span class="proj-badge" style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0">${_escHtml(t.project_name)}</span>` : ''}
        </div>
        <span class="status-badge status-pending_review" style="gap:5px">${colorDot('#8B5CF6')} На проверке</span>
      </div>

      <div class="review-task-title" onclick="openTaskModal(${t.id})" style="cursor:pointer">${_escHtml(t.title)}</div>

      <div class="review-task-meta">
        <span style="display:flex;align-items:center;gap:5px;color:#6b7280;font-size:12px">
          ${svgI(SVG_PATHS.user,12)} ${_escHtml(assigneeNames)}
        </span>
        ${dl ? `<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:${cd.color||'#6b7280'}">${svgI(cd.icon?SVG_PATHS[cd.icon]||SVG_PATHS.clock:SVG_PATHS.cal,11)} ${dl}${cd.text?' · '+cd.text:''}</span>` : ''}
      </div>

      <div class="review-task-actions">
        <button class="btn btn-outline review-reject-btn" onclick="reviewReject(${t.id})">
          ${svgI('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>',14)} Вернуть на доработку
        </button>
        <button class="btn btn-primary review-approve-btn" onclick="reviewApprove(${t.id})">
          ${svgI('<polyline points="20 6 9 17 4 12"/>',14)} Принять задачу
        </button>
      </div>
    </div>
  `;
}

async function reviewApprove(taskId) {
  try {
    await api('POST', `/tasks/${taskId}/approve`, {});
    toast('Задача принята и закрыта', 'success');
    renderReviewPage();
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function reviewReject(taskId) {
  openModal(`
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <div class="modal-title">Вернуть на доработку</div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">Комментарий сотруднику <span style="color:#9ca3af;font-weight:400">(необязательно)</span></label>
          <textarea id="reject-comment" class="form-control" rows="3" placeholder="Что нужно исправить или доделать..." style="resize:vertical"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
        <button class="btn btn-primary" style="background:#dc2626;border-color:#dc2626" onclick="reviewRejectConfirm(${taskId})">
          Вернуть на доработку
        </button>
      </div>
    </div>
  `);
}

async function reviewRejectConfirm(taskId) {
  const comment = document.getElementById('reject-comment')?.value?.trim() || '';
  closeModal();
  try {
    await api('POST', `/tasks/${taskId}/reject`, { comment });
    toast('Задача возвращена на доработку', 'info');
    renderReviewPage();
  } catch(e) {
    toast('Ошибка: ' + e.message, 'error');
  }
}

async function renderActivityPage() {
  const periodBtns = ACTIVITY_PERIODS.map(p =>
    `<button class="period-btn${activityDays === p.days ? ' active' : ''}" onclick="setActivityPeriod(${p.days})">${p.label}</button>`
  ).join('');

  const periodLabel = ACTIVITY_PERIODS.find(p => p.days === activityDays)?.label || activityDays + ' дн.';
  document.getElementById('page-content').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">${periodBtns}</div>
      <button class="btn btn-outline btn-sm act-print-btn" onclick="printActivityChart()" style="display:inline-flex;align-items:center;gap:6px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Экспорт PDF
      </button>
    </div>
    <div id="act-print-area">
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <div id="act-chart-block" style="flex:1;min-width:280px"><div style="color:#94a3b8;font-size:13px">Загрузка...</div></div>
        <div id="act-users-block" style="width:300px;flex-shrink:0"><div style="color:#94a3b8;font-size:13px">Загрузка...</div></div>
      </div>
      <div id="act-log-block"><div style="color:#94a3b8;font-size:13px">Загрузка...</div></div>
    </div>
  `;

  await loadActivityData(activityDays);
}

function printActivityChart() {
  const buckets = Object.values(_actBuckets);
  if (!buckets.length) { toast('График пуст — нет данных', 'error'); return; }

  const periodLabel = ACTIVITY_PERIODS.find(p => p.days === activityDays)?.label || activityDays + ' дн.';
  const totalEvents = buckets.reduce((s, b) => s + b.events, 0);
  const now = new Date().toLocaleString('ru-RU', { day:'2-digit', month:'long', year:'numeric' });

  const W = 1100, BAR_AREA_H = 280, LABEL_H = 24, BOTTOM_H = 110;
  const H = BAR_AREA_H + LABEL_H + BOTTOM_H;
  const padL = 40, padR = 20, padT = 10;
  const innerW = W - padL - padR;
  const n = buckets.length;
  const barW = Math.max(8, Math.min(40, innerW / n - 4));
  const gap = (innerW - barW * n) / (n + 1);
  const maxEvents = Math.max(...buckets.map(b => b.events), 1);

  // Grid lines
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => {
    const y = padT + BAR_AREA_H * (1 - f);
    const val = Math.round(maxEvents * f);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0" stroke-width="0.8"/>
            <text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="#94a3b8">${val}</text>`;
  }).join('');

  // Bars + labels
  const bars = buckets.map((b, i) => {
    const x = padL + gap + i * (barW + gap);
    const barH = Math.max(b.events > 0 ? 12 : 0, Math.round((b.events / maxEvents) * BAR_AREA_H));
    const barY = padT + BAR_AREA_H - barH;
    const color = b.events === 0 ? '#e2e8f0' : b.breakdown.length >= 5 ? '#059669' : b.breakdown.length >= 3 ? '#3B82F6' : '#D97706';
    const countLabel = b.events > 0
      ? `<text x="${x + barW/2}" y="${barY - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#1e293b">${b.events}</text>` : '';

    // User names above bar (top 3)
    const userLabels = b.breakdown.slice(0, 3).map((u, ui) => {
      const shortName = u.name.split(' ')[0]; // first name only
      const ly = barY - 18 - ui * 13;
      return `<text x="${x + barW/2}" y="${ly}" text-anchor="middle" font-size="8.5" fill="${u.color}" font-weight="600">${shortName}</text>`;
    }).join('');

    return `<g>
      <rect x="${x}" y="${barY}" width="${barW}" height="${barH}" fill="${color}" rx="3"/>
      ${countLabel}
      ${userLabels}
      <text x="${x + barW/2}" y="${padT + BAR_AREA_H + LABEL_H}" text-anchor="middle" font-size="9" fill="#64748b">${b.period}</text>
    </g>`;
  }).join('');

  // User summary table
  const allUsers = {};
  buckets.forEach(b => b.breakdown.forEach(u => {
    if (!allUsers[u.name]) allUsers[u.name] = { name: u.name, color: u.color, events: 0 };
    allUsers[u.name].events += u.events;
  }));
  const sortedUsers = Object.values(allUsers).sort((a, b) => b.events - a.events);
  const tableRows = sortedUsers.map((u, i) => {
    const ini = u.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `<tr style="background:${i%2===0?'#f8fafc':'white'}">
      <td style="padding:6px 10px;display:flex;align-items:center;gap:8px">
        <div style="width:24px;height:24px;border-radius:50%;background:${u.color};color:white;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0">${ini}</div>
        ${u.name}
      </td>
      <td style="padding:6px 14px;font-weight:700;color:#1e293b;text-align:right">${u.events}</td>
    </tr>`;
  }).join('');

  const win = window.open('', '_blank', 'width=1200,height=900');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>График активности · ${periodLabel}</title>
    <style>
      * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      body { font-family:system-ui,sans-serif; font-size:13px; color:#0f172a; background:white; padding:28px; }
      .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; padding-bottom:14px; border-bottom:2px solid #e2e8f0; }
      .title { font-size:22px; font-weight:800; }
      .subtitle { font-size:13px; color:#64748b; margin-top:4px; }
      .meta { font-size:12px; color:#94a3b8; text-align:right; }
      .stats { display:flex; gap:24px; margin-bottom:16px; }
      .stat-box { background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:10px; padding:12px 18px; }
      .stat-val { font-size:28px; font-weight:900; }
      .stat-lbl { font-size:11px; color:#64748b; }
      .legend { display:flex; gap:16px; font-size:11px; color:#64748b; margin-bottom:10px; }
      .leg-dot { width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:4px; }
      .section-title { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:#64748b; margin:20px 0 10px; }
      table { width:100%; border-collapse:collapse; font-size:13px; }
      th { background:#f1f5f9; padding:8px 10px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; color:#64748b; }
      td { border-bottom:1px solid #f1f5f9; }
      @media print { @page { size:A4 landscape; margin:1cm; } }
    </style>
  </head><body>
    <div class="header">
      <div>
        <div class="title">График активности · ${periodLabel}</div>
        <div class="subtitle">MindsBar — платформа управления задачами</div>
      </div>
      <div class="meta">Сгенерирован: ${now}</div>
    </div>

    <div class="stats">
      <div class="stat-box"><div class="stat-val">${totalEvents}</div><div class="stat-lbl">событий за период</div></div>
      <div class="stat-box"><div class="stat-val">${sortedUsers.length}</div><div class="stat-lbl">активных сотрудников</div></div>
    </div>

    <div class="legend">
      <span><span class="leg-dot" style="background:#059669"></span>5+ сотрудников</span>
      <span><span class="leg-dot" style="background:#3B82F6"></span>3–4 сотрудника</span>
      <span><span class="leg-dot" style="background:#D97706"></span>1–2 сотрудника</span>
    </div>

    <svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;border:1.5px solid #e2e8f0;border-radius:10px;background:#fafafa;margin-bottom:20px">
      ${gridLines}
      ${bars}
    </svg>

    <div class="section-title">Активность по сотрудникам</div>
    <table>
      <thead><tr><th>Сотрудник</th><th style="text-align:right">Событий</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <script>window.onload = () => window.print();<\/script>
  </body></html>`);
  win.document.close();
}

function printActivityReport(periodLabel) {
  const area = document.getElementById('act-print-area');
  if (!area) return;
  const now = new Date().toLocaleString('ru-RU', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const win = window.open('', '_blank', 'width=1100,height=800');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Активность · ${periodLabel}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: system-ui, sans-serif; font-size: 13px; color: #0f172a; padding: 24px; }
      .print-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e2e8f0; }
      .print-title { font-size: 20px; font-weight: 800; }
      .print-meta { font-size: 12px; color: #64748b; text-align: right; }
      .act-card, .chart-panel, .act-users-card { background: #f8fafc !important; border: 1.5px solid #e2e8f0; border-radius: 10px; }
      .act-log-row { border-bottom: 1px solid #f1f5f9; padding: 8px 12px; display: flex; align-items: flex-start; gap: 10px; }
      .act-log-avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: white; flex-shrink: 0; }
      .act-log-icon { display: none; }
      .act-show-more { display: none; }
      @media print { @page { size: A4 landscape; margin: 1cm; } }
    </style>
  </head><body>
    <div class="print-header">
      <div>
        <div class="print-title">Отчёт активности · ${periodLabel}</div>
      </div>
      <div class="print-meta">MindsBar<br>${now}</div>
    </div>
    ${area.innerHTML}
    <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`);
  win.document.close();
}

async function setActivityPeriod(days) {
  activityDays = days;
  document.querySelectorAll('.period-btn[onclick^="setActivityPeriod"]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick') === `setActivityPeriod(${days})`);
  });
  const loading = '<div style="color:#94a3b8;font-size:13px">Загрузка...</div>';
  const chartEl = document.getElementById('act-chart-block');
  const logEl   = document.getElementById('act-log-block');
  if (chartEl) chartEl.innerHTML = loading;
  if (logEl)   logEl.innerHTML   = loading;
  await loadActivityData(days);
}

async function loadActivityData(days) {
  try {
    const [logs, chart, users] = await Promise.all([
      GET(`/activity?limit=500&days=${days}`),
      GET(`/activity/chart?days=${days}`),
      GET('/users/last-seen'),
    ]);
    renderActivityChart(chart, days, logs);
    renderActivityUsers(users);
    renderActivityLog(logs);
  } catch (e) {
    document.getElementById('page-content').innerHTML =
      `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${e.message}</p></div>`;
  }
}

let _actBuckets = {};
let _actBucketIdx = 0;

function _actUserBreakdown(logs, fromDate, toDate) {
  const map = {};
  for (const log of logs) {
    const d = log.created_at.slice(0, 10);
    if (d < fromDate || d > toDate) continue;
    if (!map[log.user_id]) map[log.user_id] = { name: log.user_name, color: log.user_color || '#6366f1', events: 0 };
    map[log.user_id].events++;
  }
  return Object.values(map).sort((a, b) => b.events - a.events);
}

function showActBarTooltip(event, idx) {
  const b = _actBuckets[idx];
  if (!b) return;
  let el = document.getElementById('act-bar-tip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'act-bar-tip';
    el.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#f1f5f9;border-radius:10px;padding:10px 14px;font-size:12px;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.35);min-width:170px;max-width:240px;';
    document.body.appendChild(el);
  }
  const rows = b.breakdown.length
    ? b.breakdown.map(u => {
        const ini = u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return `<div style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <div style="width:24px;height:24px;border-radius:50%;background:${u.color};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0;color:#fff">${ini}</div>
          <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cbd5e1">${u.name}</div>
          <div style="font-weight:700;color:#fff;flex-shrink:0">${u.events}</div>
        </div>`;
      }).join('')
    : '<div style="color:#64748b;margin-top:6px">Нет активности</div>';
  el.innerHTML = `<div style="font-weight:700;font-size:13px;padding-bottom:6px;border-bottom:1px solid #334155">${b.period}</div>${rows}`;
  el.style.display = 'block';
  _posActTip(el, event);
}
function moveActBarTooltip(event) {
  const el = document.getElementById('act-bar-tip');
  if (el && el.style.display !== 'none') _posActTip(el, event);
}
function hideActBarTooltip() {
  const el = document.getElementById('act-bar-tip');
  if (el) el.style.display = 'none';
}
function _posActTip(el, e) {
  const w = el.offsetWidth || 200, h = el.offsetHeight || 100;
  el.style.left = Math.min(e.clientX + 14, window.innerWidth - w - 10) + 'px';
  el.style.top  = Math.max(Math.min(e.clientY - 10, window.innerHeight - h - 10), 10) + 'px';
}

function renderActivityChart(chart, days = 30, logs = []) {
  const el = document.getElementById('act-chart-block');
  if (!el) return;
  _actBuckets = {};
  _actBucketIdx = 0;

  const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const today = new Date(Date.now()+5*3600000);
  const todayStr = today.toISOString().slice(0, 10);

  const dayMap = {};
  chart.forEach(r => { dayMap[r.day] = r; });

  let buckets = [];
  let unitLabel = 'активных дней';

  if (days <= 30) {
    // Daily bars
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = dayMap[key] || { events: 0, users: 0 };
      const date = new Date(key + 'T00:00:00');
      buckets.push({
        events: row.events, users: row.users,
        label: String(date.getDate()),
        period: `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`,
        highlight: key === todayStr,
        fromDate: key, toDate: key,
      });
    }
  } else if (days <= 90) {
    // Weekly bars
    unitLabel = 'активных недель';
    let remaining = days;
    while (remaining > 0) {
      const weekSize = Math.min(7, remaining);
      let events = 0, users = 0;
      for (let j = remaining - weekSize; j < remaining; j++) {
        const d = new Date(today);
        d.setDate(today.getDate() - j);
        const key = d.toISOString().slice(0, 10);
        const row = dayMap[key] || { events: 0, users: 0 };
        events += row.events;
        users = Math.max(users, row.users);
      }
      const wFrom = new Date(today); wFrom.setDate(today.getDate() - remaining + 1);
      const wTo   = new Date(today); wTo.setDate(today.getDate() - remaining + weekSize);
      const fromDate = wFrom.toISOString().slice(0, 10);
      const toDate   = wTo.toISOString().slice(0, 10);
      const lbl = wFrom.getDate() + ' ' + MONTHS_SHORT[wFrom.getMonth()];
      buckets.push({ events, users, label: lbl, period: `Неделя ${lbl}–${wTo.getDate()} ${MONTHS_SHORT[wTo.getMonth()]}`, highlight: remaining <= 7, fromDate, toDate });
      remaining -= weekSize;
    }
  } else {
    // Monthly bars
    unitLabel = 'активных месяцев';
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - days + 1);
    const monthMap = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const mk = key.slice(0, 7);
      if (!monthMap[mk]) monthMap[mk] = { events: 0, users: 0 };
      const row = dayMap[key] || { events: 0, users: 0 };
      monthMap[mk].events += row.events;
      monthMap[mk].users = Math.max(monthMap[mk].users, row.users);
    }
    const currentMk = todayStr.slice(0, 7);
    buckets = Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0])).map(([mk, data]) => {
      const m = parseInt(mk.split('-')[1]) - 1;
      return {
        events: data.events, users: data.users,
        label: MONTHS_SHORT[m],
        period: `${MONTHS_SHORT[m]} ${mk.split('-')[0]}`,
        highlight: mk === currentMk,
        fromDate: mk + '-01', toDate: mk + '-31',
      };
    });
  }

  const maxEvents = Math.max(...buckets.map(b => b.events), 1);
  const bars = buckets.map(b => {
    const idx = _actBucketIdx++;
    _actBuckets[idx] = { period: b.period, events: b.events, breakdown: _actUserBreakdown(logs, b.fromDate, b.toDate) };
    const h = Math.max(Math.round((b.events / maxEvents) * 100), b.events > 0 ? 8 : 0);
    const color = b.events === 0 ? '#E2E8F0' : b.users >= 5 ? '#059669' : b.users >= 3 ? '#3B82F6' : '#D97706';
    const countLabel = b.events > 0 ? `<div class="act-bar-count">${b.events}</div>` : '';
    return `
      <div class="act-bar-col" onmouseenter="showActBarTooltip(event,${idx})" onmousemove="moveActBarTooltip(event)" onmouseleave="hideActBarTooltip()">
        ${countLabel}
        <div class="act-bar-wrap">
          <div class="act-bar" style="height:${h}%;background:${color};${b.highlight ? 'outline:2px solid #0F172A;outline-offset:1px' : ''}"></div>
        </div>
        <div class="act-bar-lbl${b.highlight ? ' act-bar-today' : ''}">${b.label}</div>
      </div>`;
  }).join('');

  const totalEvents = buckets.reduce((s, b) => s + b.events, 0);
  const activeCount = buckets.filter(b => b.events > 0).length;
  const periodLabel = ACTIVITY_PERIODS.find(p => p.days === days)?.label || `${days} дней`;

  el.innerHTML = `
    <div class="chart-panel" style="height:100%;display:flex;flex-direction:column">
      <div class="chart-title">Активность за ${periodLabel}</div>
      <div style="display:flex;gap:14px;margin-bottom:16px;flex-wrap:wrap">
        <div class="act-mini-stat"><div class="act-mini-val">${totalEvents}</div><div class="act-mini-lbl">событий</div></div>
        <div class="act-mini-stat"><div class="act-mini-val">${activeCount}</div><div class="act-mini-lbl">${unitLabel}</div></div>
        <div style="display:flex;align-items:center;gap:10px;margin-left:auto;font-size:11px;color:var(--text-muted)">
          <span><span class="act-legend-dot" style="background:#059669"></span> 5+ польз.</span>
          <span><span class="act-legend-dot" style="background:#3B82F6"></span> 3–4</span>
          <span><span class="act-legend-dot" style="background:#D97706"></span> 1–2</span>
        </div>
      </div>
      <div class="act-chart" style="overflow:hidden;flex:1;height:auto;min-height:80px">${bars}</div>
    </div>
  `;
}

function renderActivityUsers(users) {
  const el = document.getElementById('act-users-block');
  if (!el) return;

  const ACTION_LABELS = {
    login: 'Вход в систему',          logout: 'Выход из системы',
    task_created: 'Создал задачу',    task_status: 'Изменил статус',
    task_updated: 'Обновил задачу',   task_deleted: 'Удалил задачу',
    comment: 'Написал комментарий',
    project_created: 'Создал проект', project_updated: 'Изменил проект',
    project_deleted: 'Удалил проект', project_archived: 'Архивировал проект',
    content_created: 'Добавил в контент-план', content_updated: 'Изменил контент-план',
    user_created: 'Добавил сотрудника', user_updated: 'Изменил данные',
    schedule_created: 'Добавил расписание', schedule_updated: 'Изменил расписание',
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

  const iS = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ACTION_ICON = {
    login:              iS('<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>'),
    logout:             iS('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
    task_created:       iS('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    task_status:        iS('<polyline points="20 6 9 17 4 12"/>'),
    task_updated:       iS('<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
    task_deleted:       iS('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>'),
    comment:            iS('<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>'),
    project_created:    iS('<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>'),
    project_updated:    iS('<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
    project_deleted:    iS('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>'),
    project_archived:   iS('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>'),
    project_unarchived: iS('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>'),
    content_created:    iS('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    content_updated:    iS('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    content_deleted:    iS('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>'),
    user_created:       iS('<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>'),
    user_updated:       iS('<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    user_deleted:       iS('<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="9" y1="14" x2="15" y2="14"/>'),
    schedule_created:   iS('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    schedule_updated:   iS('<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
    schedule_deleted:   iS('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>'),
  };
  const ACTION_COLOR = {
    login:'#6366f1',            logout:'#94a3b8',
    task_created:'#3B82F6',     task_status:'#059669',     task_updated:'#D97706',   task_deleted:'#DC2626',
    comment:'#8B5CF6',
    project_created:'#f97316',  project_updated:'#f59e0b', project_deleted:'#DC2626',
    project_archived:'#9ca3af', project_unarchived:'#22c55e',
    content_created:'#ec4899',  content_updated:'#a78bfa', content_deleted:'#DC2626',
    user_created:'#22c55e',     user_updated:'#14b8a6',    user_deleted:'#DC2626',
    schedule_created:'#8b5cf6', schedule_updated:'#d97706',schedule_deleted:'#DC2626',
  };
  const ACTION_TEXT = {
    login: 'вошёл в систему',              logout: 'вышел из системы',
    task_created: 'создал задачу',         task_status: 'изменил статус задачи',
    task_updated: 'обновил задачу',        task_deleted: 'удалил задачу',
    comment: 'написал комментарий к',
    project_created: 'создал проект',      project_updated: 'изменил проект',
    project_deleted: 'удалил проект',      project_archived: 'архивировал проект',
    project_unarchived: 'восстановил проект',
    content_created: 'добавил в контент-план',  content_updated: 'изменил контент-план',
    content_deleted: 'удалил из контент-плана',
    user_created: 'добавил сотрудника',    user_updated: 'изменил данные',
    user_deleted: 'удалил сотрудника',
    schedule_created: 'добавил расписание', schedule_updated: 'изменил расписание',
    schedule_deleted: 'удалил расписание',
  };

  const toUtcLog = dt => dt ? new Date(dt.endsWith('Z') ? dt : dt + 'Z') : null;
  const fmtTime = dt => {
    const d = toUtcLog(dt);
    if (!d) return '—';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' });
  };

  const initials = name => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const VISIBLE = 10;
  const renderRow = log => {
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
  };

  const visible = logs.slice(0, VISIBLE);
  const hidden  = logs.slice(VISIBLE);

  const moreBlock = hidden.length > 0 ? `
    <div id="act-log-more" style="display:none" class="act-log-list">
      ${hidden.map(renderRow).join('')}
    </div>
    <div style="text-align:center;margin-top:12px">
      <button id="act-log-toggle" class="btn btn-outline btn-sm" onclick="
        const m=document.getElementById('act-log-more');
        const b=document.getElementById('act-log-toggle');
        const open=m.style.display==='none';
        m.style.display=open?'':'none';
        b.textContent=open?'▲ Свернуть':'▼ Показать все (${hidden.length} событий)';
      ">▼ Показать все (${hidden.length} событий)</button>
    </div>` : '';

  el.innerHTML = `
    <div class="chart-panel">
      <div class="chart-title">Лог активности <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-light);margin-left:4px">· всего ${logs.length} событий</span></div>
      ${logs.length === 0 ? '<div style="color:#94a3b8;font-size:13px;padding:8px 0">Активности нет — она появится после входа и работы сотрудников</div>' : ''}
      <div class="act-log-list">${visible.map(renderRow).join('')}</div>
      ${moreBlock}
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
        ${ev > 0 ? `<div class="act-bar-count">${ev}</div>` : ''}
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
        : (() => {
            const renderUARow = log => {
              const color = ACTION_COLOR[log.action] || '#94a3b8';
              const icon  = ACTION_ICON[log.action]  || ACTION_ICON.task_updated;
              const text  = ACTION_TEXT[log.action]  || log.action;
              return `<div class="act-log-row">
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
            };
            const vis10  = logs.slice(0, 10);
            const hidden = logs.slice(10);
            return `<div class="act-log-list">${vis10.map(renderUARow).join('')}</div>
              ${hidden.length > 0 ? `
                <div id="ua-log-more" style="display:none" class="act-log-list">${hidden.map(renderUARow).join('')}</div>
                <div style="text-align:center;margin-top:10px">
                  <button class="btn btn-outline btn-sm" id="ua-log-btn" onclick="
                    const m=document.getElementById('ua-log-more');
                    const b=document.getElementById('ua-log-btn');
                    const open=m.style.display==='none';
                    m.style.display=open?'':'none';
                    b.textContent=open?'▲ Свернуть':'▼ Показать все (${hidden.length} событий)';
                  ">▼ Показать все (${hidden.length} событий)</button>
                </div>` : ''}`;
          })()}
    </div>
  `;
}

async function renderReportsPage() {
  const now = new Date(Date.now() + 5*3600000); // Dushanbe UTC+5
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

      <!-- Workload chart -->
      ${totalAll > 0 ? (() => {
        const sorted = [...data].filter(u => u.stats.total > 0).sort((a,b) => b.stats.total - a.stats.total);
        const maxTotal = Math.max(...sorted.map(u => u.stats.total), 1);
        const bars = sorted.map(u => {
          const s = u.stats;
          const tot = s.total || 0;
          const don = s.done || 0;
          const ov  = s.overdue || 0;
          const inp = s.in_progress || 0;
          const nw  = tot - don - inp - ov;
          const pct = tot > 0 ? Math.round(don/tot*100) : 0;
          const barW = Math.round(tot/maxTotal*100);
          const ini = u.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
          return `<div class="rpt-bar-row" onclick="openEmployeeProfile(${u.id})" title="${u.name}: ${tot} задач">
            <div class="rpt-bar-label">
              <div class="rpt-bar-av" style="background:${u.avatar_color||'#6366f1'}">
                ${u.avatar_img ? `<img src="${u.avatar_img}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : ini}
              </div>
              <span class="rpt-bar-name">${u.name.split(' ')[0]}</span>
            </div>
            <div class="rpt-bar-track">
              <div class="rpt-bar-fill" style="width:${barW}%">
                ${don > 0 ? `<div class="rpt-bar-seg rpt-seg-done" style="width:${Math.round(don/tot*100)}%" title="Выполнено: ${don}"></div>` : ''}
                ${inp > 0 ? `<div class="rpt-bar-seg rpt-seg-inp" style="width:${Math.round(inp/tot*100)}%" title="В работе: ${inp}"></div>` : ''}
                ${ov > 0 ? `<div class="rpt-bar-seg rpt-seg-ov" style="width:${Math.round(ov/tot*100)}%" title="Просрочено: ${ov}"></div>` : ''}
                ${nw > 0 ? `<div class="rpt-bar-seg rpt-seg-nw" style="width:${Math.round(nw/tot*100)}%" title="Новые: ${nw}"></div>` : ''}
              </div>
            </div>
            <div class="rpt-bar-nums">
              <span class="rpt-bar-total">${tot}</span>
              <span class="rpt-bar-sub" style="color:#16a34a">${don}✓</span>
              ${ov > 0 ? `<span class="rpt-bar-sub" style="color:#dc2626">${ov}⚠</span>` : ''}
              <span class="rpt-bar-pct" style="color:${pct>=80?'#16a34a':pct>=50?'#d97706':'#dc2626'}">${pct}%</span>
            </div>
          </div>`;
        }).join('');

        return `<div class="rpt-chart-wrap">
          <div class="rpt-chart-header">
            <div class="rpt-chart-title">Нагрузка по сотрудникам</div>
            <div class="rpt-chart-legend">
              <span class="rpt-leg"><span class="rpt-leg-dot" style="background:#16a34a"></span>Выполнено</span>
              <span class="rpt-leg"><span class="rpt-leg-dot" style="background:#d97706"></span>В работе</span>
              <span class="rpt-leg"><span class="rpt-leg-dot" style="background:#dc2626"></span>Просрочено</span>
              <span class="rpt-leg"><span class="rpt-leg-dot" style="background:#e2e8f0"></span>Новые</span>
            </div>
          </div>
          <div class="rpt-chart-bars">${bars}</div>
        </div>`;
      })() : ''}

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
  reports:          { icon: svgI(SVG_PATHS.bars, 13),   text: 'Отчёты' },
  manage_projects:  { icon: svgI(SVG_PATHS.folder, 13), text: 'Проекты' },
  assign_tasks:     { icon: svgI(SVG_PATHS.clip, 13),   text: 'Назначать задачи' },
  manage_team:      { icon: svgI(SVG_PATHS.users, 13),  text: 'Команда' },
  view_activity:    { icon: svgI(SVG_PATHS.eye, 13),    text: 'Активность' },
  manage_schedule:  { icon: svgI(SVG_PATHS.cal, 13),    text: 'Расписание' },
  manage_finance:   { icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`, text: 'Финансы' },
  manage_finance_log: { icon: svgI(SVG_PATHS.clip, 13), text: 'Активность финансов' },
  manage_ideahast:  { icon: svgI(SVG_PATHS.bars, 13), text: 'Анализ проектов' },
  manage_kids:      { icon: svgI(SVG_PATHS.users, 13), text: 'Финансы Kids' },
  manage_b2c:       { icon: svgI(SVG_PATHS.users, 13), text: 'Финансы В2С' },
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
    // Fetch only this employee's tasks — much faster than loading all tasks
    const [users, tasks] = await Promise.all([
      GET('/users'),
      GET('/tasks?assignee_id=' + userId)
    ]);
    const u = users.find(u => u.id === userId);
    if (!u) {
      document.getElementById('page-content').innerHTML = '<div class="empty-state"><h3>Сотрудник не найден</h3></div>';
      return;
    }

    const allTasks = tasks; // already filtered by server
    // Task is done for this user if:
    // 1. Overall task status is 'done' (everyone completed), OR
    // 2. This user's individual done flag is set in multi_assignees
    const isUserDone = t => {
      if (t.status === 'done') return true;
      const ma = t.multi_assignees;
      if (ma && ma.length > 0) return ma.find(a => a.id === userId)?.done === 1;
      return false;
    };
    const total   = tasks.length;
    const done    = tasks.filter(t => isUserDone(t)).length;
    const inProg  = tasks.filter(t => !isUserDone(t) && t.status === 'in_progress').length;
    const newCnt  = tasks.filter(t => !isUserDone(t) && t.status === 'new').length;
    const overdue = tasks.filter(t => !isUserDone(t) && t.deadline && parseDeadline(t.deadline) < new Date()).length;
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
        <div class="emp-profile-avatar" style="background:${u.avatar_color || '#6366f1'};padding:0;overflow:hidden">
          ${u.avatar_img ? `<img src="${u.avatar_img}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">` : initials(u.name)}
        </div>
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
        <div class="section-title">Все задачи сотрудника <span style="font-size:13px;font-weight:500;color:#6b7280">(${tasks.length})</span></div>
      </div>
      ${tasks.length === 0
        ? `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.clip,44)}</div><h3>Нет задач</h3><p>Задачи не назначены</p></div>`
        : (() => {
            const LIMIT = 10;
            const visible = tasks.slice(0, LIMIT);
            const hidden  = tasks.slice(LIMIT);
            return `
              <div class="tasks-list" id="emp-tasks-visible">${visible.map(t => taskCard(t)).join('')}</div>
              ${hidden.length > 0 ? `
                <div class="tasks-list" id="emp-tasks-hidden" style="display:none">${hidden.map(t => taskCard(t)).join('')}</div>
                <div style="text-align:center;margin-top:16px">
                  <button class="btn btn-outline" id="emp-tasks-toggle" onclick="empTasksToggle(${hidden.length})">
                    ${svgI('<polyline points="6 9 12 15 18 9"/>',14)} Показать ещё ${hidden.length} ${hidden.length===1?'задачу':hidden.length>=2&&hidden.length<=4?'задачи':'задач'}
                  </button>
                </div>
              ` : ''}
            `;
          })()
      }
    `;
    attachTaskCardListeners();
    triggerDashAnimations();
  } catch (err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${err.message}</p></div>`;
  }
}

function empTasksToggle(hiddenCount) {
  const hiddenEl = document.getElementById('emp-tasks-hidden');
  const btn      = document.getElementById('emp-tasks-toggle');
  if (!hiddenEl || !btn) return;
  const isOpen = hiddenEl.style.display !== 'none';
  hiddenEl.style.display = isOpen ? 'none' : '';
  if (isOpen) {
    btn.innerHTML = `${svgI('<polyline points="6 9 12 15 18 9"/>',14)} Показать ещё ${hiddenCount} ${hiddenCount===1?'задачу':hiddenCount>=2&&hiddenCount<=4?'задачи':'задач'}`;
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    btn.innerHTML = `${svgI('<polyline points="18 15 12 9 6 15"/>',14)} Свернуть`;
    if (!isOpen) attachTaskCardListeners();
  }
}

// ─── Team Page ────────────────────────────────────────────────────────────────
async function renderTeamPage() {
  const isAdmin = state.user.role === 'admin';
  try {
    const [users, tasks] = await Promise.all([GET('/users'), GET('/tasks')]);
    state.users = users;

    // Group task counts by assignee — include both single and multi-assignee tasks
    const tasksByUser = {};
    const addToUser = (uid, isDone, status) => {
      if (!tasksByUser[uid]) tasksByUser[uid] = { total: 0, done: 0, in_progress: 0, new_count: 0 };
      const s = tasksByUser[uid];
      s.total++;
      if (isDone) s.done++;
      else if (status === 'in_progress') s.in_progress++;
      else s.new_count++;
    };
    tasks.forEach(t => {
      const ma = t.multi_assignees;
      if (ma && ma.length > 0) {
        ma.forEach(a => addToUser(a.id, t.status === 'done' || a.done === 1, t.status));
      } else if (t.assignee_id) {
        addToUser(t.assignee_id, t.status === 'done', t.status);
      }
    });

    document.getElementById('page-content').innerHTML = `
      <div class="section-header">
        <div class="section-title">Участники команды (${users.length})</div>
        ${isAdmin ? `<button class="btn btn-blue btn-sm" onclick="openUserModal()">＋ Добавить сотрудника</button>` : ''}
      </div>
      <div class="team-search-wrap">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#9ca3af;flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="team-search" class="team-search-input" placeholder="Поиск по имени или email..." oninput="filterTeamCards(this.value)">
      </div>
      <div class="team-grid" id="team-grid">
        ${users.map(u => {
          const rl = roleLabel(u);
          const tags = u.role !== 'admin' ? permTags(u.permissions) : '';
          const s = tasksByUser[u.id] || { total: 0, done: 0, in_progress: 0, new_count: 0 };
          const pct = s.total > 0 ? Math.round(s.done / s.total * 100) : 0;
          const effColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : pct > 0 ? '#ef4444' : '#d1d5db';
          return `
          <div class="member-card clickable" data-name="${(u.name+' '+u.email).toLowerCase()}" onclick="openEmployeeProfile(${u.id})">
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
    <div class="modal" style="max-height:90vh;overflow-y:auto;display:flex;flex-direction:column">
      <div class="modal-header" style="flex-shrink:0">
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

// ─── Best Employee Page ───────────────────────────────────────────────────────
let _beMonth       = new Date().toISOString().slice(0, 7);
let _beWinOffset   = 0; // sliding window offset in months

async function renderBestEmployeePage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';
  try {
    const data = await GET('/best-employee?month=' + _beMonth);
    _renderBestEmployee(data);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`;
  }
}

async function beSetMonth(m) {
  _beMonth = m;
  const data = await GET('/best-employee?month=' + m);
  _renderBestEmployee(data);
}

async function beShiftWindow(delta) {
  _beWinOffset += delta;
  const data = await GET('/best-employee?month=' + _beMonth);
  _renderBestEmployee(data);
}

function _renderBestEmployee(data) {
  const content = document.getElementById('page-content');
  const { month, rankings, history } = data;

  const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const fmtMonth = m => { const [y,mo] = m.split('-'); return MONTH_NAMES[+mo-1] + ' ' + y; };

  const scoreBar = (score) => {
    const pct = score ?? 0;
    const col = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
    return `<div class="be-score-bar-bg"><div class="be-score-bar-fill" style="width:${pct}%;background:${col}"></div></div>`;
  };
  const MEDAL_SVG = [
    `<svg viewBox="0 0 26 26" width="26" height="26"><circle cx="13" cy="13" r="12" fill="#fbbf24" stroke="#d97706" stroke-width="1.5"/><circle cx="13" cy="13" r="9" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1"/><text x="13" y="17.5" text-anchor="middle" font-size="11" font-weight="900" fill="#78350f" font-family="system-ui">1</text></svg>`,
    `<svg viewBox="0 0 26 26" width="26" height="26"><circle cx="13" cy="13" r="12" fill="#94a3b8" stroke="#64748b" stroke-width="1.5"/><circle cx="13" cy="13" r="9" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1"/><text x="13" y="17.5" text-anchor="middle" font-size="11" font-weight="900" fill="#0f172a" font-family="system-ui">2</text></svg>`,
    `<svg viewBox="0 0 26 26" width="26" height="26"><circle cx="13" cy="13" r="12" fill="#c2410c" stroke="#9a3412" stroke-width="1.5"/><circle cx="13" cy="13" r="9" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><text x="13" y="17.5" text-anchor="middle" font-size="11" font-weight="900" fill="white" font-family="system-ui">3</text></svg>`,
  ];
  const medal = (i) => MEDAL_SVG[i] || `<span class="be-rank-num">${i+1}</span>`;
  const scoreColor = s => s >= 80 ? '#16a34a' : s >= 50 ? '#d97706' : '#dc2626';

  // Sliding window: 1 past + current + 4 future = 6, with arrows
  const nowD = new Date();
  const currentMonth = nowD.toISOString().slice(0, 7);
  // Window start = 1 month before current + user offset
  const winStart = -1 + _beWinOffset;
  const visible6 = Array.from({length: 6}, (_, i) => {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() + winStart + i, 1);
    return d.toISOString().slice(0, 7);
  });
  const canLeft  = _beWinOffset > -24;
  const canRight = _beWinOffset < 24;
  const arrowBtn = (dir, disabled) =>
    `<button class="be-arrow-btn ${disabled ? 'disabled' : ''}"
      onclick="${disabled ? '' : `beShiftWindow(${dir})`}">${dir < 0 ? '‹' : '›'}</button>`;

  const monthTabs = `
    ${arrowBtn(-1, !canLeft)}
    ${visible6.map(m => {
      const isCurrent = m === currentMonth;
      const isSelected = m === month;
      return `<button class="be-month-tab ${isSelected ? 'active' : ''} ${isCurrent && !isSelected ? 'be-month-tab-current' : ''}"
        onclick="beSetMonth('${m}')">
        ${fmtMonth(m)}${isCurrent ? '<span class="be-tab-now">сейчас</span>' : ''}
      </button>`;
    }).join('')}
    ${arrowBtn(1, !canRight)}`;

  // Podium (top 3)
  const top3 = rankings.slice(0, 3);
  const rest = rankings.slice(3);
  const champion = top3[0];

  let podiumHtml = '';
  if (!champion) {
    podiumHtml = `<div class="be-empty"><div style="font-size:48px">📋</div><div>В этом месяце нет данных</div><div style="font-size:13px;color:#9ca3af;margin-top:6px">Задачи с дедлайном в этом месяце ещё не назначены</div></div>`;
  } else {
    // Champion card
    const av = champion.avatar_img
      ? `<img src="${champion.avatar_img}" class="be-champ-img">`
      : `<div class="be-champ-avatar" style="background:${champion.avatar_color||'#6366f1'}">${champion.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>`;

    podiumHtml = `
      <div class="be-champion-card">
        <div class="be-champion-crown">
          <svg viewBox="0 0 80 52" width="68" height="46">
            <path d="M6 44 L16 13 L30 31 L40 4 L50 31 L64 13 L74 44 Z" fill="#fbbf24" stroke="#d97706" stroke-width="2" stroke-linejoin="round"/>
            <rect x="6" y="42" width="68" height="8" rx="3" fill="#d97706"/>
            <circle cx="40" cy="6" r="5.5" fill="#dc2626" stroke="#991b1b" stroke-width="1"/>
            <circle cx="14" cy="14" r="4" fill="#60a5fa" stroke="#2563eb" stroke-width="1"/>
            <circle cx="66" cy="14" r="4" fill="#60a5fa" stroke="#2563eb" stroke-width="1"/>
            <circle cx="38.5" cy="4.5" r="1.8" fill="rgba(255,255,255,0.7)"/>
          </svg>
        </div>
        ${av}
        <div class="be-champ-name">${champion.name}</div>
        <div class="be-champ-score" style="color:${scoreColor(champion.score)}">${champion.score}%</div>
        <div class="be-champ-label">Эффективность</div>
        <div class="be-champ-stats">
          <div class="be-champ-stat"><span class="be-champ-stat-val" style="color:#16a34a">${champion.doneOnTime}</span><span class="be-champ-stat-lbl">в срок</span></div>
          <div class="be-champ-stat"><span class="be-champ-stat-val" style="color:#d97706">${champion.doneLate}</span><span class="be-champ-stat-lbl">с опозданием</span></div>
          <div class="be-champ-stat"><span class="be-champ-stat-val" style="color:#dc2626">${champion.overdue}</span><span class="be-champ-stat-lbl">просрочено</span></div>
          <div class="be-champ-stat"><span class="be-champ-stat-val" style="color:white">${champion.total}</span><span class="be-champ-stat-lbl">всего задач</span></div>
        </div>
        <div class="be-champ-badge">Лучший сотрудник · ${fmtMonth(month)}</div>
      </div>

      ${top3.length > 1 ? `
      <div class="be-silver-bronze">
        ${top3.slice(1).map((u, i) => {
          const av2 = u.avatar_img
            ? `<img src="${u.avatar_img}" class="be-sb-img">`
            : u.avatar_img ? `<img src="${u.avatar_img}" class="be-sb-img">` : `<div class="be-sb-avatar" style="background:${u.avatar_color||'#6366f1'}">${u.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>`;
          return `<div class="be-sb-card be-sb-${i===0?'silver':'bronze'}">
            <div class="be-sb-medal">${i===0
              ? `<svg viewBox="0 0 44 56" width="40" height="50">
                  <polygon points="16,0 22,0 22,20 10,14" fill="#475569"/>
                  <polygon points="22,0 28,0 34,14 22,20" fill="#94a3b8"/>
                  <circle cx="22" cy="38" r="16" fill="#cbd5e1" stroke="#94a3b8" stroke-width="2"/>
                  <circle cx="22" cy="38" r="12" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
                  <text x="22" y="43.5" text-anchor="middle" font-size="15" font-weight="900" fill="#0f172a" font-family="system-ui">2</text>
                </svg>`
              : `<svg viewBox="0 0 44 56" width="40" height="50">
                  <polygon points="16,0 22,0 22,20 10,14" fill="#9a3412"/>
                  <polygon points="22,0 28,0 34,14 22,20" fill="#c2410c"/>
                  <circle cx="22" cy="38" r="16" fill="#fb923c" stroke="#c2410c" stroke-width="2"/>
                  <circle cx="22" cy="38" r="12" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
                  <text x="22" y="43.5" text-anchor="middle" font-size="15" font-weight="900" fill="white" font-family="system-ui">3</text>
                </svg>`
            }</div>
            ${av2}
            <div class="be-sb-name">${u.name}</div>
            <div class="be-sb-score" style="color:${scoreColor(u.score)}">${u.score}%</div>
            <div style="font-size:11px;color:var(--text-muted)">${u.doneOnTime} из ${u.total} в срок</div>
          </div>`;
        }).join('')}
      </div>` : ''}`;
  }

  // Full table
  const tableRows = rankings.map((u, i) => {
    const av = u.avatar_img
      ? `<img src="${u.avatar_img}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">`
      : u.avatar_img ? `<img src="${u.avatar_img}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">` : `<div class="be-tbl-avatar" style="background:${u.avatar_color||'#6366f1'}">${u.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>`;
    return `<tr class="be-tbl-row ${i===0?'be-tbl-top':''}">
      <td class="be-tbl-rank">${i < 3 ? medal(i) : i+1}</td>
      <td class="be-tbl-user">${av}<span>${u.name}</span></td>
      <td class="be-tbl-num">${u.total}</td>
      <td class="be-tbl-num be-green">${u.doneOnTime}</td>
      <td class="be-tbl-num be-orange">${u.doneLate}</td>
      <td class="be-tbl-num be-red">${u.overdue}</td>
      <td class="be-tbl-score">
        ${scoreBar(u.score)}
        <span style="color:${scoreColor(u.score)};font-weight:700;font-size:13px">${u.score}%</span>
      </td>
    </tr>`;
  }).join('');

  // History winners
  const historyHtml = history.filter(h => h.winner && h.month !== month).map(h => {
    const w = h.winner;
    const av = w.avatar_img
      ? `<img src="${w.avatar_img}" class="be-hist-img">`
      : `<div class="be-hist-avatar" style="background:${w.avatar_color||'#6366f1'}">${w.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div>`;
    return `<div class="be-hist-card" onclick="beSetMonth('${h.month}')">
      <div class="be-hist-month">${fmtMonth(h.month)}</div>
      ${av}
      <div class="be-hist-name">${w.name}</div>
      <div class="be-hist-score" style="color:${scoreColor(w.score)}">${w.score}%</div>
    </div>`;
  }).join('');

  content.innerHTML = `
    <div class="be-page">
      <div class="be-month-bar">${monthTabs}</div>

      <div class="be-top-section">
        ${podiumHtml}
      </div>

      ${rankings.length > 0 ? `
      <div class="be-table-section">
        <div class="be-section-title">Таблица рейтинга · ${fmtMonth(month)}</div>
        <div class="be-table-wrap">
          <table class="be-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Сотрудник</th>
                <th title="Всего задач с дедлайном в месяце">Задач</th>
                <th title="Выполнено в срок" style="color:#16a34a">В срок</th>
                <th title="Выполнено с опозданием" style="color:#d97706">С опозд.</th>
                <th title="Просрочено / не выполнено" style="color:#dc2626">Просроч.</th>
                <th>Эффективность</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>` : ''}

      ${historyHtml ? `
      <div class="be-history-section">
        <div class="be-section-title">История победителей</div>
        <div class="be-history-row">${historyHtml}</div>
      </div>` : ''}

      <div class="be-formula-note">
        Эффективность = (задачи в срок × 100% + задачи с опозданием × 50%) / всего задач с дедлайном в месяце
      </div>
    </div>`;
}

function filterTeamCards(q) {
  const ql = q.toLowerCase().trim();
  document.querySelectorAll('#team-grid .member-card').forEach(card => {
    card.style.display = !ql || card.dataset.name.includes(ql) ? '' : 'none';
  });
}

function filterAssigneeChips(q) {
  const ql = q.toLowerCase().trim();
  document.querySelectorAll('#f-assignees .assignee-chip').forEach(chip => {
    chip.style.display = !ql || chip.dataset.name.includes(ql) ? '' : 'none';
  });
}

// ─── Finance Page ─────────────────────────────────────────────────────────────
const EXP_CATEGORIES = {
  admin: 'Админ. расходы', salary: 'ЗП', taxi: 'Услуга такси',
  master: 'Услуга мастера', household: 'Хозтовары', stationery: 'Канцелярские',
  utilities: 'Коммунальные', equipment: 'Орг. техника', internet: 'Интернет',
  ads: 'Реклама', subscriptions: 'Подписки', food: 'Питание', other: 'Разное',
};
const EXP_CATEGORY_COLORS = {
  admin:'#6366f1', salary:'#16a34a', taxi:'#f59e0b', master:'#8b5cf6',
  household:'#06b6d4', stationery:'#3b82f6', utilities:'#0891b2',
  equipment:'#64748b', internet:'#0ea5e9', ads:'#ec4899',
  subscriptions:'#d97706', food:'#22c55e', other:'#94a3b8',
};

const FIN_STATUS       = { paid: 'Оплачено', unpaid: 'Не оплачено', partial: 'Частично' };
const FIN_STATUS_COLOR = { paid: '#16a34a', unpaid: '#dc2626', partial: '#d97706' };
const FIN_TYPE         = { cash: 'Наличными', bank: 'Банк', alif: 'Alif', dushanbecity: 'DC' };
const FIN_TYPE_COLOR   = { cash: '#b45309', bank: '#0891b2', alif: '#16a34a', dushanbecity: '#1d4ed8' };
const FIN_CURRENCIES   = ['TJS', 'USD', 'RUB', 'EUR'];

let _finMonth  = (() => { try { return sessionStorage.getItem('fin_month') || new Date().toISOString().slice(0, 7); } catch { return new Date().toISOString().slice(0, 7); } })();
let _finTab    = (() => { try { return sessionStorage.getItem('fin_tab') || 'month'; } catch { return 'month'; } })();
let _finFilter = { status: '', payment_type: '', search: '' };

const fmtMoney = v => {
  const n = Number(v||0);
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // narrow no-break space
};

async function renderFinancePage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';
  // One-time cleanup of future auto-copied records
  if (!window._finCleanedUp) {
    window._finCleanedUp = true;
    DEL('/finance/cleanup-future').catch(() => {});
  }
  try {
    if (_finTab === 'annual')   { await _renderFinanceAnnual(); return; }
    if (_finTab === 'projects') { await _renderFinanceProjects(); return; }
    if (_finTab === 'expenses') { await _renderExpensesPage(); return; }
    const params = new URLSearchParams({ month: _finMonth });
    if (_finFilter.status)       params.set('status', _finFilter.status);
    if (_finFilter.payment_type) params.set('payment_type', _finFilter.payment_type);
    if (_finFilter.search)       params.set('search', _finFilter.search);
    let rows = await GET('/finance?' + params.toString());

    // Auto-copy recurring records — ONLY for current month or next month, not further
    if (!_finFilter.status && !_finFilter.payment_type && !_finFilter.search) {
      const now = new Date();
      const curReal  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      const nextReal = (() => { const d=new Date(now.getFullYear(),now.getMonth()+1,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
      // Only copy if target month is current or next — never further into the future
      if (_finMonth <= nextReal) {
        const [y, m] = _finMonth.split('-');
        const prevDate  = new Date(+y, +m - 2, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
        const prevRows  = await GET('/finance?month=' + prevMonth);
        const recurring = prevRows.filter(r => r.is_recurring);
        const existingRecurNames = new Set(rows.filter(r => r.is_recurring).map(r => r.project_name.toLowerCase()));
        const toCreate = recurring.filter(r => !existingRecurNames.has(r.project_name.toLowerCase()));
        if (toCreate.length > 0) {
          await Promise.all(toCreate.map(r =>
            POST('/finance', {
              project_id: r.project_id, project_name: r.project_name,
              service_amount: r.service_amount, paid_amount: 0,
              status: 'unpaid', payment_type: r.payment_type,
              comment: r.comment, month: _finMonth,
              client_name: r.client_name||'', client_phone: r.client_phone||'',
              is_recurring: 1,
            }).catch(() => {})
          ));
          rows = await GET('/finance?' + params.toString());
          toast(`Добавлено ${toCreate.length} повторяющихся записей`, 'success');
        }
      }
    }

    _renderFinance(rows);
    // Load section summary async
    GET('/finance/section-summary?month=' + _finMonth).then(s => {
      const el = document.getElementById('fin-section-summary');
      if (!el) return;
      const block = (title, d, color, page) => {
        const pct = d.svc>0 ? Math.round(d.paid/d.svc*100) : 0;
        const debt = d.svc - d.paid;
        return `<div class="fin-sum-card" style="cursor:pointer;border-left:4px solid ${color}" onclick="navigateTo('${page}')">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700;color:${color}">${title}</div>
            <div style="font-size:11px;color:var(--text-muted)">${d.cnt} записей</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
            <div><div style="font-size:16px;font-weight:800">${fmtMoney(d.svc)}</div><div style="font-size:10px;color:var(--text-muted)">Сумма</div></div>
            <div><div style="font-size:16px;font-weight:800;color:#16a34a">${fmtMoney(d.paid)}</div><div style="font-size:10px;color:var(--text-muted)">Оплачено</div></div>
            <div><div style="font-size:16px;font-weight:800;color:${debt>0?'#dc2626':'#16a34a'}">${fmtMoney(debt)}</div><div style="font-size:10px;color:var(--text-muted)">Долг</div></div>
          </div>
          <div class="fin-progress-bar-bg"><div class="fin-progress-bar-fill" style="width:${pct}%;background:${pct>=80?'#16a34a':pct>=50?'#d97706':'#dc2626'}"></div></div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px;text-align:right">${pct}% собрано</div>
        </div>`;
      };
      const hasData = s.finance.svc>0||s.b2c.svc>0||s.kids.svc>0;
      el.innerHTML = hasData ? `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:10px">Сводка по направлениям · ${_finMonth}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
          ${block('Финансы (Проекты)', s.finance, '#881337', 'finance')}
          ${block('Финансы В2С', s.b2c, '#6366f1', 'b2c')}
          ${block('Финансы Kids', s.kids, '#16a34a', 'kids')}
        </div>` : '';
    }).catch(() => {});
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`;
  }
}

function _renderFinance(rows) {
  const content = document.getElementById('page-content');
  const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const [y,m] = _finMonth.split('-');
  const monthLabel = MONTH_NAMES[+m-1] + ' ' + y;

  const fmtYM = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const prevMonth = () => fmtYM(new Date(+y, +m-2, 1));
  const nextMonth = () => fmtYM(new Date(+y, +m,   1));

  const tabs = [
    { key:'month', label:'Доходы' },
    { key:'expenses', label:'Расходы' }, { key:'projects', label:'По проектам' },
    { key:'annual', label:'Годовой отчёт' },
  ].map(t=>`<button class="fin-tab ${_finTab===t.key?'active':''}" onclick="finSetTab('${t.key}')">${t.label}</button>`).join('');

  const filterBar = `
    <div class="fin-filter-bar">
      <div class="fin-search-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="fin-search-input" id="fin-search-input" placeholder="Поиск по проекту или клиенту..." value="${_escHtml(_finFilter.search)}"
          oninput="_finLiveSearch(this.value)">
      </div>
      <select class="fin-filter-sel" onchange="_finFilter.status=this.value; renderFinancePage()">
        <option value="">Все статусы</option>
        ${Object.entries(FIN_STATUS).map(([k,v])=>`<option value="${k}" ${_finFilter.status===k?'selected':''}>${v}</option>`).join('')}
      </select>
      <select class="fin-filter-sel" onchange="_finFilter.payment_type=this.value; renderFinancePage()">
        <option value="">Все типы оплаты</option>
        ${Object.entries(FIN_TYPE).map(([k,v])=>`<option value="${k}" ${_finFilter.payment_type===k?'selected':''}>${v}</option>`).join('')}
      </select>
      ${(_finFilter.status||_finFilter.payment_type||_finFilter.search)
        ? `<button class="btn btn-outline btn-sm" onclick="_finFilter={status:'',payment_type:'',search:''};renderFinancePage()">Сбросить</button>` : ''}
    </div>`;

  // Summary
  const totalService = rows.reduce((s,r)=>s+(+r.service_amount||0),0);
  const totalPaid    = rows.reduce((s,r)=>s+(+r.paid_amount||0),0);
  const totalDebt    = totalService - totalPaid;
  const paidCount    = rows.filter(r=>r.status==='paid').length;
  const unpaidCount  = rows.filter(r=>r.status==='unpaid').length;
  const partialCount = rows.filter(r=>r.status==='partial').length;

  const tableRows = rows.map((r,i) => {
    const isB2C = r.is_b2c === 1 || r.is_b2c === 2;
    const debt = +r.service_amount - +r.paid_amount;
    const pmts = r.payments || [];
    return `<tr class="fin-row ${r.is_recurring?'fin-row-recurring':''} ${r.is_b2c===1?'fin-row-b2c':r.is_b2c===2?'fin-row-kids':''}">
      <td class="fin-td fin-num">${isB2C?`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${r.is_b2c===2?'#16a34a':'#6366f1'}" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`:i+1}${r.is_recurring?'<span class="fin-recur-dot">↻</span>':''}</td>
      <td class="fin-td fin-project">
        <div>${_escHtml(r.project_name)}${isB2C?` <span style="font-size:10px;background:${r.is_b2c===2?'#dcfce7':'#ede9fe'};color:${r.is_b2c===2?'#16a34a':'#6d28d9'};padding:1px 5px;border-radius:4px;font-weight:600">авто</span>`:''}</div>
        ${r.client_name?`<div style="font-size:11px;color:var(--text-muted)">${_escHtml(r.client_name)}${r.client_phone?' · '+_escHtml(r.client_phone):''}</div>`:''}
      </td>
      <td class="fin-td fin-money">${fmtMoney(r.service_amount)}</td>
      <td class="fin-td fin-money" style="color:#16a34a">
        ${fmtMoney(r.paid_amount)}
        ${pmts.length>0?`<span class="fin-pmts-badge" onclick="openPaymentsModal(${r.id})" title="Платежей: ${pmts.length}">${pmts.length}п</span>`:''}
      </td>
      <td class="fin-td fin-money" style="color:${debt>0?'#dc2626':'#16a34a'}">${fmtMoney(debt)}</td>
      <td class="fin-td"><span class="fin-status-badge" style="background:${FIN_STATUS_COLOR[r.status]}22;color:${FIN_STATUS_COLOR[r.status]}">${FIN_STATUS[r.status]||r.status}</span></td>
      <td class="fin-td"><span class="fin-type-badge" style="background:${FIN_TYPE_COLOR[r.payment_type]||'#64748b'}22;color:${FIN_TYPE_COLOR[r.payment_type]||'#64748b'}">${FIN_TYPE[r.payment_type]||r.payment_type}</span></td>
      <td class="fin-td fin-comment">${_escHtml(r.comment||'—')}</td>
      <td class="fin-td fin-actions">
        ${isB2C ? `<button class="btn btn-outline btn-sm" onclick="navigateTo('${r.is_b2c===2?'kids':'b2c'}')" style="font-size:11px;padding:3px 8px;white-space:nowrap">Открыть →</button>` : `
        <button class="fin-btn-edit" onclick="openFinanceModal(${r.id})" title="Редактировать">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="fin-btn-edit" onclick="openPaymentsModal(${r.id})" title="История платежей и изменений" style="color:#0891b2;border-color:#bae6fd">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        </button>
        <button class="fin-btn-del" onclick="deleteFinance(${r.id})" title="Удалить">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>`}
      </td>
    </tr>`;
  }).join('');

  content.innerHTML = `
    <div class="fin-page">
      <!-- Tabs + Header -->
      <div class="fin-tabs-bar">${tabs}</div>
      <div class="fin-header">
        <div class="fin-month-nav">
          <button class="fin-nav-btn" onclick="finSetMonth('${prevMonth()}')">‹</button>
          <span class="fin-month-title">${monthLabel}</span>
          <button class="fin-nav-btn" onclick="finSetMonth('${nextMonth()}')">›</button>
          ${_finMonth !== new Date().toISOString().slice(0,7) ? `<button class="btn btn-outline btn-sm" onclick="finSetMonth('${new Date().toISOString().slice(0,7)}')" style="font-size:11px;padding:4px 10px;margin-left:6px">Этот месяц</button>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline" onclick="exportFinanceExcel()" style="display:inline-flex;align-items:center;gap:6px" title="Скачать Excel">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Excel
          </button>
          <button class="btn btn-outline" onclick="exportFinancePDF()" style="display:inline-flex;align-items:center;gap:6px" title="Экспорт PDF">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> PDF
          </button>
          <button class="btn btn-blue" onclick="openFinanceModal()">＋ Добавить запись</button>
        </div>
      </div>
      ${filterBar}

      <!-- Summary cards -->
      <div class="fin-summary">
        <div class="fin-sum-card">
          <div class="fin-sum-lbl">Сумма услуг</div>
          <div class="fin-sum-val">${fmtMoney(totalService)}</div>
          <div class="fin-sum-sub">${rows.length} записей</div>
        </div>
        <div class="fin-sum-card fin-sum-green">
          <div class="fin-sum-lbl">Оплачено</div>
          <div class="fin-sum-val" style="color:#16a34a">${fmtMoney(totalPaid)}</div>
          <div class="fin-sum-sub">${paidCount} полностью · ${partialCount} частично</div>
        </div>
        <div class="fin-sum-card fin-sum-red">
          <div class="fin-sum-lbl">Остаток (задолженность)</div>
          <div class="fin-sum-val" style="color:${totalDebt>0?'#dc2626':'#16a34a'}">${fmtMoney(totalDebt)}</div>
          <div class="fin-sum-sub">${unpaidCount} не оплачено</div>
        </div>
        <div class="fin-sum-card">
          <div class="fin-sum-lbl">Процент оплаты</div>
          <div class="fin-sum-val" style="color:${totalService>0&&totalPaid/totalService>=0.8?'#16a34a':'#d97706'}">${totalService>0?Math.round(totalPaid/totalService*100):0}%</div>
          <div class="fin-progress-bar-bg"><div class="fin-progress-bar-fill" style="width:${totalService>0?Math.round(totalPaid/totalService*100):0}%"></div></div>
        </div>
      </div>

      <!-- Table -->
      ${rows.length === 0
        ? `<div class="empty-state" style="margin-top:40px"><div class="empty-icon"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><h3>Нет записей</h3><p>Нажмите «Добавить запись» чтобы начать</p></div>`
        : `<div class="fin-table-wrap">
            <table class="fin-table" id="fin-main-table">
              <thead>
                <tr>
                  <th>#</th><th>Проект / Клиент</th><th>Сумма услуги</th><th>Оплачено</th><th>Остаток</th>
                  <th>Статус</th><th>Тип оплаты</th><th>Комментарий</th><th style="width:90px"></th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
              <tfoot>
                <tr class="fin-total-row">
                  <td colspan="2" class="fin-td fin-total-lbl">ИТОГО</td>
                  <td class="fin-td fin-money fin-total">${fmtMoney(totalService)}</td>
                  <td class="fin-td fin-money fin-total" style="color:#16a34a">${fmtMoney(totalPaid)}</td>
                  <td class="fin-td fin-money fin-total" style="color:${totalDebt>0?'#dc2626':'#16a34a'}">${fmtMoney(totalDebt)}</td>
                  <td colspan="4"></td>
                </tr>
              </tfoot>
            </table>
          </div>`}

      <!-- Section summary blocks (replaces chart) -->
      <div id="fin-section-summary" style="margin-top:20px">
        <div style="color:#9ca3af;font-size:12px;padding:10px 0;text-align:center">Загрузка сводки...</div>
      </div>
    </div>`;
}

function _buildFinLineChart(annualData, currentMonth) {
  const MONTHS     = ['Янв','Фев','Мар','Апр','Май','Июнь','Июль','Авг','Сен','Окт','Ноя','Дек'];
  const MONTHS_FULL= ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const year = currentMonth.slice(0,4);
  const W = 600, H = 180, pL = 36, pB = 28, pT = 16, pR = 16;
  const iW = W-pL-pR, iH = H-pB-pT;
  const months12 = Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
  const pts = months12.map((mo,i) => {
    const r = annualData.find(d=>d.month===`${year}-${mo}`)||{total_service:0,total_paid:0,count:0};
    return { x: pL+i/11*iW, svc:+r.total_service||0, paid:+r.total_paid||0, count:+r.count||0, mo, idx:i, isCurrent:`${year}-${mo}`===currentMonth };
  });
  const maxV = Math.max(...pts.map(p=>Math.max(p.svc,p.paid)), 1);
  const yv = v => pT + (1 - v/maxV)*iH;

  // Store data for tooltip
  window._finChartPts = pts;
  window._finChartMonths = MONTHS_FULL;

  const grid = [0,0.25,0.5,0.75,1].map(f => {
    const yy = pT+(1-f)*iH;
    const val = Math.round(maxV*f);
    return `<line x1="${pL}" y1="${yy}" x2="${W-pR}" y2="${yy}" stroke="#e2e8f0" stroke-width="${f===0?1:0.8}"/>
            ${f>0?`<text x="${pL-4}" y="${yy+3}" text-anchor="end" font-size="9" fill="#94a3b8">${fmtMoney(val)}</text>`:''}`;
  }).join('');
  const polyline = (key,color) => `<polyline points="${pts.map(p=>`${p.x},${yv(p[key])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const dots = (key,color,r_val) => pts.map(p => {
    const r = p.isCurrent ? 5 : 3.5;
    return `<circle cx="${p.x}" cy="${yv(p[key])}" r="${r}" fill="${color}" stroke="white" stroke-width="${p.isCurrent?2:1.5}"/>`;
  }).join('');
  const labels = pts.map(p => `<text x="${p.x}" y="${H-6}" text-anchor="middle" font-size="9" fill="${p.isCurrent?'#881337':'#94a3b8'}" font-weight="${p.isCurrent?'700':'400'}">${MONTHS[+p.mo-1]}</text>`).join('');

  // Invisible hover zones for each month column
  const colW = iW / 11;
  const hoverZones = pts.map(p => `<rect x="${p.x - colW/2}" y="${pT}" width="${colW}" height="${iH}" fill="transparent" style="cursor:pointer"
    onmouseenter="showFinChartTooltip(event,${p.idx})" onmousemove="moveFinChartTooltip(event)" onmouseleave="hideFinChartTooltip()"/>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block" id="fin-line-chart-svg">
    ${grid}${polyline('svc','#881337')}${polyline('paid','#16a34a')}${dots('svc','#881337')}${dots('paid','#16a34a')}${labels}${hoverZones}
  </svg>`;
}

function showFinChartTooltip(event, idx) {
  const p = (window._finChartPts||[])[idx]; if (!p) return;
  const months = window._finChartMonths||[];
  const debt = p.svc - p.paid;
  let el = document.getElementById('fin-chart-tip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fin-chart-tip';
    el.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#f1f5f9;border-radius:10px;padding:12px 16px;font-size:12px;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.35);min-width:190px';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div style="font-weight:700;font-size:13px;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:8px">${months[+p.mo-1]||p.mo}</div>
    <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="color:#94a3b8">Проектов</span><span style="font-weight:700">${p.count}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="color:#94a3b8">Сумма услуг</span><span style="font-weight:700;color:#f87171">${fmtMoney(p.svc)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="color:#94a3b8">Оплачено</span><span style="font-weight:700;color:#4ade80">${fmtMoney(p.paid)}</span></div>
    <div style="display:flex;justify-content:space-between;border-top:1px solid #334155;padding-top:6px;margin-top:4px"><span style="color:#94a3b8">Задолженность</span><span style="font-weight:700;color:${debt>0?'#f87171':'#4ade80'}">${fmtMoney(debt)}</span></div>`;
  el.style.display = 'block';
  _moveFinTip(el, event);
}
function moveFinChartTooltip(event) {
  const el = document.getElementById('fin-chart-tip');
  if (el && el.style.display !== 'none') _moveFinTip(el, event);
}
function hideFinChartTooltip() {
  const el = document.getElementById('fin-chart-tip');
  if (el) el.style.display = 'none';
}
function _moveFinTip(el, e) {
  const w = el.offsetWidth||200, h = el.offsetHeight||120;
  let x = e.clientX + 14, y = e.clientY - h/2;
  if (x + w > window.innerWidth - 10) x = e.clientX - w - 14;
  if (y < 10) y = 10;
  if (y + h > window.innerHeight - 10) y = window.innerHeight - h - 10;
  el.style.left = x + 'px'; el.style.top = y + 'px';
}

async function finSetMonth(m) {
  _finMonth = m;
  try { sessionStorage.setItem('fin_month', m); } catch {}
  renderFinancePage();
}
function finSetTab(t) {
  _finTab = t;
  try { sessionStorage.setItem('fin_tab', t); } catch {}
  renderFinancePage();
}

function _finLiveSearch(q) {
  _finFilter.search = q;
  const ql = q.toLowerCase().trim();
  document.querySelectorAll('#fin-main-table .fin-row').forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = !ql || text.includes(ql) ? '' : 'none';
  });
  // Update totals visibility
  const visible = [...document.querySelectorAll('#fin-main-table .fin-row')].filter(r=>r.style.display!=='none');
  const totalFooter = document.getElementById('fin-total-footer');
  if (totalFooter && ql) {
    let svc=0, paid=0;
    visible.forEach(row => {
      const cells = row.querySelectorAll('.fin-money');
      if (cells[0]) svc  += parseFloat(cells[0].textContent.replace(/\s/g,''))||0;
      if (cells[1]) paid += parseFloat(cells[1].textContent.replace(/\s/g,''))||0;
    });
  }
}

async function _renderExpensesPage() {
  const content = document.getElementById('page-content');
  const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const [y,m] = _finMonth.split('-');
  const fmtYM = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const prevMonth = () => fmtYM(new Date(+y, +m-2, 1));
  const nextMonth = () => fmtYM(new Date(+y, +m, 1));
  const monthLabel = MONTH_NAMES[+m-1] + ' ' + y;
  const tabs = [
    { key:'month', label:'Доходы' }, { key:'expenses', label:'Расходы' },
    { key:'projects', label:'По проектам' }, { key:'annual', label:'Годовой отчёт' },
  ].map(t=>`<button class="fin-tab ${_finTab===t.key?'active':''}" onclick="finSetTab('${t.key}')">${t.label}</button>`).join('');

  const [expenses, finRows] = await Promise.all([
    GET('/expenses?month=' + _finMonth),
    GET('/finance?month=' + _finMonth).catch(()=>[])
  ]);

  const totalExp = expenses.reduce((s,e)=>s+(+e.amount||0),0);
  const totalInc = finRows.reduce((s,r)=>s+(+r.service_amount||0),0);
  const totalPaid = finRows.reduce((s,r)=>s+(+r.paid_amount||0),0);
  const balance = totalPaid - totalExp;

  const rows = expenses.map((e,i) => `
    <tr class="fin-row">
      <td class="fin-td fin-num">${i+1}</td>
      <td class="fin-td fin-project">${_escHtml(e.title)}</td>
      <td class="fin-td fin-money" style="color:#dc2626">${fmtMoney(e.amount)}</td>
      <td class="fin-td">
        <span class="fin-type-badge" style="background:${EXP_CATEGORY_COLORS[e.category]||'#94a3b8'}22;color:${EXP_CATEGORY_COLORS[e.category]||'#94a3b8'}">${EXP_CATEGORIES[e.category]||e.category}</span>
      </td>
      <td class="fin-td fin-comment">${_escHtml(e.comment||'—')}</td>
      <td class="fin-td fin-actions">
        <button class="fin-btn-edit" onclick="openExpenseModal(${e.id})" title="Редактировать">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="fin-btn-del" onclick="deleteExpense(${e.id})" title="Удалить">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </td>
    </tr>`).join('');

  content.innerHTML = `<div class="fin-page">
    <div class="fin-tabs-bar">${tabs}</div>
    <div class="fin-header">
      <div class="fin-month-nav">
        <button class="fin-nav-btn" onclick="finSetMonth('${prevMonth()}')">‹</button>
        <span class="fin-month-title">${monthLabel}</span>
        <button class="fin-nav-btn" onclick="finSetMonth('${nextMonth()}')">›</button>
        ${_finMonth !== new Date().toISOString().slice(0,7) ? `<button class="btn btn-outline btn-sm" onclick="finSetMonth('${new Date().toISOString().slice(0,7)}')" style="font-size:11px;padding:4px 10px;margin-left:6px">Этот месяц</button>` : ''}
      </div>
      <button class="btn btn-blue" onclick="openExpenseModal()">＋ Добавить расход</button>
    </div>

    <!-- Balance summary -->
    <div class="fin-summary" style="grid-template-columns:repeat(3,1fr)">
      <div class="fin-sum-card">
        <div class="fin-sum-lbl">Доходы (оплачено)</div>
        <div class="fin-sum-val" style="color:#16a34a">${fmtMoney(totalPaid)}</div>
        <div class="fin-sum-sub">Услуги: ${fmtMoney(totalInc)}</div>
      </div>
      <div class="fin-sum-card">
        <div class="fin-sum-lbl">Расходы</div>
        <div class="fin-sum-val" style="color:#dc2626">${fmtMoney(totalExp)}</div>
        <div class="fin-sum-sub">${expenses.length} позиций</div>
      </div>
      <div class="fin-sum-card" style="border-color:${balance>=0?'#bbf7d0':'#fecaca'}">
        <div class="fin-sum-lbl">Баланс (Доходы − Расходы)</div>
        <div class="fin-sum-val" style="color:${balance>=0?'#16a34a':'#dc2626'}">${balance>=0?'+':''}${fmtMoney(balance)}</div>
        <div class="fin-sum-sub">${balance>=0?'Прибыль':'Убыток'}</div>
      </div>
    </div>

    <!-- Expenses table -->
    ${expenses.length === 0
      ? `<div class="empty-state" style="margin-top:40px"><div class="empty-icon"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><polyline points="23 7 13.5 15.5 8.5 10.5 1 17"/><polyline points="17 7 23 7 23 13"/></svg></div><h3>Нет расходов</h3><p>Нажмите «Добавить расход» чтобы начать</p></div>`
      : `<div class="fin-table-wrap">
          <table class="fin-table">
            <thead><tr><th>#</th><th>Название</th><th>Сумма</th><th>Категория</th><th>Комментарий</th><th style="width:70px"></th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="fin-total-row">
              <td colspan="2" class="fin-td fin-total-lbl">ИТОГО</td>
              <td class="fin-td fin-money fin-total" style="color:#dc2626">${fmtMoney(totalExp)}</td>
              <td colspan="3"></td>
            </tr></tfoot>
          </table>
        </div>`}
  </div>`;
}

function openExpenseModal(id = null) {
  let exp = null;
  if (id) {
    GET('/expenses?month=' + _finMonth).then(all => {
      exp = all.find(e => e.id === id);
      if (exp) _showExpenseModal(exp);
    });
    return;
  }
  _showExpenseModal(null);
}

function _showExpenseModal(exp) {
  const isEdit = !!exp;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:460px">
        <div class="modal-header">
          <div class="modal-title">${isEdit?'Редактировать расход':'Новый расход'}</div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="field"><label>Название расхода</label>
            <input id="exp-title" class="input" value="${_escHtml(exp?.title||'')}" placeholder="Название...">
          </div>
          <div class="form-row">
            <div class="field"><label>Сумма</label>
              <input id="exp-amount" class="input" type="number" min="0" value="${exp?.amount||''}" placeholder="0">
            </div>
            <div class="field"><label>Месяц</label>
              <input id="exp-month" class="input" type="month" value="${exp?.month||_finMonth}">
            </div>
          </div>
          <div class="field"><label>Категория</label>
            <select id="exp-category" class="input">
              ${Object.entries(EXP_CATEGORIES).map(([k,v])=>`<option value="${k}" ${(exp?.category||'other')===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Комментарий</label>
            <textarea id="exp-comment" class="input" rows="2" placeholder="Необязательно...">${_escHtml(exp?.comment||'')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          ${isEdit?`<button class="btn btn-danger" onclick="deleteExpense(${exp.id})">Удалить</button>`:''}
          <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
          <button class="btn btn-blue" onclick="saveExpense(${isEdit?exp.id:'null'})">Сохранить</button>
        </div>
      </div>
    </div>`;
}

async function saveExpense(id) {
  const title = document.getElementById('exp-title').value.trim();
  if (!title) return toast('Введите название', 'error');
  const body = {
    title, amount: parseFloat(document.getElementById('exp-amount').value)||0,
    category: document.getElementById('exp-category').value,
    comment: document.getElementById('exp-comment').value.trim(),
    month: document.getElementById('exp-month').value || _finMonth,
  };
  try {
    if (id && id !== 'null') await PUT(`/expenses/${id}`, body);
    else await POST('/expenses', body);
    closeModal();
    if (body.month !== _finMonth) _finMonth = body.month;
    renderFinancePage();
    toast('Сохранено', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteExpense(id) {
  if (!confirm('Удалить расход?')) return;
  try {
    await DEL(`/expenses/${id}`);
    closeModal();
    renderFinancePage();
    toast('Удалено', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function _renderFinanceProjects() {
  const content = document.getElementById('page-content');
  const data = await GET('/finance/by-project');
  const total = data.reduce((s,r)=>s+(+r.total_service||0),0);
  const paid  = data.reduce((s,r)=>s+(+r.total_paid||0),0);
  const tabs = [
    { key:'month', label:'Доходы' },
    { key:'expenses', label:'Расходы' }, { key:'projects', label:'По проектам' },
    { key:'annual', label:'Годовой отчёт' },
  ].map(t=>`<button class="fin-tab ${_finTab===t.key?'active':''}" onclick="finSetTab('${t.key}')">${t.label}</button>`).join('');
  content.innerHTML = `<div class="fin-page">
    <div class="fin-tabs-bar">${tabs}</div>
    <div class="fin-header"><div class="fin-month-title" style="font-size:15px">Сводка по всем проектам</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="exportFinanceProjectsExcel()" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Excel</button>
        <button class="btn btn-outline" onclick="exportFinanceProjectsPDF()" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> PDF</button>
      </div>
    </div>
    <div class="fin-table-wrap" style="margin-top:0">
      <table class="fin-table">
        <thead><tr><th>#</th><th>Проект</th><th>Записей</th><th>Сумма услуг</th><th>Оплачено</th><th>Задолженность</th><th>%</th></tr></thead>
        <tbody>
          ${data.map((r,i)=>{
            const debt=+r.total_service-+r.total_paid;
            const pct=r.total_service>0?Math.round(r.total_paid/r.total_service*100):0;
            return `<tr class="fin-row">
              <td class="fin-td fin-num">${i+1}</td>
              <td class="fin-td fin-project">${_escHtml(r.project_name)}</td>
              <td class="fin-td" style="text-align:center">${r.count}</td>
              <td class="fin-td fin-money">${fmtMoney(r.total_service)}</td>
              <td class="fin-td fin-money" style="color:#16a34a">${fmtMoney(r.total_paid)}</td>
              <td class="fin-td fin-money" style="color:${debt>0?'#dc2626':'#16a34a'}">${fmtMoney(debt)}</td>
              <td class="fin-td" style="min-width:100px">
                <div style="display:flex;align-items:center;gap:6px">
                  <div style="flex:1;height:6px;background:var(--bg);border-radius:99px;overflow:hidden;border:1px solid var(--border)"><div style="height:100%;width:${pct}%;background:${pct>=80?'#16a34a':pct>=50?'#d97706':'#dc2626'};border-radius:99px"></div></div>
                  <span style="font-size:11px;font-weight:700;color:${pct>=80?'#16a34a':pct>=50?'#d97706':'#dc2626'}">${pct}%</span>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr class="fin-total-row">
          <td colspan="3" class="fin-td fin-total-lbl">ИТОГО</td>
          <td class="fin-td fin-money fin-total">${fmtMoney(total)}</td>
          <td class="fin-td fin-money fin-total" style="color:#16a34a">${fmtMoney(paid)}</td>
          <td class="fin-td fin-money fin-total" style="color:${(total-paid)>0?'#dc2626':'#16a34a'}">${fmtMoney(total-paid)}</td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>
  </div>`;
}

async function _renderFinanceAnnual() {
  const content = document.getElementById('page-content');
  const year = _finMonth.slice(0,4);
  // Combined data from all 3 sections
  const data = await GET('/finance/annual-combined?year=' + year);
  const MONTH_NAMES = ['Янв','Фев','Мар','Апр','Май','Июнь','Июль','Авг','Сен','Окт','Ноя','Дек'];
  const tabs = [
    { key:'month', label:'По месяцам' },
    { key:'projects', label:'По проектам' },
    { key:'annual', label:'Годовой отчёт' },
  ].map(t=>`<button class="fin-tab ${_finTab===t.key?'active':''}" onclick="finSetTab('${t.key}')">${t.label}</button>`).join('');

  const months12 = Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
  const totSvc  = data.reduce((s,r)=>s+(+r.total_svc||0),0);
  const totPaid = data.reduce((s,r)=>s+(+r.total_paid||0),0);

  // SVG combined line chart
  const W=700,H=200,pL=40,pB=24,pT=16,pR=16;
  const iW=W-pL-pR, iH=H-pB-pT;
  const maxV = Math.max(...data.map(r=>Math.max(+r.total_svc||0,+r.total_paid||0)), 1);
  const pts = data.map((r,i) => ({ x: pL+i/11*iW, svc:+r.total_svc||0, paid:+r.total_paid||0, fsvc:+r.fin_svc||0, bsvc:+r.b2c_svc||0, ksvc:+r.kids_svc||0 }));
  const polyline = (key,color,w=2) => `<polyline points="${pts.map(p=>`${p.x},${pT+(1-p[key]/maxV)*iH}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const dots2 = (key,color) => pts.map(p=>`<circle cx="${p.x}" cy="${pT+(1-p[key]/maxV)*iH}" r="3" fill="${color}" stroke="white" stroke-width="1.5"/>`).join('');
  const grid = [0.25,0.5,0.75,1].map(f=>`<line x1="${pL}" y1="${pT+(1-f)*iH}" x2="${W-pR}" y2="${pT+(1-f)*iH}" stroke="#e2e8f0" stroke-width="0.8"/>`).join('');
  const labels = pts.map((p,i)=>`<text x="${p.x}" y="${H-4}" text-anchor="middle" font-size="9" fill="#94a3b8">${MONTH_NAMES[i]}</text>`).join('');

  content.innerHTML = `<div class="fin-page">
    <div class="fin-tabs-bar">${tabs}</div>
    <div class="fin-header"><div class="fin-month-title">Год: ${year}</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="exportFinanceAnnualExcel('${year}')" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Excel</button>
        <button class="btn btn-outline" onclick="exportFinanceAnnualPDF('${year}')" style="display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> PDF</button>
      </div>
    </div>
    <div style="padding:0 24px 20px">
      <div class="fin-summary" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
        <div class="fin-sum-card"><div class="fin-sum-lbl">Сумма услуг за год</div><div class="fin-sum-val">${fmtMoney(totSvc)}</div></div>
        <div class="fin-sum-card"><div class="fin-sum-lbl">Оплачено за год</div><div class="fin-sum-val" style="color:#16a34a">${fmtMoney(totPaid)}</div></div>
        <div class="fin-sum-card"><div class="fin-sum-lbl">Задолженность</div><div class="fin-sum-val" style="color:${(totSvc-totPaid)>0?'#dc2626':'#16a34a'}">${fmtMoney(totSvc-totPaid)}</div></div>
      </div>
      <div class="chart-panel" style="margin-bottom:20px">
        <div class="chart-title">Динамика по месяцам (все разделы)</div>
        <div style="display:flex;gap:14px;font-size:11px;color:var(--text-muted);margin-bottom:8px">
          <span><svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#0f172a" stroke-width="2"/></svg> Общая сумма</span>
          <span><svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#16a34a" stroke-width="2"/></svg> Оплачено</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">${grid}${polyline('svc','#881337')}${polyline('paid','#16a34a')}${dots2('svc','#881337')}${dots2('paid','#16a34a')}${labels}</svg>
      </div>
      <div class="fin-table-wrap" style="margin-top:0">
        <table class="fin-table">
          <thead><tr><th>Месяц</th><th>Финансы</th><th>В2С</th><th>Kids</th><th>Итого сумма</th><th>Оплачено</th><th>Остаток</th><th>%</th></tr></thead>
          <tbody>
            ${data.map((r,i)=>{
              const hasData = r.total_svc>0||r.total_paid>0;
              if (!hasData) return `<tr class="fin-row"><td class="fin-td" style="color:var(--text-muted)">${MONTH_NAMES[i]}</td><td colspan="7" class="fin-td" style="color:var(--text-muted)">Нет данных</td></tr>`;
              const debt=r.total_svc-r.total_paid;
              const pct=r.total_svc>0?Math.round(r.total_paid/r.total_svc*100):0;
              return `<tr class="fin-row" style="cursor:pointer" onclick="finSetTab('month');finSetMonth('${r.month}')">
                <td class="fin-td fin-project">${MONTH_NAMES[i]} ${year}</td>
                <td class="fin-td fin-money" style="font-size:12px">${r.fin_svc>0?fmtMoney(r.fin_svc):'—'}</td>
                <td class="fin-td fin-money" style="font-size:12px;color:#6366f1">${r.b2c_svc>0?fmtMoney(r.b2c_svc):'—'}</td>
                <td class="fin-td fin-money" style="font-size:12px;color:#16a34a">${r.kids_svc>0?fmtMoney(r.kids_svc):'—'}</td>
                <td class="fin-td fin-money">${fmtMoney(r.total_svc)}</td>
                <td class="fin-td fin-money" style="color:#16a34a">${fmtMoney(r.total_paid)}</td>
                <td class="fin-td fin-money" style="color:${debt>0?'#dc2626':'#16a34a'}">${fmtMoney(debt)}</td>
                <td class="fin-td"><span style="font-weight:700;color:${pct>=80?'#16a34a':pct>=50?'#d97706':'#dc2626'}">${pct}%</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

async function openPaymentsModal(finId) {
  const root = document.getElementById('modal-root');
  const fin = (await GET('/finance?month=' + _finMonth)).find(r=>r.id===finId);
  if (!fin) return;
  const pmts = fin.payments || [];
  const hist = await GET(`/finance/${finId}/history`).catch(()=>[]);

  function render() {
    const pmts2 = (window._finPmts||pmts);
    const totalPaid = pmts2.reduce((s,p)=>s+(+p.amount||0),0);
    root.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:520px">
          <div class="modal-header">
            <div><div class="modal-title">Платежи · ${_escHtml(fin.project_name)}</div>
            <div style="font-size:12px;color:var(--text-muted)">Сумма услуги: ${fmtMoney(fin.service_amount)} ${fin.currency||'TJS'}</div></div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <!-- Existing payments -->
            ${pmts2.length ? `<div style="margin-bottom:16px">
              <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">История платежей (${pmts2.length})</div>
              ${pmts2.map(p=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:700">${fmtMoney(p.amount)} ${fin.currency||'TJS'}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${p.payment_date} · <span style="color:${FIN_TYPE_COLOR[p.payment_type]||'#64748b'}">${FIN_TYPE[p.payment_type]||p.payment_type}</span>${p.note?' · '+p.note:''}</div>
                </div>
                <button class="fin-btn-del" onclick="delPayment(${p.id},${finId})">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
                </button>
              </div>`).join('')}
              <div style="margin-top:8px;font-size:13px;font-weight:700;color:#16a34a">Итого оплачено: ${fmtMoney(totalPaid)} ${fin.currency||'TJS'}</div>
            </div>` : '<div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Платежей пока нет</div>'}
            <!-- Add payment -->
            <div style="background:var(--bg);border-radius:10px;padding:14px">
              <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:10px">Добавить платёж</div>
              <div class="form-row">
                <div class="field"><label>Сумма</label><input id="pmt-amount" class="input" type="number" placeholder="0"></div>
                <div class="field"><label>Дата</label><input id="pmt-date" class="input" type="date" value="${new Date(Date.now()+5*3600000).toISOString().slice(0,10)}"></div>
              </div>
              <div class="form-row">
                <div class="field"><label>Тип оплаты</label>
                  <select id="pmt-type" class="input">
                    ${Object.entries(FIN_TYPE).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
                  </select>
                </div>
                <div class="field"><label>Примечание</label><input id="pmt-note" class="input" placeholder="Необязательно"></div>
              </div>
            </div>
            <!-- History -->
            ${hist.length ? `<div style="margin-top:16px">
              <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">История изменений</div>
              ${hist.map(h=>`<div style="font-size:12px;padding:5px 0;border-bottom:1px solid var(--border);color:var(--text-secondary)">
                <span style="font-weight:600">${h.user_name}</span> изменил <b>${h.field}</b>:
                <span style="text-decoration:line-through;color:var(--text-muted)">${h.old_value}</span> → <span style="color:var(--primary)">${h.new_value}</span>
                <span style="float:right;color:var(--text-light)">${fmtDate(h.created_at)}</span>
              </div>`).join('')}
            </div>` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" onclick="closeModal()">Закрыть</button>
            <button class="btn btn-blue" onclick="addPayment(${finId})">Добавить платёж</button>
          </div>
        </div>
      </div>`;
  }
  window._finPmts = pmts;
  window.delPayment = async (pid, fid) => {
    await DEL(`/finance/payments/${pid}`);
    const updated = await GET('/finance?month='+_finMonth);
    const f2 = updated.find(r=>r.id===fid);
    window._finPmts = f2?.payments||[];
    render(); renderFinancePage();
  };
  window.addPayment = async (fid) => {
    const amount = parseFloat(document.getElementById('pmt-amount').value)||0;
    const date   = document.getElementById('pmt-date').value;
    if (!amount||!date) return toast('Укажите сумму и дату','error');
    const r = await POST(`/finance/${fid}/payments`, {
      amount, payment_type: document.getElementById('pmt-type').value,
      payment_date: date, note: document.getElementById('pmt-note')?.value||''
    });
    const updated = await GET('/finance?month='+_finMonth);
    const f2 = updated.find(x=>x.id===fid);
    window._finPmts = f2?.payments||[];
    render(); renderFinancePage();
  };
  render();
}

function openFinanceModal(id = null) {
  let row = null;
  if (id) {
    // Find from DOM data or re-fetch
    const rows = document.querySelectorAll('.fin-row');
    // We'll just open empty and load via API
    GET('/finance?month=' + _finMonth).then(all => {
      row = all.find(r => r.id === id);
      if (row) _showFinanceModal(row);
    }).catch(err => toast(err.message, 'error'));
    return;
  }
  _showFinanceModal(null);
}

function _showFinanceModal(row) {
  const isEdit = !!row;
  const proj = state.projects || [];
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:500px">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Редактировать запись' : 'Новая запись'}</div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Проект</label>
            <div style="display:flex;gap:8px">
              <select id="fin-proj-sel" class="input" style="flex:1" onchange="finProjSelect(this)">
                <option value="">— выбрать из списка —</option>
                ${proj.map(p=>`<option value="${p.id}|${p.name}" ${row?.project_id===p.id?'selected':''}>${p.name}</option>`).join('')}
              </select>
            </div>
            <input id="fin-proj-name" class="input" style="margin-top:6px" placeholder="Или введите вручную..." value="${_escHtml(row?.project_name||'')}">
          </div>
          <div class="form-row">
            <div class="field">
              <label>Сумма услуги</label>
              <input id="fin-service" class="input" type="number" min="0" placeholder="0" value="${row?.service_amount||''}">
            </div>
            <div class="field">
              <label>Сумма оплаты</label>
              <input id="fin-paid" class="input" type="number" min="0" placeholder="0" value="${row?.paid_amount||''}">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Статус <span style="font-size:11px;color:var(--text-muted)">(авто)</span></label>
              <div class="input" style="background:var(--bg);display:flex;align-items:center;gap:8px;cursor:default">
                <span id="fin-status-preview" style="font-weight:700"></span>
                <span style="font-size:11px;color:var(--text-muted)">рассчитывается по суммам</span>
              </div>
            </div>
            <div class="field">
              <label>Тип оплаты</label>
              <select id="fin-type" class="input">
                ${Object.entries(FIN_TYPE).map(([k,v])=>`<option value="${k}" ${(row?.payment_type||'cash')===k?'selected':''}>${v}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field">
            <label>Месяц</label>
            <input id="fin-month" class="input" type="month" value="${row?.month||_finMonth}">
          </div>
          <div class="form-row">
            <div class="field">
              <label>Клиент (ФИО)</label>
              <input id="fin-client-name" class="input" placeholder="Имя клиента" value="${_escHtml(row?.client_name||'')}">
            </div>
            <div class="field">
              <label>Телефон клиента</label>
              <input id="fin-client-phone" class="input" placeholder="+992..." value="${_escHtml(row?.client_phone||'')}">
            </div>
          </div>
          <div class="field">
            <label>Комментарий</label>
            <textarea id="fin-comment" class="input" rows="2" placeholder="Дополнительная информация...">${row?.comment||''}</textarea>
          </div>
          <div class="field" style="display:flex;align-items:center;gap:10px;margin-top:4px">
            <input type="checkbox" id="fin-recurring" ${row?.is_recurring?'checked':''} style="width:16px;height:16px">
            <label for="fin-recurring" style="font-size:13px;cursor:pointer">Повторяющаяся запись (копировать каждый месяц)</label>
          </div>
        </div>
        <div class="modal-footer">
          ${isEdit ? `<button class="btn btn-danger" onclick="deleteFinance(${row.id})">Удалить</button>` : ''}
          <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
          <button class="btn btn-blue" onclick="saveFinance(${isEdit?row.id:'null'})">Сохранить</button>
        </div>
      </div>
    </div>`;

  // Update status preview live
  const updateStatusPreview = () => {
    const svc  = parseFloat(document.getElementById('fin-service')?.value)||0;
    const paid = parseFloat(document.getElementById('fin-paid')?.value)||0;
    const st   = paid <= 0 ? 'unpaid' : paid >= svc ? 'paid' : 'partial';
    const el   = document.getElementById('fin-status-preview');
    if (el) { el.textContent = FIN_STATUS[st]; el.style.color = FIN_STATUS_COLOR[st]; }
  };
  setTimeout(() => {
    document.getElementById('fin-service')?.addEventListener('input', updateStatusPreview);
    document.getElementById('fin-paid')?.addEventListener('input', updateStatusPreview);
    updateStatusPreview();
  }, 0);
}

function finProjSelect(sel) {
  if (!sel.value) return;
  const [, name] = sel.value.split('|');
  const nameInput = document.getElementById('fin-proj-name');
  if (nameInput) nameInput.value = name;
}

async function saveFinance(id) {
  const name = document.getElementById('fin-proj-name').value.trim();
  if (!name) return toast('Введите название проекта', 'error');
  const selVal = document.getElementById('fin-proj-sel').value;
  const projId = selVal ? parseInt(selVal.split('|')[0]) || null : null;
  const body = {
    project_id:   projId,
    project_name: name,
    service_amount:  parseFloat(document.getElementById('fin-service').value)||0,
    paid_amount:     parseFloat(document.getElementById('fin-paid').value)||0,
    status: (() => {
      const svc  = parseFloat(document.getElementById('fin-service').value)||0;
      const paid = parseFloat(document.getElementById('fin-paid').value)||0;
      if (paid <= 0)        return 'unpaid';
      if (paid >= svc)      return 'paid';
      return 'partial';
    })(),
    payment_type:    document.getElementById('fin-type').value,
    comment:         document.getElementById('fin-comment').value.trim(),
    month:           document.getElementById('fin-month').value || _finMonth,
    currency:        document.getElementById('fin-currency')?.value || 'TJS',
    client_name:     document.getElementById('fin-client-name')?.value.trim()||'',
    client_phone:    document.getElementById('fin-client-phone')?.value.trim()||'',
    is_recurring:    document.getElementById('fin-recurring')?.checked ? 1 : 0,
  };
  try {
    if (id && id !== 'null') await PUT(`/finance/${id}`, body);
    else await POST('/finance', body);
    closeModal();
    if (body.month !== _finMonth) { _finMonth = body.month; }
    renderFinancePage();
    toast('Сохранено', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteFinance(id) {
  if (!confirm('Удалить запись?')) return;
  try {
    await DEL(`/finance/${id}`);
    closeModal();
    renderFinancePage();
    toast('Удалено', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function exportFinanceProjectsExcel() {
  const data = await GET('/finance/by-project');
  if (!data.length) return toast('Нет данных', 'error');
  const rows = data.map((r,i) => ({ '№':i+1, 'Проект':r.project_name, 'Записей':r.count, 'Сумма услуг':+r.total_service, 'Оплачено':+r.total_paid, 'Задолженность':(+r.total_service-+r.total_paid), '%':r.total_service>0?Math.round(r.total_paid/r.total_service*100):0 }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:4},{wch:24},{wch:8},{wch:14},{wch:14},{wch:14},{wch:8}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'По проектам');
  XLSX.writeFile(wb, 'Финансы_по_проектам.xlsx'); toast('Excel скачан','success');
}

function exportFinanceProjectsPDF() {
  const tableEl = document.querySelector('.fin-page .fin-table');
  if (!tableEl) return;
  const win = window.open('','_blank','width=900,height=700');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>По проектам</title>
    <style>*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:system-ui;font-size:12px;padding:24px}h2{margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;padding:8px;text-align:left;border:1px solid #e2e8f0;font-size:11px}td{padding:8px;border:1px solid #e2e8f0}@media print{@page{size:A4 landscape;margin:1cm}}</style>
    </head><body><h2>Финансы по проектам · MindsBar</h2>${tableEl.outerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

async function exportFinanceAnnualExcel(year) {
  const data = await GET('/finance/annual?year=' + year);
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const rows = Array.from({length:12},(_,i)=>{
    const mo = String(i+1).padStart(2,'0');
    const r = data.find(d=>d.month===`${year}-${mo}`)||{total_service:0,total_paid:0,count:0};
    return { 'Месяц':MONTHS[i], 'Записей':r.count, 'Сумма услуг':+r.total_service, 'Оплачено':+r.total_paid, 'Остаток':(+r.total_service-+r.total_paid), '%': r.total_service>0?Math.round(r.total_paid/r.total_service*100):0 };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:12},{wch:8},{wch:14},{wch:14},{wch:14},{wch:8}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, year);
  XLSX.writeFile(wb, `Финансы_${year}.xlsx`); toast('Excel скачан','success');
}

function exportFinanceAnnualPDF(year) {
  const tableEl = document.querySelector('.fin-page .fin-table');
  const svgEl   = document.querySelector('#fin-chart-svg-wrap svg');
  if (!tableEl) return;
  const win = window.open('','_blank','width=1100,height=800');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Год ${year}</title>
    <style>*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:system-ui;font-size:12px;padding:24px}h2{margin-bottom:16px}svg{width:100%;height:auto;margin-bottom:20px;display:block}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;padding:8px;text-align:left;border:1px solid #e2e8f0;font-size:11px}td{padding:8px;border:1px solid #e2e8f0}@media print{@page{size:A4 landscape;margin:1cm}}</style>
    </head><body><h2>Финансовый отчёт · ${year} год · MindsBar</h2>${svgEl?svgEl.outerHTML:''}${tableEl.outerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

async function exportFinanceExcel() {
  try {
    const rows = await GET('/finance?month=' + _finMonth);
    if (!rows.length) return toast('Нет данных для экспорта', 'error');

    const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const [y,m] = _finMonth.split('-');
    const monthLabel = MONTH_NAMES[+m-1] + ' ' + y;

    const data = rows.map((r,i) => ({
      '№': i+1,
      'Проект': r.project_name,
      'Сумма услуги': +r.service_amount || 0,
      'Оплачено': +r.paid_amount || 0,
      'Остаток': (+r.service_amount||0) - (+r.paid_amount||0),
      'Статус': FIN_STATUS[r.status] || r.status,
      'Тип оплаты': FIN_TYPE[r.payment_type] || r.payment_type,
      'Комментарий': r.comment || '',
    }));

    // Add totals row
    const totSvc  = rows.reduce((s,r)=>s+(+r.service_amount||0),0);
    const totPaid = rows.reduce((s,r)=>s+(+r.paid_amount||0),0);
    data.push({ '№':'', 'Проект':'ИТОГО', 'Сумма услуги':totSvc, 'Оплачено':totPaid, 'Остаток':totSvc-totPaid, 'Статус':'', 'Тип оплаты':'', 'Комментарий':'' });

    const ws = XLSX.utils.json_to_sheet(data);
    // Column widths
    ws['!cols'] = [{ wch:4 },{ wch:24 },{ wch:16 },{ wch:16 },{ wch:16 },{ wch:16 },{ wch:16 },{ wch:28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, monthLabel);
    XLSX.writeFile(wb, `Финансы_${_finMonth}.xlsx`);
    toast('Excel-файл скачан', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function exportFinancePDF() {
  try {
    const rows = await GET('/finance?month=' + _finMonth);
    if (!rows.length) return toast('Нет данных для экспорта', 'error');

    const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const [y,m] = _finMonth.split('-');
    const monthLabel = MONTH_NAMES[+m-1] + ' ' + y;
    const now = new Date().toLocaleString('ru-RU', { day:'2-digit', month:'long', year:'numeric' });

    const totSvc  = rows.reduce((s,r)=>s+(+r.service_amount||0),0);
    const totPaid = rows.reduce((s,r)=>s+(+r.paid_amount||0),0);
    const totDebt = totSvc - totPaid;

    const tableRows = rows.map((r,i) => `
      <tr style="background:${i%2===0?'#fff':'#f8fafc'}">
        <td>${i+1}</td>
        <td><strong>${r.project_name}</strong></td>
        <td class="num">${fmtMoney(r.service_amount)}</td>
        <td class="num green">${fmtMoney(r.paid_amount)}</td>
        <td class="num ${(+r.service_amount-(+r.paid_amount))>0?'red':'green'}">${fmtMoney(+r.service_amount-(+r.paid_amount))}</td>
        <td><span class="badge" style="background:${FIN_STATUS_COLOR[r.status]}22;color:${FIN_STATUS_COLOR[r.status]}">${FIN_STATUS[r.status]||r.status}</span></td>
        <td>${FIN_TYPE[r.payment_type]||r.payment_type}</td>
        <td class="comment">${r.comment||'—'}</td>
      </tr>`).join('');

    const win = window.open('', '_blank', 'width=1100,height=800');
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>Финансы · ${monthLabel}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        body{font-family:system-ui,sans-serif;font-size:12px;color:#0f172a;padding:24px}
        .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #e2e8f0}
        .title{font-size:20px;font-weight:800}
        .meta{font-size:11px;color:#64748b;text-align:right}
        .summary{display:flex;gap:16px;margin-bottom:20px}
        .sum-card{flex:1;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px 16px}
        .sum-lbl{font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px}
        .sum-val{font-size:20px;font-weight:900}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{background:#f1f5f9;padding:9px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;border:1px solid #e2e8f0}
        td{padding:9px 10px;border:1px solid #e2e8f0;vertical-align:middle}
        .num{text-align:right;font-weight:700;white-space:nowrap}
        .green{color:#16a34a}.red{color:#dc2626}
        .badge{padding:2px 8px;border-radius:20px;font-size:10.5px;font-weight:700;display:inline-block}
        .comment{color:#64748b;max-width:150px}
        .total-row td{background:#f1f5f9;font-weight:800;border-top:2px solid #94a3b8}
        @media print{@page{size:A4 landscape;margin:1cm}}
      </style>
    </head><body>
      <div class="header">
        <div><div class="title">Дебиторская задолженность · ${monthLabel}</div><div style="font-size:12px;color:#64748b;margin-top:3px">MindsBar — Финансовый отчёт</div></div>
        <div class="meta">${now}</div>
      </div>
      <div class="summary">
        <div class="sum-card"><div class="sum-lbl">Сумма услуг</div><div class="sum-val">${fmtMoney(totSvc)}</div><div style="font-size:11px;color:#64748b">${rows.length} записей</div></div>
        <div class="sum-card"><div class="sum-lbl">Оплачено</div><div class="sum-val green">${fmtMoney(totPaid)}</div><div style="font-size:11px;color:#64748b">${totSvc>0?Math.round(totPaid/totSvc*100):0}% от суммы</div></div>
        <div class="sum-card"><div class="sum-lbl">Задолженность</div><div class="sum-val ${totDebt>0?'red':'green'}">${fmtMoney(totDebt)}</div><div style="font-size:11px;color:#64748b">${rows.filter(r=>r.status==='unpaid').length} не оплачено</div></div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Проект</th><th>Сумма услуги</th><th>Оплачено</th><th>Остаток</th><th>Статус</th><th>Тип оплаты</th><th>Комментарий</th></tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr class="total-row"><td colspan="2">ИТОГО</td><td class="num">${fmtMoney(totSvc)}</td><td class="num green">${fmtMoney(totPaid)}</td><td class="num ${totDebt>0?'red':'green'}">${fmtMoney(totDebt)}</td><td colspan="3"></td></tr></tfoot>
      </table>
      <script>window.onload=()=>window.print()<\/script>
    </body></html>`);
    win.document.close();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Finance Activity Log Page ────────────────────────────────────────────────
const FL_SECTIONS = { finance:'Финансы', b2c:'Финансы В2С', kids:'Финансы Kids' };
const FL_ACTIONS  = {
  create_record:'Добавил запись', update_record:'Изменил запись', delete_record:'Удалил запись',
  add_payment:'Добавил платёж',
  create_expense:'Добавил расход', update_expense:'Изменил расход', delete_expense:'Удалил расход',
  add_student:'Добавил студента', update_student:'Изменил студента', delete_student:'Удалил студента',
  delete_course:'Удалил курс',
};
const FL_SECTION_COLOR = { finance:'#881337', b2c:'#6366f1', kids:'#16a34a' };
let _flSection = '', _flDays = 30;

let _flShowAll = false;

async function deleteFinanceLog(id) {
  if (!confirm('Удалить эту запись из лога?')) return;
  try {
    await DEL(`/finance-log/${id}`);
    renderFinanceLogPage();
  } catch (err) { toast(err.message, 'error'); }
}

async function renderFinanceLogPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';
  try {
    const params = new URLSearchParams({ days: _flDays, limit: 500 });
    if (_flSection) params.set('section', _flSection);
    const allLogs = (await GET('/finance-log?' + params.toString()))
      .filter(l => l.entity_title?.trim() || l.detail?.trim()); // skip empty entries

    const sectionTabs = [
      { key:'', label:'Все разделы' },
      ...Object.entries(FL_SECTIONS).map(([k,v])=>({ key:k, label:v }))
    ].map(t=>`<button class="fin-tab ${_flSection===t.key?'active':''}" onclick="_flSection='${t.key}';_flShowAll=false;renderFinanceLogPage()">${t.label}</button>`).join('');

    const dayBtns = [7,14,30,90].map(d=>`<button class="period-btn ${_flDays===d?'active':''}" onclick="_flDays=${d};_flShowAll=false;renderFinanceLogPage()">${d} дней</button>`).join('');

    // Stats — only additions count as income (not deletions, not updates)
    const incLogs = allLogs.filter(l => !l.action.includes('expense') && !l.action.includes('delete') && (l.action.includes('create') || l.action.includes('add')));
    const expLogs = allLogs.filter(l => l.action.includes('expense') && !l.action.includes('delete'));
    const totalIncome  = incLogs.reduce((s,l)=>s+(+l.amount||0),0);
    const totalExpense = expLogs.reduce((s,l)=>s+(+l.amount||0),0);
    const uniqueUsers  = new Set(allLogs.map(l=>l.user_name)).size;

    // Show 10 or all
    const logs = _flShowAll ? allLogs : allLogs.slice(0, 10);

    const logRow = (l,i) => `<tr class="fin-row">
      <td class="fin-td fin-num">${i+1}</td>
      <td class="fin-td" style="white-space:nowrap;font-size:12px">${fmtDate(l.created_at)}</td>
      <td class="fin-td" style="font-weight:600;display:flex;align-items:center;gap:6px">
        ${(() => { const u=state.users?.find(x=>x.id===l.user_id); return avatar(l.user_name||'?', u?.avatar_color||'#6366f1','avatar-xs',u?.avatar_img||''); })()}
        ${l.user_name||'—'}
      </td>
      <td class="fin-td"><span class="fin-status-badge" style="background:${FL_SECTION_COLOR[l.section]||'#94a3b8'}18;color:${FL_SECTION_COLOR[l.section]||'#94a3b8'}">${FL_SECTIONS[l.section]||l.section}</span></td>
      <td class="fin-td" style="font-size:12.5px">${FL_ACTIONS[l.action]||l.action}</td>
      <td class="fin-td fin-project" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(l.entity_title||'—')}</td>
      <td class="fin-td fin-money" style="color:${l.action.includes('expense')?'#dc2626':l.amount>0?'#16a34a':'var(--text-muted)'}">
        ${l.amount!=null?`${l.action.includes('expense')?'-':''}${fmtMoney(l.amount)}`:'—'}
      </td>
      <td class="fin-td fin-comment" style="max-width:200px">${_escHtml(l.detail||'—')}</td>
      <td class="fin-td" style="width:36px">
        <button class="fin-btn-del" title="Удалить запись"
          onclick="deleteFinanceLog(${l.id})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </td>
    </tr>`;

    content.innerHTML = `
      <div style="padding:0 24px 48px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">${sectionTabs}</div>
          <div style="margin-left:auto;display:flex;gap:6px">${dayBtns}</div>
        </div>

        <!-- Stats: 4 blocks -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px">
          <div class="fin-sum-card"><div class="fin-sum-lbl">Всего операций</div><div class="fin-sum-val">${allLogs.length}</div></div>
          <div class="fin-sum-card"><div class="fin-sum-lbl">Сотрудников</div><div class="fin-sum-val">${uniqueUsers}</div></div>
          <div class="fin-sum-card" style="border-color:#bbf7d0">
            <div class="fin-sum-lbl">Доходы (внесено)</div>
            <div class="fin-sum-val" style="color:#16a34a">+${fmtMoney(totalIncome)}</div>
          </div>
          <div class="fin-sum-card" style="border-color:#fecaca">
            <div class="fin-sum-lbl">Расходы (внесено)</div>
            <div class="fin-sum-val" style="color:#dc2626">-${fmtMoney(totalExpense)}</div>
          </div>
        </div>

        ${allLogs.length===0
          ? `<div class="empty-state"><h3>Нет данных</h3><p>Операций за выбранный период не найдено</p></div>`
          : `<div class="fin-table-wrap">
              <table class="fin-table">
                <thead><tr>
                  <th>#</th><th>Дата и время</th><th>Сотрудник</th><th>Раздел</th>
                  <th>Действие</th><th>Объект</th><th>Сумма</th><th>Детали</th><th></th>
                </tr></thead>
                <tbody>${logs.map(logRow).join('')}</tbody>
              </table>
            </div>
            ${allLogs.length > 10 ? `
              <div style="text-align:center;margin-top:14px">
                <button class="btn btn-outline" onclick="_flShowAll=!_flShowAll;renderFinanceLogPage()">
                  ${_flShowAll ? `▲ Свернуть (показать 10)` : `▼ Показать все (${allLogs.length} записей)`}
                </button>
              </div>` : ''}`}
      </div>`;
  } catch(err) { content.innerHTML=`<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`; }
}

// ─── Ideahast Page ────────────────────────────────────────────────────────────
const IH_STATUS = { active:'Действующий', pause:'На паузе', done:'Завершён' };
const IH_STATUS_COLOR = { active:'#16a34a', pause:'#d97706', done:'#6366f1' };
const IH_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#06b6d4','#881337'];

async function renderIdeahastPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';
  try {
    const projects = await GET('/ideahast');

    // Stats
    const total   = projects.length;
    const active  = projects.filter(p=>p.status==='active').length;
    const pause   = projects.filter(p=>p.status==='pause').length;
    const done    = projects.filter(p=>p.status==='done').length;

    // Avg lifetime (for completed projects)
    const lifetimes = projects.filter(p=>p.end_date).map(p=>{
      const ms = new Date(p.end_date) - new Date(p.start_date);
      return ms/(1000*60*60*24*30); // months
    });
    const avgLife = lifetimes.length ? (lifetimes.reduce((a,b)=>a+b,0)/lifetimes.length).toFixed(1) : '—';

    // Timeline SVG chart
    const now = new Date();
    const timelineHtml = _buildIhTimeline(projects);

    // Status donut
    const donutSlices = [
      { key:'active', label:'Действующие', v:active, c:'#16a34a' },
      { key:'pause',  label:'На паузе',    v:pause,  c:'#d97706' },
      { key:'done',   label:'Завершённые', v:done,   c:'#6366f1' },
    ].filter(s=>s.v>0);

    content.innerHTML = `
      <div class="ih-page">
        <!-- Header -->
        <div class="ih-header">
          <div class="ih-title-wrap">
            <div class="ih-page-title">Ideahast</div>
            <div class="ih-page-sub">Анализ портфеля проектов</div>
          </div>
          <button class="btn btn-blue" onclick="openIhModal()">＋ Добавить проект</button>
        </div>

        <!-- Stats row -->
        <div class="ih-stats">
          <div class="ih-stat ih-stat-total">
            <div class="ih-stat-val">${total}</div>
            <div class="ih-stat-lbl">Всего проектов</div>
          </div>
          <div class="ih-stat" style="border-color:#bbf7d0">
            <div class="ih-stat-val" style="color:#16a34a">${active}</div>
            <div class="ih-stat-lbl">Действующих</div>
          </div>
          <div class="ih-stat" style="border-color:#fed7aa">
            <div class="ih-stat-val" style="color:#d97706">${pause}</div>
            <div class="ih-stat-lbl">На паузе</div>
          </div>
          <div class="ih-stat" style="border-color:#ddd6fe">
            <div class="ih-stat-val" style="color:#6366f1">${done}</div>
            <div class="ih-stat-lbl">Завершённых</div>
          </div>
          <div class="ih-stat">
            <div class="ih-stat-val">${avgLife}</div>
            <div class="ih-stat-lbl">Ср. срок (мес)</div>
          </div>
        </div>

        ${total === 0 ? `<div class="empty-state" style="margin-top:40px"><div class="empty-icon">${svgI(SVG_PATHS.bars,44)}</div><h3>Нет проектов</h3><p>Добавьте первый проект для анализа</p></div>` : `
        <!-- Timeline chart -->
        <div class="ih-section">
          <div class="ih-section-title">Временная шкала проектов</div>
          ${timelineHtml}
        </div>

        <!-- Project blocks -->
        <div class="ih-section">
          <div class="ih-section-title">Все проекты (${total})</div>
          <div class="ih-grid">
            ${projects.map(p => {
              const start = p.start_date ? p.start_date : '—';
              const end   = p.end_date   ? p.end_date   : 'сейчас';
              const msLife = p.end_date
                ? new Date(p.end_date) - new Date(p.start_date)
                : Date.now() - new Date(p.start_date);
              const lifeMonths = Math.max(0, Math.floor(msLife/(1000*60*60*24*30)));
              return `
              <div class="ih-card" onclick="openIhModal(${p.id})">
                <div class="ih-card-color" style="background:${p.color}"></div>
                <div class="ih-card-body">
                  <div class="ih-card-top">
                    <div class="ih-card-title">${_escHtml(p.title)}</div>
                    <span class="ih-status-badge" style="background:${IH_STATUS_COLOR[p.status]}18;color:${IH_STATUS_COLOR[p.status]}">${IH_STATUS[p.status]||p.status}</span>
                  </div>
                  ${p.client?`<div class="ih-card-client">${svgI(SVG_PATHS.user,11)} ${_escHtml(p.client)}</div>`:''}
                  ${p.description?`<div class="ih-card-desc">${_escHtml(p.description)}</div>`:''}
                  <div class="ih-card-dates">
                    <span>${svgI(SVG_PATHS.cal,12)} ${start} — ${end}</span>
                    <span class="ih-card-life">${lifeMonths} мес.</span>
                  </div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`}
      </div>`;
  } catch (err) { content.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`; }
}

function _buildIhTimeline(projects) {
  if (!projects.length) return '';
  const sorted = [...projects].sort((a,b)=>a.start_date.localeCompare(b.start_date));
  const minDate = new Date(sorted[0].start_date);
  const maxDate = new Date(Math.max(...sorted.map(p=>p.end_date ? new Date(p.end_date) : new Date())));
  const totalMs = maxDate - minDate || 1;
  const W = 100; // percent

  const bars = sorted.map((p,i) => {
    const s = (new Date(p.start_date) - minDate) / totalMs * 100;
    const e = p.end_date ? (new Date(p.end_date) - minDate) / totalMs * 100 : 100;
    const w = Math.max(e - s, 1);
    return `<div class="ih-bar-row">
      <div class="ih-bar-label" title="${p.title}">${_escHtml(p.title.length>22?p.title.slice(0,20)+'…':p.title)}</div>
      <div class="ih-bar-track">
        <div class="ih-bar-fill" style="left:${s.toFixed(1)}%;width:${w.toFixed(1)}%;background:${p.color};opacity:${p.status==='done'?0.6:1}" title="${p.title}: ${p.start_date} — ${p.end_date||'сейчас'}"></div>
      </div>
      <span class="ih-bar-status" style="color:${IH_STATUS_COLOR[p.status]}">${IH_STATUS[p.status]?.charAt(0)}</span>
    </div>`;
  }).join('');

  const startLbl = minDate.toLocaleString('ru-RU',{month:'short',year:'numeric',timeZone:TZ});
  const endLbl   = maxDate.toLocaleString('ru-RU',{month:'short',year:'numeric',timeZone:TZ});
  return `<div class="ih-timeline">
    ${bars}
    <div class="ih-timeline-axis"><span>${startLbl}</span><span>${endLbl}</span></div>
  </div>`;
}

function openIhModal(id=null) {
  GET('/ideahast').then(projects => {
    const p = id ? projects.find(x=>x.id===id) : null;
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:480px">
          <div class="modal-header">
            <div class="modal-title">${p?'Редактировать проект':'Добавить проект'}</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="field"><label>Название проекта</label>
              <input id="ih-title" class="input" value="${_escHtml(p?.title||'')}" placeholder="Название...">
            </div>
            <div class="field"><label>Клиент</label>
              <input id="ih-client" class="input" value="${_escHtml(p?.client||'')}" placeholder="Название клиента...">
            </div>
            <div class="field"><label>Описание</label>
              <textarea id="ih-desc" class="input" rows="2">${_escHtml(p?.description||'')}</textarea>
            </div>
            <div class="form-row">
              <div class="field"><label>Статус</label>
                <select id="ih-status" class="input">
                  ${Object.entries(IH_STATUS).map(([k,v])=>`<option value="${k}" ${(p?.status||'active')===k?'selected':''}>${v}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>Цвет</label>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
                  ${IH_COLORS.map(c=>`<button type="button" class="ih-color-btn ${(p?.color||'#6366f1')===c?'selected':''}" style="background:${c}" data-color="${c}" onclick="ihSelectColor(this,'${c}')"></button>`).join('')}
                </div>
                <input type="hidden" id="ih-color" value="${p?.color||'#6366f1'}">
              </div>
            </div>
            <div class="form-row">
              <div class="field"><label>Дата начала</label>
                <input id="ih-start" class="input" type="date" value="${p?.start_date||''}">
              </div>
              <div class="field"><label>Дата окончания</label>
                <input id="ih-end" class="input" type="date" value="${p?.end_date||''}">
              </div>
            </div>
          </div>
          <div class="modal-footer">
            ${p?`<button class="btn btn-danger" onclick="deleteIhProject(${p.id})">Удалить</button>`:''}
            <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
            <button class="btn btn-blue" onclick="saveIhProject(${p?p.id:'null'})">${p?'Сохранить':'Добавить'}</button>
          </div>
        </div>
      </div>`;
  });
}

function ihSelectColor(btn, color) {
  document.querySelectorAll('.ih-color-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('ih-color').value = color;
}

async function saveIhProject(id) {
  const title = document.getElementById('ih-title').value.trim();
  const start = document.getElementById('ih-start').value;
  if (!title) return toast('Введите название','error');
  if (!start)  return toast('Укажите дату начала','error');
  const body = { title, description:document.getElementById('ih-desc').value.trim(), color:document.getElementById('ih-color').value, status:document.getElementById('ih-status').value, start_date:start, end_date:document.getElementById('ih-end').value, client:document.getElementById('ih-client').value.trim() };
  try {
    if (id && id!=='null') await PUT(`/ideahast/${id}`, body);
    else await POST('/ideahast', body);
    closeModal(); renderIdeahastPage(); toast('Сохранено','success');
  } catch (err) { toast(err.message,'error'); }
}

async function deleteIhProject(id) {
  if (!confirm('Удалить проект?')) return;
  await DEL(`/ideahast/${id}`); closeModal(); renderIdeahastPage(); toast('Удалено','success');
}

// ─── B2C Finance Page ─────────────────────────────────────────────────────────
const B2C_STATUS = { paid:'Оплатил', hybrid:'Гибрид', unpaid:'Не оплатил', partial:'Частично' };
const B2C_STATUS_COLOR = { paid:'#16a34a', hybrid:'#d97706', unpaid:'#dc2626', partial:'#9333ea' };
const B2C_METHOD = { cash:'Наличка', alif:'Alif', dc:'DC' };
const B2C_METHOD_COLOR = { cash:'#d97706', alif:'#3b82f6', dc:'#6d28d9' };

let _b2cCourseId    = (() => { try { const v = sessionStorage.getItem('b2c_course_id'); return v ? parseInt(v) : null; } catch { return null; } })();
let _b2cSearch      = '';
let _b2cMonthFilter = ''; // default = все месяцы

// Kids section state (mirrors B2C)
let _kidsCourseId    = (() => { try { const v = sessionStorage.getItem('kids_course_id'); return v ? parseInt(v) : null; } catch { return null; } })();
let _kidsSearch      = '';
let _kidsMonthFilter = '';

// Generic section helpers
const _secState = {
  b2c:  { get courseId()  { return _b2cCourseId; },  set courseId(v)  { _b2cCourseId=v; try{v?sessionStorage.setItem('b2c_course_id',v):sessionStorage.removeItem('b2c_course_id')}catch{} },
           get search()    { return _b2cSearch; },    set search(v)    { _b2cSearch=v; },
           get monthFilter(){ return _b2cMonthFilter; },set monthFilter(v){ _b2cMonthFilter=v; },
           label:'Финансы В2С', api:'b2c' },
  kids: { get courseId()  { return _kidsCourseId; }, set courseId(v)  { _kidsCourseId=v; try{v?sessionStorage.setItem('kids_course_id',v):sessionStorage.removeItem('kids_course_id')}catch{} },
           get search()    { return _kidsSearch; },   set search(v)    { _kidsSearch=v; },
           get monthFilter(){ return _kidsMonthFilter; },set monthFilter(v){ _kidsMonthFilter=v; },
           label:'Финансы Kids', api:'kids' },
};

// Generic section page — works for both 'b2c' and 'kids'
async function renderSectionPage(sec) {
  const s = _secState[sec];
  if (!s) return;
  if (s.courseId) { await renderSectionCourse(sec, s.courseId); return; }
  // Temporarily redirect to B2C-style render with sec context
  _currentSec = sec;
  await _renderGenericCoursePage(sec);
}

let _currentSec = 'b2c';

async function _renderGenericCoursePage(sec) {
  const s = _secState[sec];
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';
  try {
    const courses = await GET(`/${s.api}/courses`);
    const now = new Date();
    const statsSource = s.monthFilter ? courses.filter(c=>(c.start_date||'').startsWith(s.monthFilter)) : courses;
    const totalCourses   = statsSource.length;
    const activeCourses  = statsSource.filter(c=>!c.end_date||new Date(c.end_date)>=now).length;
    const doneCourses    = statsSource.filter(c=>c.end_date&&new Date(c.end_date)<now).length;
    const totalStudents  = statsSource.reduce((sum,c)=>sum+(+c.student_count||0),0);
    const totalCollected = statsSource.reduce((sum,c)=>sum+(+c.total_collected||0),0);
    const totalPaid      = statsSource.reduce((sum,c)=>sum+(+c.total_paid||0),0);
    const totalDebt      = totalCollected - totalPaid;
    const paidPct        = totalCollected>0?Math.round(totalPaid/totalCollected*100):0;

    const MONTH_NAMES = ['Янв','Фев','Мар','Апр','Май','Июнь','Июль','Авг','Сен','Окт','Ноя','Дек'];
    const curM = now.toISOString().slice(0,7);
    const monthSet = new Set([curM]);
    courses.forEach(c=>{ if(c.start_date) monthSet.add(c.start_date.slice(0,7)); });
    const monthTabs = [...monthSet].sort().map(m=>{
      const [y,mo]=m.split('-');
      const isCur=m===curM, isActive=m===s.monthFilter;
      return `<button class="fin-tab ${isActive?'active':''} ${isCur&&!isActive?'be-month-tab-current':''}"
        onclick="_secState['${sec}'].monthFilter='${m}';renderSectionPage('${sec}')">
        ${MONTH_NAMES[+mo-1]} ${y}${isCur?'<span class="be-tab-now">сейчас</span>':''}
      </button>`;
    }).join('') + `<button class="fin-tab ${s.monthFilter===''?'active':''}" onclick="_secState['${sec}'].monthFilter='';renderSectionPage('${sec}')">Все</button>`;

    const filteredCourses = s.monthFilter
      ? courses.filter(c=>(c.start_date||'').startsWith(s.monthFilter) || !s.monthFilter.trim())
      : courses;
    const searchFilt = s.search.toLowerCase();

    content.innerHTML = `<div class="b2c-page">
      ${totalCourses>0?`
      <div class="b2c-dashboard">
        <div class="b2c-dash-row">
          <div class="b2c-dash-card"><div class="b2c-dash-icon" style="background:#ede9fe;color:#6d28d9">${svgI(SVG_PATHS.clip,18)}</div><div class="b2c-dash-info"><div class="b2c-dash-val">${totalCourses}</div><div class="b2c-dash-lbl">Всего курсов</div></div></div>
          <div class="b2c-dash-card"><div class="b2c-dash-icon" style="background:#dcfce7;color:#16a34a">${svgI(SVG_PATHS.check,18)}</div><div class="b2c-dash-info"><div class="b2c-dash-val" style="color:#16a34a">${activeCourses}</div><div class="b2c-dash-lbl">Активных</div></div></div>
          <div class="b2c-dash-card"><div class="b2c-dash-icon" style="background:#f3f4f6;color:#6b7280">${svgI(SVG_PATHS.cal,18)}</div><div class="b2c-dash-info"><div class="b2c-dash-val">${doneCourses}</div><div class="b2c-dash-lbl">Завершённых</div></div></div>
          <div class="b2c-dash-card"><div class="b2c-dash-icon" style="background:#dbeafe;color:#1d4ed8">${svgI(SVG_PATHS.users,18)}</div><div class="b2c-dash-info"><div class="b2c-dash-val" style="color:#1d4ed8">${totalStudents}</div><div class="b2c-dash-lbl">Студентов</div></div></div>
        </div>
        <div class="b2c-dash-row">
          <div class="b2c-dash-card b2c-dash-wide"><div class="b2c-dash-icon" style="background:#fef9c3;color:#b45309">${svgI(SVG_PATHS.bars,18)}</div>
            <div class="b2c-dash-info" style="flex:1">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <div><div class="b2c-dash-val">${fmtMoney(totalCollected)}</div><div class="b2c-dash-lbl">Сумма курсов</div></div>
                <div style="text-align:right"><div class="b2c-dash-val" style="color:#16a34a">${fmtMoney(totalPaid)}</div><div class="b2c-dash-lbl">Оплачено</div></div>
                <div style="text-align:right"><div class="b2c-dash-val" style="color:${totalDebt>0?'#dc2626':'#16a34a'}">${fmtMoney(totalDebt)}</div><div class="b2c-dash-lbl">Долг</div></div>
                <div style="text-align:right"><div class="b2c-dash-val" style="color:${paidPct>=80?'#16a34a':paidPct>=50?'#d97706':'#dc2626'}">${paidPct}%</div><div class="b2c-dash-lbl">Собрано</div></div>
              </div>
              <div class="fin-progress-bar-bg" style="margin-top:10px"><div class="fin-progress-bar-fill" style="width:${paidPct}%;background:${paidPct>=80?'#16a34a':paidPct>=50?'#d97706':'#dc2626'}"></div></div>
            </div>
          </div>
        </div>
      </div>` : ''}
      <div class="b2c-filter-bar">
        <div class="fin-search-wrap" style="max-width:240px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="fin-search-input" placeholder="Поиск по курсу или преподавателю..." value="${_escHtml(s.search)}"
            oninput="_secState['${sec}'].search=this.value;document.querySelectorAll('.b2c-course-card').forEach(c=>{c.style.display=!this.value||c.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none'})">
        </div>
        <div class="b2c-month-tabs">${monthTabs}</div>
      </div>
      <div class="b2c-courses-header">
        <div class="section-title" style="display:flex;align-items:center;gap:8px">${svgI(SVG_PATHS.users,16)} Курсы (${filteredCourses.length})</div>
        <button class="btn btn-blue" onclick="openSecCourseModal('${sec}')">＋ Создать курс</button>
      </div>
      ${filteredCourses.length===0
        ? `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.users,44)}</div><h3>Нет курсов</h3><p>Создайте первый курс чтобы начать работу</p></div>`
        : `<div class="b2c-courses-grid">
            ${filteredCourses.filter(c=>!searchFilt||c.title.toLowerCase().includes(searchFilt)||(c.teacher||'').toLowerCase().includes(searchFilt)).map(c=>`
              <div class="b2c-course-card" onclick="secOpenCourse('${sec}',${c.id})">
                <div class="b2c-course-title">${_escHtml(c.title)}</div>
                ${c.teacher?`<div class="b2c-course-meta">${svgI(SVG_PATHS.user,12)} ${_escHtml(c.teacher)}${c.teacher_phone?' · '+_escHtml(c.teacher_phone):''}</div>`:''}
                ${(c.start_date||c.end_date)?`<div class="b2c-course-meta">${svgI(SVG_PATHS.cal,12)} ${c.start_date||''}${c.end_date?' — '+c.end_date:''}</div>`:''}
                <div class="b2c-course-stats"><span>${c.student_count||0} студентов</span></div>
                <div class="b2c-course-finance">
                  <div class="b2c-cf-item"><span class="b2c-cf-lbl">Сумма</span><span class="b2c-cf-val">${fmtMoney(c.total_collected||0)}</span></div>
                  <div class="b2c-cf-item"><span class="b2c-cf-lbl">Оплачено</span><span class="b2c-cf-val" style="color:#16a34a">${fmtMoney(c.total_paid||0)}</span></div>
                  <div class="b2c-cf-item"><span class="b2c-cf-lbl">Долг</span><span class="b2c-cf-val" style="color:${((+c.total_collected||0)-(+c.total_paid||0))>0?'#dc2626':'#16a34a'}">${fmtMoney(Math.max(0,(+c.total_collected||0)-(+c.total_paid||0)))}</span></div>
                </div>
                ${(+c.total_collected||0)>0?`<div class="b2c-cf-bar"><div class="b2c-cf-bar-fill" style="width:${Math.round((+c.total_paid||0)/(+c.total_collected||1)*100)}%"></div></div>`:''}
                <div class="b2c-course-actions" onclick="event.stopPropagation()">
                  <button class="fin-btn-edit" onclick="openSecCourseModal('${sec}',${c.id})" title="Редактировать">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="fin-btn-del" onclick="deleteSecCourse('${sec}',${c.id})" title="Удалить">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                  </button>
                </div>
              </div>`).join('')}
          </div>`}
    </div>`;
  } catch(err) { content.innerHTML=`<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`; }
}

function secOpenCourse(sec, id) {
  _secState[sec].courseId = id;
  renderSectionPage(sec);
}

// Generic course detail — mirrors B2C course but uses sec API
async function renderSectionCourse(sec, courseId) {
  // Re-use B2C logic with sec-specific API prefix
  const s = _secState[sec];
  const content = document.getElementById('page-content');
  try {
    const [courses, payments] = await Promise.all([GET(`/${s.api}/courses`), GET(`/${s.api}/courses/${courseId}/payments`)]);
    const course = courses.find(c=>c.id===courseId);
    if (!course) { s.courseId=null; renderSectionPage(sec); return; }
    const totalSvc=payments.reduce((a,p)=>a+(+p.course_amount||0),0);
    const totalPaid=payments.reduce((a,p)=>a+(+p.amount||0),0);
    const totalDebt=totalSvc-totalPaid;
    const paidCount=payments.filter(p=>p.status==='paid').length;
    const unpaidCount=payments.filter(p=>p.status==='unpaid').length;
    const employees=state.users?.map(u=>u.name)||[];
    const tableRows=payments.map((p,i)=>`<tr class="b2c-row">
      <td class="b2c-td b2c-num">${i+1}</td>
      <td class="b2c-td b2c-name">${_escHtml(p.student_name)}</td>
      <td class="b2c-td"><span class="fin-status-badge" style="background:${B2C_STATUS_COLOR[p.status]||'#94a3b8'}22;color:${B2C_STATUS_COLOR[p.status]||'#94a3b8'}">${B2C_STATUS[p.status]||p.status}</span></td>
      <td class="b2c-td b2c-phone">${_escHtml(p.phone||'—')}</td>
      <td class="b2c-td b2c-amount">${fmtMoney(p.course_amount||0)}</td>
      <td class="b2c-td b2c-amount" style="color:#16a34a">${fmtMoney(p.amount)}</td>
      <td class="b2c-td b2c-amount" style="color:${(+p.course_amount-(+p.amount))>0?'#dc2626':'#16a34a'}">${fmtMoney(Math.max(0,(+p.course_amount||0)-(+p.amount||0)))}</td>
      <td class="b2c-td"><span class="fin-type-badge" style="background:${B2C_METHOD_COLOR[p.payment_method]||'#94a3b8'}22;color:${B2C_METHOD_COLOR[p.payment_method]||'#94a3b8'}">${B2C_METHOD[p.payment_method]||p.payment_method}</span></td>
      <td class="b2c-td" style="font-size:12.5px;font-weight:600">${p.received_by?p.received_by.split(' ')[0]:'—'}</td>
      <td class="b2c-td b2c-date">${p.payment_date||'—'}</td>
      <td class="b2c-td b2c-comment">${_escHtml(p.comment||'—')}</td>
      <td class="b2c-td b2c-actions">
        <button class="fin-btn-edit" onclick="openSecPaymentModal('${sec}',${courseId},${p.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="fin-btn-del" onclick="deleteSecPayment('${sec}',${p.id},${courseId})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
      </td></tr>`).join('');
    content.innerHTML=`<div class="b2c-page">
      <div class="b2c-course-header">
        <button class="btn btn-outline btn-sm" onclick="_secState['${sec}'].courseId=null;renderSectionPage('${sec}')" style="display:inline-flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Все курсы</button>
        <div class="b2c-course-info"><div class="b2c-course-title-big">${_escHtml(course.title)}</div>
          <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted)">
            ${course.teacher?`<span>${svgI(SVG_PATHS.user,12)} ${_escHtml(course.teacher)}</span>`:''}
            ${course.start_date?`<span>${svgI(SVG_PATHS.cal,12)} ${course.start_date}${course.end_date?' — '+course.end_date:''}</span>`:''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="exportSecExcel('${sec}',${courseId})">Excel</button>
          <button class="btn btn-blue" onclick="openSecPaymentModal('${sec}',${courseId})">＋ Добавить студента</button>
        </div>
      </div>
      <div class="b2c-stats" style="grid-template-columns:repeat(6,1fr)">
        <div class="b2c-stat"><div class="b2c-stat-val">${payments.length}</div><div class="b2c-stat-lbl">Студентов</div></div>
        <div class="b2c-stat"><div class="b2c-stat-val" style="color:#16a34a">${paidCount}</div><div class="b2c-stat-lbl">Оплатили</div></div>
        <div class="b2c-stat"><div class="b2c-stat-val" style="color:#dc2626">${unpaidCount}</div><div class="b2c-stat-lbl">Не оплатили</div></div>
        <div class="b2c-stat"><div class="b2c-stat-val">${fmtMoney(totalSvc)}</div><div class="b2c-stat-lbl">Сумма курсов</div></div>
        <div class="b2c-stat"><div class="b2c-stat-val" style="color:#16a34a">${fmtMoney(totalPaid)}</div><div class="b2c-stat-lbl">Итого оплачено</div></div>
        <div class="b2c-stat" style="border-color:${totalDebt>0?'#fecaca':'#bbf7d0'}"><div class="b2c-stat-val" style="color:${totalDebt>0?'#dc2626':'#16a34a'}">${fmtMoney(totalDebt)}</div><div class="b2c-stat-lbl">Долг</div></div>
      </div>
      <div class="b2c-table-wrap"><table class="b2c-table">
        <thead><tr><th>№</th><th>ФИО</th><th>Статус</th><th>Контакты</th><th>Сумма курса</th><th>Оплачено</th><th>Остаток</th><th>Способ оплаты</th><th>Принимал</th><th>Дата</th><th>Комментарий</th><th></th></tr></thead>
        <tbody id="sec-tbody">${tableRows}</tbody>
        ${payments.length>0?`<tfoot><tr class="fin-total-row">
          <td colspan="4" class="fin-td fin-total-lbl">ИТОГО</td>
          <td class="fin-td fin-money fin-total">${fmtMoney(totalSvc)}</td>
          <td class="fin-td fin-money fin-total" style="color:#16a34a">${fmtMoney(totalPaid)}</td>
          <td class="fin-td fin-money fin-total" style="color:${totalDebt>0?'#dc2626':'#16a34a'}">${fmtMoney(totalDebt)}</td>
          <td colspan="4"></td></tr></tfoot>`:''}
      </table>${payments.length===0?`<div style="text-align:center;padding:32px;color:#9ca3af">Добавьте первого студента</div>`:''}</div>
    </div>`;
  } catch(err){ content.innerHTML=`<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`; }
}

// Generic CRUD wrappers
function openSecCourseModal(sec, id=null) {
  GET(`/${_secState[sec].api}/courses`).then(courses=>{
    const c=id?courses.find(x=>x.id===id):null;
    const root=document.getElementById('modal-root');
    root.innerHTML=`<div class="modal-overlay" style="align-items:flex-start;padding-top:6vh" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:480px;max-height:85vh;overflow-y:auto">
        <div class="modal-header"><div class="modal-title">${c?'Редактировать курс':'Создать курс'}</div><button class="modal-close" onclick="closeModal()">✕</button></div>
        <div class="modal-body">
          <div class="field"><label>Название курса</label><input id="sc-title" class="input" value="${_escHtml(c?.title||'')}" placeholder="Название..."></div>
          <div class="form-row">
            <div class="field"><label>Преподаватель</label><input id="sc-teacher" class="input" value="${_escHtml(c?.teacher||'')}" placeholder="ФИО..."></div>
            <div class="field"><label>Телефон</label><input id="sc-phone" class="input" value="${_escHtml(c?.teacher_phone||'')}" placeholder="+992..."></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Дата начала</label><div class="cdp-wrap"><button type="button" class="cdp-trigger" id="cdp-trig-sc-start">${svgI(SVG_PATHS.cal,13,'style="color:var(--text-muted);flex-shrink:0"')}<span class="cdp-trigger-text"></span><span class="cdp-chevron">${svgI('<polyline points="6 9 12 15 18 9"/>',12)}</span></button><div class="cdp-dropdown hidden" id="cdp-drop-sc-start"></div><input type="hidden" id="sc-start"></div></div>
            <div class="field"><label>Дата конца</label><div class="cdp-wrap"><button type="button" class="cdp-trigger" id="cdp-trig-sc-end">${svgI(SVG_PATHS.cal,13,'style="color:var(--text-muted);flex-shrink:0"')}<span class="cdp-trigger-text"></span><span class="cdp-chevron">${svgI('<polyline points="6 9 12 15 18 9"/>',12)}</span></button><div class="cdp-dropdown hidden" id="cdp-drop-sc-end"></div><input type="hidden" id="sc-end"></div></div>
          </div>
        </div>
        <div class="modal-footer">
          ${c?`<button class="btn btn-danger" onclick="deleteSecCourse('${sec}',${c.id})">Удалить</button>`:''}
          <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
          <button class="btn btn-blue" onclick="saveSecCourse('${sec}',${c?c.id:'null'})">${c?'Сохранить':'Создать курс'}</button>
        </div>
      </div></div>`;
    setTimeout(()=>{ initCustomDatepicker('sc-start',c?.start_date||''); initCustomDatepicker('sc-end',c?.end_date||''); },0);
  });
}
async function saveSecCourse(sec,id) {
  const title=document.getElementById('sc-title').value.trim();
  if(!title) return toast('Введите название','error');
  const body={title, teacher:document.getElementById('sc-teacher').value.trim(), teacher_phone:document.getElementById('sc-phone').value.trim(), start_date:document.getElementById('sc-start').value, end_date:document.getElementById('sc-end').value};
  const api=_secState[sec].api;
  try { if(id&&id!=='null') await PUT(`/${api}/courses/${id}`,body); else { const r=await POST(`/${api}/courses`,body); _secState[sec].courseId=r.id; } closeModal(); renderSectionPage(sec); toast('Сохранено','success'); } catch(err){ toast(err.message,'error'); }
}
async function deleteSecCourse(sec,id) {
  if(!confirm('Удалить курс и всех студентов?')) return;
  await DEL(`/${_secState[sec].api}/courses/${id}`); _secState[sec].courseId=null; closeModal(); renderSectionPage(sec); toast('Удалено','success');
}
function openSecPaymentModal(sec,courseId,paymentId=null) {
  const employees=state.users?.map(u=>u.name)||[];
  const api=_secState[sec].api;
  window._secReceipt='';
  GET(`/${api}/courses/${courseId}/payments`).then(payments=>{
    const p=paymentId?payments.find(x=>x.id===paymentId):null;
    if(p?.receipt_img) window._secReceipt=p.receipt_img;
    const root=document.getElementById('modal-root');
    root.innerHTML=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:480px">
        <div class="modal-header"><div class="modal-title">${p?'Редактировать':'Добавить студента'}</div><button class="modal-close" onclick="closeModal()">✕</button></div>
        <div class="modal-body">
          <div class="form-row"><div class="field"><label>ФИО студента</label><input id="sp-name" class="input" value="${_escHtml(p?.student_name||'')}" placeholder="Иванов Иван..."></div><div class="field"><label>Контакт</label><input id="sp-phone" class="input" value="${_escHtml(p?.phone||'')}" placeholder="+992..."></div></div>
          <div class="form-row"><div class="field"><label>Сумма курса</label><input id="sp-camount" class="input" type="number" value="${p?.course_amount||''}" oninput="b2cAutoStatus2()"></div><div class="field"><label>Сумма оплаты</label><input id="sp-amount" class="input" type="number" value="${p?.amount||''}" oninput="b2cAutoStatus2()"></div></div>
          <div class="field"><label>Статус <span style="font-size:11px;color:var(--text-muted)">(авто)</span></label><div class="input" style="background:var(--bg);cursor:default;display:flex;align-items:center;gap:8px"><span id="sp-status-preview" style="font-weight:700"></span><span style="font-size:11px;color:var(--text-muted)">рассчитывается по суммам</span></div></div>
          <div class="form-row"><div class="field"><label>Способ оплаты</label><select id="sp-method" class="input">${Object.entries(B2C_METHOD).map(([k,v])=>`<option value="${k}" ${(p?.payment_method||'cash')===k?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Дата оплаты</label><input id="sp-date" class="input" type="date" value="${p?.payment_date||''}"></div></div>
          <div class="field"><label>Принимал оплату</label><select id="sp-receiver" class="input"><option value="">—</option>${employees.map(n=>`<option value="${n}" ${p?.received_by===n?'selected':''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label>Скриншот чека <span style="font-size:11px;color:var(--text-muted)">(макс. 1 МБ)</span></label>
            ${p?.receipt_img?`<div style="margin-bottom:8px"><img src="${p.receipt_img}" style="max-width:100%;max-height:120px;border-radius:8px;border:1.5px solid var(--border)"></div>`:''}
            <input type="file" id="sp-receipt" accept="image/*" style="display:none" onchange="secLoadReceipt(this)">
            <label for="sp-receipt" class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Загрузить чек</label>
            <img id="sp-receipt-preview" src="" style="display:none;max-width:100%;max-height:120px;border-radius:8px;border:1.5px solid var(--border);margin-top:8px">
          </div>
          <div class="field"><label>Комментарий</label><textarea id="sp-comment" class="input" rows="2">${_escHtml(p?.comment||'')}</textarea></div>
        </div>
        <div class="modal-footer">
          ${p?`<button class="btn btn-danger" onclick="deleteSecPayment('${sec}',${p.id},${courseId})">Удалить</button>`:''}
          <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
          <button class="btn btn-blue" onclick="saveSecPayment('${sec}',${courseId},${p?p.id:'null'})">${p?'Сохранить':'Добавить'}</button>
        </div>
      </div></div>`;
    setTimeout(()=>b2cAutoStatus2(),0);
  });
}
function b2cAutoStatus2() {
  const ca=parseFloat(document.getElementById('sp-camount')?.value)||0;
  const pa=parseFloat(document.getElementById('sp-amount')?.value)||0;
  const st=pa<=0?'unpaid':pa>=ca?'paid':'hybrid';
  const el=document.getElementById('sp-status-preview');
  if(el){el.textContent=B2C_STATUS[st];el.style.color=B2C_STATUS_COLOR[st];}
}
function secLoadReceipt(input){
  const file=input.files[0]; if(!file) return;
  if(file.size>1024*1024) return toast('Файл превышает 1 МБ','error');
  const reader=new FileReader();
  reader.onload=e=>{ window._secReceipt=e.target.result; const p=document.getElementById('sp-receipt-preview'); if(p){p.src=e.target.result;p.style.display='block';} };
  reader.readAsDataURL(file);
}
async function saveSecPayment(sec,courseId,id){
  const name=document.getElementById('sp-name').value.trim();
  if(!name) return toast('Введите ФИО','error');
  const api=_secState[sec].api;
  const body={student_name:name,phone:document.getElementById('sp-phone').value.trim(),course_amount:parseFloat(document.getElementById('sp-camount').value)||0,amount:parseFloat(document.getElementById('sp-amount').value)||0,payment_method:document.getElementById('sp-method').value,received_by:document.getElementById('sp-receiver').value,payment_date:document.getElementById('sp-date').value,comment:document.getElementById('sp-comment').value.trim(),receipt_img:window._secReceipt||''};
  try{ if(id&&id!=='null') await PUT(`/${api}/payments/${id}`,body); else await POST(`/${api}/courses/${courseId}/payments`,body); closeModal(); renderSectionCourse(sec,courseId); toast('Сохранено','success'); } catch(err){toast(err.message,'error');}
}
async function deleteSecPayment(sec,id,courseId){
  if(!confirm('Удалить студента?')) return;
  await DEL(`/${_secState[sec].api}/payments/${id}`); closeModal(); renderSectionCourse(sec,courseId); toast('Удалено','success');
}
async function exportSecExcel(sec,courseId){
  const s=_secState[sec];
  const [courses,payments]=await Promise.all([GET(`/${s.api}/courses`),GET(`/${s.api}/courses/${courseId}/payments`)]);
  const course=courses.find(c=>c.id===courseId);
  const data=payments.map((p,i)=>({'№':i+1,'ФИО':p.student_name,'Статус':B2C_STATUS[p.status]||p.status,'Контакт':p.phone,'Сумма курса':+p.course_amount,'Оплачено':+p.amount,'Остаток':(+p.course_amount||0)-(+p.amount||0),'Способ оплаты':B2C_METHOD[p.payment_method]||p.payment_method,'Принимал':p.received_by,'Дата':p.payment_date,'Комментарий':p.comment}));
  const ws=XLSX.utils.json_to_sheet(data); ws['!cols']=[{wch:4},{wch:24},{wch:12},{wch:14},{wch:12},{wch:12},{wch:12},{wch:12},{wch:14},{wch:10},{wch:24}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,course?.title||'Курс');
  XLSX.writeFile(wb,`${s.label}_${course?.title||courseId}.xlsx`); toast('Excel скачан','success');
}

async function renderB2CPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';
  if (_b2cCourseId) { await renderB2CCourse(_b2cCourseId); return; }
  try {
    const courses = await GET('/b2c/courses');

    // Stats filtered by selected month
    const now = new Date();
    const statsSource = _b2cMonthFilter
      ? courses.filter(c => (c.start_date||'').startsWith(_b2cMonthFilter))
      : courses;
    const totalCourses  = statsSource.length;
    const activeCourses = statsSource.filter(c => !c.end_date || new Date(c.end_date) >= now).length;
    const doneCourses   = statsSource.filter(c => c.end_date && new Date(c.end_date) < now).length;
    const totalStudents = statsSource.reduce((s,c)=>s+(+c.student_count||0),0);
    const totalCollected= statsSource.reduce((s,c)=>s+(+c.total_collected||0),0);
    const totalPaid     = statsSource.reduce((s,c)=>s+(+c.total_paid||0),0);
    const totalDebt     = totalCollected - totalPaid;
    const paidPct       = totalCollected > 0 ? Math.round(totalPaid/totalCollected*100) : 0;

    content.innerHTML = `
      <div class="b2c-page">
        <!-- Dashboard -->
        ${totalCourses > 0 ? `
        <div class="b2c-dashboard">
          <div class="b2c-dash-row">
            <div class="b2c-dash-card">
              <div class="b2c-dash-icon" style="background:#ede9fe;color:#6d28d9">${svgI(SVG_PATHS.clip,18)}</div>
              <div class="b2c-dash-info"><div class="b2c-dash-val">${totalCourses}</div><div class="b2c-dash-lbl">Всего курсов</div></div>
            </div>
            <div class="b2c-dash-card">
              <div class="b2c-dash-icon" style="background:#dcfce7;color:#16a34a">${svgI(SVG_PATHS.check,18)}</div>
              <div class="b2c-dash-info"><div class="b2c-dash-val" style="color:#16a34a">${activeCourses}</div><div class="b2c-dash-lbl">Активных</div></div>
            </div>
            <div class="b2c-dash-card">
              <div class="b2c-dash-icon" style="background:#f3f4f6;color:#6b7280">${svgI(SVG_PATHS.cal,18)}</div>
              <div class="b2c-dash-info"><div class="b2c-dash-val">${doneCourses}</div><div class="b2c-dash-lbl">Завершённых</div></div>
            </div>
            <div class="b2c-dash-card">
              <div class="b2c-dash-icon" style="background:#dbeafe;color:#1d4ed8">${svgI(SVG_PATHS.users,18)}</div>
              <div class="b2c-dash-info"><div class="b2c-dash-val" style="color:#1d4ed8">${totalStudents}</div><div class="b2c-dash-lbl">Студентов</div></div>
            </div>
          </div>
          <div class="b2c-dash-row">
            <div class="b2c-dash-card b2c-dash-wide">
              <div class="b2c-dash-icon" style="background:#fef9c3;color:#b45309">${svgI(SVG_PATHS.bars,18)}</div>
              <div class="b2c-dash-info" style="flex:1">
                <div style="display:flex;justify-content:space-between;align-items:baseline">
                  <div><div class="b2c-dash-val">${fmtMoney(totalCollected)}</div><div class="b2c-dash-lbl">Сумма курсов</div></div>
                  <div style="text-align:right"><div class="b2c-dash-val" style="color:#16a34a">${fmtMoney(totalPaid)}</div><div class="b2c-dash-lbl">Оплачено</div></div>
                  <div style="text-align:right"><div class="b2c-dash-val" style="color:${totalDebt>0?'#dc2626':'#16a34a'}">${fmtMoney(totalDebt)}</div><div class="b2c-dash-lbl">Долг</div></div>
                  <div style="text-align:right"><div class="b2c-dash-val" style="color:${paidPct>=80?'#16a34a':paidPct>=50?'#d97706':'#dc2626'}">${paidPct}%</div><div class="b2c-dash-lbl">Собрано</div></div>
                </div>
                <div class="fin-progress-bar-bg" style="margin-top:10px">
                  <div class="fin-progress-bar-fill" style="width:${paidPct}%;background:${paidPct>=80?'#16a34a':paidPct>=50?'#d97706':'#dc2626'}"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Search + Month filter -->
        <div class="b2c-filter-bar">
          <div class="fin-search-wrap" style="max-width:240px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="fin-search-input" id="b2c-search-input" placeholder="Поиск по курсу или преподавателю..." value="${_b2cSearch}" oninput="b2cFilterSearch(this.value)">
          </div>
          <div class="b2c-month-tabs" id="b2c-month-tabs">
            ${(() => {
              const MONTH_NAMES = ['Янв','Фев','Мар','Апр','Май','Июнь','Июль','Авг','Сен','Окт','Ноя','Дек'];
              const now = new Date();
              const curM = now.toISOString().slice(0,7);
              // Get unique months from courses (start_date) + current month
              const months = new Set([curM]);
              courses.forEach(c => { if (c.start_date) months.add(c.start_date.slice(0,7)); });
              return [...months].sort().map(m => {
                const [y,mo] = m.split('-');
                const isCur = m === curM;
                const isActive = m === _b2cMonthFilter;
                return `<button class="fin-tab ${isActive?'active':''} ${isCur&&!isActive?'be-month-tab-current':''}"
                  onclick="_b2cMonthFilter='${m}';renderB2CPage()">
                  ${MONTH_NAMES[+mo-1]} ${y}${isCur?'<span class="be-tab-now">сейчас</span>':''}
                </button>`;
              }).join('') + `<button class="fin-tab ${_b2cMonthFilter===''?'active':''}" onclick="_b2cMonthFilter='';renderB2CPage()">Все</button>`;
            })()}
          </div>
        </div>

        <div class="b2c-courses-header">
          <div class="section-title" style="display:flex;align-items:center;gap:8px">
            ${svgI(SVG_PATHS.users,16)} Курсы (${totalCourses})
          </div>
          <button class="btn btn-blue" onclick="openB2CCourseModal()">＋ Создать курс</button>
        </div>
        ${totalCourses === 0
          ? `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.users,44)}</div><h3>Нет курсов</h3><p>Создайте первый курс чтобы начать работу</p></div>`
          : `<div class="b2c-courses-grid">
              ${courses.filter(c => {
                const matchSearch = !_b2cSearch || c.title.toLowerCase().includes(_b2cSearch.toLowerCase()) || (c.teacher||'').toLowerCase().includes(_b2cSearch.toLowerCase());
                const matchMonth  = !_b2cMonthFilter || (c.start_date||'').startsWith(_b2cMonthFilter);
                return matchSearch && matchMonth;
              }).map(c => {
                const collected = +c.total_collected||0;
                const paid      = +c.total_paid||0;
                const debt      = Math.max(0, collected - paid);
                const pct       = collected > 0 ? Math.round(paid/collected*100) : 0;
                const now       = new Date();
                const isActive  = !c.end_date || new Date(c.end_date) >= now;
                const sc        = +c.student_count||0;
                const scWord    = sc===1?'студент':sc>=2&&sc<=4?'студента':'студентов';
                const fmtD = raw => {
                  if (!raw) return '';
                  const d = new Date(raw);
                  if (isNaN(d.getTime())) return raw.slice(0,10);
                  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
                  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
                };
                const dateStr = (c.start_date||c.end_date)
                  ? (c.start_date && c.end_date
                      ? `${fmtD(c.start_date)} — ${fmtD(c.end_date)}`
                      : fmtD(c.start_date||c.end_date))
                  : '';
                const pctColor = pct>=80?'#16a34a':pct>=50?'#d97706':'#dc2626';
                return `
                <div class="b2c-course-card b2c-card-v2" onclick="b2cOpenCourse(${c.id})">
                  <div class="b2c-card-v2-head">
                    <div class="b2c-card-v2-title">${_escHtml(c.title)}</div>
                    <div class="b2c-card-v2-actions" onclick="event.stopPropagation()">
                      <button class="fin-btn-edit" onclick="openB2CCourseModal(${c.id})" title="Редактировать">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button class="fin-btn-del" onclick="deleteB2CCourse(${c.id})" title="Удалить">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                      </button>
                    </div>
                  </div>

                  <span class="b2c-card-v2-status ${isActive?'active':'done'}">${isActive?'● Активный':'✓ Завершён'}</span>

                  ${c.teacher?`<div class="b2c-card-v2-meta">${svgI(SVG_PATHS.user,11)} ${_escHtml(c.teacher)}${c.teacher_phone?` <span class="b2c-card-v2-phone">· ${_escHtml(c.teacher_phone)}</span>`:''}</div>`:''}
                  ${dateStr?`<div class="b2c-card-v2-meta">${svgI(SVG_PATHS.cal,11)} ${dateStr}</div>`:''}

                  <div class="b2c-card-v2-students">
                    <span class="b2c-card-v2-students-num">${sc}</span>
                    <span class="b2c-card-v2-students-lbl">${scWord}</span>
                  </div>

                  <div class="b2c-card-v2-finance">
                    <div class="b2c-card-v2-fin-item">
                      <span class="b2c-card-v2-fin-lbl">Сумма</span>
                      <span class="b2c-card-v2-fin-val">${fmtMoney(collected)}</span>
                    </div>
                    <div class="b2c-card-v2-fin-divider"></div>
                    <div class="b2c-card-v2-fin-item">
                      <span class="b2c-card-v2-fin-lbl">Оплачено</span>
                      <span class="b2c-card-v2-fin-val" style="color:#16a34a">${fmtMoney(paid)}</span>
                    </div>
                    <div class="b2c-card-v2-fin-divider"></div>
                    <div class="b2c-card-v2-fin-item">
                      <span class="b2c-card-v2-fin-lbl">Долг</span>
                      <span class="b2c-card-v2-fin-val" style="color:${debt>0?'#dc2626':'#16a34a'}">${fmtMoney(debt)}</span>
                    </div>
                  </div>

                  ${collected>0?`
                  <div class="b2c-card-v2-progress-wrap">
                    <div class="b2c-card-v2-progress-bar">
                      <div class="b2c-card-v2-progress-fill" style="width:${pct}%;background:${pctColor}"></div>
                    </div>
                    <span class="b2c-card-v2-pct" style="color:${pctColor}">${pct}%</span>
                  </div>`:''}
                </div>`;
              }).join('')}
            </div>`}
      </div>`;
  } catch (err) { content.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`; }
}

async function renderB2CCourse(courseId) {
  const content = document.getElementById('page-content');
  try {
    const [courses, payments] = await Promise.all([
      GET('/b2c/courses'),
      GET(`/b2c/courses/${courseId}/payments`)
    ]);
    const course = courses.find(c => c.id === courseId);
    if (!course) { _b2cCourseId = null; renderB2CPage(); return; }

    const totalSvc    = payments.reduce((s,p)=>s+(+p.course_amount||0),0); // сумма курсов
    const totalPaid   = payments.reduce((s,p)=>s+(+p.amount||0),0);        // итого оплачено
    const totalDebt   = totalSvc - totalPaid;
    const paidCount   = payments.filter(p=>p.status==='paid').length;
    const unpaidCount = payments.filter(p=>p.status==='unpaid').length;
    const employees = state.users?.map(u=>u.name)||[];

    const tableRows = payments.map((p,i) => `
      <tr class="b2c-row" id="b2c-row-${p.id}">
        <td class="b2c-td b2c-num">${i+1}</td>
        <td class="b2c-td b2c-name">${_escHtml(p.student_name)}</td>
        <td class="b2c-td">
          <span class="fin-status-badge" style="background:${B2C_STATUS_COLOR[p.status]||'#94a3b8'}22;color:${B2C_STATUS_COLOR[p.status]||'#94a3b8'}">${B2C_STATUS[p.status]||p.status}</span>
        </td>
        <td class="b2c-td b2c-phone">${_escHtml(p.phone||'—')}</td>
        <td class="b2c-td b2c-amount">${fmtMoney(p.course_amount||0)}</td>
        <td class="b2c-td b2c-amount" style="color:#16a34a">${fmtMoney(p.amount)}</td>
        <td class="b2c-td b2c-amount" style="color:${(+p.course_amount-(+p.amount))>0?'#dc2626':'#16a34a'}">${fmtMoney(Math.max(0,(+p.course_amount||0)-(+p.amount||0)))}</td>
        <td class="b2c-td">
          <span class="fin-type-badge" style="background:${B2C_METHOD_COLOR[p.payment_method]||'#94a3b8'}22;color:${B2C_METHOD_COLOR[p.payment_method]||'#94a3b8'}">${B2C_METHOD[p.payment_method]||p.payment_method}</span>
        </td>
        <td class="b2c-td" style="font-size:12.5px;font-weight:600">${p.received_by ? p.received_by.split(' ')[0] : '—'}</td>
        <td class="b2c-td b2c-date">${p.payment_date||'—'}</td>
        <td class="b2c-td b2c-comment">${_escHtml(p.comment||'—')}</td>
        <td class="b2c-td b2c-actions">
          <button class="fin-btn-edit" onclick="openB2CPaymentModal(${courseId},${p.id})" title="Редактировать">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="fin-btn-del" onclick="deleteB2CPayment(${p.id},${courseId})" title="Удалить">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </td>
      </tr>`).join('');

    content.innerHTML = `
      <div class="b2c-page">
        <div class="b2c-course-header">
          <button class="btn btn-outline btn-sm" onclick="_b2cCourseId=null;try{sessionStorage.removeItem('b2c_course_id')}catch{};renderB2CPage()" style="display:inline-flex;align-items:center;gap:5px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Все курсы
          </button>
          <div class="b2c-course-info">
            <div class="b2c-course-title-big">${_escHtml(course.title)}</div>
            <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted)">
              ${course.teacher?`<span>${svgI(SVG_PATHS.user,12)} ${_escHtml(course.teacher)}</span>`:''}
              ${course.start_date?`<span>${svgI(SVG_PATHS.cal,12)} ${course.start_date}${course.end_date?' — '+course.end_date:''}</span>`:''}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-outline btn-sm" onclick="exportB2CExcel(${courseId})" title="Excel">Excel</button>
            <button class="btn btn-blue" onclick="openB2CPaymentModal(${courseId})">＋ Добавить студента</button>
          </div>
        </div>

        <!-- Stats -->
        <div class="b2c-stats" style="grid-template-columns:repeat(6,1fr)">
          <div class="b2c-stat"><div class="b2c-stat-val">${payments.length}</div><div class="b2c-stat-lbl">Студентов</div></div>
          <div class="b2c-stat"><div class="b2c-stat-val" style="color:#16a34a">${paidCount}</div><div class="b2c-stat-lbl">Оплатили</div></div>
          <div class="b2c-stat"><div class="b2c-stat-val" style="color:#dc2626">${unpaidCount}</div><div class="b2c-stat-lbl">Не оплатили</div></div>
          <div class="b2c-stat"><div class="b2c-stat-val">${fmtMoney(totalSvc)}</div><div class="b2c-stat-lbl">Сумма курсов</div></div>
          <div class="b2c-stat"><div class="b2c-stat-val" style="color:#16a34a">${fmtMoney(totalPaid)}</div><div class="b2c-stat-lbl">Итого оплачено</div></div>
          <div class="b2c-stat" style="border-color:${totalDebt>0?'#fecaca':'#bbf7d0'}"><div class="b2c-stat-val" style="color:${totalDebt>0?'#dc2626':'#16a34a'}">${fmtMoney(totalDebt)}</div><div class="b2c-stat-lbl">Долг</div></div>
        </div>

        <!-- Table -->
        <div class="b2c-table-wrap">
          <table class="b2c-table">
            <thead>
              <tr>
                <th>№</th><th>ФИО</th><th>Статус</th><th>Контакты</th>
                <th>Сумма курса</th><th>Оплачено</th><th>Остаток</th>
                <th>Способ оплаты</th><th>Принимал</th>
                <th>Дата</th><th>Комментарий</th><th></th>
              </tr>
            </thead>
            <tbody id="b2c-tbody">${tableRows}</tbody>
            ${payments.length>0?`<tfoot><tr class="fin-total-row">
              <td colspan="4" class="fin-td fin-total-lbl">ИТОГО</td>
              <td class="fin-td fin-money fin-total">${fmtMoney(totalSvc)}</td>
              <td class="fin-td fin-money fin-total" style="color:#16a34a">${fmtMoney(totalPaid)}</td>
              <td class="fin-td fin-money fin-total" style="color:${totalDebt>0?'#dc2626':'#16a34a'}">${fmtMoney(totalDebt)}</td>
              <td colspan="4"></td>
            </tr></tfoot>`:''}
          </table>
          ${payments.length===0?`<div style="text-align:center;padding:32px;color:#9ca3af">Добавьте первого студента</div>`:''}
        </div>
      </div>`;
  } catch (err) { content.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`; }
}

function b2cFilterSearch(q) {
  _b2cSearch = q;
  document.querySelectorAll('.b2c-course-card').forEach(card => {
    card.style.display = !q || card.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

function b2cOpenCourse(id) {
  _b2cCourseId = id;
  try { sessionStorage.setItem('b2c_course_id', id); } catch {}
  renderB2CPage();
}

async function b2cUpdateField(paymentId, field, value, selectEl) {
  // Inline update — change color immediately
  if (field === 'status') {
    selectEl.style.color = B2C_STATUS_COLOR[value]||'#374151';
    selectEl.style.background = (B2C_STATUS_COLOR[value]||'#374151') + '18';
  }
  if (field === 'payment_method') {
    selectEl.style.color = B2C_METHOD_COLOR[value]||'#374151';
    selectEl.style.background = (B2C_METHOD_COLOR[value]||'#374151') + '18';
  }
  // Get current row data
  const rows = await GET(`/b2c/courses/${_b2cCourseId}/payments`).catch(()=>[]);
  const p = rows.find(r=>r.id===paymentId);
  if (!p) return;
  await PUT(`/b2c/payments/${paymentId}`, { ...p, [field]: value }).catch(err=>toast(err.message,'error'));
}

function openB2CCourseModal(id=null) {
  GET('/b2c/courses').then(courses => {
    const c = id ? courses.find(x=>x.id===id) : null;
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay" style="align-items:flex-start;padding-top:6vh" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:480px;max-height:85vh;overflow-y:auto">
          <div class="modal-header">
            <div class="modal-title">${c?'Редактировать курс':'Создать курс'}</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="field"><label>Название курса</label>
              <input id="b2c-course-title" class="input" value="${_escHtml(c?.title||'')}" placeholder="Название...">
            </div>
            <div class="form-row">
              <div class="field"><label>Преподаватель курса</label>
                <input id="b2c-course-teacher" class="input" value="${_escHtml(c?.teacher||'')}" placeholder="ФИО преподавателя...">
              </div>
              <div class="field"><label>Телефон преподавателя</label>
                <input id="b2c-course-teacher-phone" class="input" value="${_escHtml(c?.teacher_phone||'')}" placeholder="+992...">
              </div>
            </div>
            <div class="form-row">
              <div class="field"><label>Дата начала</label>
                <div class="cdp-wrap">
                  <button type="button" class="cdp-trigger" id="cdp-trig-b2c-start">
                    ${svgI(SVG_PATHS.cal,13,'style="color:var(--text-muted);flex-shrink:0"')}
                    <span class="cdp-trigger-text"></span>
                    <span class="cdp-chevron">${svgI('<polyline points="6 9 12 15 18 9"/>',12)}</span>
                  </button>
                  <div class="cdp-dropdown hidden" id="cdp-drop-b2c-start"></div>
                  <input type="hidden" id="b2c-start">
                </div>
              </div>
              <div class="field"><label>Дата конца</label>
                <div class="cdp-wrap">
                  <button type="button" class="cdp-trigger" id="cdp-trig-b2c-end">
                    ${svgI(SVG_PATHS.cal,13,'style="color:var(--text-muted);flex-shrink:0"')}
                    <span class="cdp-trigger-text"></span>
                    <span class="cdp-chevron">${svgI('<polyline points="6 9 12 15 18 9"/>',12)}</span>
                  </button>
                  <div class="cdp-dropdown hidden" id="cdp-drop-b2c-end"></div>
                  <input type="hidden" id="b2c-end">
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            ${c?`<button class="btn btn-danger" onclick="deleteB2CCourse(${c.id})">Удалить</button>`:''}
            <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
            <button class="btn btn-blue" onclick="saveB2CCourse(${c?c.id:'null'})">${c?'Сохранить':'Создать курс'}</button>
          </div>
        </div>
      </div>`;
    _initB2CCourseDates(c?.start_date||'', c?.end_date||'');
  });
}

function _initB2CCourseDates(startVal, endVal) {
  setTimeout(() => {
    initCustomDatepicker('b2c-start', startVal || '');
    initCustomDatepicker('b2c-end',   endVal   || '');
  }, 0);
}

async function saveB2CCourse(id) {
  const title = document.getElementById('b2c-course-title').value.trim();
  if (!title) return toast('Введите название', 'error');
  const body = { title, teacher: document.getElementById('b2c-course-teacher').value.trim(), teacher_phone: document.getElementById('b2c-course-teacher-phone').value.trim(), start_date: document.getElementById('b2c-start').value, end_date: document.getElementById('b2c-end').value };
  try {
    if (id && id!=='null') await PUT(`/b2c/courses/${id}`, body);
    else { const r = await POST('/b2c/courses', body); _b2cCourseId = r.id; }
    closeModal(); renderB2CPage(); toast('Сохранено','success');
  } catch (err) { toast(err.message,'error'); }
}

async function deleteB2CCourse(id) {
  if (!confirm('Удалить курс и всех студентов?')) return;
  await DEL(`/b2c/courses/${id}`); _b2cCourseId=null; closeModal(); renderB2CPage(); toast('Удалено','success');
}

function openB2CPaymentModal(courseId, paymentId=null) {
  const employees = state.users?.map(u=>u.name)||[];
  window._b2cReceipt = '';
  GET(`/b2c/courses/${courseId}/payments`).then(payments => {
    const p = paymentId ? payments.find(x=>x.id===paymentId) : null;
    if (p?.receipt_img) window._b2cReceipt = p.receipt_img;
    const root = document.getElementById('modal-root');
    setTimeout(() => b2cAutoStatus(), 50);
    root.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:480px">
          <div class="modal-header">
            <div class="modal-title">${p?'Редактировать':'Добавить студента'}</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="field"><label>ФИО студента</label>
                <input id="b2c-name" class="input" value="${_escHtml(p?.student_name||'')}" placeholder="Иванов Иван...">
              </div>
              <div class="field"><label>Контакт (телефон)</label>
                <input id="b2c-phone" class="input" value="${_escHtml(p?.phone||'')}" placeholder="+992...">
              </div>
            </div>
            <div class="form-row">
              <div class="field"><label>Сумма курса</label>
                <input id="b2c-course-amount" class="input" type="number" value="${p?.course_amount||''}" placeholder="0" oninput="b2cAutoStatus()">
              </div>
              <div class="field"><label>Сумма оплаты</label>
                <input id="b2c-amount" class="input" type="number" value="${p?.amount||''}" placeholder="0" oninput="b2cAutoStatus()">
              </div>
            </div>
            <div class="field" style="margin-top:-4px">
              <label>Статус оплаты <span style="font-size:11px;color:var(--text-muted)">(авто)</span></label>
              <div class="input" style="background:var(--bg);cursor:default;display:flex;align-items:center;gap:8px">
                <span id="b2c-status-preview" style="font-weight:700"></span>
                <span style="font-size:11px;color:var(--text-muted)">рассчитывается по суммам</span>
              </div>
            </div>
            <div class="form-row">
              <div class="field"><label>Способ оплаты</label>
                <select id="b2c-method" class="input">
                  ${Object.entries(B2C_METHOD).map(([k,v])=>`<option value="${k}" ${(p?.payment_method||'cash')===k?'selected':''}>${v}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>Дата оплаты</label>
                <input id="b2c-date" class="input" type="date" value="${p?.payment_date||''}">
              </div>
            </div>
            <div class="field"><label>Принимал оплату</label>
              <select id="b2c-receiver" class="input">
                <option value="">—</option>
                ${employees.map(n=>`<option value="${n}" ${p?.received_by===n?'selected':''}>${n}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Скриншот чека <span style="font-size:11px;color:var(--text-muted)">(макс. 1 МБ)</span></label>
              ${p?.receipt_img ? `<div style="margin-bottom:8px"><img src="${p.receipt_img}" style="max-width:100%;max-height:120px;border-radius:8px;border:1.5px solid var(--border)"><button class="btn btn-outline btn-sm" style="margin-top:4px;color:#dc2626" onclick="document.getElementById('b2c-receipt-preview').src='';window._b2cReceipt=''">Удалить</button></div>` : ''}
              <input type="file" id="b2c-receipt" accept="image/*" style="display:none" onchange="b2cLoadReceipt(this)">
              <label for="b2c-receipt" class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                Загрузить скриншот
              </label>
              <img id="b2c-receipt-preview" src="" style="display:none;max-width:100%;max-height:120px;border-radius:8px;border:1.5px solid var(--border);margin-top:8px">
            </div>
            <div class="field"><label>Комментарий</label>
              <textarea id="b2c-comment" class="input" rows="2">${_escHtml(p?.comment||'')}</textarea>
            </div>
          </div>
          <div class="modal-footer">
            ${p?`<button class="btn btn-danger" onclick="deleteB2CPayment(${p.id},${courseId})">Удалить</button>`:''}
            <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
            <button class="btn btn-blue" onclick="saveB2CPayment(${courseId},${p?p.id:'null'})">${p?'Сохранить':'Добавить'}</button>
          </div>
        </div>
      </div>`;
  });
}

function b2cAutoStatus() {
  const ca = parseFloat(document.getElementById('b2c-course-amount')?.value)||0;
  const pa = parseFloat(document.getElementById('b2c-amount')?.value)||0;
  const st = pa<=0?'unpaid': pa>=ca?'paid':'hybrid';
  const el = document.getElementById('b2c-status-preview');
  if (el) { el.textContent = B2C_STATUS[st]; el.style.color = B2C_STATUS_COLOR[st]; }
}

function b2cLoadReceipt(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 1024*1024) return toast('Файл превышает 1 МБ','error');
  const reader = new FileReader();
  reader.onload = e => {
    window._b2cReceipt = e.target.result;
    const prev = document.getElementById('b2c-receipt-preview');
    if (prev) { prev.src = e.target.result; prev.style.display = 'block'; }
  };
  reader.readAsDataURL(file);
}

async function saveB2CPayment(courseId, id) {
  const name = document.getElementById('b2c-name').value.trim();
  if (!name) return toast('Введите ФИО','error');
  const body = { student_name:name, phone:document.getElementById('b2c-phone').value.trim(), course_amount:parseFloat(document.getElementById('b2c-course-amount').value)||0, amount:parseFloat(document.getElementById('b2c-amount').value)||0, payment_method:document.getElementById('b2c-method').value, received_by:document.getElementById('b2c-receiver').value, payment_date:document.getElementById('b2c-date').value, comment:document.getElementById('b2c-comment').value.trim(), receipt_img:window._b2cReceipt||'' };
  try {
    if (id && id!=='null') await PUT(`/b2c/payments/${id}`, body);
    else await POST(`/b2c/courses/${courseId}/payments`, body);
    closeModal(); renderB2CCourse(courseId); toast('Сохранено','success');
  } catch (err) { toast(err.message,'error'); }
}

async function deleteB2CPayment(id, courseId) {
  if (!confirm('Удалить студента?')) return;
  await DEL(`/b2c/payments/${id}`); closeModal(); renderB2CCourse(courseId); toast('Удалено','success');
}

async function exportB2CExcel(courseId) {
  const [courses, payments] = await Promise.all([GET('/b2c/courses'), GET(`/b2c/courses/${courseId}/payments`)]);
  const course = courses.find(c=>c.id===courseId);
  const data = payments.map((p,i)=>({ '№':i+1, 'ФИО':p.student_name, 'Статус':B2C_STATUS[p.status]||p.status, 'Контакт':p.phone, 'Сумма':+p.amount, 'Способ оплаты':B2C_METHOD[p.payment_method]||p.payment_method, 'Принимал':p.received_by, 'Дата':p.payment_date, 'Комментарий':p.comment }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols']=[{wch:4},{wch:24},{wch:12},{wch:14},{wch:10},{wch:12},{wch:14},{wch:10},{wch:24}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, course?.title||'Курс');
  XLSX.writeFile(wb, `B2C_${course?.title||courseId}.xlsx`); toast('Excel скачан','success');
}

// ─── Team Tasks Page (for manage_team users) ─────────────────────────────────
let _teamTasksFilter = { status: '', assignee_id: '', search: '', overdue: false };
let _teamTasksCache  = []; // cached tasks to avoid re-fetching on search

async function renderTeamTasksPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';
  try {
    const [allTasks, users] = await Promise.all([GET('/tasks'), GET('/users')]);
    state.users = users;
    _teamTasksCache = allTasks.filter(t => t.assignee_id || (t.multi_assignees||[]).length);

    const employeeOptions = `<option value="">Все сотрудники</option>` +
      users.filter(u => u.role !== 'admin').map(u =>
        `<option value="${u.id}" ${_teamTasksFilter.assignee_id === String(u.id) ? 'selected' : ''}>${u.name}</option>`
      ).join('');

    content.innerHTML = `
      <div style="padding:0 0 40px">
        <div class="dash-stat-cards" style="margin-bottom:16px" id="tt-stats"></div>
        <div class="filters">
          <div class="search-wrap">
            <input class="search-input" id="tt-search" placeholder="Поиск задач..." value="${_escHtml(_teamTasksFilter.search)}"
              oninput="_teamTasksFilter.search=this.value;_renderTeamTasksList()">
          </div>
          <div class="employee-filter">
            <select id="tt-employee" onchange="_teamTasksFilter.assignee_id=this.value;_renderTeamTasksList()">
              ${employeeOptions}
            </select>
          </div>
          <button id="tt-btn-all" class="filter-btn" onclick="_teamTasksFilter.status='';_teamTasksFilter.overdue=false;_renderTeamTasksList()">Все</button>
          <button id="tt-btn-new" class="filter-btn" onclick="_teamTasksFilter.status='new';_teamTasksFilter.overdue=false;_renderTeamTasksList()" style="display:inline-flex;align-items:center;gap:5px">${colorDot('#3B82F6')} Новые</button>
          <button id="tt-btn-inp" class="filter-btn" onclick="_teamTasksFilter.status='in_progress';_teamTasksFilter.overdue=false;_renderTeamTasksList()" style="display:inline-flex;align-items:center;gap:5px">${colorDot('#D97706')} В работе</button>
          <button id="tt-btn-done" class="filter-btn" onclick="_teamTasksFilter.status='done';_teamTasksFilter.overdue=false;_renderTeamTasksList()" style="display:inline-flex;align-items:center;gap:5px">${colorDot('#059669')} Готово</button>
          <button id="tt-btn-ov" class="filter-btn" onclick="_teamTasksFilter.overdue=true;_teamTasksFilter.status='';_renderTeamTasksList()" style="display:inline-flex;align-items:center;gap:5px">${svgI(SVG_PATHS.warning)} Просрочено</button>
        </div>
        <div id="tt-task-list"></div>
      </div>`;

    _renderTeamTasksList();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Ошибка</h3><p>${err.message}</p></div>`;
  }
}

function _renderTeamTasksList() {
  // Apply filters client-side from cache — no API call, no focus loss
  let tasks = _teamTasksCache;
  if (_teamTasksFilter.assignee_id) {
    tasks = tasks.filter(t =>
      String(t.assignee_id) === _teamTasksFilter.assignee_id ||
      (t.multi_assignees||[]).some(a => String(a.id) === _teamTasksFilter.assignee_id)
    );
  }
  if (_teamTasksFilter.status)  tasks = tasks.filter(t => t.status === _teamTasksFilter.status);
  if (_teamTasksFilter.overdue) tasks = tasks.filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) < new Date());
  if (_teamTasksFilter.search) {
    const q = _teamTasksFilter.search.toLowerCase();
    tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || (t.assignee_name||'').toLowerCase().includes(q));
  }

  // Update active filter buttons
  ['all','new','inp','done','ov'].forEach(id => {
    const btn = document.getElementById('tt-btn-' + id);
    if (!btn) return;
    const active =
      (id==='all'  && !_teamTasksFilter.status && !_teamTasksFilter.overdue) ||
      (id==='new'  && _teamTasksFilter.status==='new') ||
      (id==='inp'  && _teamTasksFilter.status==='in_progress') ||
      (id==='done' && _teamTasksFilter.status==='done') ||
      (id==='ov'   && _teamTasksFilter.overdue);
    btn.classList.toggle('active', active);
  });

  // Update stats
  const total    = tasks.length;
  const done     = tasks.filter(t => t.status === 'done').length;
  const inProg   = tasks.filter(t => t.status === 'in_progress').length;
  const overdueN = tasks.filter(t => t.status !== 'done' && t.deadline && parseDeadline(t.deadline) < new Date()).length;
  const statsEl  = document.getElementById('tt-stats');
  if (statsEl) statsEl.innerHTML = `
    <div class="dash-stat-card"><div class="dsc-label">Всего задач</div><div class="dsc-value">${total}</div></div>
    <div class="dash-stat-card"><div class="dsc-label">Выполнено</div><div class="dsc-value dsc-value--green">${done}</div></div>
    <div class="dash-stat-card"><div class="dsc-label">В работе</div><div class="dsc-value" style="color:#D97706">${inProg}</div></div>
    <div class="dash-stat-card"><div class="dsc-label">Просрочено</div><div class="dsc-value ${overdueN>0?'dsc-value--red':''}">${overdueN}</div></div>`;

  // Update task list
  const listEl = document.getElementById('tt-task-list');
  if (!listEl) return;

  listEl.innerHTML = tasks.length === 0
    ? `<div class="empty-state"><div class="empty-icon">${svgI(SVG_PATHS.clip,44)}</div><h3>Нет задач</h3><p>Измените фильтры</p></div>`
    : `<div class="tasks-list">${tasks.map(t => taskCard(t)).join('')}</div>`;

  attachTaskCardListeners();
}

// ─── Schedule Page ────────────────────────────────────────────────────────────
const SCHED_DAYS   = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const SCHED_CLASSES = [
  { id: 0, name: 'Чёрный',     color: '#4b5563', bg: '#f3f4f6', light: '#e5e7eb' },
  { id: 1, name: 'Зелёный',    color: '#15803d', bg: '#f0fdf4', light: '#bbf7d0' },
  { id: 2, name: 'Красный',    color: '#b91c1c', bg: '#fef2f2', light: '#fecaca' },
  { id: 3, name: 'Фиолетовый', color: '#6d28d9', bg: '#f5f3ff', light: '#ddd6fe' },
  { id: 4, name: 'Жёлтый',     color: '#b45309', bg: '#fffbeb', light: '#fde68a' },
];
const SCHED_START = 8;
const SCHED_END   = 22;
const SCHED_HOUR_H = 64;

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}

let _schedDrag   = null; // { id, durMin, title, comment }
let _schedCache  = [];  // last fetched events
let _schedFilter = { search: '', classes: new Set(SCHED_CLASSES.map(c => c.id)) };

function _escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function renderSchedulePage() {
  const content = document.getElementById('page-content');
  content.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af">Загрузка...</div>';

  try { _schedCache = await GET('/schedule'); } catch { _schedCache = []; }

  const canEdit = state.user?.role === 'admin' || can('manage_schedule');
  const hours = [];
  for (let h = SCHED_START; h <= SCHED_END; h++) hours.push(h);

  let html = `
    <div class="sched-page">
      <div class="sched-toolbar">
        <div class="sched-filter-bar">
          <input class="sched-search input" id="sched-search" placeholder="Поиск по названию..." value="${_escHtml(_schedFilter.search)}" oninput="schedFilterSearch(this.value)">
          <div class="sched-class-filters">
            ${SCHED_CLASSES.map(c => `
              <button class="sched-cls-btn ${_schedFilter.classes.has(c.id) ? 'active' : ''}"
                style="--cls-color:${c.color}"
                onclick="schedToggleClass(${c.id})">${c.name}</button>
            `).join('')}
          </div>
        </div>
        <div class="sched-toolbar-right">
          ${canEdit ? `<button class="btn btn-blue" onclick="openScheduleModal()">＋ Добавить</button>` : ''}
          <button class="btn btn-outline" onclick="window.print()" title="Экспорт в PDF">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Печать / PDF
          </button>
        </div>
      </div>
      <div class="sched-outer">
        <div class="sched-scroll-area">
          <div class="sched-head">
            <div class="sched-time-stub"></div>
            ${SCHED_DAYS.map(d => `
              <div class="sched-day-head">
                <div class="sched-day-name">${d}</div>
                <div class="sched-class-labels">
                  ${SCHED_CLASSES.map(c => `<div class="sched-class-lbl" style="background:${c.color}" title="${c.name}">${c.name[0]}</div>`).join('')}
                </div>
              </div>
            `).join('')}
          </div>
          <div class="sched-body">
            <div class="sched-time-col">
              ${hours.map(h => `<div class="sched-time-cell">${h}:00</div>`).join('')}
            </div>
            ${SCHED_DAYS.map((_, dayIdx) => `
              <div class="sched-day-group">
                ${SCHED_CLASSES.map(cls => {
                  const searchLow = _schedFilter.search.toLowerCase();
                  const evs = _schedCache.filter(e =>
                    e.day === dayIdx && e.class_id === cls.id &&
                    _schedFilter.classes.has(cls.id) &&
                    (!searchLow || e.title.toLowerCase().includes(searchLow) || (e.comment||'').toLowerCase().includes(searchLow))
                  );
                  const evHtml = evs.map(e => {
                    const startMin = timeToMinutes(e.start_time) - SCHED_START * 60;
                    const endMin   = timeToMinutes(e.end_time)   - SCHED_START * 60;
                    const top    = startMin / 60 * SCHED_HOUR_H;
                    const height = Math.max((endMin - startMin) / 60 * SCHED_HOUR_H - 2, 20);
                    const durMin = endMin - startMin;
                    const safeTitle   = _escHtml(e.title);
                    const safeComment = _escHtml(e.comment);
                    return `<div class="sched-event" style="top:${top}px;height:${height}px;background:${cls.color}"
                      data-id="${e.id}"
                      ${canEdit ? `draggable="true"
                        ondragstart="schedDragStart(event,${e.id},${durMin})"
                        ondragend="schedDragEnd(event)"
                        onclick="openScheduleModal(${e.id})"` : ''}
                      title="${safeTitle} (${e.start_time}–${e.end_time})">
                      <div class="sched-event-title">${safeTitle}</div>
                      ${e.teacher ? `<div class="sched-event-teacher">${_escHtml(e.teacher)}</div>` : ''}
                      <div class="sched-event-time">${e.start_time}–${e.end_time}</div>
                      ${e.comment ? `<div class="sched-event-comment">${safeComment}</div>` : ''}
                    </div>`;
                  }).join('');
                  const colHidden = !_schedFilter.classes.has(cls.id);
                  return `<div class="sched-class-col ${colHidden ? 'sched-col-hidden' : ''}" style="background:${cls.bg}"
                    ${canEdit && !colHidden ? `
                      ondragover="schedDragOver(event)"
                      ondragleave="schedDragLeave(event)"
                      ondrop="schedDrop(event,${dayIdx},${cls.id})"
                      onclick="schedColClick(event,${dayIdx},${cls.id})"` : ''}>
                    ${hours.map(h => `<div class="sched-hour-line" style="top:${(h - SCHED_START) * SCHED_HOUR_H}px"></div>`).join('')}
                    ${evHtml}
                  </div>`;
                }).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>`;

  content.innerHTML = html;
}

function schedFilterSearch(val) {
  _schedFilter.search = val;
  renderSchedulePage();
}

function schedToggleClass(id) {
  if (_schedFilter.classes.has(id)) {
    if (_schedFilter.classes.size > 1) _schedFilter.classes.delete(id);
  } else {
    _schedFilter.classes.add(id);
  }
  renderSchedulePage();
}

function schedDragStart(e, id, durMin) {
  // Store full event data so schedDrop doesn't need a network round-trip
  const ev = _schedCache.find(x => x.id === id);
  _schedDrag = { id, durMin, title: ev?.title || '', comment: ev?.comment || '', teacher: ev?.teacher || '' };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(id));
  setTimeout(() => e.target.classList.add('sched-dragging'), 0);
}

function schedDragEnd(e) {
  e.target.classList.remove('sched-dragging');
}

function schedDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('sched-drop-over');
}

function schedDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('sched-drop-over');
  }
}

async function schedDrop(e, dayIdx, classId) {
  e.preventDefault();
  e.currentTarget.classList.remove('sched-drop-over');
  if (!_schedDrag) return;

  const col = e.currentTarget;
  const rect = col.getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const snapped = Math.round(relY / SCHED_HOUR_H * 60 / 30) * 30;
  const startTotal = SCHED_START * 60 + Math.max(0, Math.min(snapped, (SCHED_END - SCHED_START) * 60 - _schedDrag.durMin));
  const endTotal = startTotal + _schedDrag.durMin;

  const drag = _schedDrag;
  _schedDrag = null;

  try {
    await PUT(`/schedule/${drag.id}`, {
      day: dayIdx, class_id: classId,
      start_time: minutesToTime(startTotal),
      end_time:   minutesToTime(endTotal),
      title:   drag.title,
      comment: drag.comment,
      teacher: drag.teacher,
    });
    renderSchedulePage();
  } catch (err) { toast(err.message, 'error'); }
}

function schedColClick(e, dayIdx, classId) {
  if (e.target.closest('.sched-event')) return;
  const col = e.currentTarget;
  const rect = col.getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const snapped = Math.round(relY / SCHED_HOUR_H * 60 / 30) * 30;
  const startMin = SCHED_START * 60 + Math.min(Math.max(snapped, 0), (SCHED_END - SCHED_START) * 60 - 60);
  openScheduleModal(null, dayIdx, classId, minutesToTime(startMin), minutesToTime(startMin + 60));
}

function openScheduleModal(eventId = null, defaultDay = 0, defaultClass = 0, defaultStart = '09:00', defaultEnd = '10:00') {
  if (eventId) {
    const ev = _schedCache.find(e => e.id === eventId);
    if (ev) {
      _showScheduleModal(ev.id, ev.day, ev.class_id, ev.start_time, ev.end_time, ev.title, ev.comment || '', ev.teacher || '');
    } else {
      // Cache miss — re-fetch once
      GET('/schedule').then(all => {
        _schedCache = all;
        const fresh = all.find(e => e.id === eventId);
        if (fresh) _showScheduleModal(fresh.id, fresh.day, fresh.class_id, fresh.start_time, fresh.end_time, fresh.title, fresh.comment || '', fresh.teacher || '');
        else toast('Запись не найдена', 'error');
      }).catch(err => toast(err.message, 'error'));
    }
    return;
  }
  _showScheduleModal(null, defaultDay, defaultClass, defaultStart, defaultEnd, '');
}

function _showScheduleModal(id, day, classId, startTime, endTime, title, comment = '', teacher = '') {
  const isEdit = !!id;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:460px">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Редактировать занятость' : 'Добавить занятость'}</div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Название</label>
            <input id="sm-title" class="input" value="${title}" placeholder="Название занятости">
          </div>
          <div class="form-row">
            <div class="field">
              <label>День недели</label>
              <select id="sm-day" class="input">
                ${SCHED_DAYS.map((d,i) => `<option value="${i}" ${i===day?'selected':''}>${d}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Класс</label>
              <select id="sm-class" class="input">
                ${SCHED_CLASSES.map(c => `<option value="${c.id}" ${c.id===classId?'selected':''}>${c.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Начало</label>
              <input id="sm-start" class="input" type="time" value="${startTime}" min="08:00" max="22:00">
            </div>
            <div class="field">
              <label>Конец</label>
              <input id="sm-end" class="input" type="time" value="${endTime}" min="08:00" max="22:00">
            </div>
          </div>
          <div class="field" style="margin-top:4px">
            <label>Преподаватель</label>
            <input id="sm-teacher" class="input" value="${_escHtml(teacher)}" placeholder="Имя преподавателя">
          </div>
          <div class="field" style="margin-top:4px">
            <label>Комментарий</label>
            <textarea id="sm-comment" class="input" rows="3" placeholder="Дополнительная информация...">${_escHtml(comment)}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          ${isEdit ? `<button class="btn btn-danger" onclick="deleteScheduleEvent(${id})">Удалить</button>` : ''}
          <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
          <button class="btn btn-blue" onclick="saveScheduleEvent(${id||'null'})">Сохранить</button>
        </div>
      </div>
    </div>`;
}

async function saveScheduleEvent(id) {
  const title    = document.getElementById('sm-title').value.trim();
  const day      = parseInt(document.getElementById('sm-day').value);
  const classId  = parseInt(document.getElementById('sm-class').value);
  const startTime = document.getElementById('sm-start').value;
  const endTime   = document.getElementById('sm-end').value;
  const comment   = document.getElementById('sm-comment').value.trim();
  const teacher   = document.getElementById('sm-teacher')?.value.trim() || '';
  if (!title) return toast('Введите название', 'error');
  if (!startTime || !endTime) return toast('Укажите время', 'error');
  try {
    if (id) {
      await PUT(`/schedule/${id}`, { day, class_id: classId, start_time: startTime, end_time: endTime, title, comment, teacher });
    } else {
      await POST('/schedule', { day, class_id: classId, start_time: startTime, end_time: endTime, title, comment, teacher });
    }
    closeModal();
    renderSchedulePage();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteScheduleEvent(id) {
  if (!confirm('Удалить эту занятость?')) return;
  try {
    await DEL(`/schedule/${id}`);
    closeModal();
    renderSchedulePage();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Feedback Modal ───────────────────────────────────────────────────────────
const FEEDBACK_QUESTIONS = [
  'Как вы оцениваете общую атмосферу и психологический климат в коллективе?',
  'Насколько комфортными вы считаете условия работы (рабочее место, оборудование, окружающая среда)?',
  'Как вы оцениваете качество коммуникации между сотрудниками и руководством?',
  'Насколько чётко вам ставятся задачи и обозначаются ожидания по результатам?',
  'Как вы оцениваете эффективность распределения задач и рабочей нагрузки?',
  'Насколько вы удовлетворены возможностями для профессионального роста и развития?',
  'Как вы оцениваете уровень поддержки и помощи со стороны коллег при выполнении задач?',
  'Насколько своевременно и справедливо, по вашему мнению, оцениваются результаты вашей работы?',
  'Как вы оцениваете общую эффективность рабочих процессов и организации работы в команде?',
  'Насколько вы готовы рекомендовать эту компанию как хорошее место для работы?',
];

function openFeedbackModal() {
  if (state.user?.role === 'admin') {
    openFeedbackAdmin();
  } else {
    openFeedbackForm();
  }
}

function openFeedbackForm() {
  const scores = new Array(10).fill(null);
  const root = document.getElementById('modal-root');

  // Render once — never re-render on score click
  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal fb-modal">
        <div class="modal-header">
          <div class="modal-title">Обратная связь руководителю</div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body fb-body">
          <div class="fb-anon-notice">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Данное обращение является полностью анонимным. Ваши ответы не содержат личных данных и не могут быть привязаны к конкретному сотруднику.
          </div>
          <div class="fb-scale-legend">
            <span>0 — совсем не удовлетворён</span>
            <span>5 — полностью удовлетворён</span>
          </div>
          <div class="fb-questions">
            ${FEEDBACK_QUESTIONS.map((q, i) => `
              <div class="fb-question" id="fb-q-wrap-${i}">
                <div class="fb-q-text"><span class="fb-q-num">${i+1}.</span> ${q}</div>
                <div class="fb-scale" id="fb-scale-${i}">
                  ${[0,1,2,3,4,5].map(v => `
                    <button class="fb-score-btn" data-q="${i}" data-v="${v}"
                      onclick="fbSetScore(${i},${v})">${v}</button>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
          <div class="fb-suggestion-section">
            <label class="fb-suggestion-label">Ваши предложения и пожелания (необязательно)</label>
            <textarea id="fb-suggestion" class="input fb-textarea" rows="4"
              placeholder="Напишите свои мысли, предложения по улучшению рабочей среды..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <div class="fb-progress" id="fb-progress">0 / ${FEEDBACK_QUESTIONS.length} вопросов</div>
          <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
          <button class="btn btn-blue" onclick="submitFeedback()">Отправить анонимно</button>
        </div>
      </div>
    </div>`;

  // Score click: targeted DOM update only — no scroll reset
  window.fbSetScore = (idx, val) => {
    scores[idx] = val;
    // Update button states for this question only
    const scale = document.getElementById(`fb-scale-${idx}`);
    scale?.querySelectorAll('.fb-score-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.v) === val);
    });
    // Mark question as answered
    document.getElementById(`fb-q-wrap-${idx}`)?.classList.add('fb-answered');
    // Update progress counter
    const answered = scores.filter(s => s !== null).length;
    const prog = document.getElementById('fb-progress');
    if (prog) prog.textContent = `${answered} / ${FEEDBACK_QUESTIONS.length} вопросов`;
  };

  window.submitFeedback = async () => {
    if (scores.some(v => v === null))
      return toast('Пожалуйста, ответьте на все вопросы', 'error');
    const body = {};
    scores.forEach((v, i) => { body[`q${i+1}`] = v; });
    body.suggestion = document.getElementById('fb-suggestion')?.value.trim() || '';
    try {
      await POST('/feedback', body);
      closeModal();
      toast('Спасибо! Ваш отзыв отправлен анонимно', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function deleteFeedback(id) {
  if (!confirm('Удалить этот ответ навсегда? Действие необратимо.')) return;
  try {
    await DEL(`/feedback/${id}`);
    window._fbAllRows = window._fbAllRows?.filter(r => r.id !== id);
    toast('Ответ удалён', 'success');
    window._fbAdminRender?.();
  } catch (err) { toast(err.message, 'error'); }
}

async function archiveFeedback(id) {
  try {
    await api('PATCH', `/feedback/${id}/archive`, { archived: true });
    window._fbAllRows = window._fbAllRows?.filter(r => r.id !== id);
    toast('Ответ архивирован', 'success');
    window._fbAdminRender?.();
  } catch (err) { toast(err.message, 'error'); }
}

async function openFeedbackArchive() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:580px">
      <div class="modal-header">
        <div class="modal-title">Архив обратной связи</div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" id="fb-archive-body">
        <div style="text-align:center;padding:20px;color:#9ca3af">Загрузка...</div>
      </div>
    </div></div>`;
  try {
    const rows = await GET('/feedback?archived=1');
    const body = document.getElementById('fb-archive-body');
    const scoreColor = v => v >= 4 ? '#16a34a' : v >= 3 ? '#d97706' : '#dc2626';
    const rowAvg = r => { const v=[1,2,3,4,5,6,7,8,9,10].map(i=>r[`q${i}`]).filter(x=>x!=null); return v.length?v.reduce((a,b)=>a+b,0)/v.length:0; };
    if (!rows.length) {
      body.innerHTML = '<div class="empty-state" style="padding:30px 0"><h3>Архив пуст</h3><p>Архивированные ответы появятся здесь</p></div>';
      return;
    }
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding-bottom:8px">
      ${rows.map(r => {
        const overall = rowAvg(r);
        return `<div class="fb-response-card">
          <div class="fb-response-header">
            <span class="fb-response-num" style="color:#9ca3af">Архив</span>
            <span class="fb-response-date">${fmtDate(r.created_at)}</span>
            <span class="fb-response-overall" style="color:${scoreColor(overall)}">Балл: ${overall.toFixed(1)}</span>
            <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="restoreFeedback(${r.id})">Восстановить</button>
            <button class="fb-delete-btn" onclick="deleteFeedback(${r.id}); document.getElementById('fb-archive-body').innerHTML='<div style=padding:20px>Обновите...</div>'; openFeedbackArchive()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            </button>
          </div>
          ${r.suggestion?.trim() ? `<div class="fb-response-comment"><span class="fb-response-comment-lbl">Комментарий:</span>${_escHtml(r.suggestion)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

async function restoreFeedback(id) {
  try {
    await api('PATCH', `/feedback/${id}/archive`, { archived: false });
    toast('Ответ восстановлен', 'success');
    openFeedbackArchive();
  } catch (err) { toast(err.message, 'error'); }
}

async function openFeedbackAdmin() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay"><div class="modal fb-admin-modal">
    <div class="modal-header">
      <div class="modal-title">Обратная связь от команды</div>
      <button class="btn btn-outline btn-sm" onclick="openFeedbackArchive()" style="font-size:12px;display:inline-flex;align-items:center;gap:4px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg> Архив
      </button>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body fb-body"><div style="text-align:center;color:#9ca3af;padding:30px">Загрузка...</div>
    </div></div></div>`;

  let allRows = [];
  try { allRows = await GET('/feedback'); } catch (err) { toast(err.message,'error'); return; }
  window._fbAllRows = allRows;

  let activePeriod = 'all';
  window._fbAdminRender = renderAdmin;
  renderAdmin();

  // Always read from window._fbAllRows so delete/archive updates reflect immediately
  function getRows()    { return window._fbAllRows || []; }
  function getMonths() {
    const set = new Set(getRows().map(r => r.created_at?.slice(0,7)));
    return [...set].sort().reverse();
  }

  function filteredRows() {
    const rows = getRows();
    if (activePeriod === 'all') return rows;
    return rows.filter(r => r.created_at?.startsWith(activePeriod));
  }

  function rowAvg(row) {
    const vals = [1,2,3,4,5,6,7,8,9,10].map(i => row[`q${i}`]).filter(v => v != null);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
  }

  function scoreColor(v) { return v >= 4 ? '#16a34a' : v >= 3 ? '#d97706' : '#dc2626'; }

  // Per-question line chart: X = Q1..Q10, Y = 0..5, one line per response
  function buildQuestionsChart(rows) {
    if (!rows.length) return '<div style="font-size:12px;color:#9ca3af;padding:20px 0">Нет данных</div>';
    const W = 280, H = 200, padL = 22, padB = 20, padT = 10, padR = 10;
    const innerW = W - padL - padR, innerH = H - padB - padT;
    const xs = Array.from({length:10}, (_,i) => padL + i / 9 * innerW);
    const y  = v => padT + (1 - v/5) * innerH;
    const COLORS = ['#881337','#1d4ed8','#16a34a','#d97706','#7c3aed','#0891b2','#db2777','#ea580c'];
    const recent = [...rows].reverse().slice(0,6); // last 6 responses

    // Average line
    const avgPts = Array.from({length:10}, (_,i) => {
      const vals = rows.map(r=>r[`q${i+1}`]).filter(v=>v!=null);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    });

    const grid = [0,1,2,3,4,5].map(v => `
      <line x1="${padL}" y1="${y(v)}" x2="${W-padR}" y2="${y(v)}" stroke="#e5e7eb" stroke-width="0.5"/>
      <text x="${padL-3}" y="${y(v)+3.5}" text-anchor="end" font-size="8.5" fill="#9ca3af">${v}</text>`).join('');

    const xLabels = xs.map((x,i) => `<text x="${x}" y="${H-4}" text-anchor="middle" font-size="8.5" fill="#9ca3af">В${i+1}</text>`).join('');

    const responseLines = recent.map((r, ri) => {
      const pts = xs.map((x,i) => `${x},${y(r[`q${i+1}`]??0)}`).join(' ');
      const color = COLORS[ri % COLORS.length];
      const dots = xs.map((x,i) => `<circle cx="${x}" cy="${y(r[`q${i+1}`]??0)}" r="2.5" fill="${color}" stroke="white" stroke-width="1"/>`).join('');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.7"/>
              ${dots}`;
    }).join('');

    const avgPtsStr = xs.map((x,i)=>`${x},${y(avgPts[i])}`).join(' ');
    const avgLine = `<polyline points="${avgPtsStr}" fill="none" stroke="#374151" stroke-width="2" stroke-dasharray="4,3" stroke-linejoin="round" stroke-linecap="round"/>`;

    const legend = recent.map((r,ri) => {
      const num = rows.length - ri; // number in list
      return `<span class="fb-chart-legend-item"><svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="${COLORS[ri%COLORS.length]}" stroke-width="2.5"/></svg>Ответ #${num}</span>`;
    }).join('');
    const avgLegend = `<span class="fb-chart-legend-item"><svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="#374151" stroke-width="2" stroke-dasharray="4,2"/></svg>Среднее</span>`;

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">
        ${grid}${xLabels}${responseLines}${avgLine}
      </svg>
      <div class="fb-chart-legend">${legend}${avgLegend}</div>`;
  }

  function buildTrendSvg() {
    const months = getMonths().slice().reverse(); // ascending
    if (months.length < 2) return '';
    const W = 500, H = 90, padX = 36, padY = 12;
    const innerW = W - padX * 2, innerH = H - padY * 2;
    const pts = months.map((m, i) => {
      const rows = getRows().filter(r => r.created_at?.startsWith(m));
      const avg = rows.length
        ? [1,2,3,4,5,6,7,8,9,10].flatMap(qi => rows.map(r=>r[`q${qi}`])).filter(v=>v!=null)
            .reduce((a,b,_,arr)=>a+b/arr.length, 0)
        : 0;
      const x = padX + (i / (months.length - 1)) * innerW;
      const y = padY + (1 - avg / 5) * innerH;
      return { x, y, avg, m };
    });
    const polyline = pts.map(p=>`${p.x},${p.y}`).join(' ');
    const monthNames = ['Янв','Фев','Мар','Апр','Май','Июнь','Июль','Авг','Сен','Окт','Ноя','Дек'];
    const labels = pts.map(p => {
      const [yr, mo] = p.m.split('-');
      return `<text x="${p.x}" y="${H-2}" text-anchor="middle" font-size="9" fill="#9ca3af">${monthNames[+mo-1]}</text>`;
    }).join('');
    const dots = pts.map(p =>
      `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${scoreColor(p.avg)}" stroke="white" stroke-width="1.5"/>`
    ).join('');
    const yLabels = [0,1,2,3,4,5].map(v => {
      const y = padY + (1 - v/5)*innerH;
      return `<text x="${padX-4}" y="${y+3}" text-anchor="end" font-size="9" fill="#9ca3af">${v}</text>
              <line x1="${padX}" y1="${y}" x2="${W-padX}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5"/>`;
    }).join('');
    return `<div class="fb-trend-wrap">
      <div class="fb-trend-title">Тенденция по месяцам</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">
        ${yLabels}
        <polyline points="${polyline}" fill="none" stroke="#881337" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        ${labels}
      </svg>
    </div>`;
  }

  function renderAdmin() {
    const rows = filteredRows();
    const months = getMonths();
    const avg = FEEDBACK_QUESTIONS.map((_, i) => {
      const vals = rows.map(r => r[`q${i+1}`]).filter(v => v != null);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    });

    const periodBtns = [
      `<button class="fb-period-btn ${activePeriod==='all'?'active':''}" onclick="window._fbPeriod('all')">Все время</button>`,
      ...months.map(m => {
        const [yr, mo] = m.split('-');
        const mn = ['Янв','Фев','Мар','Апр','Май','Июнь','Июль','Авг','Сен','Окт','Ноя','Дек'];
        return `<button class="fb-period-btn ${activePeriod===m?'active':''}" onclick="window._fbPeriod('${m}')">${mn[+mo-1]} ${yr}</button>`;
      })
    ].join('');

    window._fbPeriod = (p) => { activePeriod = p; renderAdmin(); };

    const bodyEl = root.querySelector('.modal-body');
    if (!bodyEl) return;

    if (!getRows().length) {
      bodyEl.innerHTML = `<div class="empty-state" style="padding:40px 0"><h3>Ответов пока нет</h3><p>Сотрудники ещё не оставили обратную связь</p></div>`;
      return;
    }

    bodyEl.innerHTML = `
      <!-- Period filter -->
      <div class="fb-period-bar">${periodBtns}</div>
      <div class="fb-admin-meta">${svgI(SVG_PATHS.users,13)} Ответов за период: <strong>${rows.length}</strong></div>

      ${buildTrendSvg()}

      <!-- Average scores -->
      <div class="fb-admin-section-title">Средние оценки</div>
      <div class="fb-admin-questions">
        ${avg.map((a, i) => a === null ? '' : `
          <div class="fb-admin-row">
            <div class="fb-admin-q">${i+1}. ${FEEDBACK_QUESTIONS[i]}</div>
            <div class="fb-admin-score-wrap">
              <div class="fb-admin-bar-bg">
                <div class="fb-admin-bar-fill" style="width:${a/5*100}%;background:${scoreColor(a)}"></div>
              </div>
              <span class="fb-admin-avg" style="color:${scoreColor(a)}">${a.toFixed(1)}</span>
            </div>
          </div>`).join('')}
      </div>

      <!-- Two-column: left = responses list, right = per-question chart -->
      <div class="fb-two-col">
        <div class="fb-col-left">
          <div class="fb-admin-section-title" style="margin-top:4px">
            Отдельные ответы (${rows.length})
          </div>
          ${rows.length === 0 ? `<div style="font-size:13px;color:#9ca3af;padding:8px 0">Нет ответов за этот период</div>` : ''}
          <div class="fb-responses-list">
            ${[...rows].reverse().map((r, idx) => {
              const overall = rowAvg(r);
              const num = rows.length - idx;
              return `
              <div class="fb-response-card fb-response-clickable" onclick="openFeedbackDetail(${r.id})">
                <div class="fb-response-header">
                  <span class="fb-response-num">Ответ #${num}</span>
                  <span class="fb-response-date">${fmtDate(r.created_at)}</span>
                  <span class="fb-response-overall" style="color:${scoreColor(overall)}">
                    Общий балл: ${overall.toFixed(1)}
                  </span>
                  <button class="fb-archive-btn" title="Архивировать"
                    onclick="event.stopPropagation(); archiveFeedback(${r.id})">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                  </button>
                  <button class="fb-delete-btn" title="Удалить навсегда"
                    onclick="event.stopPropagation(); deleteFeedback(${r.id})">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                  </button>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
                <div class="fb-response-scores">
                  ${[1,2,3,4,5,6,7,8,9,10].map(qi => {
                    const v = r[`q${qi}`];
                    return `<div class="fb-resp-score"
                      style="background:${v>=4?'#dcfce7':v>=3?'#fef9c3':'#fee2e2'};color:${scoreColor(v)}">
                      <span class="fb-resp-qi">В${qi}</span>
                      <span class="fb-resp-qv">${v}</span>
                    </div>`;
                  }).join('')}
                </div>
                ${r.suggestion?.trim() ? `
                  <div class="fb-response-comment">
                    <span class="fb-response-comment-lbl">Комментарий:</span>
                    ${_escHtml(r.suggestion)}
                  </div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="fb-col-right">
          <div class="fb-admin-section-title">Визуал по вопросам</div>
          ${buildQuestionsChart(rows)}
        </div>
      </div>`;
  }
}

// ─── Feedback Detail Modal ────────────────────────────────────────────────────
function openFeedbackDetail(rowId) {
  const allRows = window._fbAllRows || [];
  const r = allRows.find(x => x.id === rowId);
  if (!r) return;

  const scores = Array.from({length:10}, (_,i) => r[`q${i+1}`] ?? 0);
  const overall = scores.reduce((a,b)=>a+b,0)/scores.length;
  const avgScores = Array.from({length:10}, (_,i) => {
    const vals = allRows.map(x=>x[`q${i+1}`]).filter(v=>v!=null);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
  });

  const sc = v => v>=4?'#16a34a':v>=3?'#d97706':'#dc2626';

  // Mini SVG chart: this response vs average
  const W=400, H=150, pL=22, pB=18, pT=8, pR=8;
  const iW=W-pL-pR, iH=H-pB-pT;
  const xs = Array.from({length:10},(_,i)=>pL+i/9*iW);
  const yv = v=>pT+(1-v/5)*iH;
  const grid=[0,1,2,3,4,5].map(v=>`<line x1="${pL}" y1="${yv(v)}" x2="${W-pR}" y2="${yv(v)}" stroke="#e5e7eb" stroke-width="0.5"/>
    <text x="${pL-3}" y="${yv(v)+3}" text-anchor="end" font-size="8" fill="#9ca3af">${v}</text>`).join('');
  const xLbls=xs.map((x,i)=>`<text x="${x}" y="${H-2}" text-anchor="middle" font-size="8" fill="#9ca3af">В${i+1}</text>`).join('');
  const thisLine=`<polyline points="${xs.map((x,i)=>`${x},${yv(scores[i])}`).join(' ')}" fill="none" stroke="#881337" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const thisDots=xs.map((x,i)=>`<circle cx="${x}" cy="${yv(scores[i])}" r="3" fill="#881337" stroke="white" stroke-width="1.5"/>`).join('');
  const avgLine=`<polyline points="${xs.map((x,i)=>`${x},${yv(avgScores[i])}`).join(' ')}" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="5,3" stroke-linejoin="round"/>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'fb-detail-overlay';
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="modal fb-detail-modal">
      <div class="modal-header">
        <div>
          <div class="modal-title">Детальный просмотр ответа</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:2px">${fmtDate(r.created_at)} · Общий балл:
            <span style="font-weight:700;color:${sc(overall)}">${overall.toFixed(1)}</span>
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('fb-detail-overlay').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding-bottom:20px">
        <!-- Mini chart -->
        <div class="fb-detail-chart-wrap">
          <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">
            Визуал ответа
          </div>
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">
            ${grid}${xLbls}${avgLine}${thisLine}${thisDots}
          </svg>
          <div style="display:flex;gap:14px;margin-top:4px">
            <span class="fb-chart-legend-item"><svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="#881337" stroke-width="2.5"/></svg>Этот ответ</span>
            <span class="fb-chart-legend-item"><svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="4,2"/></svg>Среднее</span>
          </div>
        </div>

        <!-- Questions list -->
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
          ${FEEDBACK_QUESTIONS.map((q, i) => {
            const v = scores[i];
            const av = avgScores[i];
            return `<div class="fb-detail-row">
              <div class="fb-detail-q-header">
                <span class="fb-detail-q-num">${i+1}.</span>
                <span class="fb-detail-q-text">${q}</span>
                <span class="fb-detail-score" style="color:${sc(v)}">${v}</span>
              </div>
              <div class="fb-detail-bar-bg">
                <div class="fb-detail-bar-fill" style="width:${v/5*100}%;background:${sc(v)}"></div>
                <div class="fb-detail-bar-avg" style="left:${av/5*100}%" title="Среднее: ${av.toFixed(1)}"></div>
              </div>
            </div>`;
          }).join('')}
        </div>

        ${r.suggestion?.trim() ? `
          <div class="fb-response-comment" style="margin-top:16px">
            <span class="fb-response-comment-lbl">Комментарий:</span>
            ${_escHtml(r.suggestion)}
          </div>` : ''}
      </div>
    </div>`;

  document.body.appendChild(overlay);
}

// ─── Global Search ────────────────────────────────────────────────────────────
let _gsAllTasks = null;

async function openGlobalSearch() {
  if (document.getElementById('global-search-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'global-search-overlay';
  overlay.className = 'gs-overlay';
  overlay.innerHTML = `
    <div class="gs-box">
      <div class="gs-input-wrap">
        <svg class="gs-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="gs-input" class="gs-input" placeholder="Поиск задач, проектов, сотрудников..." autocomplete="off">
        <kbd class="gs-esc-hint">Esc</kbd>
      </div>
      <div id="gs-results" class="gs-results">
        <div class="gs-hint">Начните вводить для поиска</div>
      </div>
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  const input = document.getElementById('gs-input');
  input.focus();

  // Load tasks once
  if (!_gsAllTasks) {
    try { _gsAllTasks = await GET('/tasks'); } catch { _gsAllTasks = []; }
  }

  let selectedIdx = -1;

  input.addEventListener('input', () => renderGsResults(input.value.trim(), selectedIdx = -1));

  input.addEventListener('keydown', e => {
    const items = document.querySelectorAll('.gs-result-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('gs-selected', i === selectedIdx));
      items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('gs-selected', i === selectedIdx));
      items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const selected = items[selectedIdx] || items[0];
      selected?.click();
    }
  });
}

function renderGsResults(q, selectedIdx) {
  const el = document.getElementById('gs-results');
  if (!el) return;
  if (!q) { el.innerHTML = '<div class="gs-hint">Начните вводить для поиска</div>'; return; }

  const ql = q.toLowerCase();
  const highlight = s => s.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'), '<mark class="gs-hl">$1</mark>');

  // Tasks
  const tasks = (_gsAllTasks || []).filter(t =>
    t.title?.toLowerCase().includes(ql) || (t.description || '').toLowerCase().includes(ql)
  ).slice(0, 5);

  // Projects
  const projects = (state.projects || []).filter(p =>
    p.name?.toLowerCase().includes(ql)
  ).slice(0, 4);

  // Users
  const users = (state.users || []).filter(u =>
    u.name?.toLowerCase().includes(ql) || u.email?.toLowerCase().includes(ql)
  ).slice(0, 4);

  if (!tasks.length && !projects.length && !users.length) {
    el.innerHTML = `<div class="gs-hint">Ничего не найдено по «${_escHtml(q)}»</div>`;
    return;
  }

  const STATUS_LABELS = { new: 'Новая', in_progress: 'В работе', done: 'Готово' };
  const STATUS_COLORS = { new: '#3B82F6', in_progress: '#D97706', done: '#059669' };

  let html = '';

  if (tasks.length) {
    html += `<div class="gs-group-title">${svgI(SVG_PATHS.clip,13)} Задачи</div>`;
    html += tasks.map(t => `
      <div class="gs-result-item" onclick="gsGo('task',${t.id})">
        <div class="gs-result-main">
          <span class="gs-result-title">${highlight(_escHtml(t.title))}</span>
          ${t.project_name ? `<span class="gs-result-badge" style="background:${t.project_color}22;color:${t.project_color}">${t.project_name}</span>` : ''}
        </div>
        <span class="gs-result-status" style="color:${STATUS_COLORS[t.status]}">${STATUS_LABELS[t.status]||t.status}</span>
      </div>`).join('');
  }

  if (projects.length) {
    html += `<div class="gs-group-title">${svgI(SVG_PATHS.folder,13)} Проекты</div>`;
    html += projects.map(p => `
      <div class="gs-result-item" onclick="gsGo('project',${p.id})">
        <div class="gs-result-main">
          <span class="gs-dot" style="background:${p.color}"></span>
          <span class="gs-result-title">${highlight(_escHtml(p.name))}</span>
        </div>
        <span class="gs-result-status" style="color:#94a3b8">${p.task_count||0} задач</span>
      </div>`).join('');
  }

  if (users.length) {
    html += `<div class="gs-group-title">${svgI(SVG_PATHS.users,13)} Сотрудники</div>`;
    html += users.map(u => `
      <div class="gs-result-item" onclick="gsGo('user',${u.id})">
        <div class="gs-result-main">
          ${u.avatar_img ? `<img src="${u.avatar_img}" style="width:24px;height:24px;border-radius:50%;object-fit:cover">` : `<div class="gs-user-av" style="background:${u.avatar_color||'#6366f1'}">${u.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>`}
          <span class="gs-result-title">${highlight(_escHtml(u.name))}</span>
        </div>
        <span class="gs-result-status" style="color:#94a3b8">${u.email}</span>
      </div>`).join('');
  }

  el.innerHTML = html;
  if (selectedIdx >= 0) {
    document.querySelectorAll('.gs-result-item')[selectedIdx]?.classList.add('gs-selected');
  }
}

function gsGo(type, id) {
  document.getElementById('global-search-overlay')?.remove();
  if (type === 'task') openTaskDetail(id);
  else if (type === 'project') navigateTo('project', id);
  else if (type === 'user') { state.currentEmployeeId = id; navigateTo('employee'); }
}

// ─── Admin Broadcast Modal ────────────────────────────────────────────────────
function openBroadcastModal() {
  const users = (state.users || []).filter(u => u.role !== 'admin');
  const hasTg  = u => u.telegram_id;

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:520px;max-height:90vh;overflow-y:auto">
        <div class="modal-header">
          <div>
            <div class="modal-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Отправить сообщение в Telegram
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Сообщение придёт в Telegram бот сотрудника</div>
          </div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">

          <!-- Select all -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <label style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)">
              Получатели
            </label>
            <div style="display:flex;gap:8px">
              <button class="btn btn-outline btn-sm" onclick="broadcastSelectAll(true)">Выбрать всех</button>
              <button class="btn btn-outline btn-sm" onclick="broadcastSelectAll(false)">Снять все</button>
            </div>
          </div>

          <!-- Employee list -->
          <div class="broadcast-list" id="broadcast-list">
            ${users.map(u => `
              <label class="broadcast-item ${hasTg(u) ? '' : 'broadcast-item-notg'}">
                <input type="checkbox" class="broadcast-chk" data-uid="${u.id}" ${hasTg(u) ? '' : 'disabled'}>
                <div class="broadcast-av" style="background:${u.avatar_color||'#6366f1'}">
                  ${u.avatar_img ? `<img src="${u.avatar_img}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : u.name.split(' ').map(w=>w[0]).join('').slice(0,2)}
                </div>
                <div class="broadcast-info">
                  <div class="broadcast-name">${_escHtml(u.name)}</div>
                  <div class="broadcast-tg">${hasTg(u) ? '<span style="color:#16a34a">✓ Telegram подключён</span>' : '<span style="color:#dc2626">✗ Telegram не подключён</span>'}</div>
                </div>
              </label>`).join('')}
          </div>

          <!-- Message -->
          <div class="field" style="margin-top:16px">
            <label>Текст сообщения</label>
            <textarea id="broadcast-text" class="input" rows="5"
              placeholder="Напишите сообщение для сотрудников...&#10;&#10;Поддерживается *жирный*, _курсив_"></textarea>
            <div id="broadcast-counter" style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:right">0 символов</div>
          </div>
        </div>
        <div class="modal-footer">
          <div id="broadcast-status" style="font-size:12px;color:var(--text-muted);margin-right:auto"></div>
          <button class="btn btn-outline" onclick="closeModal()">Отмена</button>
          <button class="btn btn-blue" onclick="sendBroadcast()" id="broadcast-send-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Отправить
          </button>
        </div>
      </div>
    </div>`;

  // Counter
  document.getElementById('broadcast-text')?.addEventListener('input', e => {
    document.getElementById('broadcast-counter').textContent = e.target.value.length + ' символов';
  });
}

function broadcastSelectAll(val) {
  document.querySelectorAll('.broadcast-chk:not(:disabled)').forEach(el => { el.checked = val; });
}

async function sendBroadcast() {
  const message = document.getElementById('broadcast-text')?.value.trim();
  if (!message) return toast('Введите текст сообщения', 'error');

  const userIds = [...document.querySelectorAll('.broadcast-chk:checked')].map(el => parseInt(el.dataset.uid));
  if (!userIds.length) return toast('Выберите хотя бы одного сотрудника', 'error');

  const btn = document.getElementById('broadcast-send-btn');
  const status = document.getElementById('broadcast-status');
  btn.disabled = true;
  btn.textContent = 'Отправка...';
  status.textContent = '';

  try {
    const result = await POST('/admin/broadcast', { user_ids: userIds, message });
    let msg = `✅ Отправлено: ${result.sent}`;
    if (result.noTelegram) msg += ` | ⚠️ Без Telegram: ${result.noTelegram}`;
    status.textContent = msg;
    status.style.color = '#16a34a';
    btn.textContent = 'Отправлено!';
    setTimeout(() => closeModal(), 2500);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Отправить`;
  }
}

// ─── Welcome Modal ────────────────────────────────────────────────────────────
function showWelcomeModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'welcome-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeWelcomeModal(); });
  overlay.innerHTML = `
    <div class="modal welcome-modal">
      <div class="welcome-body">
        <h2 class="welcome-title">Добро пожаловать на платформу задач</h2>
        <p class="welcome-subtitle">Здесь вы получаете задачи, отслеживаете прогресс и выстраиваете эффективную работу — всё в одном месте.</p>
        <div class="welcome-cards">
          <div class="welcome-card">
            <div class="welcome-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </div>
            <div class="welcome-card-title">Задачи от руководства</div>
            <div class="welcome-card-desc">Все задачи приходят напрямую от руководителя — ничего не теряется и не забывается</div>
          </div>
          <div class="welcome-card">
            <div class="welcome-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            </div>
            <div class="welcome-card-title">Проекты и контент-планы</div>
            <div class="welcome-card-desc">Во вкладке «Проекты» — все ваши проекты с контент-планами, сроками и задачами</div>
          </div>
          <div class="welcome-card">
            <div class="welcome-card-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            </div>
            <div class="welcome-card-title">Напоминания в Telegram</div>
            <div class="welcome-card-desc">Бот уведомит вас о новой задаче и напомнит об истекающих сроках — прямо в мессенджер</div>
          </div>
        </div>
        <div class="welcome-info">
          <div class="welcome-info-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          </div>
          <div>
            <div class="welcome-info-title">Ваша эффективность видна руководителю</div>
            <div class="welcome-info-desc">Дашборд показывает, сколько задач вы выполняете в срок, а также вашу активность на платформе. Высокие показатели замечаются и поощряются.</div>
          </div>
        </div>
      </div>
      <div class="welcome-footer">
        <span class="welcome-footer-text">Готовы начать? Перейдите к своим задачам</span>
        <button class="welcome-btn" onclick="closeWelcomeModal()">
          Перейти к задачам
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function closeWelcomeModal() {
  const overlay = document.getElementById('welcome-modal-overlay');
  if (overlay) overlay.remove();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
if (state.token && state.user) {
  initApp();
} else {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').classList.add('hidden');
}
