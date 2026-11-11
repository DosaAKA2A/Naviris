// Corre las e2e de CI archivo por archivo y repite UNA vez el que falle.
// El runner de Windows de GitHub va justo de CPU y sin GPU: una pestaña que
// tarda más de la cuenta hace fallar pruebas que en un equipo normal pasan
// siempre, y cada vez falla una distinta. Un archivo solo cuenta como roto si
// falla dos veces seguidas; los que pasan a la segunda se listan al final para
// que se vean y no se escondan.
'use strict';
const { spawnSync } = require('node:child_process');

const ARCHIVOS = [
  'test/e2e/arranque.e2e.js', 'test/e2e/perfiles.e2e.js', 'test/e2e/huecos.e2e.js',
  'test/e2e/rendimiento.e2e.js', 'test/e2e/menus.e2e.js', 'test/e2e/instancia.e2e.js',
  'test/e2e/seguridad.e2e.js', 'test/e2e/migracion.e2e.js', 'test/e2e/auditoria.e2e.js',
  'test/e2e/protocolo.e2e.js', 'test/e2e/endurece.e2e.js', 'test/e2e/firmas.e2e.js', 'test/e2e/hub-escala.test.js', 'test/e2e/x-video-tarjeta.test.js',
  'test/e2e/autoclaim.test.js'
];

const corre = (archivo) => spawnSync(process.execPath, ['--test', '--test-concurrency=1', archivo], { stdio: 'inherit' }).status === 0;

const rotos = [], segunda = [];
for (const archivo of ARCHIVOS) {
  if (corre(archivo)) continue;
  console.log(`\n[e2e-ci] ${archivo} falló; se repite una vez\n`);
  if (corre(archivo)) segunda.push(archivo); else rotos.push(archivo);
}
if (segunda.length) console.log('\n[e2e-ci] pasaron a la segunda (revisar si se repite):\n  ' + segunda.join('\n  '));
if (rotos.length) { console.log('\n[e2e-ci] fallan dos veces seguidas:\n  ' + rotos.join('\n  ')); process.exit(1); }
console.log(`\n[e2e-ci] ${ARCHIVOS.length} archivos en verde`);
