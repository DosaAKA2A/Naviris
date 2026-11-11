#!/usr/bin/env node
/* `node --check` de todos los .js/.mjs/.cjs de src/ y build/ (npm run check, y el primer
   paso del workflow de pruebas). Un error de sintaxis en el proceso principal
   le sale a quien usa Naviris como cuadro de error al abrir: esto lo para antes. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
// build/ también: el publicador roto solo se descubre al ir a publicar.
const archivos = ['src', 'build'].flatMap((d) => fs.readdirSync(path.join(RAIZ, d), { recursive: true })
  .filter((f) => /\.(c|m)?js$/.test(f))
  .map((f) => path.join(RAIZ, d, f)))
  .sort();
let mal = 0;
for (const f of archivos) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { mal++; console.error(`✖ ${path.relative(RAIZ, f)}\n${r.stderr.trim()}\n`); }
}
console.log(`${archivos.length - mal} de ${archivos.length} archivos de src/ y build/ sin errores de sintaxis`);
process.exit(mal ? 1 : 0);
