// test/browser-check.mjs — smoke test com Playwright: navega, injeta dados demo, tira screenshots
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const server = spawn('python3', ['-m', 'http.server', '8123'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 1200));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8123/index.html');
await page.waitForTimeout(1500);

// injeta dados demo diretamente no localStorage e recarrega
await page.evaluate(() => {
  const now = new Date();
  const iso = now.toISOString();
  const ym = (off) => {
    const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };
  const day = (off, dd) => ym(off) + '-' + String(dd).padStart(2, '0');
  const cats = JSON.parse(localStorage.getItem('fluxo.data.v1'))?.categories;
  const data = JSON.parse(localStorage.getItem('fluxo.data.v1'));
  const txs = [];
  let n = 0;
  const add = (t) => txs.push({ id: 'demo-' + (n++), updatedAt: iso, source: 'manual', ...t });
  for (let off = -11; off <= 0; off++) {
    add({ date: day(off, 5), desc: 'Salário', amount: 32000, type: 'receita', categoryId: 'cat-salario', accountId: 'acc-corrente' });
    if (off % 3 === 0) add({ date: day(off, 15), desc: 'Dividendos FII', amount: 2400 + off * 50, type: 'receita', categoryId: 'cat-dividendos', accountId: 'acc-corrente' });
    add({ date: day(off, 8), desc: 'Supermercado Angeloni', amount: 1850 + (off % 4) * 220, type: 'despesa', categoryId: 'cat-mercado', accountId: 'acc-itau', faturaYM: ym(off) });
    add({ date: day(off, 12), desc: 'iFood', amount: 480 + (off % 3) * 90, type: 'despesa', categoryId: 'cat-alimentacao', accountId: 'acc-c6', faturaYM: ym(off) });
    add({ date: day(off, 3), desc: 'Condomínio', amount: 1400, type: 'despesa', categoryId: 'cat-moradia', accountId: 'acc-corrente' });
    add({ date: day(off, 10), desc: 'Posto Ipiranga', amount: 750 + (off % 2) * 120, type: 'despesa', categoryId: 'cat-transporte', accountId: 'acc-bradesco', faturaYM: ym(off) });
    add({ date: day(off, 20), desc: 'Netflix', amount: 59.9, type: 'despesa', categoryId: 'cat-assinaturas', accountId: 'acc-c6', faturaYM: ym(off) });
    if (off === -2) {
      for (let k = 0; k < 6; k++) add({
        date: day(off + k, 18), desc: 'Passagens LATAM', amount: 850, type: 'despesa',
        categoryId: 'cat-viagem', accountId: 'acc-itau', faturaYM: ym(off + k),
        installment: { group: 'demo-par', n: k + 1, total: 6 }
      });
    }
  }
  data.transactions = txs;
  data.categories = data.categories.map((c) =>
    c.id === 'cat-mercado' ? { ...c, budget: 2500 } :
    c.id === 'cat-alimentacao' ? { ...c, budget: 900 } :
    c.id === 'cat-transporte' ? { ...c, budget: 1000 } : c);
  data.investments = [
    { id: 'inv-cdb', name: 'CDB 110% CDI', class: 'cdi', institution: 'Itaú', updatedAt: iso },
    { id: 'inv-fii', name: 'Carteira FIIs', class: 'fii', institution: 'XP', updatedAt: iso },
    { id: 'inv-ib', name: 'IB — carteira USD', class: 'usd', institution: 'Interactive Brokers', updatedAt: iso }
  ];
  const entries = [];
  let saldoC = 180000, saldoF = 95000, saldoI = 60000;
  for (let off = -11; off <= 0; off++) {
    saldoC = Math.round(saldoC * 1.0095 + 5000);
    saldoF = Math.round(saldoF * 1.006 + 2000);
    saldoI = Math.round(saldoI * 1.011 + 3000);
    entries.push({ id: 'ie-c' + off, investmentId: 'inv-cdb', ym: ym(off), saldoFinal: saldoC, aportes: 5000, resgates: 0, updatedAt: iso });
    entries.push({ id: 'ie-f' + off, investmentId: 'inv-fii', ym: ym(off), saldoFinal: saldoF, aportes: 2000, resgates: 0, updatedAt: iso });
    entries.push({ id: 'ie-i' + off, investmentId: 'inv-ib', ym: ym(off), saldoFinal: saldoI, aportes: 3000, resgates: 0, updatedAt: iso });
  }
  data.investmentEntries = entries;
  localStorage.setItem('fluxo.data.v1', JSON.stringify(data));
});
await page.reload();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/shot-dashboard.png', fullPage: true });

for (const [view, name] of [['lancamentos', 'tx'], ['fatura', 'fatura'], ['investimentos', 'inv'], ['relatorios', 'rel'], ['config', 'cfg']]) {
  await page.evaluate((v) => window.appNavigate(v), view);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `test/shot-${name}.png`, fullPage: true });
}

// testa o fluxo de fatura: cola texto e interpreta
await page.evaluate(() => window.appNavigate('fatura'));
await page.waitForTimeout(400);
await page.fill('#ivText', `12/06 IFOOD *RESTAURANTE 145,90
15/06 ANGELONI SUPERMERCADO 02/05 399,90
18/06 POSTO SHELL 250,00
19/06 NETFLIX.COM 59,90
20/06 MAGAZINELUIZA 01/10 189,90
21/06 PAGAMENTO EFETUADO -2.000,00`);
await page.click('#ivParse');
await page.waitForTimeout(800);
await page.screenshot({ path: 'test/shot-fatura-parse.png', fullPage: true });

// modal de novo lançamento
await page.evaluate(() => window.appNavigate('dashboard'));
await page.waitForTimeout(400);
await page.click('#fab');
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/shot-modal.png' });

// tema escuro
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.appNavigate('dashboard'); });
await page.waitForTimeout(700);
await page.screenshot({ path: 'test/shot-dark.png', fullPage: true });

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
