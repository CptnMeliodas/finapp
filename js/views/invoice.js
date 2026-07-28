// views/invoice.js — importação de fatura (PDF ou texto) + parecer completo
import * as store from '../store.js';
import { parseStatement, extractPdfText, detectBank } from '../parsers.js';
import { fmtBRL, fmtBRLCompact, currentYM, addMonths, ymLabel, ymLabelFull, escapeHtml, sum, groupBy, normalizeDesc, clampDay, uid, ymOf, ymDiff, fmtDate } from '../util.js';
import { hBarChart, statTile } from '../charts.js';

let stateIv = { items: [], bank: null, accId: null, refYM: currentYM(), imported: null };

export function renderInvoice(main) {
  const cards = store.alive('accounts').filter((a) => a.type === 'cartao');
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="card">
      <h2>Importar fatura do cartão</h2>
      <p class="sub">Envie o PDF da fatura ou cole o texto (Itaú, Bradesco, C6 — ou qualquer layout com data, descrição e valor por linha). Cada compra entra nos lançamentos no mês do gasto (configurável em Ajustes).</p>
      <div class="form-grid">
        <label class="field"><span>Cartão</span>
          <select id="ivAcc">${cards.map((a) => `<option value="${a.id}" ${stateIv.accId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Mês da fatura</span><input id="ivYM" type="month" value="${stateIv.refYM}"></label>
      </div>
      <div class="drop" id="ivDrop">📄 Toque para escolher o <b>PDF da fatura</b> ou arraste-o aqui</div>
      <input type="file" id="ivFile" accept="application/pdf" class="hidden">
      <label class="field" id="ivPassWrap"><span>Senha do PDF — preencha se a fatura for protegida (a senha é usada só no seu navegador, nada é enviado)</span>
        <input id="ivPass" type="password" autocomplete="off" placeholder="geralmente CPF ou data de nascimento, conforme o banco"></label>
      <label class="field"><span>…ou cole o texto da fatura</span>
        <textarea id="ivText" rows="5" placeholder="12/06  IFOOD *RESTAURANTE   45,90&#10;15/06  MERCADO ANGELONI 02/05   199,90&#10;…"></textarea></label>
      <div class="btn-row">
        <button class="btn" id="ivParse">Interpretar fatura</button>
        <span class="note" id="ivStatus"></span>
      </div>
    </div>
    <div id="ivPreview"></div>
    <div id="ivParecer"></div>`;
  main.appendChild(el);

  if (!cards.length) {
    el.querySelector('.card').innerHTML = '<h2>Importar fatura</h2><p class="empty">Cadastre um cartão em Ajustes → Contas e cartões primeiro.</p>';
    return;
  }
  stateIv.accId = el.querySelector('#ivAcc').value;

  const fileInput = el.querySelector('#ivFile');
  const drop = el.querySelector('#ivDrop');
  const status = el.querySelector('#ivStatus');
  drop.onclick = () => fileInput.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) await handlePdf(f, el, status);
  };
  fileInput.onchange = async () => { if (fileInput.files[0]) await handlePdf(fileInput.files[0], el, status); };
  // reprocessa o PDF quando a senha for informada (Enter ou blur)
  const pass = el.querySelector('#ivPass');
  const retryWithPass = async () => { if (lastPdfFile && pass.value) await handlePdf(lastPdfFile, el, status); };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') retryWithPass(); });
  pass.addEventListener('blur', retryWithPass);

  el.querySelector('#ivParse').onclick = () => {
    const text = el.querySelector('#ivText').value;
    if (!text.trim()) { status.textContent = 'Cole o texto ou envie o PDF.'; return; }
    runParse(text, el, status);
  };
  el.querySelector('#ivAcc').onchange = (e) => { stateIv.accId = e.target.value; };
  el.querySelector('#ivYM').onchange = (e) => { stateIv.refYM = e.target.value; };

  // se acabou de importar, mostra o parecer persistido
  if (stateIv.imported) renderParecer(el.querySelector('#ivParecer'), stateIv.imported, true);
}

let lastPdfFile = null;
async function handlePdf(file, el, status) {
  lastPdfFile = file;
  const password = el.querySelector('#ivPass').value.trim();
  try {
    status.textContent = 'Lendo PDF…';
    const buf = await file.arrayBuffer();
    const text = await extractPdfText(buf, password || undefined);
    el.querySelector('#ivText').value = text;
    runParse(text, el, status);
  } catch (err) {
    if (err.needsPassword) {
      el.querySelector('#ivPass').focus();
      status.textContent = err.wrongPassword
        ? '✗ Senha incorreta — tente novamente.'
        : '🔒 PDF protegido: digite a senha acima e pressione Enter.';
    } else {
      status.textContent = 'Falha ao ler o PDF: ' + err.message;
    }
  }
}

