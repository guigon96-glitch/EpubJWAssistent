// Testes das marcações (marca-texto, cor da letra, negrito/sublinhado) e do destaque das anotações.
// Uso: node teste-marcacoes.js <pasta-para-fotos>   (precisa das páginas geradas por ./gradlew testReleaseUnitTest)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const PROJ = path.resolve(__dirname, '..');
const ASSETS = path.join(PROJ, 'app/src/main/assets/reader');
const FIX = path.join(PROJ, 'app/build/leitor-fixtures');
const SHOTS = process.argv[2] || '/tmp';
const temas = JSON.parse(fs.readFileSync(path.join(ASSETS, 'temas.json'))).temas;
const T = (id) => temas.find((t) => t.id === id);
let failures = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function open(browser, { marcas = [], ap = {}, trocar = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(([m, a]) => {
    window.LEITOR_MARCAS = m; window.LEITOR_APARENCIA = a; window.__salvas = null;
    window.Leitor = { onPosition() {}, onProgress() {}, toggleUi() { window.__ui = (window.__ui || 0) + 1; }, openExternal() {},
      onReady() { window.__ready = true; }, salvarMarcas(j) { window.__salvas = JSON.parse(j); } };
  }, [marcas, ap]);
  await page.route('https://appassets.androidplatform.net/**', (route) => {
    const u = new URL(route.request().url());
    const f = u.pathname.startsWith('/assets/reader/') ? path.join(ASSETS, u.pathname.slice(15)) : path.join(FIX, 'criador', decodeURIComponent(u.pathname.slice(6)));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    let body = fs.readFileSync(f);
    if (trocar && f.endsWith('__leitor.html')) body = Buffer.from(trocar(body.toString()));
    route.fulfill({ status: 200, body, contentType: types[path.extname(f)] || 'application/octet-stream' });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('https://appassets.androidplatform.net/book/__leitor.html');
  await page.waitForFunction(() => window.__ready);
  return { page, ctx, errors };
}

// seleciona de "Leia" até "e pense" (passa por dentro do link da anotação: vários nós de texto)
async function selecionar(page) {
  await page.evaluate(() => {
    const p = document.getElementById('s1_r1').parentElement;
    const r = document.createRange();
    r.setStart(p.firstChild, 0);                 // "Leia "
    const ult = p.lastChild;                     // " e pense."
    r.setEnd(ult, ult.nodeValue.indexOf('pense') + 5);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForSelector('#leitor-marcador.aberto', { timeout: 3000 });
}

(async () => {
  const browser = await chromium.launch();
  let salvas;
  {
    const { page, ctx, errors } = await open(browser);
    await selecionar(page);
    ok(true, 'selecionar texto mostra a barra de marcação');
    await page.click('#leitor-marcador button[data-fundo="amarelo"]');
    const r = await page.evaluate(() => ({
      spans: document.querySelectorAll('span.lm.lm-f-amarelo').length,
      texto: [...document.querySelectorAll('span.lm')].map((s) => s.textContent).join(''),
      bg: getComputedStyle(document.querySelector('span.lm')).backgroundColor,
      aberto: !!document.querySelector('#leitor-marcador.aberto'),
    }));
    ok(r.spans >= 3, `marca-texto amarelo aplicado em vários pedaços (${r.spans} pedaços)`);
    ok(r.texto === 'Leia Isaías 25:8 e pense', 'trecho marcado exato: "' + r.texto + '"');
    ok(r.bg.startsWith('rgba(255, 214, 0'), 'cor amarela visível (' + r.bg + ')');
    ok(!r.aberto, 'barra fecha depois de marcar');
    salvas = await page.evaluate(() => window.__salvas);
    ok(salvas && salvas.length === 1 && salvas[0].texto === 'Leia Isaías 25:8 e pense' && salvas[0].fundo === 'amarelo', 'marcação salva no app');

    // a anotação dentro do trecho marcado continua abrindo o balão
    await page.click('#s1_r1');
    ok(await page.isVisible('#leitor-nota'), 'anotação dentro da marcação ainda abre o balão');
    await page.click('.leitor-nota-fechar');

    // tocar na marcação → editar: cor da letra vermelha + negrito
    await page.evaluate(() => { window.__ui = 0; });
    const pal = await page.$('span.lm >> text=Leia');
    await pal.click();
    ok(await page.isVisible('#leitor-marcador.aberto.edicao'), 'tocar na marcação abre a barra para editar');
    ok(await page.evaluate(() => !window.__ui), 'tocar na marcação não esconde a barra de cima');
    await page.click('#leitor-marcador button[data-cor="vermelho"]');
    await page.click('span.lm >> text=Leia');
    await page.click('#leitor-marcador button[data-acao="negrito"]');
    const e = await page.evaluate(() => { const s = document.querySelector('span.lm'); const cs = getComputedStyle(s); return { cor: cs.color, peso: cs.fontWeight, cls: s.className }; });
    ok(e.cor === 'rgb(198, 40, 40)', 'cor da letra vermelha (' + e.cor + ')');
    ok(Number(e.peso) >= 700, 'negrito aplicado');
    salvas = await page.evaluate(() => window.__salvas);
    ok(salvas[0].cor === 'vermelho' && salvas[0].negrito === true && salvas[0].fundo === 'amarelo', 'edição salva');

    // segunda marcação: sublinhado no título de conclusão
    await page.evaluate(() => {
      const h = document.getElementById('s1_h3'); const r = document.createRange(); r.selectNodeContents(h);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.waitForSelector('#leitor-marcador.aberto:not(.edicao)');
    await page.click('#leitor-marcador button[data-acao="sublinhado"]');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('#s1_h3 span.lm')).textDecorationLine.includes('underline')), 'sublinhado aplicado');
    const lista = JSON.parse(await page.evaluate(() => window.leitor.listarMarcas()));
    ok(lista.length === 2, 'lista de marcações tem 2 itens');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate((id) => window.leitor.irParaMarca(id), lista[1].id);
    const top = await page.evaluate(() => document.querySelector('#s1_h3 span.lm').getBoundingClientRect().top);
    ok(top > 0 && top < 800, 'ir para a marcação rola até ela');
    await page.screenshot({ path: path.join(SHOTS, 'marcacoes.png') });
    salvas = await page.evaluate(() => window.__salvas);
    ok(errors.length === 0, 'sem erros de JavaScript ' + errors.join('|'));
    await ctx.close();
  }
  // reabrir: as marcações voltam
  {
    const { page, ctx, errors } = await open(browser, { marcas: salvas });
    const n = await page.evaluate(() => [...document.querySelectorAll('span.lm')].map((s) => s.textContent).join(''));
    ok(n === 'Leia Isaías 25:8 e penseConclusão', 'marcações reaparecem ao reabrir (' + n + ')');
    ok(errors.length === 0, 'sem erros de JavaScript ' + errors.join('|'));
    await ctx.close();
  }
  // discurso atualizado no PC (texto antes mudou e o trecho aparece duas vezes): acha o lugar certo
  {
    const trocar = (h) => h.replace('<p>Introdução.</p>', '<p>Introdução nova, bem mais longa. Leia Isaías 25:8 e pense (citação repetida).</p>');
    const { page, ctx } = await open(browser, { marcas: salvas, trocar });
    const onde = await page.evaluate(() => document.querySelector('span.lm').closest('p').textContent.slice(0, 20));
    ok(onde.startsWith('Leia Isaías'), 'após atualização do EPUB, a marcação fica no mesmo trecho (não na cópia nova)');
    await ctx.close();
  }
  // remover e tema escuro + destaque das anotações
  {
    const { page, ctx } = await open(browser, { marcas: salvas, ap: { tema: T('noite'), notaCor: 'laranja', notaEstilo: 'fundo' } });
    const c = await page.evaluate(() => getComputedStyle(document.querySelector('span.lm.lm-c-vermelho')).color);
    ok(c === 'rgb(255, 138, 128)', 'cor da letra mais clara no tema escuro (' + c + ')');
    const nota = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('s1_r1')); return { cor: cs.color, bg: cs.backgroundColor }; });
    ok(nota.cor === 'rgb(255, 183, 77)' && nota.bg.startsWith('rgba(255, 183, 77'), `anotação laranja com fundo colorido (${nota.cor} / ${nota.bg})`);
    await page.screenshot({ path: path.join(SHOTS, 'marcacoes-escuro.png') });
    await page.click('span.lm >> text=Leia');
    await page.click('#leitor-marcador button[data-acao="remover"]');
    const resto = await page.evaluate(() => ({ spans: document.querySelectorAll('span.lm').length, salvas: window.__salvas.length, txt: document.getElementById('s1_r1').parentElement.textContent }));
    ok(resto.salvas === 1 && resto.txt === 'Leia Isaías 25:8 e pense.', 'remover tira a marcação e o texto fica intacto');
    await page.evaluate(() => window.leitor.apagarTodasMarcas());
    ok(await page.evaluate(() => document.querySelectorAll('span.lm').length === 0 && window.__salvas.length === 0), 'apagar todas');
    await ctx.close();
  }
  // estilos das anotações no tema claro
  {
    const { page, ctx } = await open(browser, { ap: { tema: T('branco'), notaCor: 'vermelho', notaEstilo: 'negrito' } });
    const s = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('s1_r1')); return { cor: cs.color, peso: cs.fontWeight }; });
    ok(s.cor === 'rgb(198, 40, 40)' && Number(s.peso) >= 700, 'anotação vermelha em negrito');
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(failures ? 1 : 0);
})();
