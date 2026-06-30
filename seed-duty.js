// Run once: node seed-duty.js
// Imports duty schedule from xlsx into SQLite
require('dotenv').config();
const XLSX = require('xlsx');
const { db, initDB } = require('./database');

initDB();

const wb = XLSX.readFile('/Users/abdusalom.rabikhov/Desktop/1. MindsEdTech/0. HR/График дежурств.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Row 2 (index 2): headers — №, ФИО, serial1, serial2, ..., Комментарии
// Rows 3+ (index 3+): employee data
const headerRow = rows[2];
const serialCols = [];
for (let c = 2; c < headerRow.length - 1; c++) {
  const serial = headerRow[c];
  if (typeof serial === 'number' && serial > 40000) {
    // Convert Excel serial to local date (store as Sunday = the duty day)
    const [y, m, d2] = new Date((serial - 25569) * 86400 * 1000).toISOString().slice(0,10).split('-').map(Number);
    const d = new Date(y, m-1, d2); // local date, no UTC shift
    // Snap to nearest Sunday (forward)
    const day = d.getDay();
    const diffToSun = day === 0 ? 0 : 7 - day;
    d.setDate(d.getDate() + diffToSun);
    const pad = n => String(n).padStart(2,'0');
    const sunday = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    serialCols.push({ col: c, week_start: sunday });
  }
}

console.log('Weeks found:', serialCols.map(s => s.week_start));

// Clear existing duty entries
db.prepare('DELETE FROM duty_schedule').run();

const ins = db.prepare('INSERT INTO duty_schedule (week_start, employee_name, user_id, comment) VALUES (?,?,?,?)');

let count = 0;
for (let r = 3; r < rows.length; r++) {
  const row = rows[r];
  const name = String(row[1] || '').trim();
  const comment = String(row[row.length - 1] || '').trim();
  if (!name) continue;

  for (const { col, week_start } of serialCols) {
    const val = String(row[col] || '').trim().toUpperCase();
    if (val === 'X' || val === 'Х') { // both latin X and cyrillic Х
      // Try to match user by name fragment
      const users = db.prepare('SELECT id FROM users WHERE name LIKE ?').all(`%${name.split(' ')[0]}%`);
      const user_id = users.length === 1 ? users[0].id : null;
      ins.run(week_start, name, user_id, comment);
      count++;
      console.log(`  ${week_start} → ${name}${user_id ? ` (user_id=${user_id})` : ''}`);
    }
  }
}

console.log(`\nImported ${count} duty entries.`);
