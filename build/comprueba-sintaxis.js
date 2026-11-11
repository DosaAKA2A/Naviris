#!/usr/bin/env node
/* `node --check` de todos los .js/.mjs/.cjs de src/, build/ y benchmark/ (npm run check, y el primer
   paso del workflow de pruebas). Un error de sintaxis en el proceso principal
   le sale a quien usa Naviris como cuadro de error al abrir: esto lo para antes. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
// build/ también: el publicador roto solo se descubre al ir a publicar. De benchmark/ no se entra
// en trabajo/, donde quedan los perfiles de los navegadores medidos.
const recorre = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'trabajo' && dir.endsWith('benchmark') ? [] : recorre(p);
  return /\.(c|m)?js$/.test(e.name) ? [p] : [];
});
const archivos = ['src', 'build', 'benchmark'].flatMap((d) => recorre(path.join(RAIZ, d))).sort();
let mal = 0;
for (const f of archivos) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { mal++; console.error(`✖ ${path.relative(RAIZ, f)}\n${r.stderr.trim()}\n`); }
}
console.log(`${archivos.length - mal} de ${archivos.length} archivos de src/, build/ y benchmark/ sin errores de sintaxis`);
process.exit(mal ? 1 : 0);
