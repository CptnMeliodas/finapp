// views/settings.js — sync GitHub, contas/cartões, categorias/orçamento, backup
import * as store from '../store.js';
import { syncNow, testConnection, syncConfigured } from '../github.js';
import { fmtBRL, escapeHtml, uid, downloadFile, nowISO } from '../util.js';

export function renderSettings(main) {
  const cfg = store.getCfg();
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="card">
      <h2>Sincronização com o GitHub</h2>
      <p class="sub">Os dados são gravados como <span class="mono">data/data.json</span> no seu repositório privado — cada alteração vira um commit (histórico completo e backup automático).</p>
      <div class="form-grid">
        <label class="field"><span>Usuário/organização (owner)</span><input id="gOwner" value="${escapeHtml(cfg.ghOwner || '')}" placeholder="seu-usuario"></label>
        <label class="field"><span>Repositório</span><input id="gRepo" value="${escapeHtml(cfg.ghRepo || '')}" placeholder="financas"></label>
        <label class="field"><span>Branch</span><input id="gBranch" value="${escapeHtml(cfg.ghBranch || 'main')}"></label>
        <label class="field"><span>Caminho do arquivo</span><input id="gPath" value="${escapeHtml(cfg.ghPath || 'data/data.json')}"></label>
        <label class="field full"><span>Token (fine-grained, permissão Contents read/write só neste repo)</span><input id="gToken" type="password" value="${escapeHtml(cfg.ghToken || '')}" placeholder="github_pat_…"></label>
      </div>
      <div class="btn-row">
        <button class="btn" id="gSave">Salvar e testar</button>
        <button class="btn secondary" id="gSync" ${syncConfigured() ? '' : 'disabled'}>Sincronizar agora</button>
        <span class="note" id="gStatus">${cfg.ghLastSync ? 'Último sync: ' + new Date(cfg.ghLastSync).toLocaleString('pt-BR') : 'Nunca sincronizado'}</span>
      </div>
      <p class="note mt">O token fica salvo apenas neste dispositivo (localStorage). Configure o mesmo repo no celular e no computador.</p>
    </div>

    <div class="card">
      <h2>Contas e cartões</h2>
      <div id="accList"></div>
      <div class="btn-row"><button class="btn small" id="accAdd">+ Adicionar</button></div>
    </div>

    <div class="card">
      <h2>Categorias e orçamento mensal</h2>
      <p class="sub">Defina um orçamento por categoria para acompanhar no painel.</p>
      <div id="catList"></div>
      <div class="btn-row"><button class="btn small" id="catAdd">+ Adicionar categoria</button></div>
    </div>

    <div class="card">
      <h2>Backup local</h2>
      <div class="btn-row">
        <button class="btn secondary" id="bkExport">Exportar dados (JSON)</button>
        <button class="btn secondary" id="bkImport">Importar backup</button>
        <input type="file" id="bkFile" accept="application/json" class="hidden">
      </div>
      <p class="note mt">Além do GitHub, você pode baixar/restaurar um snapshot manual a qualquer momento.</p>
    </div>`;
  main.appendChild(el);
  const q = (s) => el.querySelector(s);

  // ---- github ----
  q('#gSave').onclick = async () => {
    store.saveCfg({
      ghOwner: q('#gOwner').value.trim(),
      ghRepo: q('#gRepo').value.trim(),
      ghBranch: q('#gBranch').value.trim() || 'main',
      ghPath: q('#gPath').value.trim() || 'data/data.json',
      ghToken: q('#gToken').value.trim(),
      ghLastSha: null
    });
    q('#gStatus').textContent = 'Testando…';
    try {
      const r = await testConnection();
      q('#gStatus').textContent = `✓ Conectado a ${r.fullName}` + (r.private ? ' (privado)' : ' — ATENÇÃO: repo público!');
      q('#gSync').disabled = false;
    } catch (e) {
      q('#gStatus').textContent = '✗ ' + e.message;
    }
  };
  q('#gSync').onclick = async () => {
    q('#gStatus').textContent = 'Sincronizando…';
    const r = await syncNow();
    q('#gStatus').textContent = r.error ? '✗ ' + r.error : '✓ Sincronizado ' + new Date().toLocaleTimeString('pt-BR');
  };

  // ---- contas ----
  const drawAccs = () => {
    const list = q('#accList');
    list.innerHTML = '';
    for (const a of store.alive('accounts')) {
      const row = document.createElement('div');
      row.className = 'tx';
      row.innerHTML = `
        <div class="tx-ico">${a.type === 'cartao' ? '💳' : '🏦'}</div>
        <div class="tx-body">
          <div class="tx-desc">${escapeHtml(a.name)}</div>
          <div class="tx-meta">${a.type === 'cartao' ? `Cartão · fecha dia ${a.closingDay || '—'} · vence dia ${a.dueDay || '—'}` : 'Conta'}</div>
        </div><span class="muted">editar ›</span>`;
      row.onclick = () => openAccModal(a, drawAccs);
      list.appendChild(row);
    }
  };
  drawAccs();
  q('#accAdd').onclick = () => openAccModal(null, drawAccs);

  // ---- categorias ----
  const drawCats = () => {
    const list = q('#catList');
    list.innerHTML = '';
    for (const kind of ['despesa', 'receita']) {
      const h = document.createElement('div');
      h.className = 'tx-day';
      h.textContent = kind === 'despesa' ? 'Despesas' : 'Receitas';
      list.appendChild(h);
      for (const c of store.alive('categories').filter((c) => c.kind === kind)) {
        const row = document.createElement('div');
        row.className = 'tx';
        row.innerHTML = `
          <div class="tx-body"><div class="tx-desc">${escapeHtml(c.name)}</div></div>
          ${kind === 'despesa' ? `<span class="muted" style="font-size:12.5px">${c.budget ? 'orçamento ' + fmtBRL(c.budget) : 'sem orçamento'}</span>` : ''}`;
        row.onclick = () => openCatModal(c, drawCats);
        list.appendChild(row);
      }
    }
  };
  drawCats();
  q('#catAdd').onclick = () => openCatModal(null, drawCats);

  // ---- backup ----
  q('#bkExport').onclick = () => {
    downloadFile('finapp-backup-' + nowISO().slice(0, 10) + '.json', JSON.stringify(store.getState(), null, 1), 'application/json');
  };
  q('#bkImport').onclick = () => q('#bkFile').click();
  q('#bkFile').onchange = async () => {
    const f = q('#bkFile').files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.transactions)) throw new Error('arquivo inválido');
      if (confirm('Substituir os dados locais pelo backup? (o sync fará merge com o GitHub)')) {
        store.replaceState(data);
        window.appNavigate('dashboard');
      }
    } catch (e) { alert('Backup inválido: ' + e.message); }
  };
}

function openAccModal(acc, done) {
  const isEdit = !!acc;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
  <div class="modal">
    <h3>${isEdit ? 'Editar conta' : 'Nova conta / cartão'}<button class="close-x">✕</button></h3>
    <div class="form-grid">
      <label class="field full"><span>Nome</span><input id="aName" value="${escapeHtml(acc?.name || '')}" placeholder="Ex.: Cartão C6, Conta Itaú"></label>
      <label class="field"><span>Tipo</span>
        <select id="aType"><option value="conta" ${acc?.type === 'conta' ? 'selected' : ''}>Conta</option><option value="cartao" ${acc?.type === 'cartao' ? 'selected' : ''}>Cartão de crédito</option></select></label>
      <label class="field"><span>Banco (para o parser da fatura)</span>
        <select id="aBank">
          <option value="">—</option>
          <option value="itau" ${acc?.bank === 'itau' ? 'selected' : ''}>Itaú</option>
          <option value="bradesco" ${acc?.bank === 'bradesco' ? 'selected' : ''}>Bradesco</option>
          <option value="c6" ${acc?.bank === 'c6' ? 'selected' : ''}>C6</option>
          <option value="outro" ${acc?.bank === 'outro' ? 'selected' : ''}>Outro</option>
        </select></label>
      <label class="field"><span>Dia de fechamento (cartão)</span><input id="aClose" type="number" min="1" max="31" value="${acc?.closingDay || ''}"></label>
      <label class="field"><span>Dia de vencimento (cartão)</span><input id="aDue" type="number" min="1" max="31" value="${acc?.dueDay || ''}"></label>
    </div>
    <div class="btn-row">
      <button class="btn" id="aSave">Salvar</button>
      ${isEdit ? '<button class="btn danger" id="aDel">Arquivar</button>' : ''}
    </div>
  </div>`;
  document.body.appendChild(back);
  const q = (s) => back.querySelector(s);
  const close = () => back.remove();
  q('.close-x').onclick = close;
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  q('#aSave').onclick = () => {
    store.upsert('accounts', {
      id: acc?.id || uid('acc'),
      name: q('#aName').value.trim() || 'Conta',
      type: q('#aType').value,
      bank: q('#aBank').value,
      closingDay: Number(q('#aClose').value) || null,
      dueDay: Number(q('#aDue').value) || null,
      archived: false
    });
    close(); done();
  };
  if (isEdit) q('#aDel').onclick = () => { store.upsert('accounts', { ...acc, archived: true }); close(); done(); };
}

