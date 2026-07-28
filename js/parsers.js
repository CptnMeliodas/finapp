// parsers.js — interpreta texto de fatura (colado ou extraído de PDF) dos bancos
// Itaú, Bradesco e C6, com fallback genérico. Saída normalizada:
// {date:'YYYY-MM-DD', desc, amount (sempre >0), credit:bool, installment:{n,total}|null}
import { parseBRNumber, normalizeDesc } from './util.js';

const MONTHS_PT = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

// linhas que não são lançamentos (saldos, limites, totais, encargos informativos)
const NOISE = /(saldo (anterior|atual|em aberto)|total (da |desta )?fatura|pagamento minimo|pagamento m[ií]nimo|limite (de|total|disponivel|dispon[ií]vel)|vencimento|fechamento|encargos|juros rotativo|cet\b|custo efetivo|iof adicional|proxima fatura|pr[óo]xima fatura|demonstrativo|resumo|cotacao|cota[çc][ãa]o|d[óo]lar de|taxa de cambio|taxa de c[âa]mbio|valor em (us\$|d[óo]lar))/i;

// crédito/estorno (entra como abatimento da fatura)
const CREDIT_HINT = /(pagamento (efetuado|recebido|de fatura)|pgto\.?\s|estorno|credito de|cr[ée]dito de|ajuste a credito|ajuste a cr[ée]dito|cashback|devolucao|devolu[çc][ãa]o)/i;

// parcela: "03/10", "3 de 10", "parc 03/10", "parcela 3/10"
function extractInstallment(desc) {
  let m = desc.match(/(?:parc(?:ela)?\.?\s*)(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i)
       || desc.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/);
  if (!m) return { installment: null, desc };
  const n = Number(m[1]), total = Number(m[2]);
  if (!(n >= 1 && total >= 2 && n <= total && total <= 48)) return { installment: null, desc };
  const clean = desc.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
  return { installment: { n, total }, desc: clean };
}

// resolve dd/mm (sem ano) para o ano correto dado o mês de referência da fatura
export function resolveYear(day, month, refYM) {
  const [ry, rm] = refYM.split('-').map(Number);
  // a compra ocorreu no máximo no mês de referência; tenta ano de ref, senão ano anterior
  let y = ry;
  if (month > rm + 1) y = ry - 1; // ex.: fatura Jan/2026 com compra 28/12 → 2025
  return y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function parseDateToken(tok, refYM) {
  let m = tok.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    return y + '-' + String(Number(m[2])).padStart(2, '0') + '-' + String(Number(m[1])).padStart(2, '0');
  }
  m = tok.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return resolveYear(Number(m[1]), Number(m[2]), refYM);
  m = tok.match(/^(\d{1,2})[\s.]*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?$/i);
  if (m) return resolveYear(Number(m[1]), MONTHS_PT[m[2].toLowerCase()], refYM);
  return null;
}

// regex de valor monetário BR no fim (ou próximo do fim) da linha
const VALUE_RE = /(?:R\$\s*)?(-?\s?\d{1,3}(?:\.\d{3})*,\d{2}|-?\s?\d+,\d{2})\s*(-|CR|C|D)?\s*$/i;

