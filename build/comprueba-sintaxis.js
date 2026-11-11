#!/usr/bin/env node
/* `node --check` de todos los .js/.mjs/.cjs de src/ (npm run check, y el primer
   paso del workflow de pruebas). Un error de sintaxis en el proceso principal
   le sale a quien usa Naviris como cuadro de error al abrir: esto lo para antes. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'src');
const archivos = fs.readdirSync(SRC, { recursive: true })
  .filter((f) => /\.(c|m)?js$/.test(f))
  .map((f) => path.join(SRC, f))
  .sort();
let mal = 0;
for (const f of archivos) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { mal++; console.error(`✖ ${path.relative(SRC, f)}\n${r.stderr.trim()}\n`); }
}
console.log(`${archivos.length - mal} de ${archivos.length} archivos de src/ sin errores de sintaxis`);
process.exit(mal ? 1 : 0);
