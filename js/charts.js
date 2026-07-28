// charts.js — componentes SVG de visualização (barras, colunas, linha, meter, sparkline)
// Segue o design system: marcas finas, gaps de 2px, tooltip por marca, legenda p/ ≥2 séries.
import { fmtBRL, fmtBRLCompact, escapeHtml } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

// ---------- tooltip compartilhado ----------
let tipEl = null;
function tooltip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'chart-tip';
    tipEl.setAttribute('role', 'status');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
export function bindTip(el, html) {
  el.addEventListener('pointerenter', () => { const t = tooltip(); t.innerHTML = html; t.style.opacity = '1'; });
  el.addEventListener('pointermove', (e) => {
    const t = tooltip();
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    const r = t.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    t.style.transform = `translate(${x}px, ${y}px)`;
  });
  el.addEventListener('pointerleave', () => { tooltip().style.opacity = '0'; });
}

function svg(w, h) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  el.setAttribute('width', '100%');
  el.style.display = 'block';
  return el;
}
function mk(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
// caminho de barra com topo arredondado (4px), base reta
function roundedTopRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}
function roundedEndRectH(x, y, w, h, r) {
  r = Math.min(r, h / 2, w);
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

// ---------- barras horizontais (magnitude por categoria — sequencial) ----------
export function hBarChart(container, rows, { valueFn = (r) => r.total, labelFn = (r) => r.name, tipFn, onClick, maxBars = 12 } = {}) {
  container.innerHTML = '';
  const data = rows.slice(0, maxBars);
  if (!data.length) { container.innerHTML = '<p class="empty">Sem dados no período.</p>'; return; }
  const max = Math.max(...data.map(valueFn));
  const rowH = 34, labelW = 128, valueW = 88;
  const W = 560, H = data.length * rowH + 4;
  const el = svg(W, H);
  const ramp = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
  data.forEach((r, i) => {
    const v = valueFn(r);
    const y = i * rowH + 5;
    const bw = Math.max(2, (v / max) * (W - labelW - valueW - 16));
    const color = ramp[Math.min(i, ramp.length - 1)];
    const lbl = mk('text', { x: labelW - 8, y: y + 16, 'text-anchor': 'end', class: 'ax-label' });
    lbl.textContent = truncate(labelFn(r), 18);
    el.appendChild(lbl);
    const bar = mk('path', { d: roundedEndRectH(labelW, y + 2, bw, 20, 4), fill: color, class: onClick ? 'clickable' : '' });
    el.appendChild(bar);
    const val = mk('text', { x: labelW + bw + 8, y: y + 16, class: 'val-label' });
    val.textContent = fmtBRLCompact(v);
    el.appendChild(val);
    if (tipFn) bindTip(bar, tipFn(r));
    if (onClick) bar.addEventListener('click', () => onClick(r));
  });
  container.appendChild(el);
}

// ---------- colunas mensais (1–2 séries categóricas) ----------
// series: [{name, color, values:[...]}], labels: ['Jan',...]
export function columnChart(container, labels, series, { tipFn, height = 220, yFmt = fmtBRLCompact } = {}) {
  container.innerHTML = '';
  if (!labels.length || !series.length) { container.innerHTML = '<p class="empty">Sem dados.</p>'; return; }
  const W = 640, H = height, padL = 56, padB = 22, padT = 8;
  const el = svg(W, H);
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const plotW = W - padL - 8, plotH = H - padT - padB;
  // gridlines
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padT + plotH - (i / steps) * plotH;
    el.appendChild(mk('line', { x1: padL, x2: W - 8, y1: y, y2: y, class: i === 0 ? 'axis-line' : 'grid-line' }));
    const t = mk('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', class: 'ax-label small' });
    t.textContent = yFmt((i / steps) * max);
    el.appendChild(t);
  }
  const band = plotW / labels.length;
  const nS = series.length;
  const barW = Math.min(24, (band - 8 - (nS - 1) * 2) / nS);
  labels.forEach((lab, i) => {
    const x0 = padL + i * band + (band - (barW * nS + (nS - 1) * 2)) / 2;
    series.forEach((s, si) => {
      const v = s.values[i] || 0;
      const bh = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
      const x = x0 + si * (barW + 2);
      const y = padT + plotH - bh;
      if (bh > 0) {
        const bar = mk('path', { d: roundedTopRect(x, y, barW, bh, 4), fill: s.color });
        el.appendChild(bar);
        if (tipFn) bindTip(bar, tipFn(i, s, v));
      }
    });
    const t = mk('text', { x: padL + i * band + band / 2, y: H - 6, 'text-anchor': 'middle', class: 'ax-label small' });
    t.textContent = lab;
    el.appendChild(t);
  });
  container.appendChild(el);
  if (series.length >= 2) container.appendChild(legend(series));
}

