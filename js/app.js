// app.js — bootstrap, navegação e sync
export const APP_VERSION = 'v6';
window.APP_VERSION = 'v6';
import * as store from './store.js';
import { syncNow, syncConfigured } from './github.js';
import { debounce } from './util.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTransactions, openTxModal } from './views/transactions.js';
import { renderInvoice } from './views/invoice.js';
import { renderInvestments } from './views/investments.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M3 12l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
  lancamentos: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  fatura: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
  investimentos: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M4 19L10 12l4 4 6-8"/><path d="M15 8h5v5"/></svg>',
  relatorios: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M6 20V10M12 20V4M18 20v-7"/></svg>',
  config: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1M19.1 4.9l-2.1 2.1m-10 10l-2.1 2.1"/></svg>'
};

const VIEWS = {
  dashboard: { label: 'Início', render: renderDashboard },
  lancamentos: { label: 'Lançamentos', render: renderTransactions },
  fatura: { label: 'Fatura', render: renderInvoice },
  investimentos: { label: 'Investir', render: renderInvestments },
  relatorios: { label: 'Relatórios', render: renderReports },
  config: { label: 'Ajustes', render: renderSettings }
};

let current = 'dashboard';
const main = document.getElementById('view');

export function navigate(view, opts) {
  current = VIEWS[view] ? view : 'dashboard';
  location.hash = current;
  for (const b of document.querySelectorAll('nav.tabs button')) {
    b.classList.toggle('active', b.dataset.view === current);
  }
  main.innerHTML = '';
  VIEWS[current].render(main, opts || {});
  window.scrollTo(0, 0);
}
window.appNavigate = navigate;

function buildTabs() {
  const nav = document.getElementById('tabs');
  nav.innerHTML = Object.entries(VIEWS).map(([key, v]) =>
    `<button data-view="${key}">${ICONS[key]}<span>${v.label}</span></button>`).join('');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) navigate(b.dataset.view);
  });
}

// ---------- sync ----------
const badge = document.getElementById('syncBadge');
const syncLabel = document.getElementById('syncLabel');
function setSyncState(state, msg) {
  badge.className = 'sync-badge ' + state;
  syncLabel.textContent = state === 'sync' ? 'sincronizando…'
    : state === 'ok' ? 'sincronizado'
    : state === 'error' ? 'erro de sync'
    : 'somente local';
  if (msg) badge.title = msg;
}
export const scheduleSync = debounce(() => {
  if (syncConfigured() && navigator.onLine) syncNow(setSyncState).then(() => rerender());
}, 2500);

function rerender() {
  // re-renderiza a view atual preservando o scroll
  const y = window.scrollY;
  main.innerHTML = '';
  VIEWS[current].render(main, {});
  window.scrollTo(0, y);
}

badge.addEventListener('click', async () => {
  if (!syncConfigured()) { navigate('config'); return; }
  await syncNow(setSyncState);
  rerender();
});

// ---------- tema ----------
document.getElementById('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
  if (next) document.documentElement.dataset.theme = next;
  else delete document.documentElement.dataset.theme;
  store.saveCfg({ theme: next });
});

// ---------- init ----------
async function init() {
  store.load();
  const cfg = store.getCfg();
  if (cfg.theme) document.documentElement.dataset.theme = cfg.theme;
  buildTabs();
  if (store.isEmpty()) {
    try { await store.seedFromSample(); } catch { /* offline sem seed */ }
  }
  const hash = location.hash.replace('#', '');
  navigate(VIEWS[hash] ? hash : 'dashboard');

  document.getElementById('fab').addEventListener('click', () => openTxModal());

  // sync inicial + ao voltar para o app
  if (syncConfigured()) {
    setSyncState('sync');
    syncNow(setSyncState).then(() => rerender());
  } else setSyncState('idle');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync();
  });
  // qualquer alteração de dados agenda um push
  store.subscribe(() => scheduleSync());
}
init();
