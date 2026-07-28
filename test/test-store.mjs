// test/test-store.mjs — lógica de parcelas, fatura e merge de sync
// Rodar: node test/test-store.mjs
const mem = {};
globalThis.localStorage = {
  getItem: (k) => mem[k] ?? null,
  setItem: (k, v) => { mem[k] = v; },
  removeItem: (k) => { delete mem[k]; }
};

const store = await import('../js/store.js');
const { mergeData } = await import('../js/github.js').catch(() => ({}));

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; console.error(`✗ ${label}\n  esperado: ${JSON.stringify(expected)}\n  obtido:   ${JSON.stringify(actual)}`); }
}
function ok(cond, label) { cond ? pass++ : (fail++, console.error('✗ ' + label)); }

store.load();
store.upsert('accounts', { id: 'card1', name: 'Cartão', type: 'cartao', closingDay: 28 });
store.upsert('categories', { id: 'cat1', name: 'Teste', kind: 'despesa' });

// fatura: compra antes do fechamento cai no mês, depois cai no seguinte
eq(store.faturaYMFor({ closingDay: 28 }, '2026-06-27'), '2026-06', 'compra dia 27, fecha 28 → junho');
eq(store.faturaYMFor({ closingDay: 28 }, '2026-06-29'), '2026-07', 'compra dia 29, fecha 28 → julho');
eq(store.faturaYMFor({ closingDay: 28 }, '2026-12-30'), '2027-01', 'virada de ano');

// parcelado: 3x de R$ 100,01 → soma exata, resto na 1ª
const parcels = store.addInstallmentPurchase({ date: '2026-06-10', desc: 'TV', total: 300.01, n: 3, categoryId: 'cat1', accountId: 'card1' });
eq(parcels.length, 3, 'gera 3 parcelas');
const soma = Math.round(parcels.reduce((a, p) => a + p.amount, 0) * 100) / 100;
eq(soma, 300.01, 'soma das parcelas = total');
eq(parcels.map((p) => p.faturaYM), ['2026-06', '2026-07', '2026-08'], 'parcelas em faturas consecutivas');
eq(parcels[0].installment.total, 3, 'installment.total');

// duplicatas
const dups = store.findDuplicates({ date: '2026-06-11', amount: parcels[0].amount, accountId: 'card1' });
ok(dups.length >= 1, 'detecta duplicata por valor/conta/data próxima');

// resumo mensal por competência
const s = store.monthSummary('2026-07');
eq(Math.round(s.despesas * 100) / 100, parcels[1].amount, 'competência julho = 2ª parcela');

// tombstone
store.remove('transactions', parcels[2].id);
ok(store.txAlive().every((t) => t.id !== parcels[2].id), 'remove vira tombstone');

// merge: mais novo vence, união por id, tombstone preservado
if (mergeData) {
  const local = { transactions: [{ id: 'a', desc: 'local', updatedAt: '2026-01-02' }, { id: 'b', desc: 'só local', updatedAt: '2026-01-01' }], settings: { x: 1 } };
  const remote = { transactions: [{ id: 'a', desc: 'remoto', updatedAt: '2026-01-01' }, { id: 'c', deleted: true, updatedAt: '2026-01-03' }], settings: { y: 2 } };
  const m = mergeData(local, remote);
  eq(m.transactions.find((t) => t.id === 'a').desc, 'local', 'merge: updatedAt mais novo vence');
  eq(m.transactions.length, 3, 'merge: união por id');
  ok(m.transactions.find((t) => t.id === 'c').deleted, 'merge: tombstone preservado');
  eq(m.settings, { y: 2, x: 1 }, 'merge: settings mesclados');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
