// views/dashboard.js — visão geral do mês + tendências
import * as store from '../store.js';
import { fmtBRL, fmtBRLCompact, currentYM, addMonths, ymLabel, ymLabelFull, escapeHtml, sum } from '../util.js';
import { statTile, columnChart, hBarChart, meter, bindTip } from '../charts.js';
import { txRow } from './transactions.js';

let ym = currentYM();

export function renderDashboard(main) {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="period">
      <button id="prevM">‹</button><span class="label">${ymLabelFull(ym)}</span><button id="nextM">›</button>
      <button class="today-btn" id="todayBtn" style="width:auto">hoje</button>
    </div>
    <div class="grid-tiles" id="tiles"></div>
    <div class="row-2">
      <div class="card"><h2>Fluxo mensal</h2><p class="sub">Receitas × despesas, últimos 12 meses</p><div id="flowChart"></div></div>
      <div class="card"><h2>Despesas por categoria</h2><p class="sub">${ymLabelFull(ym)}</p><div id="catChart"></div></div>
    </div>
    <div class="row-2">
      <div class="card" id="budgetCard"><h2>Orçamento do mês</h2><p class="sub">Realizado × orçado por categoria</p><div id="budgets"></div></div>
      <div class="card"><h2>Faturas dos cartões</h2><p class="sub">Competência ${ymLabel(ym)} e compromissos futuros</p><div id="cards"></div></div>
    </div>
    <div class="card"><h2>Últimos lançamentos</h2><div id="recent"></div></div>`;
  main.appendChild(el);
  el.querySelector('#prevM').onclick = () => { ym = addMonths(ym, -1); redraw(main); };
  el.querySelector('#nextM').onclick = () => { ym = addMonths(ym, 1); redraw(main); };
  el.querySelector('#todayBtn').onclick = () => { ym = currentYM(); redraw(main); };
  draw(el);
}
function redraw(main) { main.innerHTML = ''; renderDashboard(main); }

function draw(el) {
  const cur = store.monthSummary(ym);
  const prev = store.monthSummary(addMonths(ym, -1));
  const hist = store.seriesMonthly(addMonths(ym, -11), 12);

  // tiles
  const tiles = el.querySelector('#tiles');
  const dRec = prev.receitas > 0 ? { pct: (cur.receitas - prev.receitas) / prev.receitas, vs: 'vs ' + ymLabel(addMonths(ym, -1)) } : null;
  const dDes = prev.despesas > 0 ? { pct: (cur.despesas - prev.despesas) / prev.despesas, vs: 'vs ' + ymLabel(addMonths(ym, -1)) } : null;
  statTile(tiles, { label: 'Receitas', value: fmtBRL(cur.receitas), delta: dRec, deltaGoodWhenUp: true, spark: hist.map((h) => h.receitas), sparkColor: 'var(--series-1)' });
  statTile(tiles, { label: 'Despesas', value: fmtBRL(cur.despesas), delta: dDes, deltaGoodWhenUp: false, spark: hist.map((h) => h.despesas), sparkColor: 'var(--series-2)' });
  statTile(tiles, { label: 'Saldo do mês', value: fmtBRL(cur.saldo) });
  const port = store.portfolioSummary();
  const patrimonio = sum(port, (p) => p.saldo);
  statTile(tiles, { label: 'Investimentos', value: fmtBRLCompact(patrimonio) });

  // fluxo mensal
  columnChart(el.querySelector('#flowChart'), hist.map((h) => ymLabel(h.ym)), [
    { name: 'Receitas', color: 'var(--series-1)', values: hist.map((h) => h.receitas) },
    { name: 'Despesas', color: 'var(--series-2)', values: hist.map((h) => h.despesas) }
  ], {
    tipFn: (i, s, v) => `<b>${ymLabelFull(hist[i].ym)}</b><br>${escapeHtml(s.name)}: ${fmtBRL(v)}<br>Saldo: ${fmtBRL(hist[i].saldo)}`
  });

  // categorias
  const cats = store.byCategory(ym, 'despesa');
  hBarChart(el.querySelector('#catChart'), cats, {
    tipFn: (r) => `<b>${escapeHtml(r.name)}</b><br>${fmtBRL(r.total)} em ${r.count} lançamento(s)`,
    onClick: () => window.appNavigate('lancamentos')
  });

  // orçamento
  const bud = el.querySelector('#budgets');
  const withBudget = cats.filter((c) => c.budget > 0);
  // inclui categorias orçadas sem gasto no mês
  for (const c of store.alive('categories').filter((c) => c.kind === 'despesa' && c.budget > 0)) {
    if (!withBudget.find((w) => w.catId === c.id)) withBudget.push({ catId: c.id, name: c.name, total: 0, budget: c.budget });
  }
  if (!withBudget.length) {
    bud.innerHTML = '<p class="empty">Defina orçamentos por categoria em Ajustes → Categorias.</p>';
  } else {
    withBudget.sort((a, b) => (b.total / b.budget) - (a.total / a.budget));
    for (const c of withBudget) {
      meter(bud, { value: c.total, max: c.budget, label: c.name, sublabel: `${fmtBRLCompact(c.total)} / ${fmtBRLCompact(c.budget)}` });
    }
  }

  // faturas
  const cardsEl = el.querySelector('#cards');
  const cardAccs = store.alive('accounts').filter((a) => a.type === 'cartao');
  if (!cardAccs.length) cardsEl.innerHTML = '<p class="empty">Nenhum cartão cadastrado.</p>';
  for (const acc of cardAccs) {
    const total = store.faturaTotal(acc.id, ym);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 2px;border-bottom:1px solid var(--grid)';
    row.innerHTML = `<span>${escapeHtml(acc.name)} <span class="muted" style="font-size:12px">fecha dia ${acc.closingDay || '—'}</span></span><b>${fmtBRL(total)}</b>`;
    bindTip(row, `<b>${escapeHtml(acc.name)}</b><br>Fatura ${ymLabel(ym)}: ${fmtBRL(total)}<br>Vencimento dia ${acc.dueDay || '—'}`);
    cardsEl.appendChild(row);
  }
  const fut = store.futureInstallments(ym).slice(0, 6);
  if (fut.length) {
    const t = document.createElement('div');
    t.className = 'note mt';
    t.innerHTML = '<b>Parcelas já contratadas:</b> ' + fut.map((f) => `${ymLabel(f.ym)}: ${fmtBRLCompact(f.total)}`).join(' · ');
    cardsEl.appendChild(t);
  }

  // recentes
  const recent = el.querySelector('#recent');
  const txs = store.txAlive().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);
  if (!txs.length) recent.innerHTML = '<p class="empty">Sem lançamentos ainda. Toque em + para começar, ou importe uma fatura.</p>';
  for (const t of txs) recent.appendChild(txRow(t));
}
