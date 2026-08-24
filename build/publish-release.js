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
 *
 * USO:  node build/publish-release.js            (usa la version de package.json)
 *       node build/publish-release.js --dry      (solo enseña lo que haria)
 * Necesita GH_TOKEN en el entorno.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const DIST = path.join(RAIZ, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
const VER = pkg.version;
const ES_DEV = /-dev/i.test(VER);
const CANAL = ES_DEV ? 'dev.yml' : 'latest.yml';
/* Una versión ESTABLE alimenta los DOS canales.
   Motivo: una instalación dev sigue dev.yml, así que si una estable solo
   escribiera latest.yml, quien esté en dev se quedaría clavado en la última
   prerelease y no vería nunca la versión buena — tendría que reinstalar a mano.
   Publicando el mismo build en los dos feeds, cualquiera que esté en cualquier
   versión salta directo a la última, sin pasar por ninguna intermedia.
   Al revés NO: una dev no toca latest.yml, o las instalaciones estables se
   tragarían una prerelease sin pedirlo. */
const CANALES = ES_DEV ? ['dev.yml'] : ['latest.yml', 'dev.yml'];
const TAG = 'v' + VER;
const [OWNER, REPO] = ['DosaAKA2A', 'Naviris'];
const DRY = process.argv.includes('--dry');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const SETUP = `Naviris Setup ${VER}.exe`;
const PORTABLE = `Naviris ${VER}.exe`;
const BLOCKMAP = `${SETUP}.blockmap`;

function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
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
  if (!TOKEN) { console.error('Falta GH_TOKEN en el entorno.'); process.exit(1); }
  console.log(`Publicando ${TAG} (${ES_DEV ? 'DEV' : 'ESTABLE'}) -> feed ${CANAL}`);

  const setupPath = path.join(DIST, SETUP);
  if (!fs.existsSync(setupPath)) { console.error('No encuentro', setupPath, '\nCompila antes con: npm run dist'); process.exit(1); }

  // Feed del actualizador, con el hash del instalador REAL que vamos a subir
  const hash = sha512(setupPath);
  const size = fs.statSync(setupPath).size;
  const nombreSetup = SETUP.replace(/ /g, '-');
  const yml = `version: ${VER}\nfiles:\n  - url: ${nombreSetup}\n    sha512: ${hash}\n    size: ${size}\npath: ${nombreSetup}\nsha512: ${hash}\nreleaseDate: '${new Date().toISOString()}'\n`;
  const ymlPaths = CANALES.map((c) => {
    const p = path.join(DIST, c);
    fs.writeFileSync(p, yml);
    return { file: p, name: c };
  });
  console.log(` feeds generados: ${CANALES.join(' + ')} (sha512 del Setup real)`);

  const subir = [
    { file: setupPath, name: nombreSetup },
    { file: path.join(DIST, PORTABLE), name: PORTABLE.replace(/ /g, '-') },
    { file: path.join(DIST, BLOCKMAP), name: BLOCKMAP.replace(/ /g, '-') },
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

  // Comprobación final: el feed debe descargarse y apuntar al instalador subido
  let todosOk = true;
  for (const c of CANALES) {
    const feedUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/${c}`;
    const check = await (await fetch(feedUrl)).text();
    const ok = check.includes(`version: ${VER}`) && check.includes(hash.slice(0, 24));
    if (!ok) todosOk = false;
    console.log(`\n${ok ? 'OK' : 'AVISO'}: ${c} servido y ${ok ? 'coherente' : 'NO coincide (revisar)'}`);
  }
  if (!todosOk) process.exitCode = 1;
  console.log(`https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
