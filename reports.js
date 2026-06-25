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
    };
  });

  const periodLabel =
    days === 1  ? '1 день'   :
    days === 3  ? '3 дня'    :
    days === 7  ? '7 дней'   :
    days === 14 ? '14 дней'  :
    days === 30 ? 'Месяц'    : `${days} дней`;

  return { global, employees: perEmployee, period: days, periodLabel, generatedAt: nowISOt };
}

async function generateSummaryPDF(data) {
  return new Promise((resolve, reject) => {
    const PDFDocument = require('pdfkit');
    const chunks = [];
    const doc = new PDFDocument({ margin: 45, size: 'A4' });
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Regular', FONT_REG);
    doc.registerFont('Bold',    FONT_BOLD);

    const { global: g, employees, periodLabel, generatedAt } = data;
    const W   = 505; // usable width
    const X   = 45;  // left margin
    const eff = g.total > 0 ? Math.round(g.done / g.total * 100) : 0;

    // ── Header ─────────────────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 70).fill('#1e293b');
    doc.font('Bold').fontSize(18).fillColor('#ffffff')
      .text('MindsBar — Сводный отчёт', X, 18);
    doc.font('Regular').fontSize(10).fillColor('#94a3b8')
      .text(`Период: последние ${periodLabel}   ·   Сформирован: ${generatedAt.slice(0,16).replace('T',' ')}`, X, 42);

    // ── Summary cards ─────────────────────────────────────────────────────────
    const cards = [
      { label: 'Всего задач',    value: String(g.total),    color: '#3b82f6' },
      { label: 'Выполнено',      value: `${g.done} (${eff}%)`, color: '#22c55e' },
      { label: 'Просрочено',     value: String(g.overdue),  color: '#ef4444' },
      { label: 'Сотрудников',    value: String(employees.filter(e => e.stats.assigned > 0).length), color: '#8b5cf6' },
    ];
    const cardW = 117, cardH = 55, cardGap = 8;
    let cx = X;
    const cy = 82;
    cards.forEach(card => {
      doc.roundedRect(cx, cy, cardW, cardH, 6).fill('#f8fafc').stroke('#e2e8f0');
      doc.rect(cx, cy, 4, cardH).fill(card.color);
      doc.font('Bold').fontSize(20).fillColor('#111827').text(card.value, cx + 12, cy + 8, { width: cardW - 16 });
      doc.font('Regular').fontSize(9).fillColor('#6b7280').text(card.label, cx + 12, cy + 34, { width: cardW - 16 });
      cx += cardW + cardGap;
    });

    // ── Table ─────────────────────────────────────────────────────────────────
    doc.font('Bold').fontSize(12).fillColor('#111827').text('По сотрудникам', X, cy + cardH + 18);

    const tY    = cy + cardH + 38;
    const COL   = { name: X, asgn: 230, done: 285, over: 340, pctD: 390, pctT: 445 };
    const COL_W = { name: 175, asgn: 50, done: 50, over: 50, pctD: 50, pctT: 55 };
    const ROW_H = 22;

    // header row
    doc.rect(X, tY, W, ROW_H).fill('#1e293b');
    doc.font('Bold').fontSize(8.5).fillColor('#ffffff');
    const headers = [
      ['Сотрудник',   COL.name, COL_W.name],
      ['Назначено',   COL.asgn, COL_W.asgn],
      ['Выполнено',   COL.done, COL_W.done],
      ['Просрочено',  COL.over, COL_W.over],
      ['% выполн.',   COL.pctD, COL_W.pctD],
      ['% в срок',    COL.pctT, COL_W.pctT],
    ];
    headers.forEach(([label, x, w]) =>
      doc.text(label, x + 4, tY + 7, { width: w, align: x === COL.name ? 'left' : 'center' })
    );

    // data rows
    employees.forEach((emp, i) => {
      const s  = emp.stats;
      const ry = tY + ROW_H + i * ROW_H;
      doc.rect(X, ry, W, ROW_H).fill(i % 2 === 0 ? '#ffffff' : '#f8fafc').stroke('#e5e7eb');

      doc.font('Regular').fontSize(8.5).fillColor('#111827')
        .text(emp.name.length > 28 ? emp.name.slice(0, 26) + '…' : emp.name, COL.name + 4, ry + 7, { width: COL_W.name });

      doc.text(String(s.assigned), COL.asgn + 4, ry + 7, { width: COL_W.asgn, align: 'center' });

      doc.fillColor(s.done > 0 ? '#15803d' : '#374151')
        .text(String(s.done), COL.done + 4, ry + 7, { width: COL_W.done, align: 'center' });

      doc.fillColor(s.overdue > 0 ? '#dc2626' : '#374151')
        .text(String(s.overdue), COL.over + 4, ry + 7, { width: COL_W.over, align: 'center' });

      const pDoneColor = s.pctDone === null ? '#9ca3af' : s.pctDone >= 80 ? '#15803d' : s.pctDone >= 50 ? '#d97706' : '#dc2626';
      doc.fillColor(pDoneColor)
        .text(s.pctDone !== null ? `${s.pctDone}%` : '—', COL.pctD + 4, ry + 7, { width: COL_W.pctD, align: 'center' });

      const pTimeColor = s.pctOnTime === null ? '#9ca3af' : s.pctOnTime >= 80 ? '#15803d' : s.pctOnTime >= 50 ? '#d97706' : '#dc2626';
      doc.fillColor(pTimeColor)
        .text(s.pctOnTime !== null ? `${s.pctOnTime}%` : '—', COL.pctT + 4, ry + 7, { width: COL_W.pctT, align: 'center' });
    });

    // footer
    const footY = tY + ROW_H + employees.length * ROW_H + 20;
    doc.font('Regular').fontSize(8).fillColor('#9ca3af')
      .text('MindsBar TeamTask · Автоматический отчёт', X, footY, { width: W, align: 'center' });

    doc.end();
  });
}

module.exports = { buildSummaryData, generateSummaryPDF };
