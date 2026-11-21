/* Biblioteca no computador: <Documentos>/Criador de EPUB/<Categoria>/<Título>.epub
 * Mesma ideia do Google Drive: categoria = subpasta.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULT_CATEGORIES, sortCategories } = require('./google');

class LibError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const BAD = /[\\/:*?"<>|\u0000-\u001f]/g;
function cleanName(s) { return String(s || '').replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 100); }

function createLocalLibrary({ baseDir, trashItem }) {
  function ensure() {
    fs.mkdirSync(baseDir, { recursive: true });
    for (const c of DEFAULT_CATEGORIES) fs.mkdirSync(path.join(baseDir, c), { recursive: true });
  }
  function inside(p) {
    const rel = path.relative(baseDir, p);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new LibError('PATH', 'Caminho fora da biblioteca.');
    return p;
  }
  function categories() {
    ensure();
    return sortCategories(fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({ id: path.join(baseDir, d.name), name: d.name })));
  }
  function library() {
    ensure();
    const outros = path.join(baseDir, 'Outros');
    // EPUBs soltos na raiz vão para "Outros"
    for (const f of fs.readdirSync(baseDir)) {
      if (/\.epub$/i.test(f) && fs.statSync(path.join(baseDir, f)).isFile()) {
        let dest = path.join(outros, f); let n = 2;
        while (fs.existsSync(dest)) dest = path.join(outros, f.replace(/\.epub$/i, ` (${n++}).epub`));
        try { fs.renameSync(path.join(baseDir, f), dest); } catch (e) { /* em uso: tenta depois */ }
      }
    }
    const cats = categories();
    const files = [];
    for (const c of cats) {
      for (const f of fs.readdirSync(c.id)) {
        if (!/\.epub$/i.test(f)) continue;
        const p = path.join(c.id, f);
        let st; try { st = fs.statSync(p); } catch (e) { continue; }
        if (!st.isFile()) continue;
        files.push({ id: p, name: f, title: f.replace(/\.epub$/i, ''), modified: st.mtime.toISOString(), size: st.size, categoryId: c.id, category: c.name });
      }
    }
    files.sort((x, y) => y.modified.localeCompare(x.modified));
    return { categories: cats, files, baseDir };
  }
  function createCategory(name) {
    const n = cleanName(name);
    if (!n) throw new LibError('NAME', 'Nome de categoria inválido.');
    ensure();
    const p = path.join(baseDir, n);
    fs.mkdirSync(p, { recursive: true });
    return { id: p, name: n };
  }
  function renameCategory(id, name) {
    const n = cleanName(name);
    if (!n) throw new LibError('NAME', 'Nome de categoria inválido.');
    const dest = path.join(baseDir, n);
    if (fs.existsSync(dest)) throw new LibError('EXISTS', 'Já existe uma categoria com esse nome.');
    fs.renameSync(inside(id), dest);
  }
  function deleteCategory(id) {
    inside(id);
    if (fs.readdirSync(id).some((f) => /\.epub$/i.test(f))) throw new LibError('NOT_EMPTY', 'A categoria ainda tem EPUBs. Mova-os antes de excluir.');
    fs.rmSync(id, { recursive: true, force: true });
  }
  function findByName(name, folderId) {
    const p = path.join(folderId, name);
    return fs.existsSync(p) ? { id: p, name } : null;
  }
  /** Grava o EPUB. Se o arquivo já existia em outro lugar/nome (renomeou ou trocou de categoria), remove o antigo. */
  function save({ id, name, data, folderId }) {
    const dest = path.join(inside(folderId), name);
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, dest);
    if (id && path.resolve(id) !== path.resolve(dest)) { try { inside(id); fs.unlinkSync(id); } catch (e) { /* já não existe */ } }
    return { id: dest, name };
  }
  function read(id) { return fs.readFileSync(inside(id)); }
  function moveFile(id, toFolder) {
    inside(id); inside(toFolder);
    const name = path.basename(id);
    let dest = path.join(toFolder, name); let n = 2;
    if (path.resolve(dest) === path.resolve(id)) return id;
    while (fs.existsSync(dest)) dest = path.join(toFolder, name.replace(/\.epub$/i, ` (${n++}).epub`));
    fs.renameSync(id, dest);
    return dest;
  }
  async function trash(id) { inside(id); await trashItem(id); }

  return { library, categories, createCategory, renameCategory, deleteCategory, findByName, save, read, moveFile, trash, baseDir };
}

module.exports = { createLocalLibrary, cleanName, LibError };
