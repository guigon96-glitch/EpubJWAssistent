/* Conta Google + Google Drive (processo principal).
 * - Login OAuth 2.0 para apps instalados: abre o navegador, recebe o código num endereço local
 *   (http://127.0.0.1:porta) e usa PKCE.
 * - Permissão "drive.file": o app só enxerga os arquivos que ele mesmo criou no Drive da pessoa.
 * - Cada conta tem os próprios arquivos, na pasta "Criador de EPUB".
 */
'use strict';
const http = require('http');
const crypto = require('crypto');

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];
const FOLDER_NAME = 'Criador de EPUB';
const EPUB_MIME = 'application/epub+zip';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DEFAULT_CATEGORIES = ['Discursos Públicos', 'Tesouros da Palavra de Deus', 'Outros'];

class GoogleError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

const PAGE = (title, msg) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title>
<body style="font-family:Segoe UI,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f3f3f5">
<div style="background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.12);text-align:center;max-width:420px">
<div style="font-size:40px">📖</div><h2 style="margin:8px 0;color:#2b579a">${title}</h2><p style="color:#444">${msg}</p></div></body></html>`;

/**
 * @param {object} o
 * @param {Function} o.fetch          fetch compatível (net.fetch no Electron)
 * @param {Function} o.openExternal   abre URL no navegador padrão
 * @param {Function} o.getConfig      () => {client_id, client_secret} | null
 * @param {object}   o.storage        { loadToken, saveToken(t|null), loadUser, saveUser(u|null) }
 */
function createGoogle({ fetch, openExternal, getConfig, storage, endpoints = {} }) {
  const E = Object.assign({
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    drive: 'https://www.googleapis.com/drive/v3',
    upload: 'https://www.googleapis.com/upload/drive/v3',
  }, endpoints);

  let access = null;
  let expiresAt = 0;
  let folderId = null;
  let pendingLogin = null;

  function config() {
    const c = getConfig();
    if (!c || !c.client_id) throw new GoogleError('NO_CONFIG', 'O app ainda não foi configurado com o Google.');
    return c;
  }

  async function call(url, opts = {}) {
    let r;
    try { r = await fetch(url, opts); } catch (e) { throw new GoogleError('OFFLINE', 'Sem conexão com a internet.'); }
    return r;
  }

  async function tokenRequest(params) {
    const r = await call(E.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'invalid_grant') throw new GoogleError('AUTH_EXPIRED', 'O acesso ao Google expirou. Entre novamente.');
      throw new GoogleError('AUTH', `Google recusou o login (${j.error_description || j.error || r.status}).`);
    }
    return j;
  }

  /** Abre um servidor local temporário que recebe o retorno do Google. */
  function startLoopback(state) {
    let server; let timer;
    const promise = new Promise((resolve, reject) => {
      const finish = (e, code) => {
        clearTimeout(timer);
        setTimeout(() => server.close(), 300);
        pendingLogin = null;
        if (e) reject(e); else resolve(code);
      };
      server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const code = u.searchParams.get('code');
        const ok = !u.searchParams.get('error') && code && u.searchParams.get('state') === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ok ? PAGE('Pronto!', 'Login feito. Pode fechar esta aba e voltar ao <b>Criador de EPUB</b>.')
          : PAGE('Login cancelado', 'Volte ao Criador de EPUB e tente novamente.'));
        finish(ok ? null : new GoogleError('CANCELLED', 'Login cancelado.'), code);
      });
      server.on('error', (e) => finish(new GoogleError('AUTH', 'Não foi possível iniciar o login: ' + e.message)));
      pendingLogin = { cancel: () => finish(new GoogleError('CANCELLED', 'Login cancelado.')) };
      timer = setTimeout(() => finish(new GoogleError('CANCELLED', 'O login demorou demais e foi cancelado.')), 5 * 60 * 1000);
    });
    const ready = new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
    return { promise, ready };
  }

  async function login() {
    const cfg = config();
    if (pendingLogin) pendingLogin.cancel();
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const lb = startLoopback(state);
    lb.promise.catch(() => {});
    const redirect = await lb.ready;
    const url = E.auth + '?' + new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent select_account',
    }).toString();
    await openExternal(url);
    const code = await lb.promise;
    const t = await tokenRequest({
      code, client_id: cfg.client_id, client_secret: cfg.client_secret || '',
      redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier,
    });
    if (!t.refresh_token) throw new GoogleError('AUTH', 'O Google não devolveu a permissão de acesso contínuo. Tente entrar novamente.');
    if (!String(t.scope || '').includes('drive.file')) {
      throw new GoogleError('NO_DRIVE', 'É preciso marcar a permissão do Google Drive na tela de login para salvar os arquivos.');
    }
    access = t.access_token; expiresAt = Date.now() + (t.expires_in - 60) * 1000; folderId = null;
    storage.saveToken({ refresh_token: t.refresh_token });
    const user = await fetchUser();
    storage.saveUser(user);
    return user;
  }

  function cancelLogin() { if (pendingLogin) pendingLogin.cancel(); }

  async function token() {
    if (access && Date.now() < expiresAt) return access;
    const saved = storage.loadToken();
    if (!saved || !saved.refresh_token) throw new GoogleError('NOT_LOGGED', 'Entre com sua conta Google primeiro.');
    const cfg = config();
    try {
      const t = await tokenRequest({ client_id: cfg.client_id, client_secret: cfg.client_secret || '', refresh_token: saved.refresh_token, grant_type: 'refresh_token' });
      access = t.access_token; expiresAt = Date.now() + (t.expires_in - 60) * 1000;
      return access;
    } catch (e) {
      if (e.code === 'AUTH_EXPIRED') { storage.saveToken(null); storage.saveUser(null); access = null; }
      throw e;
    }
  }

  async function api(url, opts = {}, retry = true) {
    const t = await token();
    const r = await call(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {}) }));
    if (r.status === 401 && retry) { access = null; return api(url, opts, false); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg = (j.error && (j.error.message || j.error)) || r.statusText;
      if (r.status === 404) throw new GoogleError('NOT_FOUND', 'Arquivo não encontrado no Google Drive (foi apagado?).');
      if (r.status === 403 && /quota|storage/i.test(msg)) throw new GoogleError('QUOTA', 'O Google Drive está sem espaço.');
      throw new GoogleError('API', `Erro do Google Drive: ${msg}`);
    }
    return r;
  }

  async function fetchUser() {
    const r = await api(E.userinfo);
    const j = await r.json();
    return { email: j.email || '', name: j.name || j.email || '', picture: j.picture || '' };
  }

  function currentUser() {
    const t = storage.loadToken();
    return t && t.refresh_token ? storage.loadUser() : null;
  }

  async function logout() {
    const saved = storage.loadToken();
    storage.saveToken(null); storage.saveUser(null);
    access = null; folderId = null;
    if (saved && saved.refresh_token) {
      try { await fetch(E.revoke + '?token=' + encodeURIComponent(saved.refresh_token), { method: 'POST' }); } catch (e) { /* sem internet: só esquece localmente */ }
    }
  }

  async function folder() {
    if (folderId) return folderId;
    const query = `name='${q(FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`;
    const r = await api(`${E.drive}/files?` + new URLSearchParams({ q: query, fields: 'files(id,name)', spaces: 'drive' }));
    const j = await r.json();
    if (j.files && j.files.length) { folderId = j.files[0].id; return folderId; }
    const c = await api(`${E.drive}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    folderId = (await c.json()).id;
    return folderId;
  }

  async function listFiles(q, fields) {
    const out = [];
    let pageToken = '';
    do {
      const params = { q, fields: `nextPageToken,files(${fields})`, pageSize: '1000' };
      if (pageToken) params.pageToken = pageToken;
      const r = await api(`${E.drive}/files?` + new URLSearchParams(params));
      const j = await r.json();
      out.push(...(j.files || []));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  async function createFolder(name, parent) {
    const c = await api(`${E.drive}/files?fields=id,name`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
    });
    return c.json();
  }

  /** Categorias = subpastas da pasta "Criador de EPUB". Cria as padrão que faltarem. */
  async function categories() {
    const root = await folder();
    let cats = await listFiles(`'${root}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, 'id,name');
    for (const name of DEFAULT_CATEGORIES) {
      if (!cats.some((c) => c.name === name)) cats.push(await createFolder(name, root));
    }
    return sortCategories(cats.map((c) => ({ id: c.id, name: c.name })));
  }

  async function moveFile(id, toFolder) {
    const r = await api(`${E.drive}/files/${encodeURIComponent(id)}?fields=parents`);
    const cur = (await r.json()).parents || [];
    if (cur.length === 1 && cur[0] === toFolder) return;
    const params = { addParents: toFolder, fields: 'id' };
    const remove = cur.filter((p) => p !== toFolder);
    if (remove.length) params.removeParents = remove.join(',');
    await api(`${E.drive}/files/${encodeURIComponent(id)}?` + new URLSearchParams(params), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
  }

  /** Lista categorias e EPUBs. EPUBs soltos na raiz (versões antigas) são movidos para "Outros". */
  async function library() {
    const root = await folder();
    const cats = await categories();
    const outros = cats.find((c) => c.name === 'Outros');
    const soltos = await listFiles(`'${root}' in parents and mimeType!='${FOLDER_MIME}' and trashed=false`, 'id,name');
    for (const f of soltos) { if (/\.epub$/i.test(f.name)) { try { await moveFile(f.id, outros.id); } catch (e) { /* tenta na próxima */ } } }
    const files = [];
    // consulta em lotes (limite de tamanho da consulta)
    for (let i = 0; i < cats.length; i += 20) {
      const lote = cats.slice(i, i + 20);
      const q = '(' + lote.map((c) => `'${c.id}' in parents`).join(' or ') + `) and mimeType!='${FOLDER_MIME}' and trashed=false`;
      files.push(...await listFiles(q, 'id,name,modifiedTime,size,parents'));
    }
    const byId = new Map(cats.map((c) => [c.id, c]));
    return {
      categories: cats,
      files: files.filter((f) => /\.epub$/i.test(f.name)).map((f) => {
        const c = (f.parents || []).map((p) => byId.get(p)).find(Boolean) || outros;
        return { id: f.id, name: f.name, title: f.name.replace(/\.epub$/i, ''), modified: f.modifiedTime, size: Number(f.size || 0), categoryId: c.id, category: c.name };
      }).sort((x, y) => String(y.modified).localeCompare(String(x.modified))),
    };
  }

  async function createCategory(name) {
    const root = await folder();
    const existing = await listFiles(`'${root}' in parents and mimeType='${FOLDER_MIME}' and name='${q(name)}' and trashed=false`, 'id,name');
    if (existing.length) return { id: existing[0].id, name: existing[0].name };
    const f = await createFolder(name, root);
    return { id: f.id, name: f.name };
  }
  async function renameCategory(id, name) {
    await api(`${E.drive}/files/${encodeURIComponent(id)}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  }
  async function deleteCategory(id) {
    const left = await listFiles(`'${id}' in parents and trashed=false`, 'id');
    if (left.length) throw new GoogleError('NOT_EMPTY', 'A categoria ainda tem EPUBs. Mova-os antes de excluir.');
    await trash(id);
  }

  async function findByName(name, folderId) {
    const f = folderId || await folder();
    const r = await listFiles(`'${f}' in parents and name='${q(name)}' and trashed=false`, 'id,name');
    return r[0] || null;
  }

  /** Envia (cria ou substitui) um EPUB numa categoria. Upload "resumable" aceita arquivos grandes. */
  async function upload({ id, name, data, folderId }) {
    const meta = id ? { name } : { name, mimeType: EPUB_MIME, parents: [folderId || await folder()] };
    const start = await api(`${E.upload}/files${id ? '/' + id : ''}?uploadType=resumable&fields=id,name,modifiedTime`, {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': EPUB_MIME, 'X-Upload-Content-Length': String(data.length) },
      body: JSON.stringify(meta),
    });
    const loc = start.headers.get('location');
    if (!loc) throw new GoogleError('API', 'O Google Drive não aceitou o envio.');
    const t = await token();
    const r = await call(loc, { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': EPUB_MIME }, body: data });
    if (!r.ok) throw new GoogleError('API', `Falha ao enviar o arquivo (${r.status}).`);
    const res = await r.json();
    if (id && folderId) await moveFile(id, folderId);
    return res;
  }

  async function download(id) {
    const r = await api(`${E.drive}/files/${encodeURIComponent(id)}?alt=media`);
    return Buffer.from(await r.arrayBuffer());
  }

  async function trash(id) {
    await api(`${E.drive}/files/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    });
  }

  return { login, cancelLogin, logout, currentUser, library, categories, createCategory, renameCategory, deleteCategory, moveFile, findByName, upload, download, trash };
}

function sortCategories(cats) {
  const pos = (n) => { const i = DEFAULT_CATEGORIES.indexOf(n); return i < 0 ? 99 : i; };
  return cats.slice().sort((a, b) => pos(a.name) - pos(b.name) || a.name.localeCompare(b.name, 'pt-BR'));
}

module.exports = { createGoogle, GoogleError, SCOPES, FOLDER_NAME, DEFAULT_CATEGORIES, sortCategories };
