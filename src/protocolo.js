/* ===== LA INTERFAZ SE SIRVE POR naviris://app (2026-11-11) =====
   Hasta la 3.0 la interfaz (index.html) y el splash se cargaban por file://.
   Con la fuse GrantFileProtocolExtraPrivileges encendida (no se puede apagar:
   castlabs no firma Widevine en un exe con fuses cambiadas), TODA página file://
   tiene más poder que en Chrome. La interfaz va en su propio esquema y lo que
   abren las webs por file:// lo frena archivos-locales.js.

   Qué sirve y a quién:
   · Solo existe en la sesión de la interfaz y en la del splash. Las webs viven
     en otras sesiones (persist:naviris, la privada, contenedores y espacios),
     donde naviris: no tiene manejador: una web o un webview que lo pida recibe
     un error, igual que con un esquema inventado.
   · naviris://app/<ruta> solo da archivos de la lista de abajo, dentro de la
     carpeta de la app. Nada del proceso principal (main.js, app-key.js…).
   · naviris://app/datos/fondos|imagenes/<nombre>: las imágenes que eligió la
     persona (fondo del hub, widgets de imagen), copiadas a su perfil. Van bajo
     el mismo origen para que la interfaz pueda medir su brillo con un canvas.
   La ruta se valida entera: nada de `..`, barras invertidas, `%2f`, `%5c`,
   bytes nulos ni unidades, y lo que resulte tiene que seguir dentro de su
   carpeta también después de resolver enlaces. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ESQUEMA = 'naviris';
const HOST = 'app';
const ORIGEN = `${ESQUEMA}://${HOST}`;
/* standard: rutas relativas, origen propio y su localStorage. secure: contexto
   seguro, como file://. supportFetchAPI: los sonidos y fetch('...') de la propia
   interfaz. stream: audio sin descargarlo entero. codeCache: V8 guarda el código
   compilado de los scripts y el arranque no los recompila cada vez. */
const PRIVILEGIOS = { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true };

// Lo que la interfaz, el splash y el aviso de las ventanitas cargan. Si se añade un script a index.html, va aquí (lo vigila test/protocolo.test.js).
const ARCHIVOS_APP = new Set(['index.html', 'splash.html', 'styles.css', 'icons.js', 'brands.js', 'sonidos.js', 'rat.js',
  'hub-escala.js', 'atajos.js', 'buscadores.js', 'migra-claves.js', 'centro-rendimiento.js', 'splash.js', 'dialogo.html', 'dialogo.js']);
const CARPETAS_APP = ['renderer', 'fonts', 'sonidos', 'temas', 'fondos'];
const CARPETAS_DATOS = ['fondos', 'imagenes'];

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp'
};
const IMAGENES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']);

// La dirección de una página de la interfaz, con su consulta (private=1, sacada=1…).
function url(pagina, consulta) {
  const q = consulta && Object.keys(consulta).length ? '?' + new URLSearchParams(consulta) : '';
  return `${ORIGEN}/${pagina}${q}`;
}
const urlDeDatos = (carpeta, nombre) => `${ORIGEN}/datos/${carpeta}/${encodeURIComponent(nombre)}`;

// ¿Es esta dirección la interfaz (index.html, con cualquier consulta)?
function esInterfaz(direccion) {
  try { const u = new URL(direccion); return u.protocol === ESQUEMA + ':' && u.host === HOST && u.pathname === '/index.html'; } catch { return false; }
}

// Los trozos de la ruta pedida, ya decodificados, o null si algo no es limpio.
function trozosDe(direccion) {
  let u;
  try { u = new URL(direccion); } catch { return null; }
  if (u.protocol !== ESQUEMA + ':' || u.host !== HOST || u.username || u.password || u.port) return null;
  // El parser ya resolvió `..` y `%2e%2e`; lo que quede codificado como separador o nulo se rechaza antes de decodificar.
  if (/%(2f|5c|00)/i.test(u.pathname)) return null;
  let ruta;
  try { ruta = decodeURIComponent(u.pathname); } catch { return null; }
  const trozos = ruta.split('/').slice(1);
  if (!trozos.length || trozos.some((t) => !t || t === '.' || t === '..' || /[\\:\0]/.test(t) || /^\./.test(t))) return null;
  return trozos;
}

/* El archivo de disco que corresponde a una dirección, o null. `dirs.app` es la
   carpeta de la interfaz (src) y `dirs.datos` la del perfil (userData). */
function archivoDe(direccion, dirs) {
  const t = trozosDe(direccion);
  if (!t) return null;
  const ext = path.extname(t[t.length - 1]).toLowerCase();
  if (!TIPOS[ext]) return null;
  if (t[0] === 'datos') {
    if (t.length !== 3 || !CARPETAS_DATOS.includes(t[1]) || !IMAGENES.has(ext) || !dirs.datos) return null;
    return { base: path.join(dirs.datos, t[1]), ruta: path.join(dirs.datos, t[1], t[2]), tipo: TIPOS[ext] };
  }
  const permitido = t.length === 1 ? ARCHIVOS_APP.has(t[0]) : CARPETAS_APP.includes(t[0]);
  if (!permitido) return null;
  return { base: dirs.app, ruta: path.join(dirs.app, ...t), tipo: TIPOS[ext] };
}

// Que la ruta, con los enlaces resueltos, siga dentro de su carpeta.
async function dentro(base, ruta) {
  const [b, r] = await Promise.all([fs.promises.realpath(base), fs.promises.realpath(ruta)]);
  const rel = path.relative(b, r);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const respuesta = (estado) => new Response(null, { status: estado });

// El manejador para protocol.handle. Solo GET y HEAD; lo demás no existe.
function manejador(dirs) {
  return async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return respuesta(405);
    const a = archivoDe(req.url, dirs);
    if (!a) return respuesta(404);
    try {
      if (!(await dentro(a.base, a.ruta))) return respuesta(404);
      const datos = await fs.promises.readFile(a.ruta);
      return new Response(req.method === 'HEAD' ? null : datos, {
        status: 200,
        headers: { 'Content-Type': a.tipo, 'Content-Length': String(datos.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }
      });
    } catch { return respuesta(404); }
  };
}

module.exports = { ESQUEMA, ORIGEN, PRIVILEGIOS, IMAGENES, url, urlDeDatos, esInterfaz, archivoDe, manejador };
