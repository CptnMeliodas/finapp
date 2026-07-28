// views/reports.js — visão anual, matriz categoria × mês, export CSV
import * as store from '../store.js';
import { fmtBRL, fmtBRLCompact, MESES, currentYM, ymLabel, escapeHtml, sum, toCSV, downloadFile } from '../util.js';
import { columnChart } from '../charts.js';

let year = Number(currentYM().slice(0, 4));

export function renderReports(main) {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="period">
      <button id="prevY">‹</button><span class="label">${year}</span><button id="nextY">›</button>
    </div>
    <div class="card">
      <h2>Fluxo do ano</h2>
      <p class="sub">Receitas × despesas por mês (competência)</p>
      <div id="yearChart"></div>
      <div id="yearTotals" class="mt note"></div>
    </div>
    <div class="card">
      <h2>Despesas por categoria × mês</h2>
      <p class="sub">Clique num valor para ver os lançamentos daquele mês</p>
      <div class="table-wrap" id="matrix"></div>
      <div class="btn-row">
        <button class="btn secondary" id="expCat">Exportar matriz (CSV)</button>
        <button class="btn secondary" id="expTx">Exportar lançamentos do ano (CSV)</button>
      </div>
    </div>
    <div class="card">
      <h2>Parcelamentos em andamento</h2>
      <p class="sub">Compromissos futuros já contratados</p>
      <div class="table-wrap" id="instTable"></div>
    </div>`;
  main.appendChild(el);
  el.querySelector('#prevY').onclick = () => { year--; redraw(main); };
  el.querySelector('#nextY').onclick = () => { year++; redraw(main); };
  draw(el);
}
function redraw(main) { main.innerHTML = ''; renderReports(main); }

function yms() { return [...Array(12)].map((_, i) => year + '-' + String(i + 1).padStart(2, '0')); }

function draw(el) {
  const months = yms();
  const summaries = months.map((ym) => store.monthSummary(ym));

  columnChart(el.querySelector('#yearChart'), MESES, [
    { name: 'Receitas', color: 'var(--series-1)', values: summaries.map((s) => s.receitas) },
    { name: 'Despesas', color: 'var(--series-2)', values: summaries.map((s) => s.despesas) }
  ], {
    tipFn: (i, s, v) => `<b>${MESES[i]}/${year}</b><br>${escapeHtml(s.name)}: ${fmtBRL(v)}<br>Saldo: ${fmtBRL(summaries[i].saldo)}`
  });
  const totR = sum(summaries, (s) => s.receitas), totD = sum(summaries, (s) => s.despesas);
  el.querySelector('#yearTotals').innerHTML =
    `Acumulado ${year}: receitas <b>${fmtBRL(totR)}</b> · despesas <b>${fmtBRL(totD)}</b> · saldo <b style="color:${totR - totD >= 0 ? 'var(--good-text)' : 'var(--critical)'}">${fmtBRL(totR - totD)}</b>` +
    (totR > 0 ? ` · taxa de poupança <b>${(((totR - totD) / totR) * 100).toFixed(1)}%</b>` : '');

  // matriz categoria × mês
  const cats = store.alive('categories').filter((c) => c.kind === 'despesa');
  const cells = {}; // catId → [12]
  for (const c of cats) cells[c.id] = Array(12).fill(0);
  const other = Array(12).fill(0);
  for (const t of store.txAlive()) {
    if (t.type !== 'despesa') continue;
    const ym = store.competenceYM(t);
    if (!ym.startsWith(String(year))) continue;
    const mi = Number(ym.slice(5, 7)) - 1;
    if (cells[t.categoryId]) cells[t.categoryId][mi] += t.amount;
    else other[mi] += t.amount;
  }
  const rows = cats.map((c) => ({ name: c.name, vals: cells[c.id], total: sum(cells[c.id]) }))
    .filter((r) => r.total > 0);
  if (sum(other) > 0) rows.push({ name: 'Sem categoria', vals: other, total: sum(other) });
  rows.sort((a, b) => b.total - a.total);
  const colTotals = Array(12).fill(0);
  for (const r of rows) r.vals.forEach((v, i) => colTotals[i] += v);

  const tbl = `<table class="data">
    <thead><tr><th>Categoria</th>${MESES.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr></thead>
    <tbody>
      ${rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td>${r.vals.map((v) => `<td class="num">${v ? fmtBRLCompact(v).replace('R$ ', '') : '·'}</td>`).join('')}<td class="num"><b>${fmtBRLCompact(r.total).replace('R$ ', '')}</b></td></tr>`).join('')}
      <tr class="total"><td>Total</td>${colTotals.map((v) => `<td class="num">${v ? fmtBRLCompact(v).replace('R$ ', '') : '·'}</td>`).join('')}<td class="num">${fmtBRLCompact(sum(colTotals)).replace('R$ ', '')}</td></tr>
    </tbody></table>
    <p class="note mt">Valores em reais (k = mil). Tabela completa disponível no CSV.</p>`;
  el.querySelector('#matrix').innerHTML = tbl;

  el.querySelector('#expCat').onclick = () => {
    const data = [['Categoria', ...MESES, 'Total'],
      ...rows.map((r) => [r.name, ...r.vals.map((v) => v.toFixed(2).replace('.', ',')), r.total.toFixed(2).replace('.', ',')])];
    downloadFile(`categorias-${year}.csv`, toCSV(data), 'text/csv');
  };
  el.querySelector('#expTx').onclick = () => {
    const txs = store.txAlive().filter((t) => store.competenceYM(t).startsWith(String(year)))
      .sort((a, b) => a.date.localeCompare(b.date));
    const data = [['Data', 'Competência', 'Descrição', 'Tipo', 'Valor', 'Categoria', 'Conta', 'Parcela', 'Origem'],
      ...txs.map((t) => [
        t.date, store.competenceYM(t), t.desc, t.type,
        (t.type === 'despesa' ? -t.amount : t.amount).toFixed(2).replace('.', ','),
        (store.byId('categories', t.categoryId) || {}).name || '',
        (store.byId('accounts', t.accountId) || {}).name || '',
        t.installment ? `${t.installment.n}/${t.installment.total}` : '',
        t.source || 'manual'
      ])];
    downloadFile(`lancamentos-${year}.csv`, toCSV(data), 'text/csv');
  };

  // parcelamentos em andamento
  const cur = currentYM();
  const groups = new Map();
  for (const t of store.txAlive()) {
    if (!t.installment || t.type !== 'despesa') continue;
    const g = t.installment.group || t.desc;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  const active = [];
  for (const [, list] of groups) {
    list.sort((a, b) => a.installment.n - b.installment.n);
    const last = list[list.length - 1];
    const restantes = list.filter((t) => store.competenceYM(t) >= cur);
    if (!restantes.length) continue;
    active.push({
      desc: last.desc, total: last.installment.total,
      pagas: last.installment.total - restantes.length,
      valorParcela: last.amount,
      restante: sum(restantes, (t) => t.amount),
      fim: store.competenceYM(list[list.length - 1])
    });
  }
  active.sort((a, b) => b.restante - a.restante);
  el.querySelector('#instTable').innerHTML = active.length ? `<table class="data">
    <thead><tr><th>Compra</th><th class="num">Parcela</th><th class="num">Pagas</th><th class="num">Restante</th><th>Termina em</th></tr></thead>
    <tbody>${active.map((a) => `<tr><td>${escapeHtml(a.desc)}</td><td class="num">${fmtBRL(a.valorParcela)}</td><td class="num">${a.pagas}/${a.total}</td><td class="num">${fmtBRL(a.restante)}</td><td>${ymLabel(a.fim)}</td></tr>`).join('')}
    <tr class="total"><td>Total comprometido</td><td></td><td></td><td class="num">${fmtBRL(sum(active, (a) => a.restante))}</td><td></td></tr></tbody></table>`
    : '<p class="empty">Nenhum parcelamento em andamento.</p>';
}
