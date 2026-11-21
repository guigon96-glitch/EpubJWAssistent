const { app, BrowserWindow, ipcMain, dialog, Menu, shell, net, clipboard, safeStorage } = require('electron');
const { createGoogle } = require('./google');
const { createUpdater } = require('./updater');
const { createLocalLibrary, cleanName } = require('./local-library');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let win;
let dirty = false;
let forceClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Criador de EPUB',
    icon: path.join(__dirname, 'src', 'icon.png'),
    backgroundColor: '#f3f3f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      plugins: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.maximize();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Links externos abrem no navegador, nunca dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  try { win.webContents.session.setSpellCheckerLanguages(['pt-BR']); } catch (e) { /* idioma indisponível */ }

  // Menu do botão direito nativo: sugestões do corretor + anotações + imagem
  win.webContents.on('context-menu', async (_e, params) => {
    const info = await askRenderer();
    const send = (action) => () => win.webContents.send('ctx-action', action);
    const items = [];
    if (params.misspelledWord) {
      const sug = (params.dictionarySuggestions || []).slice(0, 7);
      if (sug.length) sug.forEach((s) => items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) }));
      else items.push({ label: 'Sem sugestões', enabled: false });
      items.push({ label: 'Adicionar ao dicionário', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (info.onNote) {
      items.push({ label: 'Editar anotação', click: send('editnote') });
      items.push({ label: 'Remover anotação', click: send('delnote') });
      items.push({ type: 'separator' });
    } else if (params.isEditable && !info.onImage) {
      items.push({ label: 'Adicionar anotação', click: send('addnote') });
      items.push({ type: 'separator' });
    }
    if (info.onImage) {
      items.push({
        label: 'Tamanho da imagem',
        submenu: [25, 33, 50, 75, 100].map((p) => ({ label: `${p}% da página`, click: send('img:' + p) })),
      });
      items.push({ label: 'Propriedades da imagem…', click: send('imgprops') });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Recortar', role: 'cut', enabled: params.editFlags.canCut });
    items.push({ label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy });
    items.push({ label: 'Colar', role: 'paste', enabled: params.editFlags.canPaste });
    items.push({ type: 'separator' });
    items.push({ label: 'Selecionar tudo', role: 'selectAll' });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  win.on('close', (e) => {
    if (!dirty || forceClose) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Salvar', 'Não salvar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      title: 'Criador de EPUB',
      message: 'Deseja salvar as alterações antes de sair?',
    });
    if (r === 0) win.webContents.send('save-and-close');
    else if (r === 1) { forceClose = true; win.close(); }
  });
}

// Pergunta ao editor o que está sob o clique direito (anotação? imagem?)
function askRenderer() {
  return new Promise((resolve) => {
    const done = (_e, info) => { clearTimeout(t); resolve(info || {}); };
    const t = setTimeout(() => { ipcMain.removeListener('ctx-info', done); resolve({}); }, 400);
    ipcMain.once('ctx-info', done);
    win.webContents.send('ctx-query');
  });
}

// Busca de versículos no jw.org (feita aqui para não esbarrar em CORS)
ipcMain.handle('bible-fetch', async (_e, url) => {
  if (!/^https:\/\/www\.jw\.org\/pt\/biblioteca\/biblia\/biblia-de-estudo\/livros\/json\/data\/\d{8}-\d{8}$/.test(url)) return null;
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 CriadorEPUB', Accept: 'application/json' } });
    if (!r.ok) return null;
    const t = await r.text();
    return JSON.parse(t);
  } catch (e) { return null; }
});

