// views/investments.js — carteira, aportes, rendimentos e evolução
import * as store from '../store.js';
import { fmtBRL, fmtBRLCompact, fmtPct, currentYM, ymLabel, escapeHtml, sum, uid } from '../util.js';
import { statTile, lineChart, hBarChart } from '../charts.js';

const CLASSES = { cdi: 'Renda fixa / CDI', fii: 'FIIs', acoes: 'Ações / BDRs', usd: 'Dólar / Exterior', previdencia: 'Previdência', outro: 'Outro' };

export function renderInvestments(main) {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="grid-tiles" id="invTiles"></div>
    <div class="card">
      <h2>Evolução do patrimônio</h2>
      <p class="sub">Saldo total consolidado por mês</p>
      <div id="invChart"></div>
    </div>
    <div class="row-2">
      <div class="card"><h2>Por classe</h2><div id="invByClass"></div></div>
      <div class="card">
        <h2>Rendimento mensal</h2>
        <p class="sub">Rendimento = saldo final − saldo anterior − aportes + resgates</p>
        <div id="invYield"></div>
      </div>
    </div>
    <div class="card">
      <h2>Ativos</h2>
      <p class="sub">Registre uma vez por mês o saldo de cada ativo (com aportes/resgates do mês). O app calcula rendimento e rentabilidade.</p>
      <div id="invList"></div>
      <div class="btn-row"><button class="btn" id="invAdd">+ Novo ativo</button></div>
    </div>`;
  main.appendChild(el);
  draw(el);
  el.querySelector('#invAdd').onclick = () => openInvModal();
}

function draw(el) {
  const port = store.portfolioSummary();
  const months = store.portfolioByMonth();
  const total = sum(port, (p) => p.saldo);
  const rendUlt = sum(port.filter((p) => p.rendimentoUlt != null), (p) => p.rendimentoUlt);
  const rend12 = sum(port, (p) => p.rendimento12m);
  const aportes12 = sum(months.slice(-12), (m) => m.aportes);

  const tiles = el.querySelector('#invTiles');
  statTile(tiles, { label: 'Patrimônio investido', value: fmtBRL(total), spark: months.slice(-12).map((m) => m.total) });
  statTile(tiles, { label: 'Rendimento no último mês', value: fmtBRL(rendUlt) });
  statTile(tiles, { label: 'Rendimento 12m', value: fmtBRL(rend12) });
  statTile(tiles, { label: 'Aportes 12m', value: fmtBRL(aportes12) });

  lineChart(el.querySelector('#invChart'), months.map((m) => ymLabel(m.ym)), [
    { name: 'Patrimônio', color: 'var(--series-1)', values: months.map((m) => m.total) }
  ], {
    area: true,
    tipFn: (i, s, v) => `<b>${ymLabel(months[i].ym)}</b><br>Saldo: ${fmtBRL(v)}<br>Aportes: ${fmtBRL(months[i].aportes)}${months[i].resgates ? '<br>Resgates: ' + fmtBRL(months[i].resgates) : ''}`
  });

  // por classe
  const byClass = [];
  for (const [cls, label] of Object.entries(CLASSES)) {
    const rows = port.filter((p) => p.inv.class === cls);
    if (rows.length) byClass.push({ name: label, total: sum(rows, (r) => r.saldo), count: rows.length });
  }
  byClass.sort((a, b) => b.total - a.total);
  hBarChart(el.querySelector('#invByClass'), byClass, {
    tipFn: (r) => `<b>${escapeHtml(r.name)}</b><br>${fmtBRL(r.total)} · ${((r.total / (total || 1)) * 100).toFixed(1)}% da carteira`
  });

  // rendimento mensal consolidado (últimos 12 meses com dados)
  const yields = months.map((m, i) => {
    if (i === 0) return null;
    return m.total - months[i - 1].total - m.aportes + m.resgates;
  });
  const yl = months.slice(-12);
  const yv = yields.slice(-12);
  lineChart(el.querySelector('#invYield'), yl.map((m) => ymLabel(m.ym)), [
    { name: 'Rendimento', color: 'var(--series-3)', values: yv }
  ], {
    tipFn: (i, s, v) => `<b>${ymLabel(yl[i].ym)}</b><br>Rendimento: ${fmtBRL(v)}`
  });

  // lista de ativos
  const list = el.querySelector('#invList');
  list.innerHTML = '';
  if (!port.length) list.innerHTML = '<p class="empty">Nenhum ativo ainda. Ex.: “CDB 110% CDI”, “HGLG11”, “IB — carteira USD”.</p>';
  for (const p of port) {
    const row = document.createElement('div');
    row.className = 'tx';
    row.innerHTML = `
      <div class="tx-ico">${escapeHtml((CLASSES[p.inv.class] || '?').slice(0, 2).toUpperCase())}</div>
      <div class="tx-body">
        <div class="tx-desc">${escapeHtml(p.inv.name)}</div>
        <div class="tx-meta">${escapeHtml(CLASSES[p.inv.class] || p.inv.class)}${p.inv.institution ? ' · ' + escapeHtml(p.inv.institution) : ''} · último registro: ${p.lastYM ? ymLabel(p.lastYM) : '—'}${p.rentabUlt != null ? ' · ' + fmtPct(p.rentabUlt) + ' no mês' : ''}</div>
      </div>
      <div class="tx-amount">${fmtBRL(p.saldo)}</div>`;
    row.onclick = () => openInvModal(p.inv);
    list.appendChild(row);
  }
}

// ---------- modal de ativo + registros mensais ----------
export function openInvModal(inv) {
  const isEdit = !!inv;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
  <div class="modal">
    <h3>${isEdit ? 'Ativo' : 'Novo ativo'}<button class="close-x">✕</button></h3>
    <div class="form-grid">
      <label class="field full"><span>Nome</span><input id="iName" value="${escapeHtml(inv?.name || '')}" placeholder="Ex.: CDB 110% CDI, HGLG11, IB carteira USD"></label>
      <label class="field"><span>Classe</span>
        <select id="iClass">${Object.entries(CLASSES).map(([v, l]) => `<option value="${v}" ${inv?.class === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Instituição</span><input id="iInst" value="${escapeHtml(inv?.institution || '')}" placeholder="Itaú, XP, IB…"></label>
    </div>
    <div class="btn-row">
      <button class="btn" id="iSave">${isEdit ? 'Salvar' : 'Criar ativo'}</button>
      ${isEdit ? '<button class="btn danger" id="iDel">Excluir ativo</button>' : ''}
    </div>
    ${isEdit ? `
    <h3 class="mt">Registro mensal</h3>
    <div class="form-grid">
      <label class="field"><span>Mês</span><input id="eYM" type="month" value="${currentYM()}"></label>
      <label class="field"><span>Saldo final do mês (R$)</span><input id="eSaldo" inputmode="decimal" placeholder="0,00"></label>
      <label class="field"><span>Aportes no mês (R$)</span><input id="eAporte" inputmode="decimal" placeholder="0,00"></label>
      <label class="field"><span>Resgates no mês (R$)</span><input id="eResg" inputmode="decimal" placeholder="0,00"></label>
    </div>
    <div class="btn-row"><button class="btn" id="eSave">Registrar mês</button></div>
    <div class="table-wrap mt"><table class="data" id="eTable">
      <thead><tr><th>Mês</th><th class="num">Aportes</th><th class="num">Resgates</th><th class="num">Saldo</th><th class="num">Rendimento</th><th class="num">%</th><th></th></tr></thead>
      <tbody></tbody></table></div>` : ''}
  </div>`;
  document.body.appendChild(back);
  const q = (s) => back.querySelector(s);
  const close = () => back.remove();
  q('.close-x').onclick = close;
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  const num = (s) => {
    const v = parseFloat(String(q(s).value || '0').replace(/\./g, '').replace(',', '.'));
    return isFinite(v) ? v : 0;
  };

  q('#iSave').onclick = () => {
    const item = {
      id: inv?.id || uid('inv'),
      name: q('#iName').value.trim() || 'Ativo',
      class: q('#iClass').value,
      institution: q('#iInst').value.trim()
    };
    store.upsert('investments', item);
    close();
    window.appNavigate('investimentos');
  };
  if (isEdit) {
    q('#iDel').onclick = () => {
      if (!confirm('Excluir este ativo e todos os registros?')) return;
      for (const e of store.invEntries(inv.id)) store.remove('investmentEntries', e.id);
      store.remove('investments', inv.id);
      close();
      window.appNavigate('investimentos');
    };
    const fillTable = () => {
      const tb = q('#eTable tbody');
      const series = store.invSeries(inv.id).slice().reverse();
      tb.innerHTML = series.map((s) => `
        <tr><td>${ymLabel(s.ym)}</td>
        <td class="num">${fmtBRLCompact(s.aportes || 0)}</td>
        <td class="num">${fmtBRLCompact(s.resgates || 0)}</td>
        <td class="num">${fmtBRL(s.saldoFinal)}</td>
        <td class="num">${s.rendimento != null ? fmtBRL(s.rendimento) : '—'}</td>
        <td class="num">${s.rentab != null ? fmtPct(s.rentab) : '—'}</td>
        <td><button class="btn danger small" data-id="${s.id}">✕</button></td></tr>`).join('');
      for (const b of tb.querySelectorAll('button')) {
        b.onclick = () => { store.remove('investmentEntries', b.dataset.id); fillTable(); };
      }
    };
    fillTable();
    q('#eSave').onclick = () => {
      const ym = q('#eYM').value;
      if (!ym) return;
      const existing = store.invEntries(inv.id).find((e) => e.ym === ym);
      store.upsert('investmentEntries', {
        id: existing?.id || uid('ie'),
        investmentId: inv.id, ym,
        saldoFinal: num('#eSaldo'),
        aportes: num('#eAporte'),
        resgates: num('#eResg')
      });
      q('#eSaldo').value = ''; q('#eAporte').value = ''; q('#eResg').value = '';
      fillTable();
    };
  }
}
