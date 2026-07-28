// store.js — estado central, persistência local e agregações
import { uid, nowISO, ymOf, addMonths, clampDay, sum, groupBy, normalizeDesc } from './util.js';

const LS_DATA = 'fluxo.data.v1';
const LS_CFG = 'fluxo.cfg.v1';

export const DEFAULT_DATA = {
  schema: 1,
  updatedAt: null,
  accounts: [],
  categories: [],
  transactions: [],
  investments: [],
  investmentEntries: [],
  rules: [],
  settings: {}
};

const listeners = new Set();
let state = null;
let cfg = null;

// ---------- ciclo de vida ----------
export function load() {
  try { state = JSON.parse(localStorage.getItem(LS_DATA)) || null; } catch { state = null; }
  if (!state || !Array.isArray(state.transactions)) state = structuredClone(DEFAULT_DATA);
  try { cfg = JSON.parse(localStorage.getItem(LS_CFG)) || {}; } catch { cfg = {}; }
  return state;
}
export function getState() { return state; }
export function getCfg() { return cfg; }
export function saveCfg(patch) {
  cfg = { ...cfg, ...patch };
  localStorage.setItem(LS_CFG, JSON.stringify(cfg));
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function persist() {
  state.updatedAt = nowISO();
  localStorage.setItem(LS_DATA, JSON.stringify(state));
  for (const fn of listeners) fn(state);
}
export function replaceState(next) { state = next; persist(); }
export function markClean() { localStorage.setItem(LS_DATA, JSON.stringify(state)); }

export function isEmpty() {
  return !state.accounts.length && !state.categories.length && !state.transactions.length;
}
export async function seedFromSample() {
  const res = await fetch('./data/data.sample.json');
  const sample = await res.json();
  state = sample;
  persist();
}

// ---------- CRUD genérico ----------
function coll(name) {
  if (!state[name]) state[name] = [];
  return state[name];
}
export function upsert(collName, item) {
  const c = coll(collName);
  const i = c.findIndex((x) => x.id === item.id);
  item.updatedAt = nowISO();
  if (i >= 0) c[i] = { ...c[i], ...item };
  else c.push({ ...item, id: item.id || uid(collName.slice(0, 3)) });
  persist();
  return item;
}
export function remove(collName, id) {
  const c = coll(collName);
  const i = c.findIndex((x) => x.id === id);
  if (i >= 0) {
    // tombstone: mantém para merge entre dispositivos
    c[i] = { id: c[i].id, deleted: true, updatedAt: nowISO() };
    persist();
  }
}
export function byId(collName, id) { return coll(collName).find((x) => x.id === id); }
export function alive(collName) { return coll(collName).filter((x) => !x.deleted && !x.archived); }
export function aliveAll(collName) { return coll(collName).filter((x) => !x.deleted); }

// ---------- transações ----------
// tx: {id, date:'YYYY-MM-DD', desc, amount>0, type:'despesa'|'receita', categoryId, accountId,
//      installment:{group,n,total}|null, faturaYM (cartão), source:'manual'|'fatura', notes, updatedAt}
export function addTransaction(tx) {
  tx.id = tx.id || uid('tx');
  tx.amount = Math.round(Math.abs(Number(tx.amount)) * 100) / 100;
  if (!tx.faturaYM) {
    const acc = byId('accounts', tx.accountId);
    tx.faturaYM = acc && acc.type === 'cartao' ? faturaYMFor(acc, tx.date) : null;
  }
  return upsert('transactions', tx);
}

// mês de competência: para cartão = mês da fatura; senão, mês da data
export function competenceYM(tx) { return tx.faturaYM || ymOf(tx.date); }

// fatura em que uma compra cai, considerando dia de fechamento
export function faturaYMFor(account, dateStr) {
  const ym = ymOf(dateStr);
  const day = Number(dateStr.slice(8, 10));
  const closing = Number(account.closingDay) || 31;
  return day > closing ? addMonths(ym, 1) : ym;
}

// cria N parcelas; total = valor total da compra
export function addInstallmentPurchase({ date, desc, total, n, categoryId, accountId, notes, source }) {
  const group = uid('par');
  const per = Math.floor((total / n) * 100) / 100;
  const firstAdj = Math.round((total - per * n) * 100) / 100; // resto na 1ª parcela
  const acc = byId('accounts', accountId);
  const baseYM = acc && acc.type === 'cartao' ? faturaYMFor(acc, date) : ymOf(date);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ym = addMonths(baseYM, i);
    out.push(addTransaction({
      date: i === 0 ? date : clampDay(ym, Number(date.slice(8, 10))),
      desc, notes: notes || '',
      amount: i === 0 ? per + firstAdj : per,
      type: 'despesa', categoryId, accountId,
      installment: { group, n: i + 1, total: n },
      faturaYM: acc && acc.type === 'cartao' ? ym : null,
      source: source || 'manual'
    }));
  }
  return out;
}
export function removeInstallmentGroup(group) {
  for (const t of aliveAll('transactions').filter((t) => t.installment && t.installment.group === group)) {
    remove('transactions', t.id);
  }
}

