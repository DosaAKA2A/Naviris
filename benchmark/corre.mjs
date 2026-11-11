// La batería entera, en serie (nunca dos navegadores a la vez). Entre 4 y 5 h con los valores por defecto.
// Crea las semillas si faltan, mide y al final saca las tablas con resumen.mjs.
// Uso: node corre.mjs [etiqueta] [navegadores de más, separados por coma, p. ej. edge]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { SCRIPTS, TRABAJO } from './lib.mjs';

const ETQ = process.argv[2] || new Date().toISOString().slice(0, 10);
const MAS = process.argv[3] ? process.argv[3].split(',') : [];
const con = (lista) => [...lista, ...MAS].join(',');

const pasos = [
  ['arranque.mjs', '5', ETQ, con(['naviris', 'chrome', 'brave'])],
  ['consumo.mjs', '3', ETQ, con(['naviris', 'chrome', 'brave', 'naviris-sin'])],
  ['cargas.mjs', '5', ETQ, con(['naviris', 'chrome', 'brave', 'naviris-sin'])],
  ['youtube.mjs', '3', ETQ, con(['naviris', 'chrome', 'brave'])],
  ['bench.mjs', '3', ETQ, con(['naviris', 'chrome', 'brave', 'electron'])]
];
const faltan = ['naviris', 'chrome', 'brave', ...MAS].filter((c) => !fs.existsSync(`${TRABAJO}/semillas/${c}`));
if (faltan.length) pasos.unshift(['semillas.mjs', faltan.join(',')]);

for (const [guion, ...args] of pasos) {
  console.log(`\n== ${guion} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [`${SCRIPTS}/${guion}`, ...args], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`${guion} terminó con código ${r.status}; las medidas hechas quedan en ${TRABAJO}/medidas`); process.exit(r.status || 1); }
}
const t = spawnSync(process.execPath, [`${SCRIPTS}/resumen.mjs`, ETQ], { encoding: 'utf8' });
fs.writeFileSync(`${TRABAJO}/tablas-${ETQ}.md`, t.stdout);
process.stdout.write(t.stdout);
console.error(`Tablas en ${TRABAJO}/tablas-${ETQ}.md`);
