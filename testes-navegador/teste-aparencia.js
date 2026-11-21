// Testes do painel "Aa" (aparência) na página de leitura, no Chromium.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const PROJ = path.resolve(__dirname, '..');
const ASSETS = path.join(PROJ, 'app/src/main/assets/reader');
const FIX = path.join(PROJ, 'app/build/leitor-fixtures');
const SHOTS = process.argv[2];
const temas = JSON.parse(fs.readFileSync(path.join(ASSETS, 'temas.json'))).temas;
const T = (id) => temas.find((t) => t.id === id);
let failures = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

async function open(browser, name, initial) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript((a) => {
    window.LEITOR_APARENCIA = a;
    window.Leitor = { onPosition() {}, onProgress() {}, toggleUi() {}, openExternal() {}, onReady() { window.__ready = true; } };
  }, initial);
  await page.route('https://appassets.androidplatform.net/**', (route) => {
    const u = new URL(route.request().url());
    let f = u.pathname.startsWith('/assets/reader/') ? path.join(ASSETS, u.pathname.slice(15)) : path.join(FIX, name, decodeURIComponent(u.pathname.slice(6)));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream' });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('https://appassets.androidplatform.net/book/__leitor.html');
  await page.waitForFunction(() => window.__ready);
  return { page, ctx, errors };
}

(async () => {
  const browser = await chromium.launch();
  // tema inicial já aplicado na abertura (sem piscar)
  {
    const { page, ctx, errors } = await open(browser, 'criador', { tema: T('sepia-escuro') });
    ok(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor) === rgb(T('sepia-escuro').fundo), 'tema inicial aplicado antes de mostrar a página');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('#content p')).color) === rgb(T('sepia-escuro').texto), 'cor do texto do tema sobrescreve o CSS do livro');
    ok(errors.length === 0, 'sem erros de JavaScript ' + errors.join('|'));
    await ctx.close();
  }
  const { page, ctx, errors } = await open(browser, 'criador', {});
  await page.evaluate(() => {
    const h2 = document.getElementById('s1_h2');
    for (let i = 0; i < 6; i++) { const p = document.createElement('p'); p.className = 'lt-texto'; p.textContent = 'Jesus foi bem direto, tudo aqui será destruído, e mais tarde no monte das Oliveiras os discípulos perguntaram mais informações sobre esse dia, perguntaram o que iria acontecer. ' + i; h2.parentNode.insertBefore(p, h2); }
    window.leitor._rescan();
  });
  const ap = (a) => page.evaluate((x) => window.leitor.applyAppearance(x), a);

  // texturas: imagem gerada por código + fotos para conferência
  for (const t of temas.filter((x) => x.textura)) {
    await ap({ tema: t });
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundImage);
    ok(bg.startsWith('url("data:image/svg+xml'), `textura ${t.nome}: fundo gerado por código`);
    await page.screenshot({ path: path.join(SHOTS, `tema-${t.id}.png`) });
  }
  // contraste mínimo (WCAG AA 4.5:1) entre texto e fundo base de cada tema
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  for (const t of temas) {
    const a = lum(t.fundo), b = lum(t.texto), r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    ok(r >= 7, `contraste ${t.nome}: ${r.toFixed(1)}:1`);
  }

  // justificar só texto corrido; imagem centralizada/linha com imagem não muda
  await ap({ tema: T('branco'), alinhamento: 'justificado', recuo: '1.5', paragrafo: '1' });
  const al = await page.evaluate(() => ({
    texto: getComputedStyle(document.querySelector('p.lt-texto')).textAlign,
    img: getComputedStyle(document.querySelector('p.img')).textAlign,
    h1: getComputedStyle(document.querySelector('h1')).textAlign,
    recuo: getComputedStyle(document.querySelector('p.lt-texto')).textIndent,
    recuoImg: getComputedStyle(document.querySelector('p.img')).textIndent,
  }));
  ok(al.texto === 'justify', 'justificado aplicado ao texto');
  ok(al.img !== 'justify' && al.h1 !== 'justify', 'imagem e título não são justificados');
  ok(al.recuo !== '0px' && al.recuoImg === '0px', 'recuo da primeira linha só no texto (' + al.recuo + ')');
  const w = await page.evaluate(() => { const i = document.querySelector('p.img img'); return i.getBoundingClientRect().width / i.parentElement.getBoundingClientRect().width; });
  ok(Math.abs(w - 0.5) < 0.01, 'imagem continua com 50% da largura');

  // fonte de leitura fácil, margens, linhas, letras
  await ap({ tema: T('creme'), fonte: 'leitura-facil', margemLateral: 12, margemVertical: 5, linhas: 2.2, letras: 0.05 });
  await page.evaluate(() => document.fonts.ready);
  const ff = await page.evaluate(() => ({
    fam: getComputedStyle(document.querySelector('#content p')).fontFamily,
    loaded: document.fonts.check('16px "Atkinson Hyperlegible"'),
    pad: parseFloat(getComputedStyle(document.body).paddingLeft),
    lh: parseFloat(getComputedStyle(document.querySelector('#content p')).lineHeight) / parseFloat(getComputedStyle(document.querySelector('#content p')).fontSize),
    ls: getComputedStyle(document.querySelector('#content p')).letterSpacing,
  }));
  ok(ff.fam.includes('Atkinson') && ff.loaded, 'fonte "Leitura fácil" (Atkinson Hyperlegible) carregada');
  ok(Math.abs(ff.pad - (12 + 1280 * 0.12)) < 2, 'margem lateral 12% (' + ff.pad + 'px)');
  ok(Math.abs(ff.lh - 2.2) < 0.05, 'espaço entre linhas 2,2');
  ok(ff.ls !== 'normal' && parseFloat(ff.ls) > 0, 'espaço entre letras (' + ff.ls + ')');
  await page.screenshot({ path: path.join(SHOTS, 'aparencia-leitura-facil.png') });

  // balão da nota segue o tema
  await ap({ tema: T('grafite') });
  await page.evaluate(() => document.getElementById('s1_r1').scrollIntoView({ block: 'center' }));
  await page.click('#s1_r1');
  const nota = await page.evaluate(() => ({ bg: getComputedStyle(document.getElementById('leitor-nota')).backgroundColor, fg: getComputedStyle(document.querySelector('.leitor-nota-corpo p')).color }));
  ok(nota.bg === rgb(T('grafite').popupFundo) && nota.fg === rgb(T('grafite').texto), 'balão da nota com as cores do tema');
  await page.screenshot({ path: path.join(SHOTS, 'nota-grafite.png') });
  await page.click('.leitor-nota-fechar');

  // ---- balão da anotação: título, posição e arrastar ----
  const abrirNota = async () => {
    await page.evaluate(() => document.getElementById('s1_r1').scrollIntoView({ block: 'center' }));
    await page.click('#s1_r1');
    return page.evaluate(() => {
      const r = document.getElementById('leitor-nota').getBoundingClientRect();
      return { titulo: document.querySelector('.leitor-nota-titulo').textContent, top: r.top, bottom: r.bottom, left: r.left, h: r.height };
    });
  };
  await ap({ tema: T('branco') }); // padrão = centro
  let n = await abrirNota();
  ok(n.titulo === 'Isaías 25:8', 'título do balão = texto tocado (' + n.titulo + ')');
  ok(Math.abs((n.top + n.bottom) / 2 - 400) < 3, 'balão no centro da tela por padrão');
  await page.screenshot({ path: path.join(SHOTS, 'nota-centro.png') });
  await page.mouse.click(30, 30);
  ok(!(await page.isVisible('#leitor-nota')), 'tocar fora fecha o balão (centro)');

  await ap({ tema: T('branco'), notaPosicao: 'baixo' });
  n = await abrirNota();
  ok(800 - n.bottom > 10 && 800 - n.bottom < 40, 'opção "Embaixo" mantém o balão embaixo');
  await page.click('.leitor-nota-fechar');

  await ap({ tema: T('sepia'), notaPosicao: 'movel' });
  n = await abrirNota();
  const topo = await page.evaluate(() => { const r = document.querySelector('.leitor-nota-topo').getBoundingClientRect(); return { x: r.left + 120, y: r.top + r.height / 2 }; });
  await page.mouse.move(topo.x, topo.y);
  await page.mouse.down();
  await page.mouse.move(topo.x - 150, topo.y - 200, { steps: 8 });
  await page.mouse.up();
  const m = await page.evaluate(() => { const r = document.getElementById('leitor-nota').getBoundingClientRect(); return { left: r.left, top: r.top }; });
  ok(Math.abs(m.left - (n.left - 150)) < 3 && Math.abs(m.top - (n.top - 200)) < 3, `balão móvel arrastado (${Math.round(n.left)},${Math.round(n.top)} → ${Math.round(m.left)},${Math.round(m.top)})`);
  ok(await page.isVisible('#leitor-nota'), 'arrastar não fecha o balão');
  await page.screenshot({ path: path.join(SHOTS, 'nota-movel.png') });
  await page.mouse.click(1250, 780);
  ok(!(await page.isVisible('#leitor-nota')), 'tocar fora fecha o balão móvel');
  n = await abrirNota();
  ok(Math.abs(n.left - m.left) < 3 && Math.abs(n.top - m.top) < 3, 'balão móvel reabre onde foi deixado');
  await page.click('.leitor-nota-fechar');

  // voltar ao "original" desfaz as regras
  await ap({ tema: T('branco') });
  const orig = await page.evaluate(() => ({ al: getComputedStyle(document.querySelector('p.lt-texto')).textAlign, fam: getComputedStyle(document.querySelector('#content p')).fontFamily }));
  ok(orig.al !== 'justify' && !orig.fam.includes('Atkinson'), 'restaurar padrão volta ao original do livro');
  // mudar aparência não perde o ponto de leitura
  await page.evaluate(() => window.scrollTo(0, 600));
  const before = await page.evaluate(() => { const els = [...document.querySelectorAll('#content p')]; return els.findIndex((e) => e.getBoundingClientRect().bottom > 1); });
  await ap({ tema: T('branco'), linhas: 2.4, margemLateral: 15 });
  const after = await page.evaluate(() => { const els = [...document.querySelectorAll('#content p')]; return els.findIndex((e) => e.getBoundingClientRect().bottom > 1); });
  ok(before === after, `mudar a aparência mantém o parágrafo no topo (${before} → ${after})`);
  ok(errors.length === 0, 'sem erros de JavaScript ' + errors.join('|'));
  await ctx.close();
  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(failures ? 1 : 0);
})();
