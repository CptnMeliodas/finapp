// test/test-parsers.mjs — testes dos parsers e da lógica de datas/valores
// Rodar: node test/test-parsers.mjs
import { parseStatement, resolveYear } from '../js/parsers.js';
import { parseBRNumber, addMonths, clampDay } from '../js/util.js';

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; console.error(`✗ ${label}\n  esperado: ${JSON.stringify(expected)}\n  obtido:   ${JSON.stringify(actual)}`); }
}
function ok(cond, label) { cond ? pass++ : (fail++, console.error('✗ ' + label)); }

// ---- números BR ----
eq(parseBRNumber('1.234,56'), 1234.56, 'valor com milhar');
eq(parseBRNumber('R$ 45,90'), 45.9, 'valor com R$');
eq(parseBRNumber('-123,45'), -123.45, 'negativo');
eq(parseBRNumber('234,56'), 234.56, 'simples');

// ---- datas ----
eq(addMonths('2026-01', -1), '2025-12', 'addMonths retrocede ano');
eq(addMonths('2026-11', 3), '2027-02', 'addMonths avança ano');
eq(clampDay('2026-02', 31), '2026-02-28', 'clampDay fevereiro');
eq(resolveYear(28, 12, '2026-01'), '2025-12-28', 'compra de dezembro em fatura de janeiro');
eq(resolveYear(5, 1, '2026-01'), '2026-01-05', 'compra do mesmo mês');

// ---- fatura estilo Itaú ----
const itau = `
ITAÚ UNICLASS - fatura
12/06 IFOOD *IFOOD RESTAURANTE 45,90
15/06 ANGELONI SUPERMERCADO 02/05 199,90
18/06 POSTO IPIRANGA 250,00
20/06 PAGAMENTO EFETUADO -1.500,00
Total da fatura 2.345,67
Limite disponivel 10.000,00
`;
const r1 = parseStatement(itau, { refYM: '2026-06' });
eq(r1.bank, 'itau', 'detecta Itaú');
eq(r1.items.length, 4, 'Itaú: 4 lançamentos (ignora total/limite)');
eq(r1.items[0], { date: '2026-06-12', desc: 'IFOOD *IFOOD RESTAURANTE', amount: 45.9, credit: false, installment: null, isPayment: false }, 'Itaú: compra simples');
eq(r1.items[1].installment, { n: 2, total: 5 }, 'Itaú: detecta parcela 02/05');
ok(r1.items[3].credit === true && r1.items[3].isPayment === true, 'Itaú: pagamento como crédito');

// ---- fatura estilo Bradesco (com valor em dólar residual) ----
const bradesco = `
Bradesco Cartões
10/06 NETFLIX.COM 55,90
11/06 AMAZON MKTPLACE PARC 01/03 300,00
14/06 EBAY US 25,00 132,45
SALDO ANTERIOR 1.234,00
`;
const r2 = parseStatement(bradesco, { refYM: '2026-06' });
eq(r2.bank, 'bradesco', 'detecta Bradesco');
eq(r2.items.length, 3, 'Bradesco: 3 lançamentos');
eq(r2.items[1].installment, { n: 1, total: 3 }, 'Bradesco: PARC 01/03');
eq(r2.items[2].amount, 132.45, 'Bradesco: pega valor em R$ (último da linha)');

// ---- fatura estilo C6 (data com mês abreviado) ----
const c6 = `
C6 Bank fatura de junho
12 jun Uber *Trip 24,90
15 Jun MERCADOLIVRE Parcela 3/10 89,90
20 jun Estorno compra -50,00
`;
const r3 = parseStatement(c6, { refYM: '2026-06' });
eq(r3.bank, 'c6', 'detecta C6');
eq(r3.items.length, 3, 'C6: 3 lançamentos');
eq(r3.items[0].date, '2026-06-12', 'C6: data dd mmm');
eq(r3.items[1].installment, { n: 3, total: 10 }, 'C6: Parcela 3/10');
ok(r3.items[2].credit, 'C6: estorno como crédito');

// ---- virada de ano ----
const virada = `01/12 COMPRA DEZEMBRO 100,00\n05/01 COMPRA JANEIRO 200,00`;
const r4 = parseStatement(virada, { refYM: '2026-01' });
eq(r4.items[0].date, '2025-12-01', 'virada: dezembro → ano anterior');
eq(r4.items[1].date, '2026-01-05', 'virada: janeiro → ano da fatura');

// ---- texto colado em linha única (pdf.js às vezes) ----
const single = `12/06 LOJA A 100,00 13/06 LOJA B 200,00`;
const r5 = parseStatement('cabecalho qualquer da fatura para forcar modo single-line ' + 'x'.repeat(400) + '\n' + single, { refYM: '2026-06' });
ok(r5.items.length >= 1, 'linha única: reconhece ao menos 1 (split heurístico)');

// ---- dedupe interno ----
const dup = `12/06 MESMA COMPRA 50,00\n12/06 MESMA COMPRA 50,00`;
eq(parseStatement(dup, { refYM: '2026-06' }).items.length, 1, 'dedupe de linhas repetidas');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
