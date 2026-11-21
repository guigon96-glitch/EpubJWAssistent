(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.api || {
    // permite testar no navegador fora do Electron
    openEpub: async () => null, saveEpub: async () => null, confirm: async (m, b) => (window.confirm(m) ? 0 : b.length - 1),
    showInFolder: async () => {}, setDirty() {}, setTitle(t) { document.title = t; }, closeNow() {}, onSaveAndClose() {},
  };

  const NOVO_META = () => ({
    title: '', author: '', publisher: '', description: '', language: 'pt-BR',
    notesTitle: 'Notas', category: '', cover: null, uuid: Epub.uuid(),
  });

  // loc = onde o EPUB está: { source: 'drive'|'local'|'file', id, catId, catName }
  const state = { meta: NOVO_META(), loc: null, dirty: false };
  let editor = null;
  let loading = true; // ignora os eventos do editor até ele terminar de carregar

  // ---------- título / estado ----------
  function fileName() {
    const t = state.meta.title || 'Sem título';
    const L = state.loc;
    if (!L) return t;
    if (L.source === 'file') return L.id.split(/[\\/]/).pop();
    return `${t} · ${L.catName || ''}${L.source === 'drive' ? ' (Google Drive)' : ''}`;
  }
  function refreshTitle() { api.setTitle(`${state.dirty ? '● ' : ''}${fileName()} — Criador de EPUB`); }
  function setDirty(v) {
    if (loading) return;
    state.dirty = v; api.setDirty(v); refreshTitle();
  }
  function status(msg, ms = 4000) {
    const el = $('status'); el.textContent = msg;
    clearTimeout(status.t); if (ms) status.t = setTimeout(() => { el.textContent = ''; }, ms);
  }

  // ---------- rascunho automático ----------
  const DRAFT_KEY = 'criador-epub-rascunho';
  let draftTimer = null;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ meta: state.meta, html: editor.getContent(), loc: state.loc, t: Date.now() })); } catch (e) { /* imagens grandes podem exceder o limite */ }
    }, 3000);
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  // ---------- anotações ----------
  const BLOCK_RE = /<(p|h[1-6]|li|ul|ol|div|table|tr|td|th|blockquote|figure|pre)\b/i;

  function noteDialog({ title, ref, note, askRef, onOk }) {
    const items = [];
    if (askRef) items.push({ type: 'input', name: 'ref', label: 'Texto que aparece no documento (ex.: Isaías 25:8)' });
    else items.push({ type: 'htmlpanel', html: `<div style="margin-bottom:6px;color:#444">Referência: <b>${Epub.esc(ref)}</b></div>` });
    items.push({ type: 'textarea', name: 'note', label: 'Texto da anotação', maximized: false });
    const dlg = editor.windowManager.open({
      title,
      size: 'medium',
      body: { type: 'panel', items },
      initialData: { ref: ref || '', note: note || '' },
      buttons: [
        { type: 'cancel', text: 'Cancelar' },
        { type: 'submit', text: 'Salvar', primary: true },
      ],
      onSubmit(api2) {
        const d = api2.getData();
        if (!d.note.trim()) { editor.notificationManager.open({ text: 'Escreva o texto da anotação.', type: 'warning', timeout: 2500 }); return; }
        if (askRef && !d.ref.trim()) { editor.notificationManager.open({ text: 'Escreva o texto que aparece no documento.', type: 'warning', timeout: 2500 }); return; }
        api2.close();
        onOk(d);
      },
    });
    // foca a área de texto da nota
    setTimeout(() => {
      const ta = document.querySelector('.tox-dialog textarea');
      if (ta && !askRef) { ta.focus(); }
      if (ta) ta.style.minHeight = '160px';
    }, 50);
    return dlg;
  }

  function currentNoteRef(node) {
    return editor.dom.getParent(node || editor.selection.getNode(), 'a.noteref');
  }

  function addNote() {
    const existing = currentNoteRef();
    if (existing) return editNote(existing);
    const collapsed = editor.selection.isCollapsed();
    const bookmark = editor.selection.getBookmark(2, true);
    let html = collapsed ? '' : editor.selection.getContent();
    const text = collapsed ? '' : editor.selection.getContent({ format: 'text' }).replace(/\s+/g, ' ').trim();
    if (!collapsed && !text) { status('Selecione um texto para anotar.'); return; }
    if (BLOCK_RE.test(html)) html = Epub.esc(text);
    html = html.replace(/<\/?a\b[^>]*>/gi, '');
    const dlg = noteDialog({
      title: 'Adicionar anotação',
      ref: text,
      askRef: collapsed,
      onOk: ({ ref, note }) => {
        editor.focus();
        editor.selection.moveToBookmark(bookmark);
        const inner = collapsed ? Epub.esc(ref.trim()) : html;
        const n = note.trim();
        editor.undoManager.transact(() => {
          editor.selection.setContent(`<a class="noteref" href="#nota" data-note="${Epub.esc(n)}" title="${Epub.esc(n)}">${inner}</a>${collapsed ? '&nbsp;' : ''}`);
        });
        editor.nodeChanged();
        setDirty(true); refreshNotes();
        status('Anotação adicionada.');
      },
    });
    // Se o texto selecionado é uma referência bíblica, já preenche com o versículo
    const refs = text ? Bible.findRefs(text, true) : [];
    if (refs.length === 1) {
      dlg.setData({ note: 'Buscando o texto no jw.org…' });
      Bible.getNote(refs[0], { numbers: prefs.bibleNumbers })
        .then((n) => { try { if (dlg.getData().note.startsWith('Buscando')) dlg.setData({ note: n }); } catch (e) {} })
        .catch((e) => { try { dlg.setData({ note: '' }); } catch (x) {} status('Não foi possível buscar o texto: ' + e.message, 6000); });
    }
  }

  // ---------- Textos bíblicos ----------
  const PREFS_KEY = 'criador-epub-prefs';
  const prefs = Object.assign({ bibleAuto: true, bibleNumbers: true }, (() => {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (e) { return {}; }
  })());
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }
  window.__bibleFetch = (url) => (api.bibleFetch ? api.bibleFetch(url) : fetch(url).then((r) => r.json()));

  const BUSCANDO = 'Buscando o texto no jw.org…';

  function textNodesOf(block) {
    const out = [];
    const w = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (editor.dom.getParent(n, 'a,h1,h2,h3,h4,h5,h6', block.parentNode) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n; while ((n = w.nextNode())) out.push(n);
    return out;
  }

  /** Procura referências bíblicas nos blocos e transforma em anotações. Retorna as âncoras criadas. */
  function wrapRefsIn(blocks, caretAware) {
    const created = [];
    const rng = editor.selection.getRng();
    let cNode = rng.collapsed ? rng.startContainer : null;
    let cOff = rng.startOffset;
    blocks.forEach((block) => {
      if (/^H[1-6]$/.test(block.nodeName)) return;
      textNodesOf(block).forEach((node) => {
        const refs = Bible.findRefs(node.data);
        for (let i = refs.length - 1; i >= 0; i--) {
          const ref = refs[i];
          // não mexe enquanto a pessoa ainda está digitando a referência
          if (caretAware && cNode === node && cOff >= ref.start && cOff <= ref.end + 2) continue;
          if (caretAware && cNode === node && cOff === node.data.length && ref.end >= node.data.replace(/[\s,]+$/, '').length) continue;
          const r = editor.getDoc().createRange();
          r.setStart(node, ref.start);
          r.setEnd(node, ref.end);
          const a = editor.getDoc().createElement('a');
          a.className = 'noteref';
          a.setAttribute('href', '#nota');
          a.setAttribute('data-note', BUSCANDO);
          a.setAttribute('title', BUSCANDO);
          a.setAttribute('data-bible', 'pending');
          r.surroundContents(a);
          if (cNode === node && cOff >= ref.end && a.nextSibling && a.nextSibling.nodeType === 3) {
            cNode = a.nextSibling; cOff -= ref.end;
          }
          created.push({ a, ref });
        }
      });
    });
    if (created.length && caretAware && cNode) {
      try { const nr = editor.dom.createRng(); nr.setStart(cNode, cOff); nr.collapse(true); editor.selection.setRng(nr); } catch (e) {}
    }
    return created;
  }

  async function fillBible(created) {
    let ok = 0; let fail = 0;
    const queue = created.slice().reverse();
    const worker = async () => {
      while (queue.length) {
        const { a, ref } = queue.shift();
        try {
          const note = await Bible.getNote(ref, { numbers: prefs.bibleNumbers });
          if (a.isConnected) { a.setAttribute('data-note', note); a.setAttribute('title', note); a.removeAttribute('data-bible'); ok++; }
        } catch (e) {
          if (a.isConnected) editor.dom.remove(a, true);
          fail++;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setDirty(true); scheduleDraft(); refreshNotes();
    return { ok, fail };
  }

  let autoT = null;
  function scheduleAutoBible() {
    if (!prefs.bibleAuto) return;
    clearTimeout(autoT);
    autoT = setTimeout(async () => {
      const blk = editor.dom.getParent(editor.selection.getNode(), editor.dom.isBlock, editor.getBody());
      if (!blk || blk === editor.getBody()) return;
      const blocks = [blk];
      if (blk.previousElementSibling) blocks.unshift(blk.previousElementSibling);
      let created;
      editor.undoManager.transact(() => { created = wrapRefsIn(blocks, true); });
      if (!created.length) return;
      refreshNotes();
      const r = await fillBible(created);
      if (r.fail) status(`Não foi possível buscar ${r.fail} texto(s) bíblico(s) — verifique a internet ou a referência.`, 7000);
      else status(`Anotação bíblica criada: ${created.map((c) => c.a.textContent).join(', ')}`);
    }, 1200);
  }

  async function detectAllBible() {
    const blocks = Array.from(editor.getBody().querySelectorAll('p, li, td, th, blockquote, figcaption, div'))
      .filter((b) => !b.querySelector('p, li, div, td'));
    const total = blocks.reduce((s, b) => s + textNodesOf(b).reduce((t, n) => t + Bible.findRefs(n.data).length, 0), 0);
    if (!total) { editor.windowManager.alert('Nenhum texto bíblico sem anotação foi encontrado.'); return; }
    const r0 = await api.confirm(`Foram encontrados ${total} texto(s) bíblico(s) sem anotação. Criar as anotações com o texto da Tradução do Novo Mundo?`, ['Criar anotações', 'Cancelar']);
    if (r0 !== 0) return;
    let created;
    editor.undoManager.transact(() => { created = wrapRefsIn(blocks, false); });
    refreshNotes();
    status(`Buscando ${created.length} texto(s) no jw.org…`, 0);
    const r = await fillBible(created);
    status(`${r.ok} anotação(ões) bíblica(s) criada(s)${r.fail ? `, ${r.fail} falharam` : ''}.`, 8000);
  }

  /** Atualiza o texto de todas as anotações bíblicas criadas pelo app (as que terminam com "Tradução do Novo Mundo").
   *  Anotações escritas à mão não são tocadas. */
  async function refreshAllBible() {
    const alvo = Array.from(editor.getBody().querySelectorAll('a.noteref')).filter((a) =>
      /Tradução do Novo Mundo/.test(a.getAttribute('data-note') || '') && Bible.findRefs(a.textContent, true).length === 1);
    if (!alvo.length) { editor.windowManager.alert('Nenhuma anotação bíblica criada pelo app foi encontrada. (Anotações escritas à mão não são alteradas.)'); return; }
    const c = await api.confirm(`Atualizar o texto de ${alvo.length} anotação(ões) bíblica(s) com a versão atual do jw.org (com quebras de linha)?\n\nAnotações escritas à mão não serão alteradas.`, ['Atualizar', 'Cancelar']);
    if (c !== 0) return;
    let ok = 0; let fail = 0; let i = 0;
    const queue = alvo.slice();
    const worker = async () => {
      while (queue.length) {
        const a = queue.shift();
        status(`Atualizando anotações bíblicas… ${++i}/${alvo.length}`, 0);
        try {
          const note = await Bible.getNote(Bible.findRefs(a.textContent, true)[0], { numbers: prefs.bibleNumbers });
          if (a.isConnected) { editor.dom.setAttribs(a, { 'data-note': note, title: note }); ok++; }
        } catch (e) { fail++; }
      }
    };
    editor.undoManager.add();
    await Promise.all([worker(), worker(), worker()]);
    editor.undoManager.add();
    setDirty(true); scheduleDraft(); refreshNotes();
    status(`${ok} anotação(ões) atualizada(s)${fail ? `, ${fail} não puderam ser buscadas (verifique a internet)` : ''}.`, 8000);
  }

  async function refreshBibleNote(a) {
    const refs = Bible.findRefs(a.textContent, true);
    if (refs.length !== 1) { editor.windowManager.alert('O texto desta anotação não é uma referência bíblica reconhecida.'); return; }
    try {
      const note = await Bible.getNote(refs[0], { numbers: prefs.bibleNumbers });
      editor.undoManager.transact(() => editor.dom.setAttribs(a, { 'data-note': note, title: note }));
      setDirty(true); refreshNotes(); status('Texto bíblico atualizado.');
    } catch (e) { status('Não foi possível buscar o texto: ' + e.message, 6000); }
  }

  function editNote(a) {
    noteDialog({
      title: 'Editar anotação',
      ref: a.textContent,
      note: a.getAttribute('data-note') || '',
      onOk: ({ note }) => {
        editor.undoManager.transact(() => {
          editor.dom.setAttribs(a, { 'data-note': note.trim(), title: note.trim() });
        });
        setDirty(true); refreshNotes();
      },
    });
  }

  function removeNote(a) {
    editor.undoManager.transact(() => { editor.dom.remove(a, true); });
    editor.nodeChanged();
    setDirty(true); refreshNotes();
    status('Anotação removida (o texto foi mantido).');
  }

  function refreshNotes() {
    if (!editor) return;
    const list = $('listaNotas');
    const refs = Array.from(editor.getBody().querySelectorAll('a.noteref'));
    $('notaCount').textContent = refs.length;
    list.innerHTML = '';
    if (!refs.length) {
      list.innerHTML = '<li class="vazio" style="cursor:default;border:none">Nenhuma anotação ainda.</li>';
    }
    refs.forEach((a, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<div class="nota-head"><span class="nota-num">${i + 1}.</span><span class="nota-ref"></span>
        <span class="nota-acoes"><button data-a="edit" title="Editar">✎</button><button data-a="del" title="Remover anotação">✕</button></span></div>
        <div class="nota-texto"></div>`;
      li.querySelector('.nota-ref').textContent = a.textContent;
      li.querySelector('.nota-texto').textContent = a.getAttribute('data-note') || '';
      li.addEventListener('click', (e) => {
        const act = e.target.getAttribute && e.target.getAttribute('data-a');
        if (act === 'edit') return editNote(a);
        if (act === 'del') return removeNote(a);
        a.scrollIntoView({ behavior: 'smooth', block: 'center' });
        editor.selection.select(a);
        editor.focus();
      });
      list.appendChild(li);
    });
    refreshToc();
  }

  function refreshToc() {
    const ul = $('listaSumario');
    ul.innerHTML = '';
    const hs = Array.from(editor.getBody().querySelectorAll('h1, h2, h3')).filter((h) => h.textContent.trim());
    if (!hs.length) ul.innerHTML = '<li class="vazio" style="cursor:default">Use os estilos "Título 1/2/3" para montar o sumário.</li>';
    hs.forEach((h) => {
      const li = document.createElement('li');
      li.className = h.tagName.toLowerCase();
      li.textContent = h.textContent.trim();
      li.onclick = () => { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); editor.selection.setCursorLocation(h, 0); editor.focus(); };
      ul.appendChild(li);
    });
  }
  let refreshT = null;
  function scheduleRefresh() { clearTimeout(refreshT); refreshT = setTimeout(refreshNotes, 400); }

  // ---------- imagens ----------
  function contentWidth() {
    const b = editor.getBody();
    const cs = editor.getWin().getComputedStyle(b);
    return b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }
  function setImgPercent(img, pct) {
    pct = Math.max(5, Math.min(100, Math.round(pct)));
    editor.undoManager.transact(() => {
      editor.dom.setAttribs(img, { width: null, height: null });
      editor.dom.setStyles(img, { width: pct + '%', height: 'auto' });
    });
    editor.nodeChanged();
    setDirty(true);
  }
  function fileToDataUri(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  function insertImageFromPc() {
    const input = $('fileImagem');
    input.value = '';
    input.onchange = async () => {
      const f = input.files[0]; if (!f) return;
      const uri = await fileToDataUri(f);
      editor.focus();
      editor.insertContent(`<img src="${uri}" alt="Imagem" style="width: 100%; height: auto;" />`);
      setDirty(true);
    };
    input.click();
  }

  // ---------- TinyMCE ----------
  tinymce.init({
    selector: '#editor',
    license_key: 'gpl',
    base_url: '../node_modules/tinymce',
    suffix: '.min',
    language: 'pt_BR',
    language_url: 'pt_BR.js',
    height: '100%',
    resize: false,
    branding: false,
    promotion: false,
    browser_spellcheck: true,
    plugins: 'advlist lists link image table charmap searchreplace wordcount pagebreak visualblocks fullscreen quickbars',
    menubar: 'edit insert format table tools',
    menu: {
      insert: { title: 'Inserir', items: 'imagempc image link anotacao | table charmap pagebreak hr' },
    },
    toolbar: [
      'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | forecolor backcolor removeformat',
      'alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | imagempc table link | anotacao biblia | pagebreak searchreplace | fullscreen',
    ],
    toolbar_mode: 'wrap',
    quickbars_selection_toolbar: 'bold italic underline | blocks | anotacao',
    quickbars_insert_toolbar: false,
    quickbars_image_toolbar: false,
    // menu do botão direito é o nativo do Windows (com sugestões do corretor), montado no main.js
    contextmenu: window.api ? false : 'anotacao | imgtam | link | table',
    font_family_formats:
      'Arial=arial,helvetica,sans-serif; Calibri=calibri,carlito,sans-serif; Cambria=cambria,caladea,serif; Georgia=georgia,serif; Garamond=garamond,"EB Garamond",serif; Times New Roman=times new roman,times,serif; Verdana=verdana,geneva,sans-serif; Tahoma=tahoma,sans-serif; Trebuchet MS=trebuchet ms,sans-serif; Courier New=courier new,courier,monospace',
    font_size_formats: '8pt 9pt 10pt 11pt 12pt 14pt 16pt 18pt 20pt 24pt 28pt 32pt 36pt 48pt',
    block_formats: 'Parágrafo=p; Título 1=h1; Título 2=h2; Título 3=h3; Título 4=h4; Citação=blockquote',
    pagebreak_separator: '<div class="pagebreak"></div>',
    pagebreak_split_block: true,
    image_caption: true,
    image_advtab: true,
    image_dimensions: true,
    image_title: false,
    object_resizing: 'img',
    resize_img_proportional: true,
    paste_data_images: true,
    automatic_uploads: true,
    images_upload_handler: (blobInfo) => Promise.resolve(`data:${blobInfo.blob().type || 'image/png'};base64,${blobInfo.base64()}`),
    file_picker_types: 'image',
    file_picker_callback: (cb) => {
      const input = $('fileImagem');
      input.value = '';
      input.onchange = async () => { const f = input.files[0]; if (f) cb(await fileToDataUri(f), { alt: 'Imagem' }); };
      input.click();
    },
    convert_urls: false,
    relative_urls: false,
    link_default_target: '_blank',
    extended_valid_elements: 'a[href|target|title|class|id|data-note|data-bible|style|rel|name]',
    content_style: `
      html { background: #e8e8ec; }
      body {
        background: #fff; max-width: 794px; min-height: 1060px; margin: 28px auto; padding: 64px 72px;
        box-shadow: 0 1px 4px rgba(0,0,0,.18); box-sizing: border-box;
        font-family: Arial, helvetica, sans-serif; font-size: 12pt; line-height: 1.6; color: #111;
      }
      p { margin: 10px 0; }
      h1 { color: #333; font-size: 2em; line-height: 1.2; margin: .67em 0; }
      h2 { color: #333; font-size: 1.42em; line-height: 1.2; margin: .83em 0; }
      h3 { color: #333; font-size: 1.125em; margin: 1em 0; }
      img { max-width: 100%; height: auto; }
      figure.image { display: table; margin: 1em auto; }
      figure.image figcaption { display: table-caption; caption-side: bottom; text-align: center; font-size: .9em; color: #555; }
      blockquote { margin: 1em 1.5em; padding-left: 1em; border-left: 3px solid #ccc; color: #444; }
      a.noteref { color: #1a56db; text-decoration: underline dotted; text-underline-offset: 3px; background: #eef4ff; border-radius: 3px; cursor: help; }
      a.noteref::after { content: "✎"; font-size: .7em; vertical-align: super; margin-left: 1px; color: #1a56db; }
      .mce-pagebreak { border: 0; border-top: 2px dashed #aab; width: 100%; height: 14px; margin: 18px 0; }
    `,
    setup: (ed) => {
      editor = ed;

      ed.ui.registry.addIcon('nota', '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 11h8M8 14.5h8M8 18h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');

      ed.ui.registry.addButton('anotacao', {
        icon: 'nota', text: 'Anotação', tooltip: 'Adicionar anotação (Ctrl+Alt+N)',
        onAction: addNote,
      });
      ed.ui.registry.addMenuItem('anotacao', { icon: 'nota', text: 'Anotação…', onAction: addNote, shortcut: 'Ctrl+Alt+N' });
      ed.ui.registry.addButton('imagempc', { icon: 'image', tooltip: 'Inserir imagem do computador', onAction: insertImageFromPc });
      ed.ui.registry.addMenuItem('imagempc', { icon: 'image', text: 'Imagem do computador…', onAction: insertImageFromPc });
      ed.addShortcut('ctrl+alt+n', 'Adicionar anotação', addNote);

      ed.ui.registry.addIcon('biblia', '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M6 3h11a1 1 0 0 1 1 1v14H7a2 2 0 0 0 0 4h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 3a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 6.5v7M9.5 9h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
      ed.ui.registry.addMenuButton('biblia', {
        icon: 'biblia', text: 'Textos bíblicos', tooltip: 'Tradução do Novo Mundo (jw.org)',
        fetch: (cb) => cb([
          { type: 'menuitem', text: 'Detectar textos bíblicos no documento todo', onAction: detectAllBible },
          { type: 'menuitem', text: 'Atualizar todas as anotações bíblicas', onAction: refreshAllBible },
          { type: 'menuitem', text: 'Atualizar texto da anotação selecionada', onAction: () => { const a = currentNoteRef(); if (a) refreshBibleNote(a); else status('Clique primeiro em uma anotação.'); } },
          { type: 'separator' },
          { type: 'togglemenuitem', text: 'Criar anotação automaticamente ao digitar', active: prefs.bibleAuto, onAction: () => { prefs.bibleAuto = !prefs.bibleAuto; savePrefs(); } },
          { type: 'togglemenuitem', text: 'Incluir número dos versículos', active: prefs.bibleNumbers, onAction: () => { prefs.bibleNumbers = !prefs.bibleNumbers; savePrefs(); } },
        ]),
      });

      // Menu do botão direito
      ed.ui.registry.addMenuItem('addnota', { icon: 'nota', text: 'Adicionar anotação', onAction: addNote });
      ed.ui.registry.addMenuItem('editnota', { icon: 'edit-block', text: 'Editar anotação', onAction: () => { const a = currentNoteRef(); if (a) editNote(a); } });
      ed.ui.registry.addMenuItem('delnota', { icon: 'remove', text: 'Remover anotação', onAction: () => { const a = currentNoteRef(); if (a) removeNote(a); } });
      ed.ui.registry.addContextMenu('anotacao', {
        update: (el) => (ed.dom.getParent(el, 'a.noteref') ? 'editnota delnota' : (el.nodeName === 'IMG' ? '' : 'addnota')),
      });

      // Tamanho de imagem
      const sizes = [25, 33, 50, 75, 100];
      sizes.forEach((p) => {
        ed.ui.registry.addButton('img' + p, {
          text: p + '%', tooltip: `Largura ${p}% da página`,
          onAction: () => { const img = ed.selection.getNode(); if (img && img.nodeName === 'IMG') setImgPercent(img, p); },
        });
      });
      ed.ui.registry.addNestedMenuItem('imgtam', {
        text: 'Tamanho da imagem', icon: 'resize',
        getSubmenuItems: () => sizes.map((p) => ({
          type: 'menuitem', text: p + '% da página',
          onAction: () => { const img = ed.selection.getNode(); if (img && img.nodeName === 'IMG') setImgPercent(img, p); },
        })),
      });
      ed.ui.registry.addContextMenu('imgtam', { update: (el) => (el.nodeName === 'IMG' ? 'imgtam image' : '') });
      ed.ui.registry.addContextToolbar('imgtools', {
        predicate: (node) => node.nodeName === 'IMG',
        items: 'img25 img33 img50 img75 img100 | alignleft aligncenter alignright | image',
        position: 'node',
        scope: 'node',
      });
      ed.ui.registry.addButton('notaedit', { icon: 'edit-block', text: 'Editar anotação', onAction: () => { const a = currentNoteRef(); if (a) editNote(a); } });
      ed.ui.registry.addButton('notadel', { icon: 'remove', tooltip: 'Remover anotação', onAction: () => { const a = currentNoteRef(); if (a) removeNote(a); } });
      ed.ui.registry.addContextToolbar('notatools', {
        predicate: (node) => !!ed.dom.getParent(node, 'a.noteref'),
        items: 'notaedit notadel',
        position: 'node',
        scope: 'node',
      });

      // Guarda o alvo do clique direito para o menu nativo
      ed.on('contextmenu', (e) => {
        ctxTarget = e.target;
        if (e.target && e.target.nodeName === 'IMG') ed.selection.select(e.target);
      });

      // Redimensionar com o mouse -> guarda em % da página
      ed.on('ObjectResized', (e) => {
        if (e.target && e.target.nodeName === 'IMG') {
          const cw = contentWidth();
          if (cw > 0) setImgPercent(e.target, (e.width / cw) * 100);
        }
      });

      // Atalhos de arquivo também dentro do editor
      ed.addShortcut('meta+s', 'Salvar', () => save(false));
      ed.addShortcut('meta+shift+s', 'Salvar como', () => save(true));
      ed.addShortcut('meta+o', 'Abrir', openEpub);

      ed.on('input change undo redo SetContent ExecCommand', () => { if (!loading) { setDirty(true); scheduleDraft(); } scheduleRefresh(); });
      ed.on('keyup', (e) => {
        scheduleRefresh();
        if (!e.ctrlKey && !e.altKey && !/^(Arrow|Page|Home|End|Shift|Control|Alt|Escape)/.test(e.key)) scheduleAutoBible();
      });
      ed.on('paste', () => scheduleAutoBible());

      ed.on('init', async () => {
        ed.undoManager.clear(); ed.undoManager.add();
        setTimeout(() => { loading = false; }, 0);
        const restored = await restoreDraftIfAny();
        refreshNotes();
        refreshTitle();
        await accountReady;
        if (!restored) openLibrary(); // ao abrir, mostra a biblioteca
      });
    },
  });

  // ---------- arquivo ----------
  function loadContent(meta, html, loc) {
    loading = true;
    state.meta = Object.assign(NOVO_META(), meta);
    state.loc = loc || null;
    editor.setContent(html || '');
    editor.undoManager.clear();
    editor.undoManager.add();
    loading = false;
    state.dirty = false; api.setDirty(false);
    refreshTitle();
    refreshNotes();
    editor.getWin().scrollTo(0, 0);
  }

  function isEmptyDoc() {
    return !state.loc && !state.meta.title && !editor.getBody().textContent.trim() && !editor.getBody().querySelector('img');
  }
  async function askSaveChanges() {
    if (!state.dirty) return true;
    if (isEmptyDoc()) return true; // documento novo e vazio: nada a salvar
    const r = await api.confirm('Deseja salvar as alterações do livro atual?', ['Salvar', 'Não salvar', 'Cancelar']);
    if (r === 0) return !!(await save(false));
    return r === 1;
  }

  async function novo() {
    if (!(await askSaveChanges())) return;
    loadContent(NOVO_META(), '', null);
    clearDraft();
    closeLibrary();
    editor.focus();
    status('Novo EPUB. Ao salvar, você escolhe o título e a categoria.');
  }

  async function openEpub() {
    if (!(await askSaveChanges())) return;
    openLibrary();
  }

  async function openFileEpub() {
    const r = await api.openEpub();
    if (!r) return;
    try {
      status('Abrindo…', 0);
      const { meta, html } = await Epub.importEpub(r.data);
      loadContent(meta, html, { source: 'file', id: r.path });
      clearDraft();
      closeLibrary();
      const n = editor.getBody().querySelectorAll('a.noteref').length;
      status(`EPUB aberto${n ? ` — ${n} anotação(ões) reconhecida(s)` : ''}. Para guardá-lo na biblioteca, use "Salvar como…".`, 8000);
    } catch (e) {
      console.error(e);
      status('');
      editor.windowManager.alert('Não foi possível abrir este EPUB: ' + e.message);
    }
  }

  // ----- janela "Salvar": título + categoria (+ Google Drive / computador) -----
  let salvarResolve = null;
  let sSource = 'local';
  let sCatSel = null;
  let sCats = [];
  function sErro(msg) { $('sErro').textContent = msg || ''; }
  function renderSalvarOnde() {
    const w = $('sOndeWrap');
    if (!account) { w.innerHTML = ''; w.classList.add('hidden'); return; }
    w.classList.remove('hidden');
    w.innerHTML = `<label class="${sSource === 'drive' ? 'marcado' : ''}"><input type="radio" name="sOnde" value="drive" ${sSource === 'drive' ? 'checked' : ''}> ☁ Google Drive<br><small></small></label>
      <label class="${sSource === 'local' ? 'marcado' : ''}"><input type="radio" name="sOnde" value="local" ${sSource === 'local' ? 'checked' : ''}> 💻 Este computador</label>`;
    w.querySelector('small').textContent = account.email;
    w.querySelectorAll('input').forEach((i) => { i.onchange = () => { sSource = i.value; renderSalvarOnde(); loadSalvarCats(); }; });
  }
  function renderSalvarCats() {
    const box = $('sCats');
    box.innerHTML = '';
    sCats.forEach((c) => {
      const l = document.createElement('label');
      if (sCatSel === c.name) l.className = 'marcado';
      l.innerHTML = `<input type="radio" name="sCat"><span></span>`;
      l.querySelector('span').textContent = c.name;
      const inp = l.querySelector('input'); inp.checked = sCatSel === c.name;
      inp.onchange = () => { sCatSel = c.name; renderSalvarCats(); sErro(''); };
      box.appendChild(l);
    });
  }
  async function loadSalvarCats() {
    $('sCats').innerHTML = '<span class="upd-info">Carregando categorias…</span>';
    const r = await api.lib.list(sSource);
    if (r.error) {
      if (sSource === 'drive') { sErro('Google Drive: ' + r.error.message); sSource = 'local'; renderSalvarOnde(); return loadSalvarCats(); }
      sErro(r.error.message); sCats = []; renderSalvarCats(); return;
    }
    sCats = r.categories;
    if (!sCats.some((c) => c.name === sCatSel)) sCatSel = null;
    renderSalvarCats();
  }
  function openSalvar() {
    sErro('');
    $('sTitulo').value = state.meta.title || '';
    $('sNovaCat').value = '';
    const L = state.loc;
    sSource = L && (L.source === 'drive' || L.source === 'local') ? L.source : (account ? 'drive' : 'local');
    sCatSel = (L && L.catName) || state.meta.category || null;
    renderSalvarOnde();
    loadSalvarCats();
    $('modalSalvar').classList.remove('hidden');
    setTimeout(() => { $('sTitulo').focus(); $('sTitulo').select(); }, 30);
    return new Promise((res) => { salvarResolve = res; });
  }
  function closeSalvar(result) {
    $('modalSalvar').classList.add('hidden');
    if (salvarResolve) { salvarResolve(result); salvarResolve = null; }
  }
  $('sCancelar').onclick = () => closeSalvar(null);
  $('sOutro').onclick = () => closeSalvar({ other: true });
  $('sOk').onclick = () => {
    const title = $('sTitulo').value.trim();
    if (!title) { sErro('Escreva o título.'); $('sTitulo').focus(); return; }
    const cat = sCats.find((c) => c.name === sCatSel);
    if (!cat) { sErro('Marque uma categoria.'); return; }
    closeSalvar({ title, source: sSource, catId: cat.id, catName: cat.name });
  };
  $('sCriarCat').onclick = async () => {
    const name = $('sNovaCat').value.trim();
    if (!name) { $('sNovaCat').focus(); return; }
    const r = await api.lib.createCategory(sSource, name);
    if (r.error) { sErro(r.error.message); return; }
    $('sNovaCat').value = '';
    sCatSel = r.category.name;
    await loadSalvarCats();
  };
  $('sNovaCat').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('sCriarCat').click(); } });
  $('modalSalvar').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSalvar(null);
    if (e.key === 'Enter' && e.target.id === 'sTitulo') $('sOk').click();
  });

  async function save(saveAs) {
    const L = state.loc;
    let target;
    if (!saveAs && L && (L.source === 'drive' || L.source === 'local')) {
      target = { title: state.meta.title, source: L.source, catId: L.catId, catName: L.catName, id: L.id };
      if (!target.title) { const t = await openSalvar(); if (!t) return null; target = t.other ? t : Object.assign(t, { id: L.id }); }
    } else if (!saveAs && L && L.source === 'file') {
      target = { file: L.id };
    } else {
      const t = await openSalvar();
      if (!t) return null;
      target = t;
    }
    try {
      if (target.title) { state.meta.title = target.title; state.meta.category = target.catName; }
      status('Gerando EPUB…', 0);
      const res = await Epub.exportEpub(state.meta, editor.getContent());
      state.meta.uuid = res.uuid;
      const resumo = `(${res.notes} anotação(ões), ${res.images} imagem(ns))`;
      if (target.source === 'drive' || target.source === 'local') {
        if (target.source === 'drive') status('Enviando para o Google Drive…', 0);
        const r = await api.lib.save({ source: target.source, id: target.id || null, title: target.title, data: res.data, folderId: target.catId });
        if (r.cancelled) { status('Salvamento cancelado.'); return null; }
        if (r.error) {
          status('');
          if (target.source === 'drive' && handleAuthError(r.error)) return null;
          editor.windowManager.alert('Não foi possível salvar: ' + r.error.message);
          return null;
        }
        state.loc = { source: target.source, id: r.file.id, catId: target.catId, catName: target.catName };
        setDirty(false); clearDraft();
        status(`Salvo em "${target.catName}"${target.source === 'drive' ? ' no Google Drive' : ''}: ${r.file.name} ${resumo}`, 7000);
        if (!$('biblioteca').classList.contains('hidden')) renderLibrary();
        return r.file.name;
      }
      // fora da biblioteca: arquivo escolhido pela pessoa
      const p = await api.saveEpub({ filePath: target.file || null, data: res.data, suggestedName: res.suggestedName });
      if (!p) { status('Salvamento cancelado.'); return null; }
      state.loc = { source: 'file', id: p };
      setDirty(false); clearDraft();
      status(`Salvo: ${p.split(/[\\/]/).pop()} ${resumo}`, 6000);
      return p;
    } catch (e) {
      console.error(e);
      editor.windowManager.alert('Erro ao salvar o EPUB: ' + e.message);
      status('');
      return null;
    }
  }

  // ---------- Conta Google ----------
  let account = null;
  let gConfigured = false;
  const G = api.google;
  function initials(u) { return ((u.name || u.email || '?').trim()[0] || '?').toUpperCase(); }
  function renderAccount() {
    const box = $('conta');
    if (!G) { box.innerHTML = ''; return; }
    if (account) {
      box.innerHTML = `<button id="btnConta" class="conta-btn" title="Conta Google: ${Epub.esc(account.email)}"><span class="av"></span><span class="em"></span></button>`;
      const av = box.querySelector('.av');
      if (account.picture) { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.onerror = () => { av.textContent = initials(account); }; im.src = account.picture; av.appendChild(im); } else av.textContent = initials(account);
      box.querySelector('.em').textContent = account.email || account.name;
      $('btnConta').onclick = showAccountMenu;
    } else {
      box.innerHTML = '<button id="btnEntrar" class="btn-google" title="Salvar e abrir seus EPUBs no Google Drive"><span class="g">G</span> Entrar com Google</button>';
      $('btnEntrar').onclick = loginGoogle;
    }
  }
  function contaModal(html, buttons) {
    $('contaConteudo').innerHTML = html;
    const acts = $('contaAcoes'); acts.innerHTML = '';
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.textContent = b.text; if (b.primary) el.className = 'primary'; if (b.left) el.classList.add('left');
      el.onclick = b.onClick; acts.appendChild(el);
    });
    $('modalConta').classList.remove('hidden');
  }
  function closeConta() { $('modalConta').classList.add('hidden'); }
  function handleAuthError(err) {
    if (err && (err.code === 'NOT_LOGGED' || err.code === 'AUTH_EXPIRED')) {
      account = null; renderAccount();
      contaModal(`<h2>Entre novamente</h2><p>${Epub.esc(err.message)}</p>`, [
        { text: 'Agora não', onClick: closeConta },
        { text: 'Entrar com Google', primary: true, onClick: () => { closeConta(); loginGoogle(); } },
      ]);
      return true;
    }
    return false;
  }
  function showSetup() {
    contaModal(`<h2>Configurar o login do Google</h2>
      <p>Para salvar no Google Drive, o app precisa do arquivo de configuração do Google
      (o <b>JSON do ID do cliente OAuth</b>, baixado no Google Cloud).</p>
      <p>Coloque o arquivo com o nome <b>google-oauth.json</b> na pasta do programa (ao lado do
      <i>Criador de EPUB.exe</i>) — assim ele já vai junto quando você passar o app para outras pessoas —
      ou escolha o arquivo agora:</p>`, [
      { text: 'Fechar', left: true, onClick: closeConta },
      { text: 'Escolher arquivo JSON…', primary: true, onClick: async () => {
        const r = await G.importConfig();
        if (r.cancelled) return;
        if (r.error) { editor.windowManager.alert(r.error.message); return; }
        gConfigured = true; closeConta(); loginGoogle();
      } },
    ]);
  }
  async function loginGoogle() {
    if (!G) return;
    if (!gConfigured) { const st = await G.status(); gConfigured = st.configured; }
    if (!gConfigured) { showSetup(); return; }
    contaModal(`<div style="text-align:center"><div class="spinner"></div><h2>Continue no navegador</h2>
      <p>Abrimos a página de login do Google no seu navegador.<br>Escolha a conta e <b>permita o acesso ao Google Drive</b>.
      Depois, volte para cá.</p></div>`, [{ text: 'Cancelar', onClick: () => G.cancel() }]);
    const r = await G.login();
    if (r.error) {
      if (r.error.code === 'CANCELLED') { closeConta(); status('Login cancelado.'); return; }
      contaModal(`<h2>Não foi possível entrar</h2><p>${Epub.esc(r.error.message)}</p>`, [
        { text: 'Fechar', onClick: closeConta },
        { text: 'Tentar de novo', primary: true, onClick: loginGoogle },
      ]);
      return;
    }
    account = r.user; renderAccount();
    if (!$('biblioteca').classList.contains('hidden')) openLibrary('drive');
    contaModal(`<h2>✓ Conectado</h2><p>Você entrou como <b>${Epub.esc(account.email)}</b>.</p>
      <p>Seus EPUBs ficam na pasta <b>Criador de EPUB</b> do seu Google Drive. O app só tem acesso aos
      arquivos que ele mesmo criou — o resto do seu Drive continua privado.</p>`, [
      { text: 'OK', onClick: closeConta },
      { text: 'Ver meus EPUBs', primary: true, onClick: () => { closeConta(); openLibrary('drive'); } },
    ]);
  }
  function showAccountMenu() {
    contaModal(`<h2>Conta Google</h2><p>Conectado como <b>${Epub.esc(account.email)}</b>.</p>
      <p>Para usar outra conta, saia e entre novamente.</p>`, [
      { text: 'Sair da conta', left: true, onClick: async () => {
        const c = await api.confirm(`Sair da conta ${account.email}? Os arquivos continuam salvos no Google Drive.`, ['Sair', 'Cancelar']);
        if (c !== 0) return;
        await G.logout(); account = null; renderAccount(); closeConta(); status('Você saiu da conta Google.');
        if (state.loc && state.loc.source === 'drive') { state.loc = null; refreshTitle(); }
        if (!$('biblioteca').classList.contains('hidden')) openLibrary('local');
      } },
      { text: 'Fechar', onClick: closeConta },
      { text: '☁ Meus EPUBs', primary: true, onClick: () => { closeConta(); openLibrary('drive'); } },
    ]);
  }

  // ---------- Biblioteca ----------
  function fmtDate(iso) { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } }
  function fmtSize(n) { n = Number(n || 0); return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  const DEFAULT_CATS = ['Discursos Públicos', 'Tesouros da Palavra de Deus', 'Outros'];
  let bibSource = null;
  let bibData = null;
  let bibCat = '*';
  let bibLoading = false;

  function openLibrary(source) {
    if (!api.lib) return;
    bibSource = source || bibSource || (account ? 'drive' : 'local');
    if (bibSource === 'drive' && !account) bibSource = 'local';
    $('biblioteca').classList.remove('hidden');
    loadLibrary();
  }
  function closeLibrary() { $('biblioteca').classList.add('hidden'); }

  function renderFonte() {
    const f = $('bibFonte');
    f.innerHTML = '';
    const opts = [['drive', '☁ Google Drive'], ['local', '💻 Este computador']];
    opts.forEach(([v, t]) => {
      const b = document.createElement('button');
      b.textContent = t; if (bibSource === v) b.className = 'ativo';
      b.onclick = () => { if (v === 'drive' && !account) { loginGoogle(); return; } bibSource = v; bibCat = '*'; loadLibrary(); };
      f.appendChild(b);
    });
  }

  async function loadLibrary() {
    renderFonte();
    bibLoading = true;
    $('bibArquivos').innerHTML = '<li class="vazio">Carregando…</li>';
    $('bibCats').innerHTML = '';
    const aviso = $('bibAviso');
    aviso.classList.add('hidden');
    if (bibSource === 'local') {
      const info = await api.lib.info();
      $('bibOnde').textContent = '💻 ' + info.localDir;
      if (!account && G) {
        aviso.classList.remove('hidden');
        aviso.innerHTML = '☁ <b>Dica:</b> entre com sua conta Google para guardar os EPUBs no Google Drive e abrir no tablet. <button id="bibEntrar">Entrar com Google</button>';
        $('bibEntrar').onclick = loginGoogle;
      }
    } else {
      $('bibOnde').textContent = `☁ Google Drive de ${account ? account.email : ''} · pasta "Criador de EPUB"`;
    }
    const r = await api.lib.list(bibSource);
    bibLoading = false;
    if (r.error) {
      if (bibSource === 'drive' && handleAuthError(r.error)) { bibSource = 'local'; return loadLibrary(); }
      $('bibArquivos').innerHTML = '<li class="vazio"></li>';
      $('bibArquivos').firstChild.textContent = r.error.message;
      return;
    }
    bibData = r;
    if (bibCat !== '*' && !r.categories.some((c) => c.id === bibCat)) bibCat = '*';
    renderLibrary();
  }

  function renderLibrary() {
    if (!bibData || bibLoading) return;
    const busca = $('bibBusca').value.trim().toLowerCase();
    const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const files = bibData.files.filter((f) => !busca || norm(f.title).includes(norm(busca)));
    // categorias
    const ul = $('bibCats');
    ul.innerHTML = '';
    const addCat = (id, name, count, custom) => {
      const li = document.createElement('li');
      if (bibCat === id) li.className = 'ativo';
      li.innerHTML = `<span class="cn"></span><span class="cc">${count}</span>${custom ? '<span class="ca"><button data-a="ren" title="Renomear">✎</button><button data-a="del" title="Excluir categoria vazia">🗑</button></span>' : ''}`;
      li.querySelector('.cn').textContent = name;
      li.onclick = async (e) => {
        const a = e.target.getAttribute && e.target.getAttribute('data-a');
        if (a === 'ren') { e.stopPropagation(); return renameCat(id, name); }
        if (a === 'del') { e.stopPropagation(); return deleteCat(id, name); }
        bibCat = id; renderLibrary();
      };
      ul.appendChild(li);
    };
    addCat('*', '📚 Todos', files.length, false);
    bibData.categories.forEach((c) => addCat(c.id, (DEFAULT_CATS.includes(c.name) ? ['🎤 ', '💎 ', '📁 '][DEFAULT_CATS.indexOf(c.name)] : '📁 ') + c.name,
      files.filter((f) => f.categoryId === c.id).length, !DEFAULT_CATS.includes(c.name)));
    // arquivos
    const list = $('bibArquivos');
    list.innerHTML = '';
    const cats = bibCat === '*' ? bibData.categories : bibData.categories.filter((c) => c.id === bibCat);
    let total = 0;
    cats.forEach((c) => {
      const fs = files.filter((f) => f.categoryId === c.id);
      if (!fs.length && bibCat === '*') return;
      if (bibCat === '*') { const g = document.createElement('li'); g.className = 'grupo'; g.textContent = c.name; list.appendChild(g); }
      fs.forEach((f) => { total++; list.appendChild(itemEl(f)); });
    });
    if (!total) {
      const li = document.createElement('li'); li.className = 'vazio';
      li.textContent = busca ? 'Nenhum EPUB encontrado com esse título.'
        : bibData.files.length ? 'Nenhum EPUB nesta categoria ainda.' : 'Nenhum EPUB ainda. Clique em "＋ Novo EPUB" para começar.';
      list.appendChild(li);
    }
  }

  function itemEl(f) {
    const li = document.createElement('li');
    li.className = 'item' + (state.loc && state.loc.id === f.id ? ' atual' : '');
    li.innerHTML = '<span class="ic">📘</span><span class="dn"><b></b><small></small></span><button data-a="abrir" class="primary">Abrir</button><button data-a="mover" title="Mudar de categoria">📁 Mover</button><button data-a="del" title="Excluir">🗑</button>';
    li.querySelector('b').textContent = f.title;
    li.querySelector('small').textContent = `${f.category} · ${fmtDate(f.modified)} · ${fmtSize(f.size)}`;
    li.onclick = (e) => {
      const a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'mover') return moveItem(f);
      if (a === 'del') return deleteItem(f);
      openLibraryFile(f);
    };
    return li;
  }

  async function openLibraryFile(f) {
    if (!(await askSaveChanges())) return;
    status(bibSource === 'drive' ? 'Baixando do Google Drive…' : 'Abrindo…', 0);
    const r = await api.lib.read(bibSource, f.id);
    if (r.error) { status(''); if (!(bibSource === 'drive' && handleAuthError(r.error))) editor.windowManager.alert(r.error.message); return; }
    try {
      const { meta, html } = await Epub.importEpub(r.data);
      if (!meta.title) meta.title = f.title;
      meta.category = f.category;
      loadContent(meta, html, { source: bibSource, id: f.id, catId: f.categoryId, catName: f.category });
      clearDraft();
      closeLibrary();
      status(`Aberto: ${f.title} (${f.category})`);
    } catch (e) {
      status('');
      editor.windowManager.alert('Não foi possível abrir este EPUB: ' + e.message);
    }
  }

  function moveItem(f) {
    const outras = bibData.categories.filter((c) => c.id !== f.categoryId);
    contaModal(`<h2>📁 Mover para outra categoria</h2><p><b></b></p><p class="upd-info">Escolha a nova categoria:</p>`,
      outras.map((c) => ({ text: c.name, onClick: async () => {
        closeConta();
        const r = await api.lib.move(bibSource, f.id, c.id);
        if (r.error) { editor.windowManager.alert(r.error.message); return; }
        if (state.loc && state.loc.id === f.id) { state.loc = Object.assign({}, state.loc, { id: r.id, catId: c.id, catName: c.name }); state.meta.category = c.name; refreshTitle(); }
        status(`"${f.title}" movido para ${c.name}.`);
        loadLibrary();
      } })).concat([{ text: 'Cancelar', left: true, onClick: closeConta }]));
    document.querySelector('#contaConteudo p b').textContent = f.title;
  }

  async function deleteItem(f) {
    const onde = bibSource === 'drive' ? 'a lixeira do Google Drive' : 'a Lixeira do Windows';
    const c = await api.confirm(`Mover "${f.title}" para ${onde}?`, ['Excluir', 'Cancelar']);
    if (c !== 0) return;
    const r = await api.lib.trash(bibSource, f.id);
    if (r.error) { editor.windowManager.alert(r.error.message); return; }
    if (state.loc && state.loc.id === f.id) { state.loc = null; refreshTitle(); }
    loadLibrary();
  }

  function askName(title, value) {
    return new Promise((res) => {
      contaModal(`<h2></h2><input id="nomeCat" type="text" style="width:100%;font:inherit;padding:8px 10px;border:1px solid #cfd3d8;border-radius:8px">`, [
        { text: 'Cancelar', onClick: () => { closeConta(); res(null); } },
        { text: 'OK', primary: true, onClick: () => { const v = $('nomeCat').value.trim(); closeConta(); res(v || null); } },
      ]);
      document.querySelector('#contaConteudo h2').textContent = title;
      const i = $('nomeCat'); i.value = value || ''; setTimeout(() => { i.focus(); i.select(); }, 30);
      i.onkeydown = (e) => { if (e.key === 'Enter') { const v = i.value.trim(); closeConta(); res(v || null); } };
    });
  }
  async function newCat() {
    const name = await askName('Nova categoria');
    if (!name) return;
    const r = await api.lib.createCategory(bibSource, name);
    if (r.error) { editor.windowManager.alert(r.error.message); return; }
    bibCat = r.category.id;
    loadLibrary();
  }
  async function renameCat(id, name) {
    const n = await askName('Renomear categoria', name.replace(/^\S+\s/, ''));
    if (!n) return;
    const r = await api.lib.renameCategory(bibSource, id, n);
    if (r.error) { editor.windowManager.alert(r.error.message); return; }
    bibCat = '*';
    loadLibrary();
  }
  async function deleteCat(id, name) {
    const c = await api.confirm(`Excluir a categoria "${name.replace(/^\S+\s/, '')}"? (Só é possível se estiver vazia.)`, ['Excluir', 'Cancelar']);
    if (c !== 0) return;
    const r = await api.lib.deleteCategory(bibSource, id);
    if (r.error) { editor.windowManager.alert(r.error.message); return; }
    bibCat = '*';
    loadLibrary();
  }

  $('bibFechar').onclick = closeLibrary;
  $('bibNovo').onclick = novo;
  $('bibNovaCat').onclick = newCat;
  $('bibAtualizar').onclick = loadLibrary;
  $('bibAbrirArquivo').onclick = async () => { if (await askSaveChanges()) openFileEpub(); };
  $('bibBusca').oninput = renderLibrary;
  $('biblioteca').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modalConta').classList.contains('hidden')) closeLibrary(); });

  const accountReady = G ? G.status().then((st) => { gConfigured = st.configured; account = st.user; renderAccount(); }).catch(() => {}) : Promise.resolve();

  async function restoreDraftIfAny() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) {}
    if (!d || !d.html) return false;
    const r = await api.confirm('Foi encontrado um rascunho não salvo da última vez. Deseja recuperá-lo?', ['Recuperar', 'Descartar']);
    if (r === 0) {
      let loc = d.loc || null;
      if (!loc && d.filePath) loc = { source: 'file', id: d.filePath }; // rascunho de versão antiga
      loadContent(d.meta, d.html, loc);
      setDirty(true);
      return true;
    }
    clearDraft();
    return false;
  }

  // ---------- propriedades ----------
  let propsResolve = null;
  let propsCover = null;
  function renderCover() {
    const box = $('capaPreview');
    box.innerHTML = propsCover ? `<img src="${propsCover}" alt="capa">` : '<span>Sem capa</span>';
  }
  function openProps(requireTitle) {
    const m = state.meta;
    $('pTitulo').value = m.title || '';
    $('pAutor').value = m.author || '';
    $('pEditora').value = m.publisher || '';
    $('pIdioma').value = m.language || 'pt-BR';
    if (!$('pIdioma').value) $('pIdioma').value = 'pt-BR';
    $('pDescricao').value = m.description || '';
    $('pTituloNotas').value = m.notesTitle || 'Notas';
    propsCover = m.cover || null;
    renderCover();
    $('modalProps').classList.remove('hidden');
    $('modalProps').dataset.require = requireTitle ? '1' : '';
    setTimeout(() => $('pTitulo').focus(), 30);
    return new Promise((res) => { propsResolve = res; });
  }
  function closeProps(ok) {
    if (ok) {
      const title = $('pTitulo').value.trim();
      if (!title) { $('pTitulo').focus(); $('pTitulo').style.borderColor = '#d1242f'; return; }
      $('pTitulo').style.borderColor = '';
      const m = state.meta;
      const before = JSON.stringify(m);
      m.title = title;
      m.author = $('pAutor').value.trim();
      m.publisher = $('pEditora').value.trim();
      m.language = $('pIdioma').value;
      m.description = $('pDescricao').value.trim();
      m.notesTitle = $('pTituloNotas').value.trim() || 'Notas';
      m.cover = propsCover;
      if (JSON.stringify(m) !== before) { setDirty(true); scheduleDraft(); }
    }
    $('modalProps').classList.add('hidden');
    if (propsResolve) { propsResolve(ok); propsResolve = null; }
  }
  $('btnPropsOk').onclick = () => closeProps(true);
  $('btnPropsCancelar').onclick = () => closeProps(false);
  $('modalProps').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProps(false);
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') closeProps(true);
  });
  $('btnCapa').onclick = () => {
    const input = $('fileCapa');
    input.value = '';
    input.onchange = async () => { const f = input.files[0]; if (f) { propsCover = await fileToDataUri(f); renderCover(); } };
    input.click();
  };
  $('btnRemoverCapa').onclick = () => { propsCover = null; renderCover(); };

  // ---------- barra superior ----------
  $('btnNovo').onclick = novo;
  $('btnAbrir').onclick = openEpub;
  $('btnSalvar').onclick = () => save(false);
  $('btnSalvarComo').onclick = () => save(true);
  $('btnPropriedades').onclick = () => openProps(false);
  // mostrar/esconder o painel de anotações (dá mais espaço ao editor)
  function togglePainel(show) {
    const sb = document.querySelector('.sidebar');
    const vis = show === undefined ? sb.classList.contains('hidden') : show;
    sb.classList.toggle('hidden', !vis);
    $('btnPainel').classList.toggle('active', vis);
    try { localStorage.setItem('criador-epub-painel', vis ? '1' : '0'); } catch (e) {}
  }
  $('btnPainel').onclick = () => togglePainel();
  $('btnFecharPainel').onclick = () => togglePainel(false);
  try { if (localStorage.getItem('criador-epub-painel') === '0') togglePainel(false); else $('btnPainel').classList.add('active'); } catch (e) {}
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
    };
  });
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); openEpub(); }
    else if (k === 'n' && !e.altKey) { e.preventDefault(); novo(); }
  });

  // ---------- menu nativo do botão direito ----------
  let ctxTarget = null;
  if (api.onCtxQuery) {
    api.onCtxQuery(() => {
      const t = ctxTarget;
      return {
        onNote: !!(t && editor && editor.dom.getParent(t, 'a.noteref')),
        onImage: !!(t && t.nodeName === 'IMG'),
      };
    });
    api.onCtxAction((a) => {
      const t = ctxTarget;
      const note = t && editor.dom.getParent(t, 'a.noteref');
      if (a === 'addnote') addNote();
      else if (a === 'editnote' && note) editNote(note);
      else if (a === 'delnote' && note) removeNote(note);
      else if (a.startsWith('img:') && t && t.nodeName === 'IMG') setImgPercent(t, Number(a.slice(4)));
      else if (a === 'imgprops') { if (t && t.nodeName === 'IMG') editor.selection.select(t); editor.execCommand('mceImage'); }
    });
  }

  // ---------- Base para comparação ----------
  const BASE_KEY = 'criador-epub-base';
  let refContent = null;
  const refPane = $('refPane'); const refSplit = $('refSplitter'); const refBody = $('refBody');
  RefView.attach(refBody);
  function showRef(content, persist = true) {
    refContent = content;
    $('refTitle').textContent = content ? content.title : 'Base para comparação';
    $('refTitle').title = $('refTitle').textContent;
    RefView.render(refBody, content);
    if (persist) {
      try {
        if (content && content.kind === 'html') localStorage.setItem(BASE_KEY, JSON.stringify({ title: content.title, kind: 'html', html: content.html }));
        else localStorage.removeItem(BASE_KEY);
      } catch (e) {}
    }
  }
  function toggleRef(open) {
    const show = open === undefined ? refPane.classList.contains('hidden') : open;
    refPane.classList.toggle('hidden', !show);
    refSplit.classList.toggle('hidden', !show);
    $('btnBase').classList.toggle('active', show);
    try { localStorage.setItem(BASE_KEY + '-aberto', show ? '1' : ''); } catch (e) {}
  }
  $('btnBase').onclick = () => toggleRef();
  $('refFechar').onclick = () => toggleRef(false);
  $('refAbrir').onclick = async () => {
    if (!api.openRefFile) return;
    const f = await api.openRefFile();
    if (!f) return;
    try {
      status('Abrindo base…', 0);
      showRef(await RefView.fromFile(f));
      status('Base aberta: ' + f.name);
    } catch (e) {
      console.error(e);
      status('');
      editor.windowManager.alert('Não foi possível abrir este arquivo: ' + e.message);
    }
  };
  $('refColar').onclick = async () => {
    const c = api.readClipboard ? RefView.fromClipboard(await api.readClipboard()) : null;
    if (!c) { status('A área de transferência está vazia. Copie o texto primeiro (Ctrl+C).', 5000); return; }
    showRef(c);
  };
  $('refJanela').onclick = () => {
    if (!refContent) { status('Abra ou cole uma base primeiro.'); return; }
    api.openRefWindow && api.openRefWindow(refContent);
    toggleRef(false);
  };
  $('refWol').onclick = () => api.openWol && api.openWol();
  // arrastar a divisória
  refSplit.addEventListener('mousedown', (e) => {
    e.preventDefault();
    refSplit.classList.add('drag');
    document.querySelectorAll('iframe').forEach((f) => { f.style.pointerEvents = 'none'; });
    const right = document.querySelector('.sidebar').getBoundingClientRect().left;
    const move = (ev) => { refPane.style.width = Math.max(280, Math.min(window.innerWidth * 0.7, right - ev.clientX)) + 'px'; };
    const up = () => {
      refSplit.classList.remove('drag');
      document.querySelectorAll('iframe').forEach((f) => { f.style.pointerEvents = ''; });
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  // restaura a última base usada
  try {
    const saved = JSON.parse(localStorage.getItem(BASE_KEY) || 'null');
    showRef(saved, false);
    if (localStorage.getItem(BASE_KEY + '-aberto')) toggleRef(true);
  } catch (e) { showRef(null, false); }

  // ---------- Atualizações ----------
  const U = api.update;
  let updInfo = null;
  let updBusy = false;
  function mb(n) { return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
  async function checkUpdates(manual) {
    if (!U) return;
    const r = await U.check();
    if (r.error) { if (manual) contaModal(`<h2>Atualizações</h2><p>${Epub.esc(r.error.message)}</p>`, [{ text: 'OK', onClick: closeConta }]); return; }
    updInfo = r.available ? r : null;
    $('btnSobre').classList.toggle('tem-update', !!updInfo);
    if (updInfo) showUpdate();
    else if (manual) contaModal(`<h2>✓ Você está na versão mais recente</h2><p>Versão instalada: <b>${Epub.esc(r.current)}</b>.</p>`, [{ text: 'OK', primary: true, onClick: closeConta }]);
  }
  function showUpdate() {
    if (!updInfo || updBusy) return;
    contaModal(`<h2>🎉 Nova versão ${Epub.esc(updInfo.version)} disponível</h2>
      <p class="upd-info">Você está na versão ${Epub.esc(updInfo.current)}. Tamanho do download: ${mb(updInfo.size || 0)}.</p>
      ${updInfo.notes ? `<p><b>O que mudou:</b></p><div class="upd-notas"></div>` : ''}
      <p class="upd-info">O app vai fechar, instalar a nova versão e abrir de novo sozinho. Sua conta Google e suas preferências continuam.</p>`, [
      { text: 'Depois', left: true, onClick: closeConta },
      { text: 'Atualizar agora', primary: true, onClick: runUpdate },
    ]);
    const n = document.querySelector('#contaConteudo .upd-notas');
    if (n) n.textContent = updInfo.notes;
  }
  async function runUpdate() {
    closeConta();
    if (!(await askSaveChanges())) return;
    updBusy = true;
    contaModal(`<h2>Baixando a versão ${Epub.esc(updInfo.version)}…</h2>
      <div class="upd-barra"><div id="updBarra"></div></div><div id="updTexto" class="upd-info">Iniciando…</div>`, []);
    const r = await U.download();
    if (r.error) {
      updBusy = false;
      contaModal(`<h2>Não foi possível baixar</h2><p>${Epub.esc(r.error.message)}</p>`, [
        { text: 'Fechar', onClick: closeConta }, { text: 'Tentar de novo', primary: true, onClick: runUpdate }]);
      return;
    }
    contaModal(`<div style="text-align:center"><div class="spinner"></div><h2>Instalando…</h2>
      <p>O Criador de EPUB vai fechar e abrir de novo em alguns segundos.</p></div>`, []);
    clearDraft();
    const i = await U.install();
    if (i.error) {
      updBusy = false;
      contaModal(`<h2>Não foi possível instalar</h2><p>${Epub.esc(i.error.message)}</p>`, [{ text: 'Fechar', onClick: closeConta }]);
    }
  }
  if (U) {
    U.onProgress(({ got, total }) => {
      const bar = $('updBarra'); const t = $('updTexto');
      if (bar && total) bar.style.width = Math.round((got / total) * 100) + '%';
      if (t) t.textContent = total ? `${mb(got)} de ${mb(total)} (${Math.round((got / total) * 100)}%)` : mb(got);
    });
    setTimeout(() => checkUpdates(false), 4000);
  }
  $('btnSobre').onclick = async () => {
    const info = api.appInfo ? await api.appInfo() : { version: '?' };
    contaModal(`<h2>📖 Criador de EPUB</h2><p>Versão instalada: <b>${Epub.esc(info.version)}</b></p>
      ${updInfo ? `<p>Há uma nova versão disponível: <b>${Epub.esc(updInfo.version)}</b>.</p>` : ''}
      <p class="upd-info">As atualizações são publicadas em github.com/guigon96-glitch/EpubJWAssistent.</p>`, [
      { text: 'Ver versões no GitHub', left: true, onClick: () => api.openExternal && api.openExternal(info.releases) },
      { text: 'Fechar', onClick: closeConta },
      updInfo ? { text: 'Atualizar agora', primary: true, onClick: showUpdate }
        : { text: 'Verificar atualizações', primary: true, onClick: () => { closeConta(); checkUpdates(true); } },
    ]);
  };

  api.onSaveAndClose(async () => { const p = await save(false); if (p) api.closeNow(); });

  // expõe para testes automatizados
  window.__app = { refreshAllBible, showRef, toggleRef, state, get editor() { return editor; }, save, loadContent, addNote, prefs, wrapRefsIn, textNodesOf, scheduleAutoBible };
})();
