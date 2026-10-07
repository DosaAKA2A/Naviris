// Genera resources/adblock/resources.json: la copia de respaldo de los recursos
// del bloqueador (scriptlets y sustitutos de `$redirect=`) que viaja con la app.
// Uso: npm run adblock-recursos
//
// Con ella Naviris arranca con los scriptlets puestos aunque sea la primera vez
// y no haya red; luego la app los regenera sola cada 24 h desde las mismas
// fuentes (src/adblock.js), con el MISMO código: el de src/adblock-recursos.js.
// Conviene volver a lanzarlo antes de cada versión para que la copia no se
// quede vieja.
const fs = require('fs');
const path = require('path');
const { generarRecursos } = require('../src/adblock-recursos');

const DESTINO = path.join(__dirname, '..', 'resources', 'adblock');

async function bajar(url) {
  const ctrl = new AbortController();
  const tope = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'naviris-build' } });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(tope); }
}

(async () => {
  const t0 = Date.now();
  const { recursos, resumen } = await generarRecursos(bajar);
  fs.mkdirSync(DESTINO, { recursive: true });
  const json = JSON.stringify(recursos);
  fs.writeFileSync(path.join(DESTINO, 'resources.json'), json, 'utf8');
  // La fecha de esta copia: la app la compara con la de la que haya bajado ella
  // para quedarse con la más nueva (tras actualizar Naviris, la del paquete
  // puede ser más reciente que la guardada en el perfil).
  const meta = { generado: Date.now(), ...resumen };
  fs.writeFileSync(path.join(DESTINO, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log('Recursos del adblock:', resumen.total, 'en total —',
    resumen.scriptlets, 'scriptlets de uBlock (' + resumen.confianza, 'de confianza,', resumen.funciones, 'funciones de apoyo),',
    resumen.sustitutos, 'sustitutos y', resumen.brave, 'de Brave');
  if (resumen.choques.length) console.log('Nombres repetidos (se queda el primero):', resumen.choques.join(', '));
  console.log('Escrito', path.join(DESTINO, 'resources.json'), '(' + Math.round(json.length / 1024) + ' KB) en', ((Date.now() - t0) / 1000).toFixed(1), 's');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
