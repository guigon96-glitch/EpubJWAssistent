const http = require('http'); const crypto = require('crypto'); const assert = require('assert');
const { createGoogle } = require(__dirname + '/../google.js');
const files = {}; let nextId = 1; let lastChallenge; const sessions = {};
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); let body = []; for await (const c of req) body.push(c); body = Buffer.concat(body);
  const json = (o, st = 200, h = {}) => { res.writeHead(st, Object.assign({ 'Content-Type': 'application/json' }, h)); res.end(JSON.stringify(o)); };
  if (u.pathname === '/token') { const p = new URLSearchParams(body.toString());
    if (p.get('grant_type') === 'authorization_code') { assert.strictEqual(crypto.createHash('sha256').update(p.get('code_verifier')).digest('base64url'), lastChallenge); assert.ok(p.get('redirect_uri').startsWith('http://127.0.0.1:'));
      return json({ access_token: 'AT1', expires_in: 3600, refresh_token: 'RT', scope: 'openid email https://www.googleapis.com/auth/drive.file' }); }
    if (p.get('refresh_token') === 'RT') return json({ access_token: 'AT2', expires_in: 3600 }); return json({ error: 'invalid_grant' }, 400); }
  if (!/^Bearer AT/.test(req.headers.authorization || '')) return json({ error: { message: 'unauth' } }, 401);
  if (u.pathname === '/userinfo') return json({ email: 'teste@exemplo.com', name: 'Teste' });
  if (u.pathname === '/drive/files' && req.method === 'GET') { const q = u.searchParams.get('q');
    let list = Object.values(files).filter(f => !f.trashed);
    if (q.includes("mimeType='application/vnd.google-apps.folder'")) list = list.filter(f => f.folder);
    else { const par = /'([^']+)' in parents/.exec(q)[1]; list = list.filter(f => f.parent === par); const nm = /name='((?:\\'|[^'])*)'/.exec(q); if (nm) list = list.filter(f => f.name === nm[1].replace(/\\'/g, "'")); }
    return json({ files: list.map(f => ({ id: f.id, name: f.name, modifiedTime: 't' })) }); }
  if (u.pathname === '/drive/files' && req.method === 'POST') { const m = JSON.parse(body); const id = 'F' + nextId++; files[id] = { id, name: m.name, folder: true }; return json({ id }); }
  let m;
  if ((m = /^\/upload\/files(?:\/(\w+))?$/.exec(u.pathname))) { const meta = JSON.parse(body); const id = m[1] || ('F' + nextId++); const sid = 'S' + nextId++; sessions[sid] = { id, meta, isNew: !m[1] }; return json({}, 200, { Location: `http://127.0.0.1:${srv.address().port}/session/${sid}` }); }
  if ((m = /^\/session\/(\w+)$/.exec(u.pathname))) { const s = sessions[m[1]]; const f = files[s.id] || (files[s.id] = { id: s.id, parent: s.meta.parents[0] }); f.name = s.meta.name; f.data = body; return json({ id: f.id, name: f.name }); }
  if ((m = /^\/drive\/files\/(\w+)$/.exec(u.pathname))) { if (!files[m[1]]) return json({ error: { message: 'nf' } }, 404);
    if (req.method === 'PATCH') { Object.assign(files[m[1]], JSON.parse(body)); return json({}); } res.writeHead(200); return res.end(files[m[1]].data); }
  json({ error: 'nope ' + u.pathname }, 500);
});
srv.listen(0, '127.0.0.1', async () => {
  const B = `http://127.0.0.1:${srv.address().port}`;
  let tok = null, user = null;
  const g = createGoogle({ fetch, getConfig: () => ({ client_id: 'cid', client_secret: 'sec' }),
    storage: { loadToken: () => tok, saveToken: t => tok = t, loadUser: () => user, saveUser: u => user = u },
    endpoints: { auth: B + '/auth', token: B + '/token', revoke: B + '/revoke', userinfo: B + '/userinfo', drive: B + '/drive', upload: B + '/upload' },
    openExternal: async (url) => { const u = new URL(url); lastChallenge = u.searchParams.get('code_challenge');
      assert.ok(u.searchParams.get('scope').includes('drive.file')); const r = await fetch(`${u.searchParams.get('redirect_uri')}/?code=C1&state=${u.searchParams.get('state')}`); assert.ok((await r.text()).includes('Pronto')); } });
  console.log('login ->', await g.login(), 'user', g.currentUser());
  await g.logout(); console.log('after logout', g.currentUser(), tok);
  try { await g.library(); } catch (e) { console.log('err code', e.code); }
  srv.close();
});
