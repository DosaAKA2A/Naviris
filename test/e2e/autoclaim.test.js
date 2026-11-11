// e2e: AutoClaim sobre un canal de Twitch de mentira servido como www.twitch.tv.
// Silencia, baja a la calidad mínima (también tras navegar a otro canal sin recargar,
// como en un raid), reclama el cofre y los drops una sola vez cada uno y la cuenta
// de la pestaña sobrevive a una recarga de la página.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { arranca, hasta, espera, RAIZ } = require('./naviris');

const PAGINA = fs.readFileSync(path.join(__dirname, 'paginas', 'twitch-canal.html'));
const CANAL = 'https://www.twitch.tv/naviris-prueba';
const FFMPEG = path.join(RAIZ, 'resources', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

// Dos streams de prueba de 4 s: 720p y 160p (VP8, lo reproduce cualquier Chromium)
function videos() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-video-'));
  const out = {};
  for (const [nombre, tam] of [['v720', '1280x720'], ['v160', '284x160']]) {
    const f = path.join(dir, nombre + '.webm');
    execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${tam}:rate=15`, '-t', '4', '-c:v', 'libvpx', '-b:v', '200k', f]);
    out[nombre] = fs.readFileSync(f);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test('AutoClaim en un canal de Twitch', { timeout: 180000, skip: !fs.existsSync(FFMPEG) && 'falta resources/bin/ffmpeg (npm run fetch-bin)' }, async (t) => {
  const vid = videos();
  const nav = await arranca();
  t.after(() => nav.cierra());
  const web = await nav.abre(CANAL, [['https://www.twitch.tv/naviris-*', (url) => {
    const m = url.match(/\/(v720|v160)\.webm$/);
    return m ? { cuerpo: vid[m[1]], tipo: 'video/webm' } : { cuerpo: PAGINA, tipo: 'text/html; charset=utf-8' };
  }]]);
  const pestana = (expr) => nav.ui.evalua(`(() => { const t = tabs.find((x) => /twitch\\.tv/.test(x.url)); return ${expr}; })()`);
  const alto = () => web.evalua('document.querySelector("video").videoHeight');
  const registro = (que) => web.evalua(`window.__registro.filter((x) => x === ${JSON.stringify(que)}).length`);
  const reclamos = () => pestana('t.twitchClaims || 0');

  await hasta(async () => (await alto()) === 720, 10000);
  await pestana('(activateAutoLoot(t), 1)');

  // Silenciada y en la calidad mínima, sin dejar el 160p como calidad global
  assert.strictEqual(await pestana('t.muted && t.webview.isAudioMuted()'), true);
  await hasta(async () => (await alto()) === 160, 10000);
  await hasta(() => web.evalua('localStorage.getItem("video-quality") === null'), 5000);

  // Cofre de puntos: un clic, un reclamo, con el saldo de puntos (no el de Bits)
  await web.evalua('window.__ponCofre()');
  await hasta(async () => (await reclamos()) === 1, 5000);
  await espera(2500);
  assert.strictEqual(await registro('cofre'), 1);
  assert.strictEqual(await reclamos(), 1);
  const ultimo = JSON.parse(await nav.ui.evalua('JSON.stringify(loot[0])'));
  assert.strictEqual(ultimo.kind, 'points');
  assert.strictEqual(ultimo.balance, 1250);
  assert.strictEqual(ultimo.channel, 'twitch.tv/naviris-prueba');

  // Drop: el botón se queda en pantalla y aun así se pulsa y se cuenta una vez
  await web.evalua('window.__ponDrop()');
  await hasta(async () => (await reclamos()) === 2, 5000);
  for (let i = 0; i < 3; i++) { await web.evalua('window.__toca()'); await espera(1200); }
  assert.strictEqual(await registro('drop'), 1);
  assert.strictEqual(await reclamos(), 2);

  // Otro canal sin recargar (raid): el stream nuevo llega en 720p y vuelve a bajar
  await web.evalua('window.__otroCanal()');
  await hasta(async () => (await alto()) === 720, 10000);
  await hasta(async () => (await alto()) === 160, 20000);
  assert.strictEqual(await pestana('t.autoLoot && t.muted'), true);

  // Recarga de la página: la cuenta de la pestaña no vuelve a empezar
  await pestana('(t.webview.reload(), 1)');
  await hasta(() => web.evalua('document.readyState === "complete" && typeof window.__ponCofre === "function" && window.__registro.length === 0'), 15000);
  await espera(1000);
  await web.evalua('window.__ponCofre()');
  await hasta(async () => (await reclamos()) === 3, 6000);
});
