// e2e: en x.com, el clic en un video con tarjeta de sitio web lo reproduce aquí y
// no abre la web; el "De sitio.com" y los enlaces normales siguen abriéndose.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { arranca, hasta, espera } = require('./naviris');

const PAGINA = fs.readFileSync(path.join(__dirname, 'paginas', 'x-tarjeta.html'));
const URL_POST = 'https://x.com/naviris-prueba/status/1';

test('X: video con tarjeta de sitio web', { timeout: 120000 }, async (t) => {
  const nav = await arranca();
  t.after(() => nav.cierra());
  const web = await nav.abre(URL_POST, [['https://x.com/naviris-prueba*', () => ({ cuerpo: PAGINA, tipo: 'text/html; charset=utf-8' })]]);
  const urls = () => nav.ui.evalua('JSON.stringify(tabs.filter((t) => t.kind === "web").map((t) => t.url))').then(JSON.parse);
  const centro = async (sel) => JSON.parse(await web.evalua(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]); })()`));
  const pausado = () => web.evalua('document.querySelector("video").paused');

  const antes = await urls();
  const [vx, vy] = await centro('video');
  assert.strictEqual(await pausado(), true);
  await web.clic(vx, vy);
  await hasta(async () => !(await pausado()), 3000);
  await web.clic(vx, vy);
  await hasta(() => pausado(), 3000);
  await espera(800);
  assert.deepStrictEqual(await urls(), antes, 'el clic en el video no abre ninguna pestaña');

  // El botón del reproductor que está encima sigue funcionando
  const [bx, by] = await centro('#silencio');
  await web.clic(bx, by);
  assert.deepStrictEqual(await web.evalua('window.__registro'), ['silencio']);

  // "De example.com", debajo del video: abre la web como siempre
  const [lx, ly] = await centro('#vanidad');
  await web.clic(lx, ly);
  await hasta(async () => (await urls()).includes('https://example.com/naviris-prueba-tarjeta'), 8000);
  // Y un enlace normal del post, también
  await nav.ui.evalua(`activateTab(tabs.find((t) => t.url === ${JSON.stringify(URL_POST)}).id)`);
  const [nx, ny] = await centro('#normal');
  await web.clic(nx, ny);
  await hasta(async () => (await urls()).includes('https://example.com/naviris-prueba-normal'), 8000);
});