ipcMain.on('set-dirty', (_e, v) => { dirty = !!v; });
ipcMain.on('set-title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.on('close-now', () => { forceClose = true; if (win) win.close(); });

ipcMain.handle('open-epub', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir EPUB',
    filters: [{ name: 'Livro EPUB', extensions: ['epub'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  return { path: p, data: fs.readFileSync(p) };
});

ipcMain.handle('save-epub', async (_e, { filePath, data, suggestedName }) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Salvar EPUB',
      defaultPath: suggestedName || 'livro.epub',
      filters: [{ name: 'Livro EPUB', extensions: ['epub'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
    if (!/\.epub$/i.test(target)) target += '.epub';
  }
  fs.writeFileSync(target, Buffer.from(data));
  return target;
});

// ---------- Base para comparação ----------
let refWin = null;
let wolWin = null;
ipcMain.handle('open-ref-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir base para comparação',
    filters: [
      { name: 'Documentos', extensions: ['docx', 'pdf', 'epub', 'txt', 'html', 'htm', 'md'] },
      { name: 'Todos os arquivos', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), ext: path.extname(p).slice(1), data: fs.readFileSync(p) };
});
ipcMain.handle('read-clipboard', () => ({ html: clipboard.readHTML(), text: clipboard.readText() }));
ipcMain.on('open-ref-window', (_e, content) => {
  if (refWin && !refWin.isDestroyed()) {
    refWin.webContents.send('ref-content', content);
    refWin.focus();
    return;
  }
  refWin = new BrowserWindow({
    width: 760, height: 900, title: 'Base para comparação', backgroundColor: '#ffffff', icon: path.join(__dirname, 'src', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, plugins: true, spellcheck: false },
  });
  refWin.setMenuBarVisibility(false);
  refWin.webContents.on('will-navigate', (e) => e.preventDefault());
  refWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  refWin.loadFile(path.join(__dirname, 'src', 'ref.html'));
  refWin.webContents.once('did-finish-load', () => refWin.webContents.send('ref-content', content));
  refWin.on('closed', () => { refWin = null; });
});
ipcMain.on('open-wol', () => {
  if (wolWin && !wolWin.isDestroyed()) { wolWin.focus(); return; }
  wolWin = new BrowserWindow({ width: 900, height: 950, title: 'Biblioteca On-line (wol.jw.org)', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  wolWin.setMenuBarVisibility(false);
  wolWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/([a-z0-9-]+\.)*jw\.org\//i.test(url)) wolWin.loadURL(url); else if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wolWin.loadURL('https://wol.jw.org/pt/wol/h/r5/lp-t');
  wolWin.on('closed', () => { wolWin = null; });
});

// ---------- Conta Google / Google Drive ----------
// Configuração do app no Google Cloud: arquivo JSON baixado do console ("ID do cliente OAuth", tipo App para computador).
// Procurado ao lado do .exe (para distribuir junto) ou na pasta de dados do usuário (importado pelo app).
function configPaths() {
  return [
    path.join(path.dirname(app.getPath('exe')), 'google-oauth.json'),
    path.join(__dirname, 'google-oauth.json'),
    path.join(app.getPath('userData'), 'google-oauth.json'),
  ];
}
function parseConfig(text) {
  const j = JSON.parse(text);
  const c = j.installed || j.web || j;
  return c && c.client_id ? { client_id: c.client_id, client_secret: c.client_secret || '' } : null;
}
function getGoogleConfig() {
  for (const p of configPaths()) {
    try { if (fs.existsSync(p)) { const c = parseConfig(fs.readFileSync(p, 'utf8')); if (c) return c; } } catch (e) { /* ignora arquivo inválido */ }
  }
  return null;
}
const dataFile = (n) => path.join(app.getPath('userData'), n);
const googleStorage = {
  loadToken() {
    try {
      const raw = fs.readFileSync(dataFile('google-token.bin'));
      const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
      return JSON.parse(txt);
    } catch (e) { return null; }
  },
  saveToken(t) {
    const f = dataFile('google-token.bin');
    if (!t) { try { fs.unlinkSync(f); } catch (e) {} return; }
    const txt = JSON.stringify(t);
    fs.writeFileSync(f, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt, 'utf8'));
  },
  loadUser() { try { return JSON.parse(fs.readFileSync(dataFile('google-user.json'), 'utf8')); } catch (e) { return null; } },
  saveUser(u) {
    const f = dataFile('google-user.json');
    if (!u) { try { fs.unlinkSync(f); } catch (e) {} return; }
    fs.writeFileSync(f, JSON.stringify(u));
  },
};
const google = createGoogle({
  fetch: (url, opts) => net.fetch(url, opts),
  openExternal: (url) => shell.openExternal(url),
  getConfig: getGoogleConfig,
  storage: googleStorage,
});
// erros viajam como {error:{code,message}} (o IPC perde propriedades de Error)
const safe = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { return { error: { code: e.code || 'ERRO', message: e.message } }; }
};
// ---------- Atualizações (GitHub Releases) ----------
const UPDATE_REPO = 'guigon96-glitch/EpubJWAssistent';
const updater = createUpdater({
  fetch: (url, opts) => net.fetch(url, opts),
  repo: UPDATE_REPO,
  currentVersion: app.getVersion(),
  tmpDir: path.join(app.getPath('temp'), 'CriadorEPUB-update'),
  spawn,
});
let updateInfo = null;
ipcMain.handle('app-info', () => ({ version: app.getVersion(), releases: `https://github.com/${UPDATE_REPO}/releases` }));
ipcMain.handle('upd-check', safe(async () => { updateInfo = await updater.check(); return updateInfo; }));
ipcMain.handle('upd-download', safe(async () => {
  if (!updateInfo || !updateInfo.available) throw Object.assign(new Error('Nenhuma atualização para baixar.'), { code: 'NONE' });
  let last = 0;
  const r = await updater.download(updateInfo, (got, total) => {
    const now = Date.now();
    if (now - last > 150 || got === total) { last = now; if (win) win.webContents.send('upd-progress', { got, total }); }
  });
  return { ok: true, verified: r.verified };
}));
ipcMain.handle('upd-install', safe(async () => {
  if (process.platform !== 'win32') throw Object.assign(new Error('A instalação automática só funciona no Windows.'), { code: 'PLATFORM' });
  updater.install();
  forceClose = true;
  setTimeout(() => app.quit(), 400);
  return { ok: true };
}));
ipcMain.handle('open-external', (_e, url) => { if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); });

ipcMain.handle('g-status', () => ({ configured: !!getGoogleConfig(), user: google.currentUser() }));
ipcMain.handle('g-login', safe(async () => {
  const user = await google.login();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  return { user };
}));
ipcMain.handle('g-cancel', () => google.cancelLogin());
ipcMain.handle('g-logout', safe(async () => { await google.logout(); return {}; }));
// ---------- Biblioteca (Google Drive ou computador), com categorias = pastas ----------
let localLib = null;
function getLocal() {
  if (!localLib) localLib = createLocalLibrary({ baseDir: path.join(app.getPath('documents'), 'Criador de EPUB'), trashItem: (p) => shell.trashItem(p) });
  return localLib;
}
const driveLib = {
  library: () => google.library(),
  createCategory: (n) => google.createCategory(cleanName(n)),
  renameCategory: (id, n) => google.renameCategory(id, cleanName(n)),
  deleteCategory: (id) => google.deleteCategory(id),
  moveFile: async (id, to) => { await google.moveFile(id, to); return id; },
  trash: (id) => google.trash(id),
  read: (id) => google.download(id),
  findByName: (n, f) => google.findByName(n, f),
  save: ({ id, name, data, folderId }) => google.upload({ id, name, data, folderId }),
};
function lib(source) {
  if (source === 'drive') return driveLib;
  if (source === 'local') return getLocal();
  throw Object.assign(new Error('Origem desconhecida.'), { code: 'SOURCE' });
}
ipcMain.handle('lib-info', () => ({ localDir: getLocal().baseDir }));
ipcMain.handle('lib-open-folder', () => shell.openPath(getLocal().baseDir));
ipcMain.handle('lib-list', safe(async (_e, { source }) => lib(source).library()));
ipcMain.handle('lib-cat-create', safe(async (_e, { source, name }) => {
  if (!cleanName(name)) throw Object.assign(new Error('Nome de categoria inválido.'), { code: 'NAME' });
  return { category: await lib(source).createCategory(name) };
}));
ipcMain.handle('lib-cat-rename', safe(async (_e, { source, id, name }) => {
  if (!cleanName(name)) throw Object.assign(new Error('Nome de categoria inválido.'), { code: 'NAME' });
  await lib(source).renameCategory(id, name); return {};
}));
ipcMain.handle('lib-cat-delete', safe(async (_e, { source, id }) => { await lib(source).deleteCategory(id); return {}; }));
ipcMain.handle('lib-move', safe(async (_e, { source, id, to }) => ({ id: await lib(source).moveFile(id, to) })));
ipcMain.handle('lib-trash', safe(async (_e, { source, id }) => { await lib(source).trash(id); return {}; }));
ipcMain.handle('lib-read', safe(async (_e, { source, id }) => ({ data: await lib(source).read(id) })));
ipcMain.handle('lib-save', safe(async (_e, { source, id, title, data, folderId }) => {
  const L = lib(source);
  const base = cleanName(title) || 'Sem título';
  let name = base + '.epub';
  let target = id || null;
  const existing = await L.findByName(name, folderId);
  if (existing && existing.id !== id) {
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', title: 'Criador de EPUB',
      message: `Já existe "${base}" nesta categoria.`,
      detail: 'Deseja substituir o EPUB existente ou salvar com outro nome?',
      buttons: ['Substituir', 'Salvar com outro nome', 'Cancelar'], defaultId: 1, cancelId: 2,
    });
    if (r === 2) return { cancelled: true };
    if (r === 0) {
      const old = id;
      target = existing.id;
      const f = await L.save({ id: target, name, data: Buffer.from(data), folderId });
      if (old && old !== existing.id) { try { await L.trash(old); } catch (e) { /* ignora */ } }
      return { file: { id: f.id, name: f.name || name } };
    }
    let n = 2;
    do { name = `${base} (${n++}).epub`; } while (await L.findByName(name, folderId));
  }
  const f = await L.save({ id: target, name, data: Buffer.from(data), folderId });
  return { file: { id: f.id, name: f.name || name } };
}));
ipcMain.handle('g-import-config', safe(async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolher o arquivo de configuração do Google (JSON)',
    filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return { cancelled: true };
  const text = fs.readFileSync(r.filePaths[0], 'utf8');
  let c = null; try { c = parseConfig(text); } catch (e) {}
  if (!c) return { error: { code: 'BAD_CONFIG', message: 'Este arquivo não parece ser o JSON do ID do cliente OAuth do Google.' } };
  fs.writeFileSync(dataFile('google-oauth.json'), text);
  return { ok: true };
}));

ipcMain.handle('confirm', async (_e, { message, buttons }) => {
  return dialog.showMessageBoxSync(win, {
    type: 'question', buttons, defaultId: 0, cancelId: buttons.length - 1,
    title: 'Criador de EPUB', message,
  });
});

ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
