// verifica a conferência da fatura em viewport de celular
import { chromium } from 'playwright';
import { spawn } from 'child_process';
const root = new URL('..', import.meta.url).pathname;
const server = spawn('python3', ['-m', 'http.server', '8126'], { cwd: root });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8126/index.html#fatura');
await page.waitForTimeout(1500);
await page.evaluate(() => window.appNavigate('fatura'));
await page.waitForTimeout(400);
await page.fill('#ivText', `05/06 PANVEL FARMACIA CENTRO JOINVILLE 25,00
10/06 POSTO IPIRANGA JARAGUA DO SUL 27,00
11/06 IFOOD *RESTAURANTE COMIDA BOA DEMAIS 136,79
10/10 3.333,36
12/06 RESTAURANTE MADALOSSO CURITIBA PARC 02/05 49,00
30/12 3.001,24
12/06 RH SUPERMERCADOS LTDA JOINVILLE SC BR 5,00`);
await page.click('#ivParse');
await page.waitForTimeout(900);
await page.screenshot({ path: 'test/shot-mobile-preview.png', fullPage: false });
const firstDesc = await page.textContent('.pv-row .pv-desc');
console.log('primeira desc visível:', JSON.stringify(firstDesc));
const suspects = await page.$$eval('.pv-row .warn', (els) => els.map((e) => e.textContent));
console.log('avisos:', suspects);
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'sem erros');
await browser.close(); server.kill();
process.exit(errors.length ? 1 : 0);
