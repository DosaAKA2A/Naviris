// Coste de las llamadas al motor del bloqueador que hace Naviris en cada página, medido en Node.
// Carga el motor serializado de un perfil (motor.bin) y los recursos del repo, como al arrancar.
// No abre ningún navegador. El motor sale de la semilla de Naviris (semillas.mjs) o de cualquier perfil
// de Naviris que ya haya bajado sus listas.
// Uso: node micro-adblock.cjs <carpeta adblock del perfil>
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = process.env.NAVIRIS_REPO || path.join(__dirname, '..');
const { Engine, FilterSet } = require(path.join(REPO, 'node_modules/adblock-rs'));

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'motor.bin'))) {
  console.error('Falta la carpeta con motor.bin. Uso: node micro-adblock.cjs <carpeta adblock del perfil>');
  process.exit(1);
}
const ms = (a) => Number(process.hrtime.bigint() - a) / 1e6;
const e = new Engine(new FilterSet(false));
const b = fs.readFileSync(path.join(dir, 'motor.bin'));
let t = process.hrtime.bigint();
e.deserialize(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
console.log('deserialize ms', ms(t).toFixed(1));
const rec = fs.readFileSync(path.join(REPO, 'resources/adblock/resources.json'), 'utf8');
t = process.hrtime.bigint(); e.useResources(JSON.parse(rec)); console.log('useResources ms', ms(t).toFixed(1));

const URLS = ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'https://www.nytimes.com/', 'https://elcomercio.pe/', 'https://es.wikipedia.org/wiki/Navegador_web', 'https://www.bbc.com/mundo', 'https://www.amazon.com/', 'https://browserbench.org/Speedometer3.1/'];
const N = 50;
for (const u of URLS) {
  e.urlCosmeticResources(u);
  t = process.hrtime.bigint();
  let r;
  for (let i = 0; i < N; i++) r = e.urlCosmeticResources(u);
  const cos = ms(t) / N;
  const clases = Array.from({ length: 300 }, (_, i) => 'c' + i + (i % 7 ? '' : '-ad')), ids = Array.from({ length: 50 }, (_, i) => 'id' + i);
  t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) e.hiddenClassIdSelectors(clases, ids, r.exceptions || []);
  const hid = ms(t) / N;
  t = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) e.check(u.replace(/\/[^/]*$/, '/') + 'static/x' + i + '.js', u, 'script', 'GET', true);
  const chk = ms(t) / 1000;
  console.log(u, JSON.stringify({ urlCosmeticResourcesMs: +cos.toFixed(3), scriptletKB: Math.round((r.injected_script || '').length / 1024), hideSel: (r.hide_selectors || []).length, exceptions: (r.exceptions || []).length, hiddenClassIdSelectorsMs: +hid.toFixed(3), checkMs: +chk.toFixed(4) }));
}
