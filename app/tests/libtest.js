const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { createGoogle } = require(__dirname + '/../google.js');
const { createLocalLibrary } = require(__dirname + '/../local-library.js');
// ---- Drive simulado ----
const files = {}; let n = 1; const sessions = {};
const add = (o) => { const id = 'F' + n++; files[id] = Object.assign({ id, trashed: false, parents: [] }, o); return files[id]; };
function match(f, q) {
  if (/trashed=false/.test(q) && f.trashed) return false;
  if (/mimeType='application\/vnd.google-apps.folder'/.test(q) && !f.folder) return false;
  if (/mimeType!='application\/vnd.google-apps.folder'/.test(q) && f.folder) return false;
  const nm = /name='((?:\\'|[^'])*)'/.exec(q); if (nm && f.name !== nm[1].replace(/\\'/g, "'")) return false;
  const ps = [...q.matchAll(/'([^']+)' in parents/g)].map(m => m[1]);
  if (ps.length && !ps.some(p => f.parents.includes(p))) return false;
  return true;
}
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); let body = []; for await (const c of req) body.push(c); body = Buffer.concat(body);
  const json = (o, st = 200, h = {}) => { res.writeHead(st, Object.assign({ 'Content-Type': 'application/json' }, h)); res.end(JSON.stringify(o)); };
  if (u.pathname === '/token') return json({ access_token: 'AT', expires_in: 3600 });
  if (u.pathname === '/drive/files' && req.method === 'GET') { const q = u.searchParams.get('q').replace(/'root' in parents/, "'ROOT' in parents"); return json({ files: Object.values(files).filter(f => match(f, q)).map(f => ({ id: f.id, name: f.name, parents: f.parents, modifiedTime: f.t || '2026-01-01', size: f.data ? f.data.length : 0 })) }); }
  if (u.pathname === '/drive/files' && req.method === 'POST') { const m = JSON.parse(body); const f = add({ name: m.name, folder: m.mimeType === 'application/vnd.google-apps.folder', parents: m.parents || ['ROOT'] }); return json({ id: f.id, name: f.name }); }
  let m;
  if ((m = /^\/upload\/files(?:\/(\w+))?$/.exec(u.pathname))) { const sid = 'S' + n++; sessions[sid] = { id: m[1], meta: JSON.parse(body) }; return json({}, 200, { Location: `http://127.0.0.1:${srv.address().port}/session/${sid}` }); }
  if ((m = /^\/session\/(\w+)$/.exec(u.pathname))) { const s = sessions[m[1]]; let f = s.id ? files[s.id] : add({ parents: s.meta.parents }); f.name = s.meta.name; f.data = body; f.t = new Date().toISOString(); return json({ id: f.id, name: f.name }); }
  if ((m = /^\/drive\/files\/(\w+)$/.exec(u.pathname))) { const f = files[m[1]]; if (!f) return json({ error: { message: 'nf' } }, 404);
    if (req.method === 'PATCH') { const b = body.length ? JSON.parse(body) : {}; Object.assign(f, b);
      if (u.searchParams.get('addParents')) { const rm = (u.searchParams.get('removeParents') || '').split(',').filter(Boolean); f.parents = f.parents.filter(p => !rm.includes(p)).concat([u.searchParams.get('addParents')]); }
      return json({ id: f.id }); }
    if (u.searchParams.get('fields') === 'parents') return json({ parents: f.parents });
    res.writeHead(200); return res.end(f.data); }
  json({ error: 'nope ' + req.method + u.pathname }, 500);
});
srv.listen(0, '127.0.0.1', async () => {
  const B = `http://127.0.0.1:${srv.address().port}`;
  const g = createGoogle({ fetch, getConfig: () => ({ client_id: 'c' }), openExternal: async () => {},
    storage: { loadToken: () => ({ refresh_token: 'R' }), saveToken() {}, loadUser: () => ({ email: 'a@b' }), saveUser() {} },
    endpoints: { token: B + '/token', drive: B + '/drive', upload: B + '/upload', userinfo: B + '/u' } });
  // pasta raiz com um EPUB antigo solto
  const root = add({ name: 'Criador de EPUB', folder: true, parents: ['ROOT'] });
  add({ name: 'Antigo.epub', parents: [root.id], data: Buffer.from('x') });
  let lib = await g.library();
  console.log('DRIVE categorias:', lib.categories.map(c => c.name).join(' | '));
  console.log('DRIVE antigo foi para:', lib.files.map(f => f.title + '→' + f.category).join(', '));
  const disc = lib.categories.find(c => c.name === 'Discursos Públicos');
  const up = await g.upload({ name: 'Nº 132 Ressurreição.epub', data: Buffer.from('E1'), folderId: disc.id });
  const tes = await g.createCategory('Estudos Especiais');
  await g.upload({ id: up.id, name: 'Nº 132 Ressurreição (rev).epub', data: Buffer.from('E2'), folderId: tes.id }); // renomeia + muda categoria
  lib = await g.library();
  console.log('DRIVE após salvar/renomear/mover:', lib.files.map(f => f.title + '→' + f.category).join(', '), '| cats:', lib.categories.map(c => c.name).join(' | '));
  try { await g.deleteCategory(tes.id); } catch (e) { console.log('DRIVE excluir categoria cheia ->', e.code); }
  await g.moveFile(up.id, disc.id); await g.moveFile(up.id, disc.id);
  await g.renameCategory(tes.id, 'Estudos'); await g.deleteCategory(tes.id);
  lib = await g.library();
  console.log('DRIVE final:', lib.files.map(f => f.title + '→' + f.category).join(', '), '| cats:', lib.categories.map(c => c.name).join(' | '));
  srv.close();
  // ---- local ----
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
  fs.writeFileSync(path.join(base, 'Solto.epub'), 'x');
  const L = createLocalLibrary({ baseDir: base, trashItem: async (p) => fs.unlinkSync(p) });
  let l = L.library();
  console.log('LOCAL categorias:', l.categories.map(c => c.name).join(' | '), '| solto→', l.files.map(f => f.category).join());
  const d = l.categories[0];
  const s1 = L.save({ name: 'Discurso A.epub', data: Buffer.from('a'), folderId: d.id });
  const nc = L.createCategory('Minha: categoria?');
  const s2 = L.save({ id: s1.id, name: 'Discurso A2.epub', data: Buffer.from('b'), folderId: nc.id });
  l = L.library();
  console.log('LOCAL após renomear/mover:', l.files.map(f => f.title + '→' + f.category).join(', '), '| antigo existe?', fs.existsSync(s1.id));
  try { L.deleteCategory(nc.id); } catch (e) { console.log('LOCAL excluir cheia ->', e.code); }
  try { L.read(path.join(base, '..', 'x')); } catch (e) { console.log('LOCAL fora da pasta ->', e.code); }
  const mv = L.moveFile(s2.id, d.id); await L.trash(mv); L.deleteCategory(nc.id);
  console.log('LOCAL final:', L.library().files.length, 'arquivos (Outros tem o solto)', '| cats:', L.categories().map(c => c.name).join(' | '));
});