function runParse(text, el, status) {
  stateIv.refYM = el.querySelector('#ivYM').value || currentYM();
  stateIv.accId = el.querySelector('#ivAcc').value;
  const acc = store.byId('accounts', stateIv.accId);
  const { bank, items, ignored } = parseStatement(text, { bank: acc?.bank, refYM: stateIv.refYM });
  stateIv.bank = bank;
  stateIv.imported = null;
  if (!items.length) {
    status.textContent = 'Nenhum lançamento reconhecido. Confira se o texto tem “data descrição valor” por linha.';
    return;
  }
  status.textContent = `${items.length} lançamentos reconhecidos` + (bank ? ` · layout ${bankName(bank)}` : '') + (ignored.length ? ` · ${ignored.length} linhas ignoradas` : '');
  stateIv.items = items.map((it) => ({
    ...it,
    include: !it.isPayment,
    categoryId: it.credit ? null : (store.suggestCategory(it.desc) || 'cat-outros'),
    dup: store.findDuplicates({ ...it, accountId: stateIv.accId }).length > 0,
    suspect: !it.installment && (ymOf(it.date) > stateIv.refYM || ymDiff(stateIv.refYM, ymOf(it.date)) > 2)
  }));
  for (const it of stateIv.items) if (it.dup) it.include = false;
  renderPreview(el.querySelector('#ivPreview'), el);
  renderParecer(el.querySelector('#ivParecer'), buildAnalysis(stateIv.items.filter((i) => i.include), stateIv.accId, stateIv.refYM), false);
}

