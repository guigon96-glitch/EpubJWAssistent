/* Atualização automática pelo GitHub Releases.
 * - Lê a última versão publicada em https://github.com/<repo>/releases/latest
 * - Procura o instalador "Instalar-Criador-de-EPUB-x.y.z.exe" (+ "….exe.sha256" para conferir o arquivo)
 * - Baixa com progresso, confere o SHA-256 e roda o instalador em modo silencioso (/S /UPDATE),
 *   que espera o app fechar, instala por cima e abre o app de novo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INSTALLER_RE = /^Instalar-Criador-de-EPUB-[\d.]+\.exe$/i;

function parseVersion(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isNewer(remote, local) {
  const a = parseVersion(remote); const b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

class UpdateError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

function createUpdater({ fetch, repo, currentVersion, tmpDir, spawn }) {
  let downloaded = null; // { file, version }

  async function check() {
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CriadorDeEPUB-Updater' },
      });
    } catch (e) { throw new UpdateError('OFFLINE', 'Sem conexão com a internet.'); }
    if (r.status === 404) return { available: false, current: currentVersion };
    if (r.status === 403 || r.status === 429) throw new UpdateError('LIMIT', 'O GitHub limitou as consultas. Tente de novo mais tarde.');
    if (!r.ok) throw new UpdateError('HTTP', `Não foi possível verificar atualizações (${r.status}).`);
    const rel = await r.json();
    const version = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
    const assets = rel.assets || [];
    const installer = assets.find((a) => INSTALLER_RE.test(a.name));
    if (!installer || !isNewer(version, currentVersion)) return { available: false, current: currentVersion, latest: version };
    const sha = assets.find((a) => a.name === installer.name + '.sha256');
    return {
      available: true,
      current: currentVersion,
      version,
      notes: String(rel.body || '').trim(),
      url: installer.browser_download_url,
      size: installer.size,
      name: installer.name,
      shaUrl: sha ? sha.browser_download_url : null,
      page: rel.html_url,
    };
  }

  async function download(info, onProgress) {
    let expected = null;
    if (info.shaUrl) {
      try {
        const s = await fetch(info.shaUrl, { headers: { 'User-Agent': 'CriadorDeEPUB-Updater' } });
        if (s.ok) expected = ((await s.text()).trim().split(/\s+/)[0] || '').toLowerCase();
      } catch (e) { /* segue sem conferência se o .sha256 falhar */ }
    }
    let r;
    try { r = await fetch(info.url, { headers: { 'User-Agent': 'CriadorDeEPUB-Updater' } }); } catch (e) { throw new UpdateError('OFFLINE', 'A conexão caiu durante o download.'); }
    if (!r.ok || !r.body) throw new UpdateError('HTTP', `Falha ao baixar a atualização (${r.status}).`);
    const total = Number(r.headers.get('content-length')) || info.size || 0;
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, info.name);
    const part = file + '.part';
    const out = fs.createWriteStream(part);
    const hash = crypto.createHash('sha256');
    let got = 0;
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
        if (onProgress) onProgress(got, total);
      }
    } catch (e) {
      out.destroy(); try { fs.unlinkSync(part); } catch (x) {}
      throw new UpdateError('OFFLINE', 'A conexão caiu durante o download.');
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    if (total && got !== total) { try { fs.unlinkSync(part); } catch (x) {} throw new UpdateError('INCOMPLETE', 'O download veio incompleto. Tente de novo.'); }
    const digest = hash.digest('hex');
    if (expected && digest !== expected) { try { fs.unlinkSync(part); } catch (x) {} throw new UpdateError('CHECKSUM', 'O arquivo baixado não confere (SHA-256). Tente de novo.'); }
    try { fs.unlinkSync(file); } catch (x) {}
    fs.renameSync(part, file);
    downloaded = { file, version: info.version, verified: !!expected };
    return downloaded;
  }

  /** Inicia o instalador silencioso e devolve true; quem chama deve fechar o app em seguida. */
  function install() {
    if (!downloaded || !fs.existsSync(downloaded.file)) throw new UpdateError('NO_FILE', 'Baixe a atualização primeiro.');
    const child = spawn(downloaded.file, ['/S', '/UPDATE'], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }

  return { check, download, install };
}

module.exports = { createUpdater, isNewer, parseVersion, UpdateError };
