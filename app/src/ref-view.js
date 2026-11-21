/* Painel "Base para comparação": mostra um documento só para leitura ao lado do editor
 * (ou numa janela separada). Referências bíblicas no texto ficam clicáveis.
 */
(function () {
  'use strict';

  // Estilos dos esboços (S-34 etc.) em Word -> classes HTML
  const STYLE_MAP = [
    "p[style-name='JW Title With Number'] => h2.titulo:fresh",
    "p[style-name='JW Title'] => h2.titulo:fresh",
    "p[style-name='JW HEADING'] => h3:fresh",
    "p[style-name='JW HEADING VIDEO'] => h4:fresh",
    "p[style-name='JW Note'] => p.nota:fresh",
    "p[style-name='JW TOTAL TIME'] => p.tempo:fresh",
    "p[style-name='JW Copyright'] => p.copy:fresh",
    "p[style-name='JW Mnemonic'] => p.copy:fresh",
  ];
  for (let i = 0; i <= 6; i++) STYLE_MAP.push(`p[style-name='JW Indent ${i}'] => p.ind${i}:fresh`);

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function sanitize(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, button, textarea, select, base').forEach((n) => n.remove());
    d.body.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || n === 'contenteditable' || ((n === 'src' || n === 'href') && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      });
      if (el.tagName === 'A') el.removeAttribute('href'); // só leitura: nada de navegar
    });
    return d.body.innerHTML;
  }

  function textToHtml(t) {
    return String(t).replace(/\r\n?/g, '\n').split(/\n{2,}|\n/).map((l) => (l.trim() ? `<p>${esc(l)}</p>` : '')).join('');
  }

  /** Converte o arquivo aberto em conteúdo exibível: {title, kind:'html'|'pdf', html?, data?} */
  async function fromFile({ name, ext, data }) {
    ext = (ext || '').toLowerCase();
    const title = name.replace(/\.[^.]+$/, '');
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (ext === 'pdf') return { title, kind: 'pdf', data };
    if (ext === 'docx') {
      const r = await mammoth.convertToHtml({ arrayBuffer: ab }, { styleMap: STYLE_MAP });
      return { title, kind: 'html', html: sanitize(r.value) };
    }
    if (ext === 'epub') {
      const r = await Epub.importEpub(data);
      return { title: r.meta.title || title, kind: 'html', html: sanitize(r.html) };
    }
    const text = new TextDecoder('utf-8').decode(data);
    if (ext === 'html' || ext === 'htm') return { title, kind: 'html', html: sanitize(text) };
    return { title, kind: 'html', html: textToHtml(text) };
  }

  function fromClipboard({ html, text }) {
    if (html && html.trim()) return { title: 'Texto colado', kind: 'html', html: sanitize(html) };
    if (text && text.trim()) return { title: 'Texto colado', kind: 'html', html: textToHtml(text) };
    return null;
  }

  // ---- referências bíblicas clicáveis ----
  function markBible(root) {
    if (!window.Bible) return;
    const doc = root.ownerDocument;
    const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let n;
    while ((n = w.nextNode())) nodes.push(n);
    nodes.forEach((node) => {
      const refs = Bible.findRefs(node.data, true);
      for (let i = refs.length - 1; i >= 0; i--) {
        const r = doc.createRange();
        r.setStart(node, refs[i].start); r.setEnd(node, refs[i].end);
        const s = doc.createElement('span');
        s.className = 'bref';
        s.title = 'Clique para ver o versículo';
        r.surroundContents(s);
      }
    });
  }

  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  async function showVerse(span) {
    closePop();
    const doc = span.ownerDocument;
    pop = doc.createElement('div');
    pop.className = 'ref-pop';
    pop.innerHTML = '<div class="ref-pop-head"></div><div class="ref-pop-body">Buscando no jw.org…</div>';
    pop.querySelector('.ref-pop-head').textContent = span.textContent;
    const host = span.closest('.ref-body') || doc.body;
    host.appendChild(pop);
    const hr = host.getBoundingClientRect();
    const sr = span.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(sr.left - hr.left, hr.width - 380)) + 'px';
    pop.style.top = (sr.bottom - hr.top + host.scrollTop + 6) + 'px';
    const mine = pop;
    try {
      const ref = Bible.findRefs(span.textContent, true)[0];
      const note = await Bible.getNote(ref, { numbers: true });
      if (pop === mine) pop.querySelector('.ref-pop-body').textContent = note.replace(/\n[^\n]*$/, '');
    } catch (e) {
      if (pop === mine) pop.querySelector('.ref-pop-body').textContent = 'Não foi possível buscar o texto (verifique a internet).';
    }
  }

  /** Mostra o conteúdo dentro do elemento container. */
  function render(container, content) {
    closePop();
    if (container._pdfUrl) { URL.revokeObjectURL(container._pdfUrl); container._pdfUrl = null; }
    if (!content) {
      container.innerHTML = `<div class="ref-empty">
        <p><b>Base para comparação</b></p>
        <p>Abra aqui o material de base do discurso para ver lado a lado com o seu texto:</p>
        <ul><li><b>Abrir arquivo</b>: Word (.docx), PDF, EPUB ou TXT</li>
        <li><b>Colar</b>: copie o texto (ex.: do JW Library) e clique em Colar</li></ul>
        <p>Este painel é só para leitura e não entra no EPUB. Clique numa referência bíblica sublinhada para ver o versículo.</p></div>`;
      return;
    }
    if (content.kind === 'pdf') {
      const url = URL.createObjectURL(new Blob([content.data], { type: 'application/pdf' }));
      container._pdfUrl = url;
      container.innerHTML = `<iframe class="ref-pdf" src="${url}"></iframe>`;
      return;
    }
    container.innerHTML = '<div class="ref-doc"></div>';
    const docEl = container.firstChild;
    docEl.innerHTML = content.html;
    markBible(docEl);
  }

  function attach(container) {
    container.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.bref');
      if (b) { e.stopPropagation(); showVerse(b); return; }
      if (pop && !pop.contains(e.target)) closePop();
    });
    container.ownerDocument.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  }

  window.RefView = { fromFile, fromClipboard, render, attach };
})();