export function txAlive() { return coll('transactions').filter((t) => !t.deleted); }

// possíveis duplicatas (import de fatura): mesma conta, mesmo valor, data ±3 dias
export function findDuplicates(candidate) {
  const cd = new Date(candidate.date + 'T00:00:00');
  return txAlive().filter((t) => {
    if (t.accountId !== candidate.accountId) return false;
    if (Math.abs(t.amount - Math.abs(candidate.amount)) > 0.005) return false;
    const td = new Date(t.date + 'T00:00:00');
    return Math.abs(td - cd) <= 3 * 86400e3;
  });
}

// ---------- agregações ----------
export function monthTx(ym) { return txAlive().filter((t) => competenceYM(t) === ym); }

export function monthSummary(ym) {
  const txs = monthTx(ym);
  const receitas = sum(txs.filter((t) => t.type === 'receita'), (t) => t.amount);
  const despesas = sum(txs.filter((t) => t.type === 'despesa'), (t) => t.amount);
  return { receitas, despesas, saldo: receitas - despesas, count: txs.length };
}

export function byCategory(ym, type = 'despesa') {
  const txs = monthTx(ym).filter((t) => t.type === type);
  const g = groupBy(txs, (t) => t.categoryId || 'cat-outros');
  const rows = [];
  for (const [catId, list] of g) {
    const cat = byId('categories', catId);
    rows.push({ catId, name: cat ? cat.name : 'Sem categoria', total: sum(list, (t) => t.amount), count: list.length, budget: cat ? cat.budget || 0 : 0 });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

export function seriesMonthly(fromYM, months) {
  const out = [];
  let ym = fromYM;
  for (let i = 0; i < months; i++) {
    out.push({ ym, ...monthSummary(ym) });
    ym = addMonths(ym, 1);
  }
  return out;
}

export function faturaTx(accountId, ym) {
  return txAlive().filter((t) => t.accountId === accountId && t.faturaYM === ym);
}
export function faturaTotal(accountId, ym) {
  const txs = faturaTx(accountId, ym);
  return sum(txs.filter((t) => t.type === 'despesa'), (t) => t.amount) - sum(txs.filter((t) => t.type === 'receita'), (t) => t.amount);
}

// parcelas futuras já contratadas (compromissos)
export function futureInstallments(fromYM) {
  const rows = txAlive().filter((t) => t.installment && competenceYM(t) > fromYM && t.type === 'despesa');
  const g = groupBy(rows, (t) => competenceYM(t));
  const out = [...g.entries()].map(([ym, list]) => ({ ym, total: sum(list, (t) => t.amount), count: list.length }));
  out.sort((a, b) => a.ym.localeCompare(b.ym));
  return out;
}

// ---------- investimentos ----------
// investment: {id, name, class:'cdi'|'fii'|'acoes'|'usd'|'previdencia'|'outro', institution}
// entry: {id, investmentId, ym, aportes, resgates, saldoFinal, updatedAt}
// rendimento do mês = saldoFinal - saldoAnterior - aportes + resgates
export function invEntries(investmentId) {
  return aliveAll('investmentEntries').filter((e) => !e.deleted && e.investmentId === investmentId)
    .sort((a, b) => a.ym.localeCompare(b.ym));
}
export function invSeries(investmentId) {
  const es = invEntries(investmentId);
  let prev = null;
  return es.map((e) => {
    const rendimento = prev == null ? null : Math.round((e.saldoFinal - prev - (e.aportes || 0) + (e.resgates || 0)) * 100) / 100;
    const rentab = prev != null && prev + (e.aportes || 0) > 0 ? rendimento / (prev + (e.aportes || 0)) : null;
    const row = { ...e, rendimento, rentab };
    prev = e.saldoFinal;
    return row;
  });
}
export function portfolioByMonth() {
  const all = aliveAll('investmentEntries').filter((e) => !e.deleted);
  const g = groupBy(all, (e) => e.ym);
  const months = [...g.keys()].sort();
  return months.map((ym) => {
    // saldo total do mês: para cada investimento, último saldo conhecido <= ym
    let total = 0, aportes = 0, resgates = 0;
    for (const inv of alive('investments')) {
      const es = invEntries(inv.id).filter((e) => e.ym <= ym);
      if (es.length) total += es[es.length - 1].saldoFinal;
      const cur = es.find((e) => e.ym === ym);
      if (cur) { aportes += cur.aportes || 0; resgates += cur.resgates || 0; }
    }
    return { ym, total, aportes, resgates };
  });
}
export function portfolioSummary() {
  const rows = [];
  for (const inv of alive('investments')) {
    const series = invSeries(inv.id);
    const last = series[series.length - 1];
    rows.push({
      inv, saldo: last ? last.saldoFinal : 0, lastYM: last ? last.ym : null,
      rendimentoUlt: last ? last.rendimento : null, rentabUlt: last ? last.rentab : null,
      rendimento12m: sum(series.slice(-12).filter((s) => s.rendimento != null), (s) => s.rendimento)
    });
  }
  rows.sort((a, b) => b.saldo - a.saldo);
  return rows;
}

// ---------- regras de categorização ----------
export function learnRule(desc, categoryId) {
  const key = normalizeDesc(desc).split(' ').slice(0, 3).join(' ');
  if (!key || !categoryId) return;
  const rules = coll('rules');
  const i = rules.findIndex((r) => r.key === key);
  if (i >= 0) rules[i] = { ...rules[i], categoryId, updatedAt: nowISO() };
  else rules.push({ id: uid('rl'), key, categoryId, updatedAt: nowISO() });
  persist();
}
export function suggestCategory(desc) {
  const nd = normalizeDesc(desc);
  // regra aprendida
  for (const r of coll('rules')) {
    if (!r.deleted && r.key && nd.includes(r.key)) return r.categoryId;
  }
  return builtinCategory(nd);
}

const BUILTIN = [
  [/(ifood|ifd|rappi|restaurante|rest\b|lanchonete|pizzaria|hamburg|burger|padaria|cafe|cafeteria|churrascaria|sushi|bar\b|boteco|acai)/, 'cat-alimentacao'],
  [/(supermerc|mercado|atacad|angeloni|giassi|fort\b|bistek|carrefour|big\b|aldo|hortifruti|sacolao|acougue)/, 'cat-mercado'],
  [/(posto|combustivel|ipiranga|shell|petrobras|br\b.*posto|uber|99app|99\*|taxi|estacionamento|pedagio|sem parar|veloe|conectcar|auto\s?pec|pneu|lavacao)/, 'cat-transporte'],
  [/(aluguel|condominio|celesc|energia|agua|casan|samae|internet|vivo fibra|claro res|unifique|gas\b|reforma|marceneiro|eletricista|leroy|cassol|havan casa)/, 'cat-moradia'],
  [/(farmacia|drogaria|panvel|catarinense pharma|raia|pague menos|unimed|clinica|laborat|dentista|odonto|hospital|medic|psicolog|fisioterap)/, 'cat-saude'],
  [/(netflix|spotify|prime|amazon prime|disney|hbo|max\b|globoplay|youtube|icloud|apple\.com|google one|chatgpt|openai|claude|anthropic|dropbox|office|microsoft 365|kindle)/, 'cat-assinaturas'],
  [/(cinema|cinepolis|ingresso|show|teatro|steam|playstation|xbox|nintendo|clube|viagem local|passeio)/, 'cat-lazer'],
  [/(latam|gol\b|azul\b|aereo|airbnb|booking|hotel|hospedagem|decolar|123milhas|maxmilhas|rent a car|localiza|movida|unidas)/, 'cat-viagem'],
  [/(escola|colegio|faculdade|univer|curso|udemy|alura|livraria|livro|papelaria)/, 'cat-educacao'],
  [/(renner|riachuelo|zara|hering|centauro|nike|adidas|decathlon|shein|malwee|marisa|c&a|vestuario|calcad)/, 'cat-vestuario'],
  [/(petshop|pet\b|veterinar|cobasi|petz|racao)/, 'cat-pets'],
  [/(iptu|ipva|darf|das\b|inss|taxa|cartorio|anuidade|juros|iof|multa|tarifa|seguro)/, 'cat-impostos']
];
export function builtinCategory(nd) {
  for (const [re, cat] of BUILTIN) if (re.test(nd)) return cat;
  return null;
}
