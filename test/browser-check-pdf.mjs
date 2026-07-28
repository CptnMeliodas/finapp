// test/browser-check-pdf.mjs — fluxo de PDF protegido por senha na aba Fatura
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('python3', ['-m', 'http.server', '8124'], { cwd: root });
await new Promise((r) => setTimeout(r, 1200));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8124/index.html#fatura');
await page.waitForTimeout(1500);
await page.evaluate(() => window.appNavigate('fatura'));
await page.waitForTimeout(500);

// envia o PDF protegido SEM senha → deve pedir a senha
await page.setInputFiles('#ivFile', root + 'test/fatura-protegida.pdf');
await page.waitForTimeout(4000);
const s1 = await page.textContent('#ivStatus');
console.log('sem senha →', s1.trim());
if (!/protegido/i.test(s1)) { console.error('FALHOU: não pediu senha'); process.exitCode = 1; }

// senha errada
await page.fill('#ivPass', '0000');
await page.press('#ivPass', 'Enter');
await page.waitForTimeout(2500);
const s2 = await page.textContent('#ivStatus');
console.log('senha errada →', s2.trim());
if (!/incorreta/i.test(s2)) { console.error('FALHOU: não detectou senha errada'); process.exitCode = 1; }

// senha correta → deve interpretar 3 lançamentos
await page.fill('#ivPass', '1234');
await page.press('#ivPass', 'Enter');
await page.waitForTimeout(3000);
const s3 = await page.textContent('#ivStatus');
console.log('senha correta →', s3.trim());
if (!/3 lançamentos/.test(s3)) { console.error('FALHOU: não interpretou os lançamentos'); process.exitCode = 1; }
await page.screenshot({ path: 'test/shot-pdf-senha.png', fullPage: true });

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'sem erros de página');
if (errors.length) process.exitCode = 1;
await browser.close();
server.kill();