function renderPreview(container, root) {
  const cats = store.alive('categories').filter((c) => c.kind === 'despesa');
  const items = stateIv.items;
  container.innerHTML = `
    <div class="card">
      <h2>Conferência (${items.length} itens)</h2>
      <p class="sub">Desmarque o que não deve entrar. Ajuste categorias — o app aprende para as próximas faturas. Itens esmaecidos parecem duplicados de lançamentos já existentes.</p>
      <div class="preview-list" id="pvList"></div>
      <label class="field mt"><input type="checkbox" id="pvProject" checked style="width:auto;margin-right:6px">Projetar parcelas futuras como lançamentos (compras parceladas geram as próximas parcelas automaticamente)</label>
      <div class="btn-row">
        <button class="btn" id="pvImport">Importar selecionados</button>
        <span class="note" id="pvTotals"></span>
      </div>
    </div>`;
  const list = container.querySelector('#pvList');
  const totals = container.querySelector('#pvTotals');

  const refresh = () => {
    const inc = items.filter((i) => i.include && !i.credit);
    const cred = items.filter((i) => i.include && i.credit);
    totals.textContent = `Selecionados: ${fmtBRL(sum(inc, (i) => i.amount))} em compras` + (cred.length ? ` · ${fmtBRL(sum(cred, (i) => i.amount))} em créditos/pagamentos` : '');
    renderParecer(document.getElementById('ivParecer'), buildAnalysis(items.filter((i) => i.include), stateIv.accId, stateIv.refYM), false);
  };

  items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'pv-row' + (it.dup ? ' dup' : '');
    row.innerHTML = `
      <input type="checkbox" ${it.include ? 'checked' : ''}>
      <div class="pv-main">
        <div class="pv-line1">
          <span class="pv-date muted">${it.date.slice(8, 10)}/${it.date.slice(5, 7)}</span>
          <span class="pv-desc" title="${escapeHtml(it.desc)}">${escapeHtml(it.desc)}</span>
          <span class="pv-amt">${it.credit ? '−' : ''}${fmtBRL(it.amount)}</span>
        </div>
        <div class="pv-line2">
          ${it.installment ? `<span class="badge">parcela ${it.installment.n}/${it.installment.total}</span>` : ''}
          ${it.dup ? '<span class="warn">já existe?</span>' : ''}
          ${it.suspect ? '<span class="warn">⚠ data fora do período — conferir</span>' : ''}
          ${it.credit ? '<span class="badge gray">crédito</span>' : `<select>${cats.map((c) => `<option value="${c.id}" ${it.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>`}
        </div>
      </div>`;
    row.querySelector('input').onchange = (e) => { it.include = e.target.checked; refresh(); };
    const sel = row.querySelector('select');
    if (sel) sel.onchange = (e) => { it.categoryId = e.target.value; refresh(); };
    list.appendChild(row);
  });
  refresh();

  container.querySelector('#pvImport').onclick = () => {
    const project = container.querySelector('#pvProject').checked;
    const analysis = buildAnalysis(items.filter((i) => i.include), stateIv.accId, stateIv.refYM);
    let created = 0;
    for (const it of items) {
      if (!it.include) continue;
      const group = it.installment && it.installment.total > 1 ? uid('par') : null;
      // parcela: a cobrança pertence ao mês desta fatura; a data original fica nas observações
      const isParc = !!it.installment;
      const chargeDate = isParc ? clampDay(stateIv.refYM, Number(it.date.slice(8, 10))) : it.date;
      store.addTransaction({
        date: chargeDate, desc: it.desc, amount: it.amount,
        type: it.credit ? 'receita' : 'despesa',
        categoryId: it.credit ? 'cat-outras-receitas' : it.categoryId,
        accountId: stateIv.accId,
        faturaYM: stateIv.refYM,
        installment: it.installment ? { group, n: it.installment.n, total: it.installment.total } : null,
        notes: isParc && chargeDate !== it.date ? 'Compra original em ' + fmtDate(it.date) : '',
        source: 'fatura'
      });
      created++;
      if (!it.credit && it.categoryId) store.learnRule(it.desc, it.categoryId);
      // projeta parcelas restantes
      if (project && it.installment && it.installment.n < it.installment.total) {
        for (let k = it.installment.n + 1; k <= it.installment.total; k++) {
          const off = k - it.installment.n;
          const ym = addMonths(stateIv.refYM, off);
          store.addTransaction({
            date: clampDay(ym, Number(it.date.slice(8, 10))),
            desc: it.desc, amount: it.amount, type: 'despesa',
            categoryId: it.categoryId, accountId: stateIv.accId,
            faturaYM: ym,
            installment: { group, n: k, total: it.installment.total },
            notes: 'Compra original em ' + fmtDate(it.date),
            source: 'fatura-proj'
          });
          created++;
        }
      }
    }
    stateIv.imported = analysis;
    stateIv.items = [];
    window.appNavigate('fatura');
  };
}

function bankName(b) { return { itau: 'Itaú', bradesco: 'Bradesco', c6: 'C6' }[b] || b; }

// ---------- parecer ----------
function buildAnalysis(items, accId, refYM) {
  const compras = items.filter((i) => !i.credit);
  const creditos = items.filter((i) => i.credit);
  const total = sum(compras, (i) => i.amount) - sum(creditos, (i) => i.amount);
  const byCat = [...groupBy(compras, (i) => i.categoryId || 'cat-outros').entries()].map(([catId, list]) => {
    const cat = store.byId('categories', catId);
    return { catId, name: cat ? cat.name : 'Sem categoria', total: sum(list, (i) => i.amount), count: list.length };
  }).sort((a, b) => b.total - a.total);
  const top = compras.slice().sort((a, b) => b.amount - a.amount).slice(0, 10);
  const parceladas = compras.filter((i) => i.installment);
  const parcSum = sum(parceladas, (i) => i.amount);
  const novas = parceladas.filter((i) => i.installment.n === 1);
  const compromissoFuturo = sum(parceladas.filter((i) => i.installment.n < i.installment.total),
    (i) => i.amount * (i.installment.total - i.installment.n));
  // recorrências: mesmo estabelecimento em faturas anteriores deste cartão
  const past = store.txAlive().filter((t) => t.accountId === accId && t.faturaYM && t.faturaYM < refYM);
  const pastKeys = new Set(past.map((t) => normalizeDesc(t.desc).split(' ').slice(0, 2).join(' ')));
  const recorrentes = [], estreias = [];
  for (const [key, list] of groupBy(compras, (i) => normalizeDesc(i.desc).split(' ').slice(0, 2).join(' '))) {
    (pastKeys.has(key) ? recorrentes : estreias).push({ key, total: sum(list, (i) => i.amount), desc: list[0].desc });
  }
  const prevTotal = store.faturaTotal(accId, addMonths(refYM, -1));
  const dias = new Set(compras.map((i) => i.date)).size || 1;
  return {
    accId, refYM, total, count: compras.length, creditos: sum(creditos, (i) => i.amount),
    byCat, top, parcSum, parcCount: parceladas.length, novasParc: novas.length,
    compromissoFuturo, prevTotal, mediaDia: sum(compras, (i) => i.amount) / dias,
    ticketMedio: compras.length ? sum(compras, (i) => i.amount) / compras.length : 0,
    estreias: estreias.sort((a, b) => b.total - a.total).slice(0, 8),
    temHistorico: past.length > 0
  };
}

function renderParecer(container, a, imported) {
  if (!a || (!a.count && !imported)) { container.innerHTML = ''; return; }
  const acc = store.byId('accounts', a.accId);
  const deltaPrev = a.prevTotal > 0 ? (a.total - a.prevTotal) / a.prevTotal : null;
  container.innerHTML = `
    <div class="card">
      <h2>${imported ? '✅ Fatura importada — parecer' : 'Parecer da fatura (prévia)'}</h2>
      <p class="sub">${escapeHtml(acc ? acc.name : '')} · competência ${ymLabelFull(a.refYM)}</p>
      <div class="grid-tiles" id="pTiles"></div>
      <div class="row-2">
        <div><h2 style="font-size:14px">Onde o dinheiro foi</h2><div id="pCats"></div></div>
        <div><h2 style="font-size:14px">Maiores compras</h2><div id="pTop"></div></div>
      </div>
      <div id="pNotes" class="mt"></div>
    </div>`;
  const tiles = container.querySelector('#pTiles');
  statTile(tiles, { label: 'Total da fatura', value: fmtBRL(a.total), delta: deltaPrev != null ? { pct: deltaPrev, vs: 'vs fatura anterior' } : null, deltaGoodWhenUp: false });
  statTile(tiles, { label: 'Compras', value: String(a.count) });
  statTile(tiles, { label: 'Ticket médio', value: fmtBRL(a.ticketMedio) });
  statTile(tiles, { label: 'Média por dia de uso', value: fmtBRL(a.mediaDia) });

  hBarChart(container.querySelector('#pCats'), a.byCat, {
    tipFn: (r) => `<b>${escapeHtml(r.name)}</b><br>${fmtBRL(r.total)} · ${r.count} compra(s) · ${((r.total / (a.total || 1)) * 100).toFixed(0)}% da fatura`
  });
  const topEl = container.querySelector('#pTop');
  topEl.innerHTML = a.top.map((t) => `
    <div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--grid);font-size:13px">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.desc)}${t.installment ? ` <span class="badge">${t.installment.n}/${t.installment.total}</span>` : ''}</span>
      <b style="white-space:nowrap">${fmtBRL(t.amount)}</b></div>`).join('') || '<p class="empty">—</p>';

  const notes = [];
  const pctParc = a.total > 0 ? a.parcSum / a.total : 0;
  if (a.parcCount) notes.push(`<b>Parcelamentos:</b> ${a.parcCount} parcela(s) somando ${fmtBRL(a.parcSum)} (${(pctParc * 100).toFixed(0)}% da fatura)${a.novasParc ? `, sendo ${a.novasParc} compra(s) nova(s) parcelada(s)` : ''}.`);
  if (a.compromissoFuturo > 0) notes.push(`<b>Compromisso futuro já contratado:</b> ${fmtBRL(a.compromissoFuturo)} em parcelas que ainda vão vencer nas próximas faturas.`);
  if (pctParc > 0.4 && a.total > 0) notes.push(`⚠️ Mais de 40% desta fatura é parcelamento — atenção ao efeito bola de neve nas próximas competências.`);
  if (deltaPrev != null && Math.abs(deltaPrev) >= 0.15) {
    notes.push(`<b>Variação:</b> fatura ${deltaPrev > 0 ? 'subiu' : 'caiu'} ${(Math.abs(deltaPrev) * 100).toFixed(0)}% vs a anterior (${fmtBRL(a.prevTotal)}).`);
  }
  if (a.creditos > 0) notes.push(`<b>Créditos/estornos:</b> ${fmtBRL(a.creditos)} abatidos do total.`);
  if (a.temHistorico && a.estreias.length) {
    notes.push(`<b>Estabelecimentos novos nesta fatura:</b> ${a.estreias.map((e) => escapeHtml(e.desc) + ' (' + fmtBRLCompact(e.total) + ')').join(', ')}.`);
  }
  if (a.byCat[0] && a.total > 0) {
    notes.push(`<b>Maior categoria:</b> ${escapeHtml(a.byCat[0].name)} concentra ${((a.byCat[0].total / a.total) * 100).toFixed(0)}% da fatura.`);
  }
  container.querySelector('#pNotes').innerHTML = notes.map((n) => `<p style="font-size:13.5px;margin:6px 0">${n}</p>`).join('');
}
