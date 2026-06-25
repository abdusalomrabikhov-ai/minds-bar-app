const path = require('path');
const { db } = require('./database');

const FONT_REG  = path.join(__dirname, 'fonts', 'gothampro.ttf');
const FONT_BOLD = path.join(__dirname, 'fonts', 'gothampro_bold.ttf');

function buildSummaryData(days) {
  const nowLocal   = new Date(Date.now() + 5 * 3600000); // UTC+5
  const startLocal = new Date(nowLocal.getTime() - days * 86400000);
  const nowISOt    = nowLocal.toISOString().slice(0, 19);
  const todayISO   = nowLocal.toISOString().slice(0, 10);
  const startISO   = startLocal.toISOString().slice(0, 19).replace('T', ' ');

  const global = db.prepare(`
    SELECT
      COUNT(DISTINCT t.id) as total,
      COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) as done,
      COALESCE(SUM(CASE WHEN t.status != 'done' AND t.deadline IS NOT NULL AND
        (length(t.deadline) > 10 AND t.deadline < ? OR length(t.deadline) <= 10 AND t.deadline < ?)
      THEN 1 ELSE 0 END), 0) as overdue
    FROM tasks t
    WHERE t.created_at >= ?
  `).get(nowISOt, todayISO, startISO);

  const employees = db.prepare(
    "SELECT id, name, avatar_color, avatar_img FROM users WHERE role = 'employee' ORDER BY name"
  ).all();

  const perEmployee = employees.map(user => {
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT t.id) as assigned,
        COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) as done,
        COALESCE(SUM(CASE WHEN t.status != 'done' AND t.deadline IS NOT NULL AND
          (length(t.deadline) > 10 AND t.deadline < ? OR length(t.deadline) <= 10 AND t.deadline < ?)
        THEN 1 ELSE 0 END), 0) as overdue
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
      WHERE (t.assignee_id = ? OR ta.user_id = ?) AND t.created_at >= ?
    `).get(nowISOt, todayISO, user.id, user.id, user.id, startISO);

    const dlRows = db.prepare(`
      SELECT DISTINCT t.id, t.status, t.deadline, t.updated_at,
        ta.done AS my_done, ta.done_at AS my_done_at
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
      WHERE (t.assignee_id = ? OR ta.user_id = ?)
        AND t.created_at >= ? AND t.deadline IS NOT NULL AND t.deadline != ''
    `).all(user.id, user.id, user.id, startISO);

    const taskList = db.prepare(`
      SELECT DISTINCT t.id, t.title, t.status, t.deadline, t.priority,
        p.name as project_name, p.color as project_color,
        CASE WHEN t.status != 'done' AND t.deadline IS NOT NULL AND
          (length(t.deadline) > 10 AND t.deadline < ? OR length(t.deadline) <= 10 AND t.deadline < ?)
        THEN 1 ELSE 0 END as is_overdue
      FROM tasks t
      LEFT JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE (t.assignee_id = ? OR ta.user_id = ?) AND t.created_at >= ?
      ORDER BY CASE t.status WHEN 'done' THEN 2 ELSE 1 END, t.deadline ASC NULLS LAST
    `).all(nowISOt, todayISO, user.id, user.id, user.id, startISO);

    let doneOnTime = 0, doneLate = 0;
    for (const t of dlRows) {
      const isDone  = t.status === 'done' || t.my_done === 1;
      const doneAt  = t.status === 'done' ? t.updated_at : (t.my_done === 1 ? t.my_done_at : null);
      const dlNorm  = t.deadline.replace(' ', 'T').length <= 10
        ? t.deadline.replace(' ', 'T') + 'T23:59:59'
        : t.deadline.replace(' ', 'T');
      const doneNorm = doneAt ? doneAt.replace(' ', 'T') : null;
      if (isDone && doneNorm) {
        if (doneNorm <= dlNorm) doneOnTime++;
        else doneLate++;
      }
    }

    const dlTotal   = dlRows.length;
    const assigned  = stats?.assigned  || 0;
    const done      = stats?.done      || 0;
    const pctDone   = assigned  > 0 ? Math.round(done       / assigned  * 100) : null;
    const pctOnTime = dlTotal   > 0 ? Math.round(doneOnTime / dlTotal   * 100) : null;

    return {
      ...user,
      stats: { assigned, done, overdue: stats?.overdue || 0, doneOnTime, doneLate, dlTotal, pctDone, pctOnTime },
      taskList,
    };
  });

  const periodLabel =
    days === 1  ? '1 день'   :
    days === 3  ? '3 дня'    :
    days === 7  ? '7 дней'   :
    days === 14 ? '14 дней'  :
    days === 30 ? 'Месяц'    : `${days} дней`;

  const fmt = d => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  const dateFrom = fmt(startLocal);
  const dateTo   = fmt(nowLocal);

  return { global, employees: perEmployee, period: days, periodLabel, generatedAt: nowISOt, dateFrom, dateTo };
}

async function generateSummaryPDF(data) {
  return new Promise((resolve, reject) => {
    const PDFDocument = require('pdfkit');
    const chunks = [];
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Reg',  FONT_REG);
    doc.registerFont('Bold', FONT_BOLD);

    const { global: g, employees, periodLabel, generatedAt, dateFrom, dateTo } = data;
    const PW = 595, X = 36, W = 523;
    const eff = g.total > 0 ? Math.round(g.done / g.total * 100) : 0;

    // helpers
    const effColor = pct =>
      pct === null ? '#9ca3af' : pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
    const dateStr = (() => {
      const d = new Date(generatedAt);
      return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    })();

    // ── HEADER ─────────────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 72).fill('#0f172a');
    // accent stripe
    doc.rect(0, 68, PW, 4).fill('#881337');
    // logo dot
    doc.circle(X + 8, 28, 8).fill('#881337');
    doc.circle(X + 8, 28, 4).fill('#ffffff');
    doc.font('Bold').fontSize(17).fillColor('#ffffff')
      .text('MindsBar — Сводный отчёт', X + 22, 20);
    doc.font('Reg').fontSize(9).fillColor('#94a3b8')
      .text(`Период: ${dateFrom} — ${dateTo} (${periodLabel})   ·   Сформирован: ${dateStr} ${generatedAt.slice(11,16)}`, X + 22, 42);

    // ── METRIC CARDS ───────────────────────────────────────────────────────────
    const cardDefs = [
      { label: 'Всего задач',    value: g.total,    sub: 'за период',         color: '#3b82f6', bg: '#eff6ff' },
      { label: 'Выполнено',      value: g.done,     sub: `${eff}% от всех`,    color: '#16a34a', bg: '#f0fdf4' },
      { label: 'Просрочено',     value: g.overdue,  sub: 'требуют внимания',   color: '#dc2626', bg: '#fef2f2' },
      { label: 'Сотрудников',    value: employees.filter(e => e.stats.assigned > 0).length,
        sub: 'активны в периоде', color: '#7c3aed', bg: '#f5f3ff' },
    ];
    const cW = 120, cH = 66, cGap = 9;
    let cy = 84, cx = X;
    cardDefs.forEach(c => {
      // card bg
      doc.roundedRect(cx, cy, cW, cH, 8).fill(c.bg);
      // top color bar
      doc.roundedRect(cx, cy, cW, 4, 2).fill(c.color);
      // value
      doc.font('Bold').fontSize(26).fillColor(c.color)
        .text(String(c.value), cx, cy + 12, { width: cW, align: 'center' });
      // label
      doc.font('Bold').fontSize(8).fillColor('#374151')
        .text(c.label, cx, cy + 42, { width: cW, align: 'center' });
      // sub
      doc.font('Reg').fontSize(7).fillColor('#9ca3af')
        .text(c.sub, cx, cy + 53, { width: cW, align: 'center' });
      cx += cW + cGap;
    });

    // ── CHART SECTION ──────────────────────────────────────────────────────────
    const chartY0 = cy + cH + 20;

    // section header band
    doc.rect(X, chartY0, W, 22).fill('#1e293b');
    doc.font('Bold').fontSize(9).fillColor('#ffffff')
      .text('ГРАФИК ЭФФЕКТИВНОСТИ', X + 10, chartY0 + 7);
    // legend
    const legX = X + W - 195;
    const legY = chartY0 + 7;
    [[' Выполнено','#16a34a'],[' Просрочено','#dc2626'],[' Остальные','#cbd5e1']].forEach(([lbl, col], i) => {
      const lx = legX + i * 65;
      doc.rect(lx, legY + 2, 7, 7).fill(col);
      doc.font('Reg').fontSize(7).fillColor('#ffffff').text(lbl, lx + 9, legY + 1, { width: 54 });
    });

    const active = employees.filter(e => e.stats.assigned > 0)
      .sort((a, b) => b.stats.assigned - a.stats.assigned);
    const maxA = Math.max(...active.map(e => e.stats.assigned), 1);
    // BAR_X=184, BAR_TRACK=260, count(32)+gap(6)+badge(34) = 72 → right edge 184+260+72=516 < 559 ✓
    const BAR_X = X + 148, BAR_TRACK = 260, ROW = 24;
    let ry = chartY0 + 22;

    active.forEach((emp, i) => {
      const s = emp.stats;
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(X, ry, W, ROW).fill(bg);

      // avatar circle
      const av = emp.avatar_color || '#6366f1';
      doc.circle(X + 13, ry + ROW / 2, 10).fill(av);
      const ini = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      doc.font('Bold').fontSize(6.5).fillColor('#ffffff')
        .text(ini, X + 4, ry + ROW / 2 - 4, { width: 18, align: 'center' });

      // name
      const shortName = emp.name.length > 20 ? emp.name.slice(0, 18) + '…' : emp.name;
      doc.font('Reg').fontSize(8).fillColor('#111827')
        .text(shortName, X + 28, ry + ROW / 2 - 4, { width: 115 });

      // track background — use clip so all segments inherit rounding
      const trackW = Math.round(s.assigned / maxA * BAR_TRACK);
      doc.roundedRect(BAR_X, ry + 7, BAR_TRACK, 10, 4).fill('#e2e8f0');

      // clip subsequent drawing to rounded track shape
      doc.save();
      doc.roundedRect(BAR_X, ry + 7, BAR_TRACK, 10, 4).clip();

      const doneW = s.done > 0 && trackW > 0 ? Math.round(s.done / s.assigned * trackW) : 0;
      const ovW   = s.overdue > 0 && trackW > 0 ? Math.round(s.overdue / s.assigned * trackW) : 0;
      if (doneW > 0) doc.rect(BAR_X, ry + 7, doneW, 10).fill('#16a34a');
      if (ovW   > 0) doc.rect(BAR_X + doneW, ry + 7, ovW, 10).fill('#dc2626');

      doc.restore();

      // count badge  (starts at BAR_X + 260 + 6 = 450)
      doc.font('Bold').fontSize(7.5).fillColor('#374151')
        .text(`${s.done}/${s.assigned}`, BAR_X + BAR_TRACK + 6, ry + ROW / 2 - 4, { width: 34 });

      // efficiency badge (starts at 450+34+2 = 486, width 32 → ends at 518 < 559 ✓)
      const pct = s.pctDone ?? 0;
      const col = effColor(pct);
      doc.roundedRect(BAR_X + BAR_TRACK + 42, ry + 6, 32, 13, 3).fill(col);
      doc.font('Bold').fontSize(7).fillColor('#ffffff')
        .text(`${pct}%`, BAR_X + BAR_TRACK + 42, ry + 9, { width: 32, align: 'center' });

      ry += ROW;
    });

    if (active.length === 0) {
      doc.font('Reg').fontSize(10).fillColor('#9ca3af')
        .text('Нет задач за выбранный период', X, ry + 10, { width: W, align: 'center' });
      ry += 30;
    }

    // ── TABLE SECTION ──────────────────────────────────────────────────────────
    const tY0 = ry + 16;

    doc.rect(X, tY0, W, 22).fill('#1e293b');
    doc.font('Bold').fontSize(9).fillColor('#ffffff')
      .text('ДЕТАЛЬНАЯ ТАБЛИЦА', X + 10, tY0 + 7);

    const COL  = { name: X,     asgn: X+155, done: X+205, over: X+255, pctD: X+308, pctT: X+375, bar: X+425 };
    const CW   = { name: 150,   asgn: 48,    done: 48,    over: 50,    pctD: 64,    pctT: 64,    bar: 70   };
    const TRH  = 19;

    // col headers
    doc.rect(X, tY0 + 22, W, TRH).fill('#334155');
    doc.font('Bold').fontSize(7.5).fillColor('#e2e8f0');
    [['Сотрудник',COL.name,CW.name,'left'],['Назначено',COL.asgn,CW.asgn,'center'],
     ['Выполнено',COL.done,CW.done,'center'],['Просрочено',COL.over,CW.over,'center'],
     ['% выполн.',COL.pctD,CW.pctD,'center'],['% в срок',COL.pctT,CW.pctT,'center'],
     ['Эффект.',COL.bar,CW.bar,'center'],
    ].forEach(([lbl,x,w,align]) =>
      doc.text(lbl, x + 3, tY0 + 28, { width: w, align })
    );

    // data rows
    employees.forEach((emp, i) => {
      const s   = emp.stats;
      const dY  = tY0 + 22 + TRH + i * TRH;
      doc.rect(X, dY, W, TRH).fill(i % 2 === 0 ? '#ffffff' : '#f8fafc').stroke('#e5e7eb');

      doc.font('Reg').fontSize(7.5).fillColor('#111827')
        .text(emp.name.length > 22 ? emp.name.slice(0,20)+'…' : emp.name, COL.name + 3, dY + 6, { width: CW.name });
      doc.fillColor('#374151')
        .text(String(s.assigned), COL.asgn + 3, dY + 6, { width: CW.asgn, align: 'center' });
      doc.fillColor(s.done > 0 ? '#15803d' : '#374151')
        .text(String(s.done), COL.done + 3, dY + 6, { width: CW.done, align: 'center' });
      doc.fillColor(s.overdue > 0 ? '#dc2626' : '#374151')
        .text(String(s.overdue), COL.over + 3, dY + 6, { width: CW.over, align: 'center' });

      const pdC = effColor(s.pctDone);
      doc.font('Bold').fontSize(7.5).fillColor(pdC)
        .text(s.pctDone !== null ? `${s.pctDone}%` : '—', COL.pctD + 3, dY + 6, { width: CW.pctD, align: 'center' });
      const ptC = effColor(s.pctOnTime);
      doc.fillColor(ptC)
        .text(s.pctOnTime !== null ? `${s.pctOnTime}%` : '—', COL.pctT + 3, dY + 6, { width: CW.pctT, align: 'center' });

      // mini efficiency bar
      const pct = s.pctDone ?? 0;
      const barMaxW = CW.bar - 6;
      doc.roundedRect(COL.bar + 3, dY + 6, barMaxW, 7, 2).fill('#e2e8f0');
      if (pct > 0) {
        doc.roundedRect(COL.bar + 3, dY + 6, Math.round(pct / 100 * barMaxW), 7, 2).fill(effColor(pct));
      }
    });

    // ── FOOTER page 1 ─────────────────────────────────────────────────────────
    const footY = tY0 + 22 + TRH + employees.length * TRH + 14;
    doc.rect(0, footY, PW, 28).fill('#0f172a');
    doc.font('Reg').fontSize(7.5).fillColor('#64748b')
      .text('MindsBar TeamTask · Автоматический отчёт · Только для внутреннего использования', X, footY + 10, { width: W, align: 'center' });

    // ── PAGE 2: Task details per employee ─────────────────────────────────────
    const activeWithTasks = employees.filter(e => e.taskList && e.taskList.length > 0);
    if (activeWithTasks.length > 0) {
      doc.addPage({ margin: 0, size: 'A4' });

      // page 2 header
      doc.rect(0, 0, PW, 50).fill('#0f172a');
      doc.font('Bold').fontSize(13).fillColor('#ffffff')
        .text('MindsBar — Детальный разбор задач', X, 14);
      doc.font('Reg').fontSize(9).fillColor('#94a3b8')
        .text(`Период: ${dateFrom} — ${dateTo} (${periodLabel})`, X, 32);
      doc.rect(0, 46, PW, 4).fill('#881337');

      const statusLabel = s => s === 'done' ? 'Выполнено' : s === 'in_progress' ? 'В работе' : s === 'pending_review' ? 'На проверке' : 'Новая';
      const statusDot   = s => s === 'done' ? '#16a34a' : s === 'pending_review' ? '#7c3aed' : s === 'in_progress' ? '#d97706' : '#94a3b8';
      const fmtDl = dl => {
        if (!dl) return '—';
        const d = new Date(dl.replace(' ', 'T'));
        return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
      };
      const pLabels = { high: 'Высок.', medium: 'Средн.', low: 'Низкий' };
      const pColors = { high: '#b91c1c', medium: '#78716c', low: '#16a34a' };

      let py = 58;

      activeWithTasks.forEach(emp => {
        if (emp.taskList.length === 0) return;
        if (py > 760) { doc.addPage({ margin: 0, size: 'A4' }); py = 20; }

        const av = emp.avatar_color || '#6366f1';
        const s  = emp.stats;

        // ── minimal employee header: white bg + thin left accent ──────────────
        doc.rect(X, py, W, 26).fill('#f8fafc').stroke('#e2e8f0');
        doc.rect(X, py, 3, 26).fill(av);
        doc.circle(X + 18, py + 13, 8).fill(av);
        const ini = emp.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        doc.font('Bold').fontSize(6).fillColor('#ffffff').text(ini, X + 11, py + 9, { width: 14, align: 'center' });
        doc.font('Bold').fontSize(9).fillColor('#111827').text(emp.name, X + 32, py + 8);
        const statsTxt = `${s.assigned} задач  ·  ${s.done} выполнено${s.overdue > 0 ? `  ·  ${s.overdue} просрочено` : ''}`;
        doc.font('Reg').fontSize(7.5).fillColor(s.overdue > 0 ? '#b91c1c' : '#94a3b8').text(statsTxt, X + 170, py + 9);
        py += 26;

        // ── column headers — very light ──────────────────────────────────────
        doc.rect(X, py, W, 14).fill('#f1f5f9');
        doc.font('Bold').fontSize(6.5).fillColor('#94a3b8');
        doc.text('Задача',  X + 6,   py + 4, { width: 205 });
        doc.text('Проект',  X + 215, py + 4, { width: 105 });
        doc.text('Статус',  X + 324, py + 4, { width: 92 });
        doc.text('Дедлайн', X + 420, py + 4, { width: 62 });
        doc.text('Приор.',  X + 486, py + 4, { width: 37, align: 'center' });
        py += 14;

        // ── task rows ─────────────────────────────────────────────────────────
        emp.taskList.forEach((t, ti) => {
          if (py > 808) { doc.addPage({ margin: 0, size: 'A4' }); py = 20; }
          const rh = 16;
          doc.rect(X, py, W, rh).fill(ti % 2 === 0 ? '#ffffff' : '#fafafa');
          doc.moveTo(X, py + rh).lineTo(X + W, py + rh).lineWidth(0.3).stroke('#e2e8f0');

          const title = t.title.length > 44 ? t.title.slice(0, 42) + '…' : t.title;
          doc.font('Reg').fontSize(7.5).fillColor(t.is_overdue ? '#b91c1c' : '#1e293b')
            .text(title, X + 6, py + 5, { width: 205 });

          const proj = (t.project_name || '').slice(0, 19) + (t.project_name?.length > 19 ? '…' : '');
          if (t.project_color && t.project_name) {
            doc.circle(X + 218, py + 8, 3).fill(t.project_color);
            doc.font('Reg').fontSize(7).fillColor('#475569').text(proj, X + 224, py + 4, { width: 96 });
          } else {
            doc.font('Reg').fontSize(7).fillColor('#cbd5e1').text('—', X + 215, py + 4, { width: 100 });
          }

          // status: small colored dot + plain text
          doc.circle(X + 327, py + 8, 3).fill(statusDot(t.status));
          doc.font('Reg').fontSize(7).fillColor('#475569')
            .text(statusLabel(t.status), X + 333, py + 4, { width: 80 });

          doc.font('Reg').fontSize(7.5).fillColor(t.is_overdue ? '#b91c1c' : '#475569')
            .text(fmtDl(t.deadline), X + 420, py + 4, { width: 62 });

          doc.font('Reg').fontSize(6.5).fillColor(pColors[t.priority] || '#78716c')
            .text(pLabels[t.priority] || 'Средн.', X + 486, py + 4, { width: 37, align: 'center' });

          py += rh;
        });
        py += 14;
      });

      // footer page 2
      doc.rect(0, 822, PW, 20).fill('#0f172a');
      doc.font('Reg').fontSize(7).fillColor('#475569')
        .text('MindsBar TeamTask · Детальный отчёт по задачам · Только для внутреннего использования', X, 828, { width: W, align: 'center' });
    }

    doc.end();
  });
}

module.exports = { buildSummaryData, generateSummaryPDF };
