/* Leitor de Discursos — comportamento da página de leitura (roda dentro da WebView). */
(function () {
  'use strict';

  var bridge = window.Leitor || {
    onPosition: function () {}, onProgress: function () {}, toggleUi: function () {}, openExternal: function () {}, onReady: function () {}
  };
  var content = document.getElementById('content');
  var BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,img,table,pre,dd,dt,figure,hr';
  var blocks = Array.prototype.slice.call(content.querySelectorAll(BLOCKS));

  // ---------------- anotações ----------------

  function epubType(el) {
    return (el && el.getAttribute && (el.getAttribute('epub:type') || el.getAttribute('role') || '')) || '';
  }
  function hasClass(el, re) { return !!(el && typeof el.className === 'string' && re.test(el.className)); }

  var NOTE_TYPE = /(^|\s|-)(foot|end|rear)?notes?(\s|$)|doc-(foot|end)note|doc-endnotes/i;
  var NOTE_CLASS = /(^|\s)(nota|notas|footnotes?|endnotes?|fn|note|notes|rearnotes?)(\s|$)/i;
  var REF_CLASS = /(^|\s)(noteref|footnote-?ref|fnref|nota-?ref)(\s|$)/i;
  var BACK_TEXT = /^\s*[↩↑⤴^]?\s*(voltar|back|return)?\s*[↩↑⤴]?\s*$/i;

  /** Decide se o link [a] aponta para uma nota (e não para um capítulo/título). */
  function isNoteLink(a, target) {
    if (!target) return false;
    if (/^H[1-6]$/.test(target.tagName) || target.tagName === 'SECTION' && hasClass(target, /epub-sec/)) return false;
    if (/noteref/i.test(epubType(a)) || hasClass(a, REF_CLASS)) return true;
    if (NOTE_TYPE.test(epubType(target)) || hasClass(target, NOTE_CLASS)) return true;
    var anc = target.closest('aside, .footnotes, .endnotes, .notes, .notas, [epub\\:type~="footnotes"], [epub\\:type~="endnotes"], [epub\\:type~="rearnotes"]');
    if (anc) return true;
    // A nota tem um link de volta para esta chamada (padrão fn1/r1 do Calibre e do Criador de EPUB).
    if (a.id && target.parentNode) {
      var host = noteBlock(target);
      if (host.querySelector('a[href="#' + cssEscape(a.id) + '"]')) return true;
    }
    if (a.closest('sup') || (a.firstElementChild && a.firstElementChild.tagName === 'SUP')) return true;
    return false;
  }

  /** Bloco que contém o texto da nota (o alvo pode ser só uma âncora dentro do parágrafo). */
  function noteBlock(target) {
    if (/^(A|SPAN|SUP|B|I|EM|STRONG)$/.test(target.tagName)) {
      var b = target.closest('p, li, aside, div, dd, blockquote');
      if (b && b !== content) return b;
    }
    return target;
  }

  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\#.:\[\]]/g, '\\$&');
  }

  var fundo, painel, corpo, tituloEl, ativo = null;
  var notaPosicao = 'centro';   // baixo | centro | movel
  var posMovel = null;          // última posição do balão móvel {left, top}

  function buildPanel() {
    fundo = document.createElement('div');
    fundo.id = 'leitor-nota-fundo';
    painel = document.createElement('div');
    painel.id = 'leitor-nota';
    painel.setAttribute('role', 'dialog');
    var topo = document.createElement('div');
    topo.className = 'leitor-nota-topo';
    var titulo = document.createElement('span');
    titulo.className = 'leitor-nota-titulo';
    titulo.textContent = 'Nota';
    tituloEl = titulo;
    var alca = document.createElement('span');
    alca.className = 'leitor-nota-alca';
    alca.textContent = '⠿';
    alca.setAttribute('aria-hidden', 'true');
    var fechar = document.createElement('button');
    fechar.className = 'leitor-nota-fechar';
    fechar.setAttribute('aria-label', 'Fechar');
    fechar.textContent = '×';
    fechar.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeNote(); });
    topo.appendChild(alca);
    topo.appendChild(titulo);
    topo.appendChild(fechar);
    ativarArrastar(topo);
    corpo = document.createElement('div');
    corpo.className = 'leitor-nota-corpo';
    painel.appendChild(topo);
    painel.appendChild(corpo);
    document.body.appendChild(fundo);
    document.body.appendChild(painel);
    fundo.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeNote(); });
  }

  function showNote(a, target) {
    var block = noteBlock(target);
    var clone = block.cloneNode(true);
    // remove o link de volta (↩) e ids duplicados
    var links = clone.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      var h = l.getAttribute('href') || '';
      if ((a.id && h === '#' + a.id) || BACK_TEXT.test(l.textContent)) l.parentNode.removeChild(l);
    }
    if (clone.removeAttribute) clone.removeAttribute('id');
    var withId = clone.querySelectorAll('[id]');
    for (var j = 0; j < withId.length; j++) withId[j].removeAttribute('id');
    // Se o próprio bloco for uma lista/aside, mostra o conteúdo inteiro.
    corpo.innerHTML = '';
    if (clone.tagName === 'LI') {
      while (clone.firstChild) corpo.appendChild(clone.firstChild);
    } else {
      corpo.appendChild(clone);
    }
    tituloEl.textContent = tituloDaNota(a);
    if (ativo) ativo.classList.remove('leitor-nota-ativa');
    ativo = a;
    a.classList.add('leitor-nota-ativa');
    fundo.classList.add('aberto');
    painel.classList.add('aberto');
    painel.scrollTop = 0;
    posicionarPainel();
  }

  /** Título do balão = o texto que foi tocado (ex.: "Isaías 25:8"). Se for só um número, "Nota 1". */
  function tituloDaNota(a) {
    var t = (a.textContent || '').replace(/\s+/g, ' ').trim();
    var num = t.replace(/^[\[\(]+|[\]\)]+$/g, '');
    if (!t) return 'Nota';
    if (/^[0-9]+[a-z]?$|^[*†‡§]+$/i.test(num)) return 'Nota ' + num;
    return t.length > 80 ? t.slice(0, 77) + '…' : t;
  }

  function posicionarPainel() {
    painel.classList.remove('pos-baixo', 'pos-centro', 'pos-movel');
    painel.classList.add('pos-' + notaPosicao);
    fundo.classList.toggle('leve', notaPosicao === 'movel');
    painel.style.left = painel.style.top = '';
    if (notaPosicao === 'movel' && posMovel) {
      var r = painel.getBoundingClientRect();
      painel.style.left = limitar(posMovel.left, 0, window.innerWidth - r.width) + 'px';
      painel.style.top = limitar(posMovel.top, 0, window.innerHeight - Math.min(r.height, 60)) + 'px';
      painel.classList.add('arrastado');
    } else {
      painel.classList.remove('arrastado');
    }
  }

  function limitar(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /** No modo "móvel", o balão é arrastado pela barra de título. */
  function ativarArrastar(alvo) {
    var ini = null;
    alvo.addEventListener('pointerdown', function (e) {
      if (notaPosicao !== 'movel' || e.target.closest('.leitor-nota-fechar')) return;
      var r = painel.getBoundingClientRect();
      ini = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      painel.style.left = r.left + 'px';
      painel.style.top = r.top + 'px';
      painel.classList.add('arrastado', 'arrastando');
      try { alvo.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    alvo.addEventListener('pointermove', function (e) {
      if (!ini) return;
      var r = painel.getBoundingClientRect();
      var left = limitar(ini.left + e.clientX - ini.x, 0, window.innerWidth - r.width);
      var top = limitar(ini.top + e.clientY - ini.y, 0, window.innerHeight - 60);
      painel.style.left = left + 'px';
      painel.style.top = top + 'px';
      posMovel = { left: left, top: top };
    });
    function fim() { ini = null; painel.classList.remove('arrastando'); }
    alvo.addEventListener('pointerup', fim);
    alvo.addEventListener('pointercancel', fim);
  }

  function closeNote() {
    if (fundo) fundo.classList.remove('aberto');
    if (painel) painel.classList.remove('aberto');
    if (ativo) { ativo.classList.remove('leitor-nota-ativa'); ativo = null; }
  }

  function isNoteOpen() { return painel && painel.classList.contains('aberto'); }

  function scrollToEl(el) {
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.pageYOffset - 12;
    window.scrollTo(0, Math.max(0, y));
    schedulePosition();
  }

  function findTarget(href) {
    if (!href || href.charAt(0) !== '#') return null;
    var id = href.slice(1);
    try { id = decodeURIComponent(id); } catch (e) {}
    return document.getElementById(id);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    var insidePanel = painel && painel.contains(e.target);
    if (marcador && marcador.contains(e.target)) return;      // botões da barra de marcação
    if (marcadorAberto()) { fecharMarcador(); if (!a) { e.preventDefault(); return; } }

    if (a && a.getAttribute('data-external')) {
      e.preventDefault();
      bridge.openExternal(a.getAttribute('href'));
      return;
    }
    if (a && a.getAttribute('href')) {
      var href = a.getAttribute('href');
      var target = findTarget(href);
      e.preventDefault();
      if (!target) return;
      if (insidePanel) {
        // link dentro da nota: outra nota → troca o conteúdo; senão fecha e vai até lá
        if (isNoteLink(a, target)) { showNote(a, target); } else { closeNote(); scrollToEl(target); }
        return;
      }
      if (isNoteLink(a, target)) showNote(a, target); else scrollToEl(target);
      return;
    }
    if (insidePanel) return;
    if (isNoteOpen()) { closeNote(); return; }
    var sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 0) return;
    var lm = e.target.closest ? e.target.closest('.lm') : null;
    if (lm) { editarMarca(lm.getAttribute('data-mid'), lm); return; }
    bridge.toggleUi();
  }, true);

  // marca visualmente as chamadas de nota
  (function markRefs() {
    var as = content.querySelectorAll('a[href^="#"]');
    for (var i = 0; i < as.length; i++) {
      var t = findTarget(as[i].getAttribute('href'));
      if (t && isNoteLink(as[i], t)) as[i].classList.add('leitor-nota-ref');
    }
  })();

  // ---------------- posição de leitura ----------------

  function currentIndex() {
    // primeiro bloco cujo fim ainda está visível no topo da tela
    var lo = 0, hi = blocks.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var r = blocks[mid].getBoundingClientRect();
      if (r.bottom > 1) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
    }
    return ans;
  }

  /** Quanto (0 a 1) do bloco atual já passou do topo da tela — para restaurar com precisão. */
  function inBlock(index) {
    if (index < 0) return 0;
    var r = blocks[index].getBoundingClientRect();
    return r.height > 0 ? Math.min(1, Math.max(0, -r.top / r.height)) : 0;
  }

  /** Porcentagem lida (0–100), pelo fim da área visível em relação ao texto todo. */
  function percent() {
    var end = content.getBoundingClientRect().bottom + window.pageYOffset;
    var start = content.getBoundingClientRect().top + window.pageYOffset;
    var seen = window.pageYOffset + window.innerHeight - start;
    var total = end - start;
    if (total <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round(100 * seen / total)));
  }

  var posTimer = null;
  function schedulePosition() {
    if (posTimer) clearTimeout(posTimer);
    posTimer = setTimeout(function () {
      posTimer = null;
      var i = currentIndex();
      bridge.onPosition(i, inBlock(i));
      if (bridge.onProgress) bridge.onProgress(percent());
    }, 350);
  }
  window.addEventListener('scroll', schedulePosition, { passive: true });

  var mark = -1, markPart = 0;

  // ---------------- aparência (painel "Aa") ----------------

  var FONTES = {
    serifada: 'Georgia, "Noto Serif", "Times New Roman", serif',
    'sem-serifa': 'Roboto, "Noto Sans", Arial, sans-serif',
    'leitura-facil': '"Atkinson Hyperlegible", Roboto, sans-serif',
    mono: '"Roboto Mono", "Noto Sans Mono", "Courier New", monospace'
  };

  // Classifica uma vez os parágrafos de texto corrido (alinhados à esquerda/justificados no livro),
  // para que "justificar" e "recuo" não mexam em títulos, imagens ou linhas centralizadas.
  (function classify() {
    var els = content.querySelectorAll('p, li, dd, blockquote');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var al = getComputedStyle(el).textAlign;
      if (!/^(start|left|justify|-webkit-auto|auto)$/.test(al)) continue;
      if (!el.textContent.trim() || el.querySelector('img, svg, image')) continue;
      el.classList.add('lt-texto');
    }
  })();

  function hexToRgb(h) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
    return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
  }
  function translucida(hex, alfa) {
    var c = hexToRgb(hex);
    return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + alfa + ')';
  }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }

  /** Gera a textura (ruído SVG, feito por código) como imagem de fundo em mosaico. */
  function textureUrl(t) {
    if (!t || !t.camadas || !t.camadas.length) return 'none';
    var size = num(t.tamanho, 300);
    var defs = '', rects = '';
    t.camadas.forEach(function (c, i) {
      var rgb = hexToRgb(c.cor);
      var op = num(c.opacidade, 0.2), k = num(c.contraste, 1);
      var tipo = c.tipo === 'turbulence' ? 'turbulence' : 'fractalNoise';
      defs += "<filter id='f" + i + "' x='0' y='0' width='100%' height='100%'>" +
        "<feTurbulence type='" + tipo + "' baseFrequency='" + String(c.freq || '0.05').replace(/[^0-9. ]/g, '') +
        "' numOctaves='" + Math.max(1, Math.min(6, num(c.oitavas, 2))) + "' seed='" + (i * 7 + 3) + "' stitchTiles='stitch'/>" +
        "<feColorMatrix type='matrix' values='0 0 0 0 " + rgb[0].toFixed(3) + " 0 0 0 0 " + rgb[1].toFixed(3) +
        " 0 0 0 0 " + rgb[2].toFixed(3) + " 0 0 0 " + (op * k).toFixed(3) + " " + (op * (1 - k) * 0.5).toFixed(3) + "'/></filter>";
      rects += "<rect width='100%' height='100%' filter='url(#f" + i + ")'/>";
    });
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + size + "' height='" + size + "'>" + defs + rects + "</svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  var vinheta = null;

  /** Aplica tema, fonte, margens e espaçamentos (sobrescrevendo o CSS do livro). */
  function applyAppearance(a) {
    a = a || {};
    var t = a.tema || {};
    var css = ':root{--bg:' + (t.fundo || '#fff') + ';--fg:' + (t.texto || '#1b1b1b') + ';--link:' + (t.link || '#0b57d0') +
      ';--panel-bg:' + (t.popupFundo || t.fundo || '#fff') + ';--panel-border:' + (t.popupBorda || '#c9c9c9') + ';}';
    css += 'html{background-color:var(--bg)!important;background-image:' + textureUrl(t.textura) + '!important;background-repeat:repeat!important}';
    css += 'body{color:var(--fg)!important}';
    css += '#content,#content *{color:var(--fg)!important;background-color:transparent!important;border-color:var(--panel-border)!important}';
    css += '#content a[href]{color:var(--link)!important}';
    if (t.escuro) css += '#content img{filter:brightness(0.88)}';
    if (t.escuro) {
      // cores da letra mais claras para continuarem legíveis no fundo escuro
      css += '#content .lm.lm-c-vermelho,#leitor-marcador .lm-c-vermelho{color:#FF8A80!important}' +
        '#content .lm.lm-c-azul,#leitor-marcador .lm-c-azul{color:#82B1FF!important}' +
        '#content .lm.lm-c-verde,#leitor-marcador .lm-c-verde{color:#B9F6CA!important}' +
        '#content .lm.lm-c-roxo,#leitor-marcador .lm-c-roxo{color:#EA80FC!important}';
    }

    // destaque das anotações (chamadas de nota): cor e estilo escolhidos no painel Aa
    var COR_NOTA = { vermelho: ['#C62828', '#FF8A80'], azul: ['#1565C0', '#82B1FF'], verde: ['#2E7D32', '#9CE6A8'],
      roxo: ['#6A1B9A', '#EA80FC'], laranja: ['#B45309', '#FFB74D'] };
    var cn = COR_NOTA[a.notaCor] ? COR_NOTA[a.notaCor][t.escuro ? 1 : 0] : 'var(--link)';
    var sel = '#content a.leitor-nota-ref';
    css += sel + '{color:' + cn + '!important;border-bottom-color:' + cn + '!important}';
    if (a.notaEstilo === 'fundo') {
      css += sel + '{border-bottom:0!important;background-color:' + translucida(cn === 'var(--link)' ? (t.link || '#0b57d0') : cn, 0.18) + '!important;border-radius:5px;padding:0 3px}';
    } else if (a.notaEstilo === 'negrito') {
      css += sel + ',' + sel + ' *{font-weight:700!important}' + sel + '{border-bottom-width:2px!important;border-bottom-style:solid!important}';
    } else if (a.notaEstilo === 'sublinhado') {
      css += sel + '{border-bottom-style:solid!important}';
    }

    var f = FONTES[a.fonte];
    if (f) css += 'body,#content,#content *:not(code):not(pre):not(kbd):not(samp),#leitor-nota,#leitor-nota *{font-family:' + f + '!important}';

    var ml = num(a.margemLateral, 5), mv = num(a.margemVertical, 2);
    css += 'body{padding-left:calc(12px + ' + ml + '%)!important;padding-right:calc(12px + ' + ml + '%)!important;' +
      'padding-top:calc(16px + ' + mv + '%)!important;padding-bottom:calc(60vh + ' + mv + '%)!important}';
    css += '#content{letter-spacing:' + num(a.letras, 0) + 'em}';
    css += '#content :is(p,li,div,blockquote,dd,dt,td,span,a){line-height:' + num(a.linhas, 1.6) + '!important}';

    if (a.paragrafo !== undefined && a.paragrafo !== null && a.paragrafo !== 'original') {
      css += '#content p{margin-top:0!important;margin-bottom:' + num(a.paragrafo, 0.8) + 'em!important}';
    }
    if (a.recuo !== undefined && a.recuo !== null && a.recuo !== 'original') {
      css += '#content p.lt-texto{text-indent:' + num(a.recuo, 0) + 'em!important}';
    }
    if (a.alinhamento === 'justificado') css += '#content .lt-texto{text-align:justify!important;hyphens:auto}';
    else if (a.alinhamento === 'esquerda') css += '#content .lt-texto{text-align:left!important}';

    if (/^(baixo|centro|movel)$/.test(a.notaPosicao || '')) notaPosicao = a.notaPosicao;
    if (painel && painel.classList.contains('aberto')) posicionarPainel();

    var st = document.getElementById('leitor-aparencia');
    if (!st) {
      st = document.createElement('style');
      st.id = 'leitor-aparencia';
      document.head.appendChild(st);
    }
    st.textContent = css;

    if (!vinheta) {
      vinheta = document.createElement('div');
      vinheta.id = 'leitor-vinheta';
      document.body.insertBefore(vinheta, document.body.firstChild);
    }
    var v = t.textura ? num(t.textura.vinheta, 0) : 0;
    if (v > 0) {
      vinheta.style.display = 'block';
      vinheta.style.background = 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(70,45,10,' + (v * 0.55).toFixed(3) + ') 100%)';
    } else {
      vinheta.style.display = 'none';
    }
  }

  // ---------------- marcações (marca-texto, cor da letra, negrito, sublinhado) ----------------
  // Cada marca guarda o trecho e um pouco do texto antes/depois, para ser reencontrada
  // mesmo quando o discurso é atualizado no PC (o EPUB muda, mas o trecho continua lá).

  var FUNDOS = ['amarelo', 'verde', 'azul', 'rosa', 'laranja', 'roxo'];
  var CORES = ['vermelho', 'azul', 'verde', 'roxo'];
  var CTX = 40; // caracteres de contexto guardados antes/depois
  var marcas = [];
  try { marcas = Array.isArray(window.LEITOR_MARCAS) ? window.LEITOR_MARCAS : []; } catch (e0) { marcas = []; }
  var marcador = null, selInfo = null, marcaEmEdicao = null;

  /** Texto corrido do discurso + mapa de onde está cada pedaço (nós de texto). */
  function indiceTexto() {
    var nodes = [], starts = [], full = '';
    var w = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = w.nextNode())) {
      nodes.push(n); starts.push(full.length); full += n.nodeValue;
    }
    return { nodes: nodes, starts: starts, full: full };
  }

  /** Converte um ponto da seleção (nó + deslocamento) em posição no texto corrido. */
  function offsetDe(idx, node, off) {
    if (node.nodeType === 3) {
      var i = idx.nodes.indexOf(node);
      return i < 0 ? -1 : idx.starts[i] + off;
    }
    var k;
    if (off < node.childNodes.length) {
      // ponto antes de um filho: início do primeiro texto a partir dele
      var alvo = node.childNodes[off];
      for (k = 0; k < idx.nodes.length; k++) {
        var t = idx.nodes[k];
        if (t === alvo || (alvo.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)) return idx.starts[k];
      }
      return idx.full.length;
    }
    // ponto depois do último filho: fim do último texto dentro do elemento
    for (k = idx.nodes.length - 1; k >= 0; k--) {
      if (node.contains(idx.nodes[k])) return idx.starts[k] + idx.nodes[k].nodeValue.length;
    }
    for (k = 0; k < idx.nodes.length; k++) {
      if (node.compareDocumentPosition(idx.nodes[k]) & Node.DOCUMENT_POSITION_FOLLOWING) return idx.starts[k];
    }
    return idx.full.length;
  }

  /** Acha a posição do trecho da marca no texto atual (usando o contexto antes/depois). */
  function localizar(idx, m) {
    var full = idx.full, t = m.texto;
    if (!t) return -1;
    var melhor = -1, nota = -1, i = full.indexOf(t);
    while (i >= 0) {
      var pts = 0;
      if (m.antes && full.slice(Math.max(0, i - m.antes.length), i) === m.antes) pts += 2;
      if (m.depois && full.slice(i + t.length, i + t.length + m.depois.length) === m.depois) pts += 2;
      pts -= Math.abs(i - (m.pos || 0)) / 1e7; // desempate: mais perto da posição antiga
      if (pts > nota) { nota = pts; melhor = i; }
      i = full.indexOf(t, i + 1);
    }
    return melhor;
  }

  /** Envolve o trecho [ini, fim) em <span class="lm ..."> (um por nó de texto). */
  function envolver(idx, ini, fim, m) {
    for (var k = 0; k < idx.nodes.length; k++) {
      var node = idx.nodes[k], a = idx.starts[k], b = a + node.nodeValue.length;
      if (b <= ini || a >= fim || !node.parentNode) continue;
      if (node.parentNode.closest && node.parentNode.closest('#leitor-nota, #leitor-marcador')) continue;
      var s0 = Math.max(ini, a) - a, s1 = Math.min(fim, b) - a;
      if (!node.nodeValue.slice(s0, s1).trim() && s1 - s0 < 2) continue;
      var meio = node;
      if (s0 > 0) meio = node.splitText(s0);
      if (s1 - s0 < meio.nodeValue.length) meio.splitText(s1 - s0);
      var span = document.createElement('span');
      span.className = classesDe(m);
      span.setAttribute('data-mid', m.id);
      meio.parentNode.insertBefore(span, meio);
      span.appendChild(meio);
    }
  }

  function classesDe(m) {
    var c = 'lm';
    if (m.fundo) c += ' lm-f-' + m.fundo;
    if (m.cor) c += ' lm-c-' + m.cor;
    if (m.sublinhado) c += ' lm-s';
    if (m.negrito) c += ' lm-b';
    return c;
  }

  function desembrulhar(id) {
    var spans = content.querySelectorAll('span.lm[data-mid="' + id + '"]');
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i], pai = sp.parentNode;
      while (sp.firstChild) pai.insertBefore(sp.firstChild, sp);
      pai.removeChild(sp);
      pai.normalize();
    }
  }

  function aplicarTodas() {
    marcas.forEach(function (m) {
      var idx = indiceTexto();
      var i = localizar(idx, m);
      m.achada = i >= 0;
      if (i >= 0) { m.pos = i; envolver(idx, i, i + m.texto.length, m); }
    });
  }

  function salvar() {
    var limpo = marcas.map(function (m) {
      return { id: m.id, texto: m.texto, antes: m.antes, depois: m.depois, pos: m.pos, fundo: m.fundo || null,
        cor: m.cor || null, sublinhado: !!m.sublinhado, negrito: !!m.negrito, criada: m.criada };
    });
    if (bridge.salvarMarcas) bridge.salvarMarcas(JSON.stringify(limpo));
  }

  // ---- barra flutuante de marcação ----

  function criarMarcador() {
    marcador = document.createElement('div');
    marcador.id = 'leitor-marcador';
    var html = '<div class="lmk-linha">';
    FUNDOS.forEach(function (f) { html += '<button class="lmk-f lm-f-' + f + '" data-fundo="' + f + '" aria-label="Marca-texto ' + f + '"></button>'; });
    html += '</div><div class="lmk-linha">';
    CORES.forEach(function (c) { html += '<button class="lmk-c lm-c-' + c + '" data-cor="' + c + '" aria-label="Letra ' + c + '">A</button>'; });
    html += '<button class="lmk-b" data-acao="negrito" aria-label="Negrito"><b>B</b></button>' +
      '<button class="lmk-s" data-acao="sublinhado" aria-label="Sublinhado"><u>S</u></button>' +
      '<button class="lmk-x" data-acao="remover" aria-label="Remover marcação">🗑</button></div>';
    marcador.innerHTML = html;
    // não deixa o toque nos botões desfazer a seleção do texto
    marcador.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    marcador.addEventListener('mousedown', function (e) { e.preventDefault(); });
    marcador.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      if (b.getAttribute('data-fundo')) aplicarEstilo({ fundo: b.getAttribute('data-fundo') });
      else if (b.getAttribute('data-cor')) aplicarEstilo({ cor: b.getAttribute('data-cor') });
      else if (b.getAttribute('data-acao') === 'negrito') aplicarEstilo({ negrito: true });
      else if (b.getAttribute('data-acao') === 'sublinhado') aplicarEstilo({ sublinhado: true });
      else if (b.getAttribute('data-acao') === 'remover') removerMarcacao();
    });
    document.body.appendChild(marcador);
  }

  function marcadorAberto() { return marcador && marcador.classList.contains('aberto'); }
  function fecharMarcador() { if (marcador) marcador.classList.remove('aberto'); selInfo = null; marcaEmEdicao = null; }

  function mostrarMarcador(rect, edicao) {
    if (!marcador) criarMarcador();
    marcador.classList.toggle('edicao', !!edicao);
    marcador.classList.add('aberto');
    var mw = marcador.offsetWidth, mh = marcador.offsetHeight;
    var left = Math.max(8, Math.min(window.innerWidth - mw - 8, rect.left + rect.width / 2 - mw / 2));
    // embaixo da seleção (o menu do Android costuma ficar em cima); se não couber, em cima
    var top = rect.bottom + 14;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 14);
    marcador.style.left = left + 'px';
    marcador.style.top = top + 'px';
  }

  function lerSelecao() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (!content.contains(r.commonAncestorContainer)) return null;
    var idx = indiceTexto();
    var ini = offsetDe(idx, r.startContainer, r.startOffset), fim = offsetDe(idx, r.endContainer, r.endOffset);
    if (ini < 0 || fim <= ini) return null;
    // tira espaços das pontas
    while (ini < fim && /\s/.test(idx.full[ini])) ini++;
    while (fim > ini && /\s/.test(idx.full[fim - 1])) fim--;
    if (fim <= ini) return null;
    return { ini: ini, fim: fim, full: idx.full, rect: r.getBoundingClientRect() };
  }

  var selTimer = null;
  document.addEventListener('selectionchange', function () {
    if (selTimer) clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      var info = lerSelecao();
      if (info) { selInfo = info; marcaEmEdicao = null; mostrarMarcador(info.rect, false); }
      else if (!marcaEmEdicao && marcadorAberto()) fecharMarcador();
    }, 250);
  });

  function novaId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function aplicarEstilo(estilo) {
    if (marcaEmEdicao) {
      var m0 = marcas.filter(function (x) { return x.id === marcaEmEdicao; })[0];
      if (m0) {
        if (estilo.fundo) m0.fundo = m0.fundo === estilo.fundo ? null : estilo.fundo;
        if (estilo.cor) m0.cor = m0.cor === estilo.cor ? null : estilo.cor;
        if (estilo.negrito) m0.negrito = !m0.negrito;
        if (estilo.sublinhado) m0.sublinhado = !m0.sublinhado;
        if (!m0.fundo && !m0.cor && !m0.negrito && !m0.sublinhado) { removerPorId(m0.id); }
        else {
          var spans = content.querySelectorAll('span.lm[data-mid="' + m0.id + '"]');
          for (var i = 0; i < spans.length; i++) spans[i].className = classesDe(m0);
        }
        salvar();
      }
      fecharMarcador();
      return;
    }
    if (!selInfo) return;
    var t = selInfo.full.slice(selInfo.ini, selInfo.fim);
    var m = {
      id: novaId(), texto: t,
      antes: selInfo.full.slice(Math.max(0, selInfo.ini - CTX), selInfo.ini),
      depois: selInfo.full.slice(selInfo.fim, selInfo.fim + CTX),
      pos: selInfo.ini, fundo: estilo.fundo || null, cor: estilo.cor || null,
      negrito: !!estilo.negrito, sublinhado: !!estilo.sublinhado, criada: Date.now(), achada: true
    };
    envolver(indiceTexto(), selInfo.ini, selInfo.fim, m);
    marcas.push(m);
    salvar();
    window.getSelection().removeAllRanges();
    fecharMarcador();
  }

  function removerPorId(id) {
    desembrulhar(id);
    marcas = marcas.filter(function (x) { return x.id !== id; });
  }

  /** Remove as marcas que tocam no trecho selecionado (ou a marca em edição). */
  function removerMarcacao() {
    if (marcaEmEdicao) { removerPorId(marcaEmEdicao); }
    else if (selInfo) {
      var ids = {};
      var r = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
      if (r) {
        var spans = content.querySelectorAll('span.lm');
        for (var i = 0; i < spans.length; i++) if (r.intersectsNode(spans[i])) ids[spans[i].getAttribute('data-mid')] = 1;
      }
      Object.keys(ids).forEach(removerPorId);
      window.getSelection().removeAllRanges();
    }
    salvar();
    fecharMarcador();
  }

  /** Tocar numa marca abre a barra para mudar a cor ou remover. */
  function editarMarca(id, el) {
    marcaEmEdicao = id;
    selInfo = null;
    mostrarMarcador(el.getBoundingClientRect(), true);
  }

  window.leitor = {
    applyAppearance: function (a) { window.leitor.mark(); applyAppearance(a); window.leitor.backToMark(); },
    goTo: function (anchor) {
      closeNote();
      scrollToEl(document.getElementById(anchor));
    },
    restore: function (index, part) {
      if (index >= 0 && index < blocks.length) {
        var r = blocks[index].getBoundingClientRect();
        var off = (part > 0 && part <= 1) ? part * r.height : -4;
        window.scrollTo(0, Math.max(0, r.top + window.pageYOffset + off));
      }
    },
    mark: function () { mark = currentIndex(); markPart = inBlock(mark); },
    backToMark: function () { if (mark >= 0) window.leitor.restore(mark, markPart); schedulePosition(); },
    closeNote: function () { var o = isNoteOpen(); closeNote(); return o; },
    isNoteOpen: function () { return !!isNoteOpen(); },
    listarMarcas: function () {
      return JSON.stringify(marcas.map(function (m) {
        return { id: m.id, texto: m.texto, fundo: m.fundo, cor: m.cor, achada: m.achada !== false };
      }));
    },
    irParaMarca: function (id) {
      closeNote();
      var sp = content.querySelector('span.lm[data-mid="' + id + '"]');
      if (sp) {
        var y = sp.getBoundingClientRect().top + window.pageYOffset - window.innerHeight / 3;
        window.scrollTo(0, Math.max(0, y));
        sp.classList.add('lm-piscar');
        setTimeout(function () { sp.classList.remove('lm-piscar'); }, 1600);
        schedulePosition();
      }
    },
    apagarMarca: function (id) { removerPorId(id); salvar(); },
    apagarTodasMarcas: function () { marcas.slice().forEach(function (m) { desembrulhar(m.id); }); marcas = []; salvar(); },
    _isNoteLink: isNoteLink,
    _rescan: function () { blocks = Array.prototype.slice.call(content.querySelectorAll(BLOCKS)); },
    _textureUrl: textureUrl
  };

  // aparência inicial (enviada pelo app dentro da página) para não "piscar" com as cores erradas
  applyAppearance(window.LEITOR_APARENCIA || {});
  aplicarTodas();
  window.leitor._rescan();

  buildPanel();
  // só restaura a posição depois que as imagens carregarem (elas mudam a altura da página)
  function ready() { bridge.onReady(); schedulePosition(); }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready);
})();
