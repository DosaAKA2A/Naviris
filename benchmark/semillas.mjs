// Perfiles semilla: cada navegador arranca una vez con perfil vacío y se deja 120 s para su trabajo de
// primer arranque (Naviris baja y monta las listas del bloqueador; Brave baja las suyas y sus componentes;
// Chrome y Edge, los suyos). Cada pasada de consumo, cargas, YouTube y benchmarks parte de una COPIA de su
// semilla: un perfil limpio, sin historial ni sesiones, pero ya inicializado.
// «naviris-sin» = la semilla de Naviris con el bloqueador apagado (adblockEnabled: false).
// En Naviris solo se apagan los sonidos, para que no suenen en cada pasada.
// Uso: node semillas.mjs [navs separados por coma]   (por defecto naviris,chrome,brave)
import fs from 'node:fs';
import { TRABAJO, familia, lanza, prepara, cierra, espera, borraPerfil, copiaPerfil, log } from './lib.mjs';

const CUALES = (process.argv[2] || 'naviris,chrome,brave').split(',').filter((c) => c !== 'naviris-sin');
for (const cual of CUALES) {
  const perfil = `${TRABAJO}/semillas/${cual}`;
  await borraPerfil(perfil); fs.mkdirSync(perfil, { recursive: true });
  if (familia(cual) === 'naviris') fs.writeFileSync(`${perfil}/naviris-settings.json`, JSON.stringify({ sonidos: false }));
  const b = lanza(cual, perfil, { log: `${TRABAJO}/logs/semilla-${cual}.log` });
  await prepara(b);
  await espera(120000);
  if (familia(cual) === 'naviris') log('bloqueador', await b.ui.ev('window.navirisApp && window.navirisApp.adblockGet ? window.navirisApp.adblockGet() : null').catch((e) => String(e)));
  log('semilla', cual, await cierra(b));
}
if (CUALES.includes('naviris')) {
  const sin = `${TRABAJO}/semillas/naviris-sin`;
  copiaPerfil(`${TRABAJO}/semillas/naviris`, sin);
  const f = `${sin}/naviris-settings.json`;
  const s = JSON.parse(fs.readFileSync(f, 'utf8')); s.adblockEnabled = false; fs.writeFileSync(f, JSON.stringify(s, null, 2));
  log('semilla naviris-sin, bloqueador', s.adblockEnabled);
}
process.exit(0);