function openCatModal(cat, done) {
  const isEdit = !!cat;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
  <div class="modal">
    <h3>${isEdit ? 'Editar categoria' : 'Nova categoria'}<button class="close-x">✕</button></h3>
    <div class="form-grid">
      <label class="field full"><span>Nome</span><input id="cName" value="${escapeHtml(cat?.name || '')}"></label>
      <label class="field"><span>Tipo</span>
        <select id="cKind" ${isEdit ? 'disabled' : ''}><option value="despesa" ${cat?.kind === 'despesa' ? 'selected' : ''}>Despesa</option><option value="receita" ${cat?.kind === 'receita' ? 'selected' : ''}>Receita</option></select></label>
      <label class="field"><span>Orçamento mensal (R$, 0 = sem)</span><input id="cBudget" inputmode="decimal" value="${cat?.budget || ''}"></label>
    </div>
    <div class="btn-row">
      <button class="btn" id="cSave">Salvar</button>
      ${isEdit ? '<button class="btn danger" id="cDel">Arquivar</button>' : ''}
    </div>
  </div>`;
  document.body.appendChild(back);
  const q = (s) => back.querySelector(s);
  const close = () => back.remove();
  q('.close-x').onclick = close;
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  q('#cSave').onclick = () => {
    const budget = parseFloat(String(q('#cBudget').value || '0').replace(/\./g, '').replace(',', '.')) || 0;
    store.upsert('categories', {
      id: cat?.id || uid('cat'),
      name: q('#cName').value.trim() || 'Categoria',
      kind: isEdit ? cat.kind : q('#cKind').value,
      budget,
      archived: false
    });
    close(); done();
  };
  if (isEdit) q('#cDel').onclick = () => { store.upsert('categories', { ...cat, archived: true }); close(); done(); };
}
