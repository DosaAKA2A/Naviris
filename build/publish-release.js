#!/usr/bin/env node
/* Publicador de releases de Naviris.
 *
 * POR QUÉ EXISTE: `electron-builder --publish` falla sistemáticamente en este
 * repo (5 de 5 intentos). Sus dos publicadores (nsis y portable) compiten por
 * crear la misma release y el segundo muere con 422 "already_exists" dejando la
 * release a medias: se sube el blockmap y falta el instalador, el portable y el
 * feed .yml. Sin ese feed el actualizador no ve la version.
 *
 * QUÉ HACE: coge lo que ya hay en dist/ (compilado y FIRMADO con VMP por
 * `npm run dist`) y lo sube a la release del tag, generando el feed correcto:
 *   - latest.yml para las versiones estables
 *   - dev.yml    para las que llevan sufijo -dev
 * El feed y sus comprobaciones viven en build/feed-actualizador.js, lo mismo que
 * prueba test/actualizador.test.js.
 *
 * ANTES DE NADA corre `npm test` y, si falla, no publica (tampoco con --dry).
 * Solo se salta con NAVIRIS_PUBLICAR_SIN_PRUEBAS=1, y lo avisa bien alto.
 *
 * USO:  node build/publish-release.js            (usa la version de package.json)
 *       node build/publish-release.js --dry      (solo enseña lo que haria)
 * Necesita GH_TOKEN en el entorno.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const feed = require('./feed-actualizador');

const RAIZ = path.join(__dirname, '..');
const DIST = path.join(RAIZ, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
const VER = pkg.version;
const ES_DEV = feed.esDev(VER);
const CANAL = feed.feedDe(VER);
/* Cada línea escribe SOLO su feed: una estable no toca dev.yml, o las
   instalaciones dev verían una versión de la otra línea. Las dos líneas no se
   cruzan; si quien está en dev tiene que recibir algo, se publica en dev. */
const CANALES = [CANAL];
const TAG = 'v' + VER;
const [OWNER, REPO] = ['DosaAKA2A', 'Naviris'];
const DRY = process.argv.includes('--dry');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const { setup: SETUP, portable: PORTABLE, blockmap: BLOCKMAP, subido: SUBIDO } = feed.nombres(VER);

/* La puerta: sin pruebas en verde no se publica. Va aquí y no solo en
   `npm run release` porque este script también se lanza a mano. */
function pasaLasPruebas() {
  if (process.env.NAVIRIS_PUBLICAR_SIN_PRUEBAS === '1') {
    console.warn('\n*** NAVIRIS_PUBLICAR_SIN_PRUEBAS=1: se publica SIN correr las pruebas. ***\n');
    return true;
  }
  console.log('Corriendo las pruebas (npm test) antes de publicar...');
  const r = spawnSync('npm test', { cwd: RAIZ, stdio: 'inherit', shell: true });
  if (r.status === 0) return true;
  console.error(`\nNO SE PUBLICA: las pruebas han fallado (npm test terminó con ${r.status ?? r.error?.message}).` +
    '\nArréglalas y vuelve a lanzar. Solo en una emergencia: NAVIRIS_PUBLICAR_SIN_PRUEBAS=1 (ver README).');
  return false;
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: 'Bearer ' + TOKEN, 'User-Agent': 'Naviris-publisher', Accept: 'application/vnd.github+json', ...(opts.headers || {}) }
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url.replace(/https:\/\/[^/]+/, '')} -> ${txt.slice(0, 180)}`);
  return txt ? JSON.parse(txt) : null;
}

(async () => {
  if (!pasaLasPruebas()) process.exit(1);
  if (!TOKEN) { console.error('Falta GH_TOKEN en el entorno.'); process.exit(1); }
  console.log(`Publicando ${TAG} (${ES_DEV ? 'DEV' : 'ESTABLE'}) -> feed ${CANAL}`);

  const setupPath = path.join(DIST, SETUP);
  if (!fs.existsSync(setupPath)) { console.error('No encuentro', setupPath, '\nCompila antes con: npm run dist'); process.exit(1); }

  // Feed del actualizador, con el hash del instalador REAL que vamos a subir
  const yml = feed.generaFeed(VER, setupPath);
  const mal = feed.compruebaFeed(yml, { version: VER, setupPath, nombreFeed: CANAL });
  if (mal.length) { console.error('El feed generado no cuadra:\n - ' + mal.join('\n - ')); process.exit(1); }
  const ymlPaths = CANALES.map((c) => {
    const p = path.join(DIST, c);
    fs.writeFileSync(p, yml);
    return { file: p, name: c };
  });
  console.log(` feeds generados: ${CANALES.join(' + ')} (sha512 del Setup real)`);

  const subir = [
    { file: setupPath, name: SUBIDO.setup },
    { file: path.join(DIST, PORTABLE), name: SUBIDO.portable },
    { file: path.join(DIST, BLOCKMAP), name: SUBIDO.blockmap },
    ...ymlPaths
  ].filter((a) => fs.existsSync(a.file));

  if (DRY) {
    console.log('\n--dry: subiria a', TAG);
    subir.forEach((a) => console.log('  ', a.name, (fs.statSync(a.file).size / 1048576).toFixed(1) + ' MB'));
    return;
  }

  // Release del tag: se reutiliza si existe (electron-builder suele haberla creado)
  let rel;
  try {
    rel = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
    console.log(` release existente id=${rel.id}`);
  } catch (e) {
    rel = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({ tag_name: TAG, name: TAG, prerelease: ES_DEV, generate_release_notes: true })
    });
    console.log(` release creada id=${rel.id}`);
  }
  // Una dev sin marcar como prerelease se cuela como «la última estable» (ver feed-actualizador.js)
  const malRelease = feed.compruebaRelease(rel, VER);
  if (malRelease.length) { console.error('NO SE PUBLICA: ' + malRelease.join('; ') + '. Corrígelo en GitHub y vuelve a lanzar.'); process.exit(1); }

  for (const a of subir) {
    const viejo = (rel.assets || []).find((x) => x.name === a.name);
    if (viejo) {
      await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${viejo.id}`, { method: 'DELETE' });
      console.log(` reemplazando ${a.name}`);
    }
    const buf = fs.readFileSync(a.file);
    const res = await fetch(`https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(a.name)}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'User-Agent': 'Naviris-publisher', 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length },
      body: buf
    });
    if (!res.ok) { console.error(` FALLO subiendo ${a.name}: ${res.status} ${(await res.text()).slice(0, 150)}`); process.exit(1); }
    console.log(` subido ${a.name} (${(buf.length / 1048576).toFixed(1)} MB)`);
  }

  // Comprobación final: el feed servido debe cuadrar con el instalador subido
  let todosOk = true;
  for (const c of CANALES) {
    const feedUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/${c}`;
    const servido = await (await fetch(feedUrl)).text();
    const malServido = feed.compruebaFeed(servido, { version: VER, setupPath, nombreFeed: c });
    if (malServido.length) todosOk = false;
    console.log(`\n${malServido.length ? 'AVISO' : 'OK'}: ${c} servido y ${malServido.length ? 'NO coincide: ' + malServido.join('; ') : 'coherente'}`);
  }
  if (!todosOk) process.exitCode = 1;
  console.log(`https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
