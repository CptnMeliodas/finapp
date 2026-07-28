// util.js — helpers de formatação, datas e ids
export const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtBRL = (v) => BRL.format(v || 0);
export const fmtBRLCompact = (v) => {
  const a = Math.abs(v || 0);
  if (a >= 1_000_000) return 'R$ ' + (v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
  if (a >= 10_000) return 'R$ ' + (v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
  return fmtBRL(v);
};
export const fmtPct = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) + '%';

export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const MESES_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function uid(prefix = 't') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
export function nowISO() { return new Date().toISOString(); }

// 'YYYY-MM-DD' local
export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function ymOf(dateStr) { return (dateStr || '').slice(0, 7); } // 'YYYY-MM'
export function currentYM() { return todayStr().slice(0, 7); }
export function ymLabel(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  return MESES[m - 1] + '/' + String(y).slice(2);
}
export function ymLabelFull(ym) {
  const [y, m] = ym.split('-').map(Number);
  return MESES_FULL[m - 1] + ' de ' + y;
}
export function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return y + '-' + String(m).padStart(2, '0');
}
export function ymDiff(a, b) { // a - b em meses
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (ya - yb) * 12 + (ma - mb);
}
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
export function fmtDateShort(dateStr) {
  if (!dateStr) return '—';
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}
export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function clampDay(ym, day) {
  return ym + '-' + String(Math.min(day, daysInMonth(ym))).padStart(2, '0');
}

// parse "1.234,56" | "R$ 1.234,56" | "-123,45" | "123.45" → Number
export function parseBRNumber(s) {
  if (typeof s === 'number') return s;
  if (!s) return NaN;
  let t = String(s).replace(/R\$\s?/gi, '').replace(/\s/g, '').trim();
  let neg = false;
  if (/^-/.test(t) || /-$/.test(t) || /\bCR\b/i.test(t)) neg = true;
  t = t.replace(/-|(\bCR\b)/gi, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) t = t.replace(/,/g, '');
  const n = parseFloat(t);
  return neg ? -n : n;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
export function sum(arr, fn = (x) => x) { return arr.reduce((a, x) => a + (fn(x) || 0), 0); }

export function normalizeDesc(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

export function downloadFile(name, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function toCSV(rows) {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
}