// tenta interpretar uma linha como lançamento
function parseLine(line, refYM) {
  const raw = line.trim();
  if (!raw || raw.length < 8) return null;
  if (NOISE.test(raw)) return null;

  // data no início: dd/mm, dd/mm/aaaa, dd mmm
  const dm = raw.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}[\s.]*(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?)\s+(.*)$/i);
  if (!dm) return null;
  const date = parseDateToken(dm[1].replace(/\s+/g, ' ').trim(), refYM);
  if (!date) return null;

  let rest = dm[2].trim();
  const vm = rest.match(VALUE_RE);
  if (!vm) return null;
  let value = parseBRNumber(vm[1]);
  if (!isFinite(value) || value === 0) return null;
  const suffix = (vm[2] || '').toUpperCase();
  let credit = value < 0 || suffix === 'CR' || suffix === '-' || suffix === 'C';

  let desc = rest.slice(0, vm.index).trim()
    .replace(/\s{2,}/g, ' ')
    .replace(/[|•·]+/g, ' ')
    .trim();
  if (!desc) return null;
  // linha com valor em dólar antes do valor em reais (Bradesco/Itaú internacional):
  // remove valores monetários residuais no fim da descrição
  desc = desc.replace(/(?:US\$|U\$|USD)?\s*\d{1,3}(?:\.\d{3})*,\d{2,4}\s*$/i, '').trim() || desc;

  if (CREDIT_HINT.test(desc)) credit = true;
  const inst = extractInstallment(desc);
  return {
    date, desc: inst.desc, amount: Math.abs(value), credit,
    installment: inst.installment,
    isPayment: /pagamento|pgto/i.test(desc)
  };
}

export function detectBank(text) {
  const t = normalizeDesc(text);
  if (/c6 bank|c6 carbon|banco c6|c6bank/.test(t)) return 'c6';
  if (/bradesco/.test(t)) return 'bradesco';
  if (/itau|itaucard|personnalite|uniclass|latam pass itau/.test(t)) return 'itau';
  return null;
}

// pré-processamento específico por banco (layout de colunas do PDF)
function preprocess(text, bank) {
  let lines = text.split(/\r?\n/);
  // pdf.js às vezes junta tudo numa linha: quebra antes de cada data
  if (lines.length < 5 && text.length > 400) {
    lines = text
      .replace(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(?=[A-ZÀ-Ú])/g, '\n$1 ')
      .replace(/(\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?)\s+(?=[A-ZÀ-Ú])/gi, '\n$1 ')
      .split(/\n/);
  }
  if (bank === 'c6') {
    // C6 costuma listar "dd mmm  DESCRICAO  R$ 0.000,00" (às vezes sem R$)
    lines = lines.map((l) => l.replace(/\bR\$\s*/g, 'R$ '));
  }
  return lines;
}

export function parseStatement(text, { bank, refYM }) {
  const detected = detectBank(text) || bank || null;
  const lines = preprocess(text, detected);
  const items = [];
  const ignored = [];
  for (const line of lines) {
    const it = parseLine(line, refYM);
    if (it) items.push(it);
    else if (line.trim().length > 4) ignored.push(line.trim());
  }
  // dedupe exato dentro da própria fatura (linhas repetidas em quebras de página)
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const k = it.date + '|' + normalizeDesc(it.desc) + '|' + it.amount + '|' + (it.installment ? it.installment.n : 0);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(it);
  }
  return { bank: detected, items: unique, ignored };
}

// extrai texto de um PDF usando pdf.js (carregado sob demanda)
// password: senha do PDF protegido (opcional). Lança {needsPassword:true} se
// o PDF for protegido e a senha estiver ausente ou incorreta.
export async function extractPdfText(arrayBuffer, password) {
  if (!window.pdfjsLib) {
    await loadScript('./vendor/pdf.min.js'); // pdf.js embutido no repo (funciona offline)
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  }
  let pdf;
  try {
    pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, password: password || undefined }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') {
      const err = new Error(password ? 'Senha incorreta para este PDF.' : 'Este PDF é protegido por senha.');
      err.needsPassword = true;
      err.wrongPassword = !!password;
      throw err;
    }
    throw e;
  }
  let out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // agrupa itens por linha (coordenada Y) para reconstruir o layout
    const rows = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: item.transform[4], str: item.str });
    }
    const sorted = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, cells] of sorted) {
      cells.sort((a, b) => a.x - b.x);
      out.push(cells.map((c) => c.str).join(' ').replace(/\s{2,}/g, '  ').trim());
    }
    out.push('');
  }
  return out.join('\n');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar ' + src + ' (sem internet?)'));
    document.head.appendChild(s);
  });
}
