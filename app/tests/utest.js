const http = require('http'); const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const { createUpdater, isNewer } = require(__dirname + '/../updater.js');
const payload = crypto.randomBytes(3 * 1024 * 1024); let tamper = false; let latest = '1.7.1';
const srv = http.createServer((req, res) => {
  const B = `http://127.0.0.1:${srv.address().port}`;
  if (req.url.includes('/releases/latest')) { res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tag_name: 'v' + latest, body: '- Novidade A\n- Correção B', html_url: B + '/rel', assets: [
      { name: `Instalar-Criador-de-EPUB-${latest}.exe`, size: payload.length, browser_download_url: B + '/dl/inst.exe' },
      { name: `Instalar-Criador-de-EPUB-${latest}.exe.sha256`, size: 64, browser_download_url: B + '/dl/inst.sha' }] })); }
  if (req.url === '/dl/inst.sha') { res.writeHead(200); return res.end(crypto.createHash('sha256').update(payload).digest('hex') + '  inst.exe\n'); }
  if (req.url === '/dl/inst.exe') { const d = Buffer.from(payload); if (tamper) d[10] ^= 1; res.writeHead(200, { 'Content-Length': d.length }); return res.end(d); }
  res.writeHead(404); res.end();
});
srv.listen(0, '127.0.0.1', async () => {
  const B = `http://127.0.0.1:${srv.address().port}`;
  const f = (url, o) => fetch(url.replace('https://api.github.com', B), o);
  const spawned = [];
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'upd-'));
  const up = createUpdater({ fetch: f, repo: 'x/y', currentVersion: '1.7.0', tmpDir: tmp, spawn: (file, args) => { spawned.push([path.basename(file), args]); return { unref() {} }; } });
  console.log('isNewer', isNewer('1.10.0', '1.9.9'), isNewer('1.7.0', '1.7.0'), isNewer('1.6.9', '1.7.0'));
  const info = await up.check(); console.log('check', info.available, info.version, JSON.stringify(info.notes));
  let last; const d = await up.download(info, (g, t) => last = [g, t]); console.log('download ok verified=', d.verified, 'progress', last, 'size', fs.statSync(d.file).size);
  up.install(); console.log('spawned', JSON.stringify(spawned));
  tamper = true; try { await up.download(info); } catch (e) { console.log('tampered ->', e.code, '| leftover .part:', fs.readdirSync(tmp)); }
  latest = '1.7.0'; console.log('same version ->', (await up.check()).available);
  srv.close();
});
