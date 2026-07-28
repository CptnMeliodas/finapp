// views/transactions.js — lista mensal + modal de lançamento (despesa/receita/parcelado)
import * as store from '../store.js';
import { fmtBRL, fmtDate, todayStr, currentYM, addMonths, ymLabelFull, escapeHtml, groupBy, sum } from '../util.js';

let ym = currentYM();
let filter = { type: '', accountId: '', categoryId: '', q: '' };

export function renderTransactions(main) {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="period">
      <button id="prevM">‹</button>
      <span class="label" id="ymLabel"></span>
      <button id="nextM">›</button>
      <button class="today-btn" id="todayBtn" style="width:auto">hoje</button>
    </div>
    <div class="card">
      <div class="form-grid">
        <label class="field"><span>Buscar</span><input id="fQ" placeholder="descrição…" value="${escapeHtml(filter.q)}"></label>
        <label class="field"><span>Tipo</span>
          <select id="fType">
            <option value="">Todos</option>
            <option value="despesa" ${filter.type === 'despesa' ? 'selected' : ''}>Despesas</option>
            <option value="receita" ${filter.type === 'receita' ? 'selected' : ''}>Receitas</option>
          </select></label>
        <label class="field"><span>Conta/Cartão</span><select id="fAcc"><option value="">Todas</option></select></label>
        <label class="field"><span>Categoria</span><select id="fCat"><option value="">Todas</option></select></label>
      </div>
    </div>
    <div id="txSummary" class="card"></div>
    <div id="txList"></div>`;
  main.appendChild(el);

  fillSelect(el.querySelector('#fAcc'), store.alive('accounts').map((a) => [a.id, a.name]), filter.accountId);
  fillSelect(el.querySelector('#fCat'), store.alive('categories').map((c) => [c.id, c.name]), filter.categoryId);

  const rerender = () => { renderList(el); };
  el.querySelector('#prevM').onclick = () => { ym = addMonths(ym, -1); rerender(); };
  el.querySelector('#nextM').onclick = () => { ym = addMonths(ym, 1); rerender(); };
  el.querySelector('#todayBtn').onclick = () => { ym = currentYM(); rerender(); };
  el.querySelector('#fQ').oninput = (e) => { filter.q = e.target.value; rerender(); };
  el.querySelector('#fType').onchange = (e) => { filter.type = e.target.value; rerender(); };
  el.querySelector('#fAcc').onchange = (e) => { filter.accountId = e.target.value; rerender(); };
  el.querySelector('#fCat').onchange = (e) => { filter.categoryId = e.target.value; rerender(); };
  renderList(el);
}

function fillSelect(sel, pairs, value) {
  for (const [v, label] of pairs) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  }
}

function renderList(root) {
  root.querySelector('#ymLabel').textContent = ymLabelFull(ym);
  let txs = store.monthTx(ym);
  if (filter.type) txs = txs.filter((t) => t.type === filter.type);
  if (filter.accountId) txs = txs.filter((t) => t.accountId === filter.accountId);
  if (filter.categoryId) txs = txs.filter((t) => t.categoryId === filter.categoryId);
  if (filter.q) {
    const q = filter.q.toLowerCase();
    txs = txs.filter((t) => (t.desc || '').toLowerCase().includes(q));
  }
  txs.sort((a, b) => b.date.localeCompare(a.date));

  const receitas = sum(txs.filter((t) => t.type === 'receita'), (t) => t.amount);
  const despesas = sum(txs.filter((t) => t.type === 'despesa'), (t) => t.amount);
  root.querySelector('#txSummary').innerHTML = `
    <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13.5px">
      <span>Receitas: <b style="color:var(--good-text)">${fmtBRL(receitas)}</b></span>
      <span>Despesas: <b>${fmtBRL(despesas)}</b></span>
      <span>Saldo: <b style="color:${receitas - despesas >= 0 ? 'var(--good-text)' : 'var(--critical)'}">${fmtBRL(receitas - despesas)}</b></span>
      <span class="muted">${txs.length} lançamentos</span>
    </div>`;

  const list = root.querySelector('#txList');
  list.innerHTML = '';
  if (!txs.length) { list.innerHTML = '<p class="empty">Nenhum lançamento neste mês. Toque em + para lançar.</p>'; return; }
  const byDay = groupBy(txs, (t) => t.date);
  for (const [date, dayTxs] of byDay) {
    const h = document.createElement('div');
    h.className = 'tx-day';
    h.textContent = fmtDate(date);
    list.appendChild(h);
    for (const t of dayTxs) list.appendChild(txRow(t));
  }
}

export function txRow(t, { onClick } = {}) {
  const cat = store.byId('categories', t.categoryId);
  const acc = store.byId('accounts', t.accountId);
  const div = document.createElement('div');
  div.className = 'tx';
  const ini = (cat ? cat.name : '?').slice(0, 2).toUpperCase();
  const inst = t.installment ? `<span class="badge">${t.installment.n}/${t.installment.total}</span>` : '';
  const src = t.source === 'fatura' ? '<span class="badge gray">fatura</span>' : '';
  div.innerHTML = `
    <div class="tx-ico">${escapeHtml(ini)}</div>
    <div class="tx-body">
      <div class="tx-desc">${escapeHtml(t.desc)} ${inst} ${src}</div>
      <div class="tx-meta">${escapeHtml(cat ? cat.name : 'Sem categoria')} · ${escapeHtml(acc ? acc.name : '—')}</div>
    </div>
    <div class="tx-amount ${t.type}">${t.type === 'receita' ? '+' : '−'} ${fmtBRL(t.amount)}</div>`;
  div.addEventListener('click', () => (onClick ? onClick(t) : openTxModal(t)));
  return div;
}

// ---------- modal ----------
export function openTxModal(tx) {
  const isEdit = !!(tx && tx.id);
  const back = document.createElement('div');
  back.className = 'modal-back';
  const cats = store.alive('categories');
  const accs = store.alive('accounts');
  const type = tx?.type || 'despesa';
  back.innerHTML = `
  <div class="modal">
    <h3>${isEdit ? 'Editar lançamento' : 'Novo lançamento'}<button class="close-x">✕</button></h3>
    <div class="seg" id="segType">
      <button data-v="despesa" class="${type === 'despesa' ? 'active' : ''}">Despesa</button>
      <button data-v="receita" class="${type === 'receita' ? 'active' : ''}">Receita</button>
    </div>
    <div class="form-grid">
      <label class="field full"><span>Descrição</span><input id="mDesc" value="${escapeHtml(tx?.desc || '')}" placeholder="Ex.: Mercado, iFood, Salário…"></label>
      <label class="field"><span>Valor (R$)${isEdit || '' ? '' : ' — total se parcelado'}</span><input id="mAmount" inputmode="decimal" value="${tx?.amount ?? ''}" placeholder="0,00"></label>
      <label class="field"><span>Data</span><input id="mDate" type="date" value="${tx?.date || todayStr()}"></label>
      <label class="field"><span>Conta / Cartão</span><select id="mAcc">${accs.map((a) => `<option value="${a.id}" ${tx?.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Categoria</span><select id="mCat">${cats.map((c) => `<option value="${c.id}" ${tx?.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
      <label class="field ${isEdit ? 'hidden' : ''}"><span>Parcelas</span>
        <select id="mParc">${[...Array(24)].map((_, i) => `<option value="${i + 1}">${i + 1 === 1 ? 'À vista' : (i + 1) + 'x'}</option>`).join('')}</select></label>
      <label class="field full"><span>Observações</span><input id="mNotes" value="${escapeHtml(tx?.notes || '')}"></label>
    </div>
    <div class="btn-row">
      <button class="btn" id="mSave">${isEdit ? 'Salvar' : 'Lançar'}</button>
      ${isEdit ? '<button class="btn danger" id="mDel">Excluir</button>' : ''}
      ${isEdit && tx.installment ? '<button class="btn danger" id="mDelGroup">Excluir todas as parcelas</button>' : ''}
    </div>
  </div>`;
  document.body.appendChild(back);
  const q = (s) => back.querySelector(s);
  let curType = type;
  q('#segType').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    curType = b.dataset.v;
    for (const x of q('#segType').children) x.classList.toggle('active', x === b);
    // filtra categorias pelo tipo
    const list = store.alive('categories').filter((c) => c.kind === curType || !c.kind);
    q('#mCat').innerHTML = list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  });
  if (!isEdit) {
    const list = cats.filter((c) => c.kind === curType || !c.kind);
    q('#mCat').innerHTML = list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    // sugere categoria conforme digita
    q('#mDesc').addEventListener('blur', () => {
      const sug = store.suggestCategory(q('#mDesc').value);
      if (sug && q('#mCat').querySelector(`option[value="${sug}"]`)) q('#mCat').value = sug;
    });
  }
  const close = () => back.remove();
  q('.close-x').onclick = close;
  back.addEventListener('click', (e) => { if (e.target === back) close(); });

  q('#mSave').onclick = () => {
    const amount = parseFloat(String(q('#mAmount').value).replace(/\./g, '').replace(',', '.'));
    if (!isFinite(amount) || amount <= 0) { q('#mAmount').focus(); return; }
    const base = {
      desc: q('#mDesc').value.trim() || '(sem descrição)',
      date: q('#mDate').value || todayStr(),
      categoryId: q('#mCat').value,
      accountId: q('#mAcc').value,
      notes: q('#mNotes').value.trim(),
      type: curType
    };
    const nParc = isEdit ? 1 : Number(q('#mParc').value);
    if (isEdit) {
      store.upsert('transactions', { ...tx, ...base, amount, faturaYM: undefined });
      // recalcula fatura se mudou conta/data
      const saved = store.byId('transactions', tx.id);
      const acc = store.byId('accounts', saved.accountId);
      saved.faturaYM = acc && acc.type === 'cartao' ? (tx.faturaYM && tx.accountId === saved.accountId && tx.date === saved.date ? tx.faturaYM : store.faturaYMFor(acc, saved.date)) : null;
      store.upsert('transactions', saved);
    } else if (nParc > 1 && curType === 'despesa') {
      store.addInstallmentPurchase({ ...base, total: amount, n: nParc });
    } else {
      store.addTransaction({ ...base, amount });
    }
    store.learnRule(base.desc, base.categoryId);
    close();
    window.appNavigate(location.hash.replace('#', '') || 'dashboard');
  };
  if (isEdit) {
    q('#mDel').onclick = () => { store.remove('transactions', tx.id); close(); window.appNavigate(location.hash.replace('#', '') || 'lancamentos'); };
    const dg = q('#mDelGroup');
    if (dg) dg.onclick = () => { store.removeInstallmentGroup(tx.installment.group); close(); window.appNavigate(location.hash.replace('#', '') || 'lancamentos'); };
  }
  setTimeout(() => q('#mDesc').focus(), 50);
}