// ---------- linha (evolução) ----------
export function lineChart(container, labels, series, { tipFn, height = 220, yFmt = fmtBRLCompact, area = false } = {}) {
  container.innerHTML = '';
  const n = labels.length;
  if (!n) { container.innerHTML = '<p class="empty">Sem dados.</p>'; return; }
  const W = 640, H = height, padL = 60, padB = 22, padT = 10, padR = 14;
  const el = svg(W, H);
  const allVals = series.flatMap((s) => s.values.filter((v) => v != null));
  const max = niceMax(Math.max(1, ...allVals));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padT + plotH - (i / steps) * plotH;
    el.appendChild(mk('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: i === 0 ? 'axis-line' : 'grid-line' }));
    const t = mk('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', class: 'ax-label small' });
    t.textContent = yFmt((i / steps) * max);
    el.appendChild(t);
  }
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => padT + plotH - (v / max) * plotH;
  const every = Math.ceil(n / 8);
  labels.forEach((lab, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    const t = mk('text', { x: xAt(i), y: H - 6, 'text-anchor': 'middle', class: 'ax-label small' });
    t.textContent = lab;
    el.appendChild(t);
  });
  for (const s of series) {
    const pts = s.values.map((v, i) => v == null ? null : [xAt(i), yAt(v)]);
    const segs = [];
    let cur = [];
    for (const p of pts) { if (p) cur.push(p); else { if (cur.length) segs.push(cur); cur = []; } }
    if (cur.length) segs.push(cur);
    for (const seg of segs) {
      const d = seg.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      if (area && seg.length > 1) {
        const ad = d + ` L${seg[seg.length - 1][0].toFixed(1)},${padT + plotH} L${seg[0][0].toFixed(1)},${padT + plotH} Z`;
        el.appendChild(mk('path', { d: ad, fill: s.color, opacity: '0.1' }));
      }
      el.appendChild(mk('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    pts.forEach((p, i) => {
      if (!p) return;
      const dot = mk('circle', { cx: p[0], cy: p[1], r: 4, fill: s.color, class: 'dot-ring' });
      el.appendChild(dot);
      if (tipFn) bindTip(dot, tipFn(i, s, s.values[i]));
    });
  }
  container.appendChild(el);
  if (series.length >= 2) container.appendChild(legend(series));
}

// ---------- meter (orçamento) ----------
export function meter(container, { value, max, label, sublabel }) {
  const pct = max > 0 ? value / max : 0;
  const state = pct >= 1 ? 'critical' : pct >= 0.85 ? 'warning' : 'ok';
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  wrap.innerHTML = `
    <div class="meter-head">
      <span class="meter-label">${escapeHtml(label)}</span>
      <span class="meter-val">${escapeHtml(sublabel || '')}</span>
    </div>
    <div class="meter-track"><div class="meter-fill ${state}" style="width:${Math.min(100, pct * 100).toFixed(1)}%"></div></div>`;
  bindTip(wrap.querySelector('.meter-track'), `<b>${escapeHtml(label)}</b><br>${fmtBRL(value)} de ${fmtBRL(max)} (${(pct * 100).toFixed(0)}%)`);
  container.appendChild(wrap);
  return wrap;
}

// ---------- sparkline (stat tile) ----------
export function sparkline(values, { width = 96, height = 28, color = 'var(--series-1)' } = {}) {
  const el = svg(width, height);
  const vals = values.filter((v) => v != null);
  if (vals.length < 2) return el;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = values.map((v, i) => v == null ? null :
    [(i / (values.length - 1)) * (width - 8) + 4, height - 4 - ((v - min) / span) * (height - 8)]);
  const d = pts.filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  el.appendChild(mk('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.85 }));
  const last = pts.filter(Boolean).pop();
  if (last) el.appendChild(mk('circle', { cx: last[0], cy: last[1], r: 3.5, fill: color, class: 'dot-ring' }));
  return el;
}

// ---------- stat tile ----------
export function statTile(container, { label, value, delta, deltaGoodWhenUp = true, spark, sparkColor }) {
  const div = document.createElement('div');
  div.className = 'tile';
  let deltaHtml = '';
  if (delta != null && isFinite(delta.pct)) {
    const up = delta.pct >= 0;
    const good = up === deltaGoodWhenUp;
    const arrow = up ? '▲' : '▼';
    deltaHtml = `<span class="delta ${good ? 'good' : 'bad'}">${arrow} ${Math.abs(delta.pct * 100).toFixed(0)}% <span class="delta-ctx">${escapeHtml(delta.vs || '')}</span></span>`;
  }
  div.innerHTML = `<div class="tile-label">${escapeHtml(label)}</div>
    <div class="tile-value">${escapeHtml(value)}</div>
    <div class="tile-foot">${deltaHtml}</div>`;
  if (spark && spark.filter((v) => v != null).length >= 2) {
    div.querySelector('.tile-foot').appendChild(sparkline(spark, { color: sparkColor || 'var(--series-1)' }));
  }
  container.appendChild(div);
  return div;
}

function legend(series) {
  const div = document.createElement('div');
  div.className = 'legend';
  div.innerHTML = series.map((s) => `<span class="legend-item"><span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`).join('');
  return div;
}

function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
