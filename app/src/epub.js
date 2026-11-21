/* Geração e leitura de EPUB.
 * Anotações no editor:  <a class="noteref" href="#nota" data-note="texto da nota">referência</a>
 * No EPUB exportado viram (igual ao modelo do usuário):
 *   <a href="#fn1" id="r1" class="noteref" epub:type="noteref">referência</a>
 *   ... e no final: <div class="footnotes"><h3>Notas</h3><p id="fn1" class="nota">texto <a href="#r1">↩</a></p></div>
 */
(function () {
  'use strict';

  // Largura útil da "página" do editor, em px (usada para converter tamanho de imagem em %)
  const PAGE_CONTENT_WIDTH = 650;
  const XHTML_NS = 'http://www.w3.org/1999/xhtml';

  const BOOK_CSS = `body {
  font-family: Arial, sans-serif;
  font-size: 1em;
  line-height: 1.6;
  margin: 0 5pt;
  padding: 0;
}
h1 { color: #333; font-size: 2em; font-weight: bold; line-height: 1.2; margin: 0.67em 0; }
h2 { color: #333; font-size: 1.41667em; font-weight: bold; line-height: 1.2; margin: 0.83em 0; }
h3 { color: #333; font-size: 1.125em; font-weight: bold; margin: 1em 0; }
h4, h5, h6 { color: #333; font-weight: bold; }
p { margin: 10px 0; }
ul, ol { margin: 10px 0; }
img { max-width: 100%; height: auto; }
figure { margin: 1em 0; }
figure.image { display: table; margin-left: auto; margin-right: auto; }
figure.image figcaption { display: table-caption; caption-side: bottom; text-align: center; font-size: 0.9em; color: #555; }
table { border-collapse: collapse; }
td, th { border: 1px solid #999; padding: 4px 6px; }
blockquote { margin: 1em 1.5em; padding-left: 1em; border-left: 3px solid #ccc; color: #444; }
.pagebreak { page-break-after: always; break-after: page; height: 0; margin: 0; }
a.noteref { color: blue; text-decoration: none; }
.footnotes { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc; }
.footnotes h3 { color: #333; font-size: 1.125em; font-weight: bold; margin: 1em 0; }
.footnotes p.nota { font-size: 0.75em; margin: 10px 0; }
.footnotes p.nota a { text-decoration: none; }
@page { margin-top: 5pt; margin-bottom: 5pt; }
`;

  // ---------- utilidades ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
  const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

  function dataUriToBytes(uri) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
    if (!m) return null;
    const mime = (m[1] || 'application/octet-stream').toLowerCase();
    let bytes;
    if (m[2]) {
      const bin = atob(m[3]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
    }
    return { mime, bytes };
  }
  async function srcToBytes(src) {
    if (/^data:/i.test(src)) return dataUriToBytes(src);
    try {
      const r = await fetch(src);
      if (!r.ok) return null;
      const blob = await r.blob();
      return { mime: (blob.type || 'image/png').toLowerCase(), bytes: new Uint8Array(await blob.arrayBuffer()) };
    } catch (e) { return null; }
  }
  function imageSize(src) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth || 1200, h: im.naturalHeight || 1600 });
      im.onerror = () => resolve({ w: 1200, h: 1600 });
      im.src = src;
    });
  }
  function serializeChildren(el) {
    const ser = new XMLSerializer();
    let out = '';
    el.childNodes.forEach((n) => { out += ser.serializeToString(n); });
    return out.replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
  }
  // nome de arquivo amigável: mantém acentos e espaços, tira só o que o Windows não aceita
  function slug(s) {
    return (s || 'livro').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 100) || 'livro';
  }
  function xhtmlPage(title, lang, bodyInner, bodyClass) {
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${bodyInner}
</body>
</html>
`;
  }

  // ---------- EXPORTAR ----------
  async function exportEpub(meta, html) {
    const lang = meta.language || 'pt-BR';
    const title = meta.title || 'Sem título';
    const doc = new DOMParser().parseFromString('<!doctype html><html><body>' + html + '</body></html>', 'text/html');
    const body = doc.body;

    // Limpa restos do editor
    body.querySelectorAll('script, style, link, meta').forEach((n) => n.remove());
    body.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    // Quebra de página
    body.querySelectorAll('div.pagebreak').forEach((d) => { d.textContent = ''; });

    // Imagens
    const images = []; // {href, mime, bytes, id}
    const bySrc = new Map();
    let imgN = 0;
    for (const img of Array.from(body.querySelectorAll('img'))) {
      const src = img.getAttribute('src') || '';
      let entry = bySrc.get(src);
      if (!entry) {
        const data = await srcToBytes(src);
        if (!data) { img.remove(); continue; }
        imgN++;
        const ext = EXT_BY_MIME[data.mime] || 'png';
        const mime = MIME_BY_EXT[ext];
        entry = { href: `images/imagem_${String(imgN).padStart(3, '0')}.${ext}`, mime, bytes: data.bytes, id: `img${imgN}` };
        images.push(entry);
        bySrc.set(src, entry);
      }
      img.setAttribute('src', entry.href);
      if (!img.getAttribute('alt')) img.setAttribute('alt', 'Imagem');
      // Tamanho -> porcentagem da largura da página (fica proporcional em qualquer leitor)
      const sw = img.style.width;
      if (!/%$/.test(sw)) {
        let px = 0;
        if (/px$/.test(sw)) px = parseFloat(sw);
        else if (img.getAttribute('width')) px = parseFloat(img.getAttribute('width'));
        if (px > 0) {
          img.style.width = Math.min(100, Math.round((px / PAGE_CONTENT_WIDTH) * 1000) / 10) + '%';
        }
      }
      img.removeAttribute('width');
      img.removeAttribute('height');
      if (img.style.width) img.style.height = 'auto';
      img.removeAttribute('data-mce-src');
    }

    // Títulos com id (para o sumário)
    const toc = [];
    let hN = 0;
    body.querySelectorAll('h1, h2, h3').forEach((h) => {
      const text = h.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      if (!h.id) h.id = `cap_${++hN}`;
      toc.push({ level: Number(h.tagName[1]), text, id: h.id });
    });

    // Anotações
    const notes = [];
    body.querySelectorAll('a.noteref').forEach((a) => {
      const n = notes.length + 1;
      const text = a.getAttribute('data-note') || '';
      notes.push(text);
      a.setAttribute('href', `#fn${n}`);
      a.setAttribute('id', `r${n}`);
      a.setAttribute('class', 'noteref');
      a.setAttribute('epub:type', 'noteref');
      a.removeAttribute('data-note');
      a.removeAttribute('data-bible');
      a.removeAttribute('title');
      a.removeAttribute('data-mce-href');
    });

    let inner = serializeChildren(body);
    if (notes.length) {
      const notesTitle = meta.notesTitle || 'Notas';
      inner += `\n<div class="footnotes" epub:type="endnotes">\n  <h3>${esc(notesTitle)}</h3>\n`;
      notes.forEach((t, i) => {
        const n = i + 1;
        const txt = esc(t.trim()).replace(/\r?\n/g, '<br />');
        inner += `  <p id="fn${n}" class="nota" epub:type="endnote">${txt} <a href="#r${n}">↩</a></p>\n`;
      });
      inner += '</div>';
    }

    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`);
    const O = 'OEBPS/';
    zip.file(O + 'style.css', BOOK_CSS);
    zip.file(O + 'texto.xhtml', xhtmlPage(title, lang, inner));

    // Capa
    let coverEntry = null;
    if (meta.cover) {
      const data = await srcToBytes(meta.cover);
      if (data) {
        const ext = EXT_BY_MIME[data.mime] || 'jpg';
        coverEntry = { href: `images/capa.${ext}`, mime: MIME_BY_EXT[ext], bytes: data.bytes };
        const { w, h } = await imageSize(meta.cover);
        zip.file(O + 'capa.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}">
<head>
  <meta charset="utf-8" />
  <title>Capa</title>
  <style type="text/css">@page { padding: 0; margin: 0; } body { text-align: center; padding: 0; margin: 0; } div { height: 100vh; }</style>
</head>
<body epub:type="cover">
  <div>
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <image width="${w}" height="${h}" xlink:href="${coverEntry.href}"/>
    </svg>
  </div>
</body>
</html>
`);
      }
    }
    for (const im of images) zip.file(O + im.href, im.bytes);
    if (coverEntry) zip.file(O + coverEntry.href, coverEntry.bytes);

    // Sumário (nav.xhtml EPUB3 + toc.ncx EPUB2)
    const tocItems = toc.length ? toc : [{ level: 1, text: title, id: '' }];
    const minLevel = Math.min(...tocItems.map((t) => t.level));
    // monta árvore
    const root = { children: [], level: minLevel - 1 };
    const stack = [root];
    tocItems.forEach((t) => {
      const node = { ...t, children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= t.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    });
    const navOl = (nodes, ind) => `${ind}<ol>\n` + nodes.map((n) =>
      `${ind}  <li><a href="texto.xhtml${n.id ? '#' + n.id : ''}">${esc(n.text)}</a>${n.children.length ? '\n' + navOl(n.children, ind + '    ') + ind + '  ' : ''}</li>\n`
    ).join('') + `${ind}</ol>\n`;
    zip.file(O + 'nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}">
<head><meta charset="utf-8" /><title>Sumário</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Sumário</h1>
${navOl(root.children, '    ')}  </nav>
</body>
</html>
`);
    let order = 0;
    const ncxPoints = (nodes, ind) => nodes.map((n) => {
      order++;
      return `${ind}<navPoint id="np${order}" playOrder="${order}">
${ind}  <navLabel><text>${esc(n.text)}</text></navLabel>
${ind}  <content src="texto.xhtml${n.id ? '#' + n.id : ''}"/>
${ncxPoints(n.children, ind + '  ')}${ind}</navPoint>
`;
    }).join('');
    const bookId = meta.uuid || uuid();
    zip.file(O + 'toc.ncx', `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${esc(lang)}">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookId}"/>
    <meta name="dtb:depth" content="3"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
${ncxPoints(root.children, '    ')}  </navMap>
</ncx>
`);

    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const manifest = [
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      '<item id="css" href="style.css" media-type="text/css"/>',
      '<item id="texto" href="texto.xhtml" media-type="application/xhtml+xml"' + (/<svg[\s>]/.test(inner) ? ' properties="svg"' : '') + '/>',
    ];
    if (coverEntry) {
      manifest.push('<item id="capa" href="capa.xhtml" media-type="application/xhtml+xml" properties="svg"/>');
      manifest.push(`<item id="cover-image" href="${coverEntry.href}" media-type="${coverEntry.mime}" properties="cover-image"/>`);
    }
    images.forEach((im) => manifest.push(`<item id="${im.id}" href="${im.href}" media-type="${im.mime}"/>`));

    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">urn:uuid:${bookId}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
${meta.author ? `    <dc:creator id="autor">${esc(meta.author)}</dc:creator>\n` : ''}${meta.publisher ? `    <dc:publisher>${esc(meta.publisher)}</dc:publisher>\n` : ''}${meta.description ? `    <dc:description>${esc(meta.description)}</dc:description>\n` : ''}    <dc:language>${esc(lang)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
    <meta name="criador-epub:notas-titulo" content="${esc(meta.notesTitle || 'Notas')}"/>
${meta.category ? `    <meta name="criador-epub:categoria" content="${esc(meta.category)}"/>\n` : ''}${coverEntry ? '    <meta name="cover" content="cover-image"/>\n' : ''}  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx">
${coverEntry ? '    <itemref idref="capa"/>\n' : ''}    <itemref idref="texto"/>
  </spine>
${coverEntry ? '  <guide>\n    <reference type="cover" href="capa.xhtml" title="Capa"/>\n  </guide>\n' : ''}</package>
`;
    zip.file(O + 'content.opf', opf);

    const out = await zip.generateAsync({
      type: 'uint8array',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    return { data: out, notes: notes.length, images: images.length, suggestedName: slug(title) + '.epub', uuid: bookId };
  }

  // ---------- IMPORTAR ----------
  function dirOf(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); }
  function resolvePath(base, rel) {
    rel = decodeURIComponent(rel.split('#')[0].split('?')[0]);
    if (!rel) return base;
    const parts = (rel.startsWith('/') ? rel.slice(1) : dirOf(base) + rel).split('/');
    const out = [];
    parts.forEach((p) => { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); });
    return out.join('/');
  }
  function findZipFile(zip, path) {
    let f = zip.file(path);
    if (f) return f;
    const low = path.toLowerCase();
    const hit = Object.keys(zip.files).find((k) => k.toLowerCase() === low);
    return hit ? zip.file(hit) : null;
  }
  function bytesToB64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(s);
  }
  async function zipDataUri(zip, path) {
    const f = findZipFile(zip, path);
    if (!f) return null;
    const bytes = await f.async('uint8array');
    const ext = (path.split('.').pop() || '').toLowerCase();
    return `data:${MIME_BY_EXT[ext] || 'image/png'};base64,${bytesToB64(bytes)}`;
  }
  function parseDoc(text) {
    // tenta como XHTML; se estiver malformado, usa o parser HTML (tolerante)
    const x = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (!x.getElementsByTagName('parsererror').length && x.body) {
      const h = document.implementation.createHTMLDocument('');
      const imported = h.importNode(x.body, true);
      h.body.replaceWith(imported);
      return h;
    }
    return new DOMParser().parseFromString(text, 'text/html');
  }
  function textOf(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

  async function importEpub(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const containerFile = findZipFile(zip, 'META-INF/container.xml');
    if (!containerFile) throw new Error('Arquivo EPUB inválido (sem META-INF/container.xml).');
    const container = new DOMParser().parseFromString(await containerFile.async('string'), 'application/xml');
    const rootfile = container.getElementsByTagName('rootfile')[0];
    const opfPath = rootfile && rootfile.getAttribute('full-path');
    const opfFile = opfPath && findZipFile(zip, opfPath);
    if (!opfFile) throw new Error('Arquivo EPUB inválido (OPF não encontrado).');
    const opf = new DOMParser().parseFromString(await opfFile.async('string'), 'application/xml');

    const dc = (name) => {
      const el = opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', name)[0];
      return el ? el.textContent.trim() : '';
    };
    const metas = Array.from(opf.getElementsByTagName('meta'));
    const metaName = (n) => { const m = metas.find((x) => x.getAttribute('name') === n); return m ? m.getAttribute('content') : ''; };

    const manifest = new Map();
    Array.from(opf.getElementsByTagName('item')).forEach((it) => {
      manifest.set(it.getAttribute('id'), {
        href: resolvePath(opfPath, it.getAttribute('href')),
        type: it.getAttribute('media-type') || '',
        props: it.getAttribute('properties') || '',
      });
    });

    // identificador
    const uidAttr = opf.documentElement.getAttribute('unique-identifier');
    let ident = '';
    Array.from(opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'identifier')).forEach((el) => {
      if (!ident || el.getAttribute('id') === uidAttr) ident = el.textContent.trim();
    });
    const uuidMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(ident);

    // capa
    let coverItem = null;
    manifest.forEach((v) => { if (/\bcover-image\b/.test(v.props)) coverItem = v; });
    if (!coverItem && metaName('cover')) coverItem = manifest.get(metaName('cover')) || null;
    const cover = coverItem && /^image\//.test(coverItem.type) ? await zipDataUri(zip, coverItem.href) : null;

    const guideCover = Array.from(opf.getElementsByTagName('reference')).find((r) => /cover|title-page/i.test(r.getAttribute('type') || ''));
    const guideCoverPath = guideCover ? resolvePath(opfPath, guideCover.getAttribute('href')) : null;

    // documentos do spine
    const docs = [];
    for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
      const item = manifest.get(ref.getAttribute('idref'));
      if (!item || !/html|xml/.test(item.type) || /\bnav\b/.test(item.props)) continue;
      const f = findZipFile(zip, item.href);
      if (!f) continue;
      const doc = parseDoc(await f.async('string'));
      const b = doc.body;
      if (!b) continue;
      // pula página de capa (só imagem, sem texto)
      const onlyImage = !textOf(b) && b.querySelectorAll('img, svg, image').length > 0;
      if (onlyImage && (item.href === guideCoverPath || docs.length === 0)) continue;
      docs.push({ path: item.href, doc });
    }

    // --- Converter notas de rodapé/fim em anotações ---
    const byKey = new Map();
    docs.forEach((d) => d.doc.querySelectorAll('[id]').forEach((el) => byKey.set(d.path + '#' + el.id, el)));
    const toRemove = new Set();
    docs.forEach((d) => {
      d.doc.querySelectorAll('a[href*="#"]').forEach((a) => {
        const href = a.getAttribute('href');
        if (/^[a-z]+:/i.test(href)) return;
        const targetPath = href.startsWith('#') ? d.path : resolvePath(d.path, href);
        const target = byKey.get(targetPath + '#' + href.split('#')[1]);
        if (!target || target.contains(a) || a.contains(target)) return;
        const etype = (a.getAttribute('epub:type') || '') + ' ' + (a.getAttribute('class') || '') + ' ' + (a.getAttribute('role') || '');
        const tType = (target.getAttribute('epub:type') || '') + ' ' + (target.getAttribute('role') || '') + ' ' + (target.getAttribute('class') || '');
        let backlink = null;
        if (a.id) {
          backlink = Array.from(target.querySelectorAll('a[href]')).find((b) => {
            const bh = b.getAttribute('href');
            return bh.split('#')[1] === a.id;
          }) || null;
        }
        const isNote = /noteref/i.test(etype) || /(foot|end)note|doc-(foot|end)note/i.test(tType) || !!backlink;
        if (!isNote) return;
        const clone = target.cloneNode(true);
        clone.querySelectorAll('a[href]').forEach((b) => {
          const bh = b.getAttribute('href').split('#')[1];
          if (a.id && bh === a.id) b.remove();
          else if (/^\s*[↩↑⤴^]+\s*$/.test(b.textContent)) b.remove();
        });
        clone.querySelectorAll('br').forEach((br) => br.replaceWith('\u2029'));
        const noteText = (clone.textContent || '').replace(/[ \t\r\n\u00a0]+/g, ' ').replace(/ *\u2029 */g, '\n').trim();
        a.setAttribute('class', 'noteref');
        a.setAttribute('href', '#nota');
        a.setAttribute('data-note', noteText);
        a.setAttribute('title', noteText);
        a.removeAttribute('id');
        a.removeAttribute('epub:type');
        a.removeAttribute('role');
        toRemove.add(target);
      });
    });
    const parents = new Set();
    toRemove.forEach((t) => { if (t.parentElement) parents.add(t.parentElement); t.remove(); });
    // remove container de notas que ficou vazio (com o título "Notas")
    parents.forEach((p) => {
      let el = p;
      while (el && el.tagName !== 'BODY') {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('h1,h2,h3,h4,h5,h6,hr').forEach((h) => h.remove());
        if (textOf(clone) || clone.querySelector('img')) break;
        const parent = el.parentElement;
        el.remove();
        el = parent;
      }
    });

    // --- Imagens -> data URI, limpeza ---
    const parts = [];
    for (const d of docs) {
      const b = d.doc.body;
      b.querySelectorAll('script, style, link, meta').forEach((n) => n.remove());
      for (const svg of Array.from(b.querySelectorAll('svg'))) {
        const im = svg.querySelector('image');
        if (!im) continue;
        const h = im.getAttribute('xlink:href') || im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (!h) continue;
        const img = d.doc.createElement('img');
        img.setAttribute('src', h);
        img.setAttribute('alt', 'Imagem');
        svg.replaceWith(img);
      }
      for (const img of Array.from(b.querySelectorAll('img'))) {
        const src = img.getAttribute('src') || '';
        if (/^data:/i.test(src)) continue;
        const uri = /^[a-z]+:/i.test(src) ? null : await zipDataUri(zip, resolvePath(d.path, src));
        if (uri) img.setAttribute('src', uri); else img.remove();
      }
      b.querySelectorAll('[class]').forEach((el) => {
        if (el.classList.contains('noteref')) el.setAttribute('class', 'noteref');
        else if (el.classList.contains('pagebreak')) el.setAttribute('class', 'pagebreak');
        else el.removeAttribute('class');
      });
      b.querySelectorAll('[id^="calibre_"]').forEach((el) => el.removeAttribute('id'));
      // links internos para outros arquivos do livro (não-notas) não fazem sentido no editor
      b.querySelectorAll('a[href]').forEach((a) => {
        const h = a.getAttribute('href');
        if (a.classList.contains('noteref') || /^[a-z]+:/i.test(h) || h.startsWith('#')) return;
        a.replaceWith(...a.childNodes);
      });
      // texto solto direto no body -> parágrafo
      Array.from(b.childNodes).forEach((n) => {
        if (n.nodeType === 3 && n.textContent.trim()) {
          const p = d.doc.createElement('p');
          p.textContent = n.textContent.trim();
          n.replaceWith(p);
        }
      });
      // parágrafos vazios repetidos
      b.querySelectorAll('p').forEach((p) => {
        if (!textOf(p) && !p.querySelector('img, br') && p.childNodes.length && !p.textContent.includes(' ')) p.remove();
      });
      parts.push(b.innerHTML.trim());
    }

    const notesTitle = metaName('criador-epub:notas-titulo') || 'Notas';
    let lang = dc('language') || 'pt-BR';
    if (/^pt$/i.test(lang)) lang = 'pt-BR';
    return {
      meta: {
        title: dc('title'),
        author: dc('creator'),
        publisher: dc('publisher'),
        description: (dc('description') || '').replace(/<[^>]+>/g, ''),
        language: lang,
        notesTitle,
        category: metaName('criador-epub:categoria') || '',
        cover,
        uuid: uuidMatch ? uuidMatch[1].toLowerCase() : uuid(),
      },
      html: parts.join('\n<div class="pagebreak"></div>\n'),
    };
  }

  window.Epub = { exportEpub, importEpub, PAGE_CONTENT_WIDTH, uuid, esc };
})();
