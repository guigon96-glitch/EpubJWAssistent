/* Textos bíblicos — Tradução do Novo Mundo (Edição de Estudo), português.
 * Os versículos são buscados no jw.org na hora (não ficam guardados no app).
 */
(function () {
  'use strict';

  const BASE = 'https://www.jw.org/pt/biblioteca/biblia/biblia-de-estudo/livros/json/data/';
  const LABEL = 'Tradução do Novo Mundo';

  // número do livro -> nomes/abreviações aceitos (sem acento, minúsculo, sem ponto)
  const BOOKS = [
    [1, 'genesis', 'gen', 'gn'],
    [2, 'exodo', 'ex', 'exo'],
    [3, 'levitico', 'lev', 'lv'],
    [4, 'numeros', 'num', 'nm'],
    [5, 'deuteronomio', 'deut', 'dt'],
    [6, 'josue', 'jos', 'js'],
    [7, 'juizes', 'jz', 'jui'],
    [8, 'rute', 'ru', 'rt'],
    [9, '1 samuel', '1 sam', '1 sa', '1 sm'],
    [10, '2 samuel', '2 sam', '2 sa', '2 sm'],
    [11, '1 reis', '1 re', '1 rs'],
    [12, '2 reis', '2 re', '2 rs'],
    [13, '1 cronicas', '1 cro', '1 cr'],
    [14, '2 cronicas', '2 cro', '2 cr'],
    [15, 'esdras', 'esd', 'ed'],
    [16, 'neemias', 'nee', 'ne'],
    [17, 'ester', 'est', 'et'],
    [18, 'jo'], // "Jó" — tratado à parte para não confundir com João
    [19, 'salmos', 'salmo', 'sal', 'sl'],
    [20, 'proverbios', 'prov', 'pro', 'pr'],
    [21, 'eclesiastes', 'ecl', 'ec'],
    [22, 'cantico de salomao', 'cantico dos canticos', 'canticos', 'cantico', 'can', 'ct'],
    [23, 'isaias', 'isa', 'is'],
    [24, 'jeremias', 'jer', 'jr'],
    [25, 'lamentacoes', 'lam', 'lm'],
    [26, 'ezequiel', 'eze', 'ez'],
    [27, 'daniel', 'dan', 'dn'],
    [28, 'oseias', 'ose'],
    [29, 'joel', 'jl'],
    [30, 'amos'],
    [31, 'obadias', 'oba', 'ob', 'abdias'],
    [32, 'jonas', 'jon', 'jn'],
    [33, 'miqueias', 'miq', 'mq'],
    [34, 'naum'],
    [35, 'habacuque', 'hab', 'hc'],
    [36, 'sofonias', 'sof', 'sf'],
    [37, 'ageu', 'ag'],
    [38, 'zacarias', 'zac', 'zc'],
    [39, 'malaquias', 'mal', 'ml'],
    [40, 'mateus', 'mat', 'mt'],
    [41, 'marcos', 'mar', 'mr', 'mc'],
    [42, 'lucas', 'luc', 'lu', 'lc'],
    [43, 'joao'], // "João" / "Jo" tratados à parte
    [44, 'atos', 'at'],
    [45, 'romanos', 'rom', 'ro', 'rm'],
    [46, '1 corintios', '1 cor', '1 co'],
    [47, '2 corintios', '2 cor', '2 co'],
    [48, 'galatas', 'gal', 'gl'],
    [49, 'efesios', 'efe', 'ef'],
    [50, 'filipenses', 'fil', 'fp'],
    [51, 'colossenses', 'col', 'cl'],
    [52, '1 tessalonicenses', '1 tes', '1 te', '1 ts'],
    [53, '2 tessalonicenses', '2 tes', '2 te', '2 ts'],
    [54, '1 timoteo', '1 tim', '1 ti', '1 tm'],
    [55, '2 timoteo', '2 tim', '2 ti', '2 tm'],
    [56, 'tito', 'tit', 'tt'],
    [57, 'filemon', 'flm', 'file'],
    [58, 'hebreus', 'heb', 'he', 'hb'],
    [59, 'tiago', 'tia', 'tg'],
    [60, '1 pedro', '1 ped', '1 pe', '1 pd'],
    [61, '2 pedro', '2 ped', '2 pe', '2 pd'],
    [62, '1 joao', '1 jo'],
    [63, '2 joao', '2 jo'],
    [64, '3 joao', '3 jo'],
    [65, 'judas', 'jud', 'jd'],
    [66, 'apocalipse', 'apoc', 'apo', 'ap'],
  ];
  const ALIAS = new Map();
  BOOKS.forEach(([n, ...names]) => names.forEach((a) => ALIAS.set(a, n)));
  // abreviações oficiais curtas que também são palavras comuns ("de", "os"...):
  // só valem no modo "loose" (painel de base / referência selecionada)
  const LOOSE = new Map([['de', 5], ['le', 3], ['nu', 4], ['je', 24], ['la', 25], ['da', 26], ['os', 28], ['am', 30], ['na', 34], ['za', 38], ['ju', 65]]);

  function norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\./g, ' ').replace(/([123])\s*[ºª°]?\s*(?=[a-z])/g, '$1 ').replace(/\s+/g, ' ').trim();
  }
  // "Jó" (com acento) = livro de Jó; "Jo"/"João" = João
  function lookupBook(raw, loose) {
    const r = raw.trim().replace(/\.$/, '');
    if (/^j[óÓ]$/i.test(r)) return 18;
    const k = norm(r);
    if (k === 'jo' || k === 'joao') return 43;
    return ALIAS.get(k) || (loose && /^[A-ZÀ-Ú]/.test(r) ? LOOSE.get(k) : null) || null;
  }

  // Ex.: "1 Coríntios 15:26", "João 5:28, 29", "Lucas 7:11-17", "Sal. 83:18", "Jó 14:14, 15"
  const REF_RE = /((?:[123]\s?[ºª]?\s?)?[A-Za-zÀ-ÖØ-öø-ÿ]+\.?(?:\s+(?:de|dos)\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)?)\s+(\d{1,3}):(\d{1,3}(?:\s*[-–]\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*)/g;

  /** Encontra referências bíblicas num texto. Retorna [{start, end, text, book, chapter, segments:[[a,b]]}] */
  function findRefs(text, loose) {
    const out = [];
    REF_RE.lastIndex = 0;
    let m;
    while ((m = REF_RE.exec(text))) {
      // o "livro" capturado pode trazer palavras antes (ex.: "texto de Isaías") — tenta do fim para o começo
      const words = m[1].split(/\s+/);
      let book = null; let bookStr = '';
      for (let i = 0; i < words.length && !book; i++) {
        const cand = words.slice(i).join(' ');
        const b = lookupBook(cand, loose);
        if (b) { book = b; bookStr = cand; }
      }
      if (!book) { REF_RE.lastIndex = m.index + m[1].length; continue; }
      // não pode estar colado em letra/número antes
      const start = m.index + m[1].length - bookStr.length;
      if (start > 0 && /[\wÀ-ÿ]/.test(text[start - 1])) continue;
      const chapter = Number(m[2]);
      const segments = [];
      m[3].split(',').forEach((part) => {
        const [a, b] = part.split(/[-–]/).map((x) => Number(x.trim()));
        if (a) segments.push([a, b && b >= a ? b : a]);
      });
      // junta segmentos contíguos (28, 29 -> 28-29)
      const merged = [];
      segments.forEach((s) => {
        const last = merged[merged.length - 1];
        if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]); else merged.push([...s]);
      });
      const end = m.index + m[0].length;
      out.push({ start, end, text: text.slice(start, end), book, chapter, segments: merged });
    }
    return out;
  }

  function vid(book, ch, v) { return String(book) + String(ch).padStart(3, '0') + String(v).padStart(3, '0'); }

  // Retorna o texto limpo do versículo. Quebras de parágrafo e linhas de poesia viram "\n".
  // brk.lead / brk.trail indicam se o versículo começa/termina com quebra.
  function cleanVerseHtml(html) {
    const d = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    // remove número do versículo/capítulo, marcadores de nota (*) e referências cruzadas (+)
    d.querySelectorAll('sup.verseNum, span.chapterNum, fn, xref, sup, a.footnoteLink, a.xrefLink').forEach((n) => n.remove());
    d.querySelectorAll('.parabreak, .newblock').forEach((n) => n.replaceWith('\u2029'));
    let t = (d.body.textContent || '')
      .replace(/[\u00a0\u202f\u2009\r\n\t ]+/g, ' ')
      .replace(/ *\u2029[ \u2029]*/g, '\n')
      .replace(/ +([,.;:!?)])/g, '$1');
    const lead = /^\s*\n/.test(t);
    const trail = /\n\s*$/.test(t);
    t = t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    return { text: t, lead, trail };
  }

  const cache = new Map();
  async function fetchRange(book, ch, a, b) {
    const key = `${vid(book, ch, a)}-${vid(book, ch, b)}`;
    if (cache.has(key)) return cache.get(key);
    const json = await window.__bibleFetch(BASE + key);
    if (!json || !json.ranges) throw new Error('Texto não encontrado no jw.org.');
    const range = Object.values(json.ranges)[0];
    if (!range || !range.verses || !range.verses.length) throw new Error('Texto não encontrado no jw.org.');
    const res = {
      citation: (range.citation || '').replace(/&nbsp;/g, ' ').replace(/ /g, ' '),
      verses: range.verses.map((v) => Object.assign({ n: v.verseNumber }, cleanVerseHtml(v.content))),
    };
    cache.set(key, res);
    return res;
  }

  /** Busca o texto de uma referência (resultado de findRefs). opts.numbers = incluir números dos versículos */
  async function getNote(ref, opts = {}) {
    const parts = [];
    for (const [a, b] of ref.segments) {
      const r = await fetchRange(ref.book, ref.chapter, a, b);
      let txt = '';
      r.verses.forEach((v, i) => {
        if (i > 0) txt += (v.lead || r.verses[i - 1].trail) ? '\n' : ' ';
        txt += opts.numbers === false ? v.text : `${v.n} ${v.text}`;
      });
      parts.push(txt);
    }
    // formato: só o texto; na última linha, a tradução
    return `${parts.join(' … ')}\n${LABEL}`;
  }

  window.Bible = { findRefs, getNote, cleanVerseHtml, lookupBook };
})();
