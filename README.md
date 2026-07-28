# Fluxo — Finanças Pessoais

> **Este repositório contém apenas o código do app** (nada sensível). Os dados financeiros vivem em um repositório **privado** separado (`data/data.json`), acessado pelo app em tempo de execução via API do GitHub com token restrito. App no ar via GitHub Pages.

Gerenciador de finanças pessoais completo, feito para rodar como **PWA** (celular e computador), com dados versionados no **seu repositório privado do GitHub** — cada alteração vira um commit, o que dá histórico auditável de anos e backup automático, sem servidor e sem custo.

## O que ele faz

- **Lançamentos rápidos** de despesas e receitas (botão `+`), com categorias que o app aprende com o uso.
- **Compras parceladas**: informe o total e o nº de parcelas; o app gera cada parcela na fatura/competência correta (resto de arredondamento na 1ª parcela).
- **Importação de fatura de cartão** (Itaú, Bradesco, C6 e layout genérico): envie o **PDF** ou **cole o texto**; o app interpreta, sugere categorias, detecta parcelas (`02/05`), duplicatas e créditos/estornos, e permite conferir tudo antes de importar.
- **Parecer completo da fatura**: total e variação vs fatura anterior, gastos por categoria, maiores compras, ticket médio, % parcelado, compromisso futuro já contratado, estabelecimentos novos e alertas.
- **Competência por fatura**: compra no cartão dia 29 com fechamento dia 28 cai no mês seguinte — os painéis respeitam isso.
- **Investimentos**: registre mensalmente saldo/aportes/resgates de cada ativo (CDI, FIIs, ações, dólar…); o app calcula rendimento, rentabilidade %, evolução patrimonial e consolida a carteira.
- **Análise**: dashboard mensal com tendências, orçamento por categoria (metas), fluxo de 12 meses, relatório anual categoria × mês, parcelamentos em andamento e **export CSV**.
- **Tema claro/escuro**, funciona **offline** (service worker) e sincroniza quando volta a conexão.

## Estrutura

```
index.html            shell do app (PWA)
css/styles.css        design system (claro/escuro)
js/store.js           estado, persistência local, agregações
js/github.js          sync com GitHub Contents API (merge por entidade)
js/parsers.js         parsers de fatura (Itaú/Bradesco/C6/genérico) + PDF (pdf.js)
js/charts.js          gráficos SVG (colunas, barras, linha, meter, sparkline)
js/views/…            telas: dashboard, lançamentos, fatura, investimentos, relatórios, ajustes
data/data.json        SEUS DADOS (criado pelo próprio app via API)
data/data.sample.json seed inicial de categorias/contas
test/                 testes de parser/lógica (node) e smoke test de navegador
```

## Setup (uma vez, ~10 minutos)

### 1. Crie o repositório

Crie um repo **privado** no GitHub (ex.: `financas`) e envie todos estes arquivos para a branch `main`.

### 2. Gere o token de acesso

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token:

- **Repository access**: *Only select repositories* → selecione apenas o repo `financas`.
- **Permissions** → Repository permissions → **Contents: Read and write**. Nada mais.
- Validade: escolha 1 ano (o GitHub avisa quando expirar; basta gerar outro).

Esse token só consegue ler/escrever arquivos desse único repo — é o escopo mínimo possível.

### 3. Hospede o app

O app é 100% estático. Opções, da mais simples para a mais flexível:

| Opção | Como | Observação |
|---|---|---|
| **GitHub Pages** | Settings → Pages → Deploy from branch → `main` / root | Em repo **privado**, Pages exige plano GitHub Pro. Em conta gratuita, use uma das opções abaixo ou torne público **só o código** (veja nota) |
| **Cloudflare Pages / Netlify** | Conecte o repo privado; deploy automático a cada push | Gratuito, funciona com repo privado; o site pode ficar atrás de senha (Netlify) ou Cloudflare Access |
| **Local** | `python3 -m http.server 8000` na pasta e abra `http://localhost:8000` | Sempre funciona; bom para testar |

> **Nota (conta gratuita):** uma alternativa limpa é usar **dois repositórios** — o código em um repo público (para o GitHub Pages gratuito) e os dados em um repo privado separado. Em Ajustes, aponte owner/repo para o repo privado de dados. O código não contém nada sensível; o token e os dados nunca tocam o repo público.

### 4. Configure o app

Abra o app → **Ajustes** → Sincronização com o GitHub: preencha owner, repo, branch, caminho (`data/data.json`) e o token → **Salvar e testar**. Repita no celular (mesmos valores). No celular, use "Adicionar à tela de início" para instalar como app.

O token fica somente no `localStorage` do dispositivo — não é gravado no repositório.

## Como usar no dia a dia

- **Gasto avulso**: `+` → descrição, valor, cartão/conta, categoria (sugerida automaticamente) → Lançar. Parcelado: escolha `Nx` e informe o valor **total**.
- **Fatura fechou**: aba **Fatura** → escolha o cartão e o mês de competência → envie o PDF ou cole o texto → confira a lista (categorias, duplicatas) → **Importar selecionados**. O parecer sai na hora. Compras parceladas podem projetar as parcelas futuras automaticamente; quando a fatura seguinte for importada, essas projeções são detectadas como duplicatas e você simplesmente desmarca as linhas repetidas.
- **Fim do mês (investimentos)**: aba **Investir** → em cada ativo, registre saldo final + aportes/resgates do mês. Rendimento e rentabilidade saem calculados.
- **Análise**: dashboard para o mês, **Relatórios** para o ano (com CSV para Excel/BI).

## Sincronização e conflitos

O estado local (localStorage) é a fonte de trabalho; o `data/data.json` do repo é o ponto de encontro entre dispositivos. O sync faz merge **por entidade** (união por id; `updatedAt` mais recente vence; exclusões viram tombstones), então usar celular e PC no mesmo dia é seguro. Conflito de escrita simultânea é resolvido com re-pull + merge + retry.

## Testes

```
node test/test-parsers.mjs    # parsers de fatura, datas, valores BR
node test/test-store.mjs      # parcelas, competência de fatura, merge de sync
node test/browser-check.mjs   # smoke test de navegador (requer playwright + chromium)
```

## Limitações conhecidas

- O parser de PDF depende do texto extraível (faturas digitalizadas como imagem precisariam de OCR — nesse caso, use o modo "colar texto" a partir do app do banco).
- Layouts de fatura mudam; se alguma linha não for reconhecida, o modo texto é o plano B garantido. Ajustes de layout ficam concentrados em `js/parsers.js`.
- Sync via GitHub é quase-tempo-real (segundos), não instantâneo; o app puxa ao abrir/voltar ao foco e empurra ~2,5s após cada alteração.

## Licença

Uso pessoal. Faça fork à vontade.
