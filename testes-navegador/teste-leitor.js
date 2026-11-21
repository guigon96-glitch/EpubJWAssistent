// Teste da página de leitura no Chromium (simula a WebView do Android).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROJ = path.resolve(__dirname, '..');
const ASSETS = path.join(PROJ, 'app/src/main/assets/reader');
const FIX = path.join(PROJ, 'app/build/leitor-fixtures');
const SHOTS = process.argv[2] || '/tmp';

let failures = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function openBook(browser, name, query = '') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.atTopOrEnd = (id) => {
      const top = document.getElementById(id).getBoundingClientRect().top;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return (top >= -5 && top < 40) || (top > 0 && top < window.innerHeight && Math.abs(window.scrollY - max) < 2);
    };
    window.__calls = [];
    window.Leitor = {
      onPosition: (i, f) => window.__calls.push(['pos', i, f]),
      toggleUi: () => window.__calls.push(['ui']),
      openExternal: (u) => window.__calls.push(['ext', u]),
      onReady: () => window.__calls.push(['ready']),
    };
  });
  await page.route('https://appassets.androidplatform.net/**', (route) => {
    const u = new URL(route.request().url());
    let file;
    if (u.pathname.startsWith('/assets/reader/')) file = path.join(ASSETS, u.pathname.slice('/assets/reader/'.length));
    else if (u.pathname.startsWith('/book/')) file = path.join(FIX, name, decodeURIComponent(u.pathname.slice('/book/'.length)));
    if (!file || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('https://appassets.androidplatform.net/book/__leitor.html' + query);
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === 'ready'));
  return { page, ctx, errors };
}

(async () => {
  const browser = await chromium.launch();

  // ---------- EPUB do Criador de EPUB ----------
  {
    const { page, ctx, errors } = await openBook(browser, 'criador');
    // conteúdo longo para testar rolagem
    await page.evaluate(() => {
      const h2 = document.getElementById('s1_h2');
      for (let i = 0; i < 60; i++) { const p = document.createElement('p'); p.textContent = 'Parágrafo de enchimento ' + i; h2.parentNode.insertBefore(p, h2); }
    });
    await page.evaluate(() => { const r = document.getElementById('s1_r1'); window.scrollTo(0, r.getBoundingClientRect().top + window.scrollY - 300); });
    const yBefore = await page.evaluate(() => window.scrollY);
    await page.click('#s1_r1');
    const nota = page.locator('#leitor-nota');
    ok(await nota.isVisible(), 'criador: tocar na anotação abre o balão');
    const txt = await nota.innerText();
    ok(txt.includes('Ele acabará com a morte'), 'criador: balão mostra o texto da nota');
    ok(!txt.includes('↩'), 'criador: link de volta (↩) removido do balão');
    ok((await page.locator('#leitor-nota br').count()) === 1, 'criador: quebra de linha <br> do versículo preservada');
    ok(Math.abs((await page.evaluate(() => window.scrollY)) - yBefore) < 2, 'criador: o texto NÃO pulou para o fim do livro');
    await page.screenshot({ path: path.join(SHOTS, 'nota-claro.png') });
    // fechar tocando fora
    await page.mouse.click(640, 100);
    ok(!(await nota.isVisible()), 'criador: tocar fora fecha o balão');
    // fechar pelo botão ×
    await page.click('#s1_r1');
    await page.click('.leitor-nota-fechar');
    ok(!(await nota.isVisible()), 'criador: botão × fecha o balão');
    // voltar (botão do Android)
    await page.click('#s1_r1');
    ok((await page.evaluate(() => window.leitor.closeNote())) === true, 'criador: botão Voltar fecha o balão primeiro');
    ok((await page.evaluate(() => window.leitor.closeNote())) === false, 'criador: segundo Voltar sai do leitor');
    ok((await page.locator('a.leitor-nota-ref').count()) === 1, 'criador: chamada de nota marcada visualmente');

    // imagem 50%
    const w = await page.evaluate(() => {
      const img = document.querySelector('section#s1__top img');
      return { img: img.getBoundingClientRect().width, box: img.parentElement.getBoundingClientRect().width, loaded: img.complete };
    });
    ok(Math.abs(w.img - w.box / 2) < 2, `criador: imagem com width 50% (${w.img.toFixed(0)} de ${w.box.toFixed(0)} px)`);

    // sumário (goTo) e posição
    await page.evaluate(() => window.leitor.goTo('s1_h3'));
    const top = await page.evaluate(() => atTopOrEnd('s1_h3'));
    ok(top, 'criador: item do sumário rola até o título');
    await page.waitForTimeout(500);
    const pos = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'pos').pop());
    ok(pos && pos[1] > 0, 'criador: posição de leitura informada ao app (' + (pos && pos[1]) + ')');
    // restaurar a posição
    const ySaved = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate((p) => window.leitor.restore(p[1], p[2]), pos);
    const yRest = await page.evaluate(() => window.scrollY);
    ok(Math.abs(yRest - ySaved) < 60, `criador: posição restaurada ao reabrir (${ySaved} → ${yRest})`);

    // toque no texto → mostra/esconde barra
    await page.evaluate(() => { window.__calls = []; });
    await page.click('#s1_h3');
    ok(await page.evaluate(() => window.__calls.some((c) => c[0] === 'ui')), 'criador: tocar no texto mostra/esconde a barra');

    // tema escuro
    await page.evaluate((t) => window.leitor.applyAppearance({ tema: t }), {"id": "noite", "nome": "Noite", "grupo": "Escuros", "escuro": true, "fundo": "#000000", "texto": "#D9D6D0", "link": "#8AB4F8", "popupFundo": "#161616", "popupBorda": "#3A3A3A"});
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    ok(bg === 'rgb(0, 0, 0)', 'criador: tema escuro aplicado (' + bg + ')');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.click('#s1_r1');
    await page.screenshot({ path: path.join(SHOTS, 'nota-escuro.png') });
    ok(errors.length === 0, 'criador: sem erros de JavaScript ' + errors.join(' | '));
    await ctx.close();
  }

  // ---------- EPUB estilo Calibre ----------
  {
    const { page, ctx, errors } = await openBook(browser, 'calibre');
    await page.click('#s0_r1');
    ok((await page.locator('#leitor-nota').innerText()).includes('Primeira nota'), 'calibre: nota <sup>1</sup> em outro arquivo abre no balão');
    await page.click('.leitor-nota-fechar');
    await page.click('#s0_r2');
    const t2 = await page.locator('#leitor-nota').innerText();
    ok(t2.includes('Segunda nota'), 'calibre: nota cujo alvo é uma âncora dentro do parágrafo');
    await page.click('.leitor-nota-fechar');
    await page.evaluate(() => { window.__calls = []; });
    await page.click('text=capítulo 2');
    ok(!(await page.locator('#leitor-nota').isVisible()), 'calibre: link para capítulo NÃO abre balão');
    const t = await page.evaluate(() => atTopOrEnd('s1_cap2'));
    ok(t, 'calibre: link para capítulo rola até ele');
    await page.click('a[data-external]');
    ok(await page.evaluate(() => window.__calls.some((c) => c[0] === 'ext')), 'calibre: link externo pede confirmação ao app');
    ok(errors.length === 0, 'calibre: sem erros de JavaScript ' + errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(failures ? 1 : 0);
})();
