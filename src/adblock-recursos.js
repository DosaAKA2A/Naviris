// Recursos del bloqueador de anuncios: los scriptlets (`##+js(...)` de las
// listas) y los sustitutos que piden las reglas `$redirect=`. Sin ellos el motor
// de Brave sabe QUÉ hacer pero no tiene CON QUÉ: las reglas de scriptlet no
// inyectan nada y las de sustitución se quedan en un bloqueo a pelo.
//
// Hasta julio de 2026 bastaba con bajar el resources/resources.json de Brave,
// pero ese archivo desapareció (404) y lo que queda en dist/resources.json son
// solo los 17 recursos propios de Brave. Los scriptlets de uBlock Origin (los
// json-prune, set, trusted-* que mantienen vivo el reproductor de YouTube) y los
// sustitutos (el señuelo de ad_status.js, los 1x1.gif, noop.js...) ya no los
// publica nadie empaquetados: Brave los arma en su propio proceso de
// compilación a partir del código de uBlock. Aquí se hace lo mismo.
//
// Este módulo lo usan DOS sitios con el mismo código, a propósito:
//   · build/adblock-recursos.js genera la copia de respaldo que viaja con la
//     app (resources/adblock/resources.json).
//   · src/adblock.js lo vuelve a generar cada 24 h desde la red, para que los
//     arreglos de uBlock lleguen sin publicar una versión de Naviris.
// Quien lo llama pone la función de descarga (fetch de Node en el build,
// net.fetch de Electron en la app); aquí no se toca la red directamente.
'use strict';

const vm = require('vm');
const path = require('path').posix;

const BRAVE_URL = 'https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json';
const UBO_RAIZ = 'https://raw.githubusercontent.com/gorhill/uBlock/master/src/';
const UBO_SCRIPTLETS = 'js/resources/scriptlets.js';
const UBO_SUSTITUTOS = 'js/redirect-resources.js';
const UBO_WAR = 'web_accessible_resources/';

// Bit de permiso de los recursos que uBlock marca con `requiresTrust` (los
// trusted-*: pueden reescribir respuestas, poner cookies, pulsar botones...).
// Solo los puede inyectar una lista parseada con ese mismo bit, y en el catálogo
// de Brave las listas de confianza llevan `permission_mask: 1`. Es el mismo
// criterio de uBlock: un trusted-* que llegue desde una lista cualquiera no se
// ejecuta.
const PERMISO_CONFIANZA = 1;

/* ---------- Scriptlets de uBlock: de módulos ES a recursos ----------

   uBlock guarda sus scriptlets como MÓDULOS ES (src/js/resources/*.js): cada
   archivo importa sus funciones de apoyo y registra los scriptlets con
   `registerScriptlet(fn, { name, aliases, dependencies, requiresTrust, world })`
   o con `builtinScriptlets.push({...})`. Lo que se inyecta en la página es el
   TEXTO de cada función (`fn.toString()`), así que hay que ejecutar esos módulos
   para que se registren y luego leer los textos.

   Ni el motor de Brave (su ensamblador solo entiende el formato antiguo, con
   cabeceras `/// nombre.js`) ni Node sin banderas experimentales
   (`vm.SourceTextModule`) cargan módulos desde texto, y un import() de verdad
   ejecutaría código bajado de internet en el proceso principal con todos los
   privilegios. Por eso se reescriben los import/export a llamadas normales y
   todo corre en un contexto `vm` aparte:
     · sin ningún objeto del proceso principal dentro (ni el objeto global, que
       se crea sin prototipo): es lo que cierra la vía clásica de escape
       `this.constructor.constructor('return process')()`;
     · sin generación de código desde texto (ni eval ni new Function);
     · con tope de tiempo;
     · y lo único que sale es una cadena JSON, que se vuelve a parsear fuera.
   Un contexto `vm` no es una frontera de seguridad completa (lo dice la
   documentación de Node), pero así no se le da a ese código nada con lo que
   llegar al proceso principal. El código es el mismo que acabará inyectado en
   las páginas, que es donde se ejecuta de verdad. */

const RE_IMPORT = /^import\s+(?:([\w$*\s{},]+?)\s+from\s+)?(['"])([^'"\n]+)\2[ \t]*;?/gm;

// Ruta de un import relativo, siempre dentro de src/ de uBlock y siempre .js.
function resolverRuta(desde, spec) {
  if (!/^\.\.?\//.test(spec)) throw new Error('import no relativo en ' + desde + ': ' + spec);
  const ruta = path.normalize(path.join(path.dirname(desde), spec));
  if (ruta.startsWith('..') || path.isAbsolute(ruta) || !ruta.endsWith('.js')) throw new Error('import fuera de uBlock en ' + desde + ': ' + spec);
  return ruta;
}

function importsDe(texto, ruta) {
  const out = [];
  RE_IMPORT.lastIndex = 0;
  let m;
  while ((m = RE_IMPORT.exec(texto))) out.push(resolverRuta(ruta, m[3]));
  return out;
}

// `{ a, b as c }` -> 'a, b: c' (patrón de desestructuración equivalente)
function destructurar(llaves, ruta) {
  return llaves.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const p = s.split(/\s+as\s+/);
    if (p.length === 1 && /^[\w$]+$/.test(p[0])) return p[0];
    if (p.length === 2 && /^[\w$]+$/.test(p[0]) && /^[\w$]+$/.test(p[1])) return p[0] + ': ' + p[1];
    throw new Error('import que no se entiende en ' + ruta + ': ' + s);
  }).join(', ');
}

// Reescribe un módulo ES a una función `(__import, __exports) => {...}`. Solo se
// tocan sentencias de nivel superior, que uBlock escribe siempre en la columna
// 0; el cuerpo de las funciones (lo que luego se inyecta) queda intacto, y por
// eso `fn.toString()` devuelve exactamente el texto original.
function transformarModulo(texto, ruta) {
  const exportados = [];   // [nombre público, nombre local]
  let codigo = texto.replace(/\r\n?/g, '\n');
  codigo = codigo.replace(RE_IMPORT, (_t, clausula, _q, spec) => {
    const destino = JSON.stringify(resolverRuta(ruta, spec));
    if (!clausula) return '__import(' + destino + ');';
    const c = clausula.trim();
    let m;
    if ((m = /^\*\s+as\s+([\w$]+)$/.exec(c))) return 'const ' + m[1] + ' = __import(' + destino + ');';
    if ((m = /^\{([^}]*)\}$/.exec(c))) return 'const { ' + destructurar(m[1], ruta) + ' } = __import(' + destino + ');';
    if ((m = /^([\w$]+)$/.exec(c))) return 'const ' + m[1] + ' = __import(' + destino + ').default;';
    if ((m = /^([\w$]+)\s*,\s*\{([^}]*)\}$/.exec(c))) {
      return 'const ' + m[1] + ' = __import(' + destino + ').default; const { ' + destructurar(m[2], ruta) + ' } = __import(' + destino + ');';
    }
    throw new Error('import que no se entiende en ' + ruta + ': ' + c);
  });
  codigo = codigo.replace(/^export\s+((?:async\s+)?function\s*\*?\s*([\w$]+)\s*\()/gm, (_t, decl, nombre) => { exportados.push([nombre, nombre]); return decl; });
  codigo = codigo.replace(/^export\s+(class\s+([\w$]+))/gm, (_t, decl, nombre) => { exportados.push([nombre, nombre]); return decl; });
  codigo = codigo.replace(/^export\s+((?:const|let|var)\s+([\w$]+)\s*=)/gm, (_t, decl, nombre) => { exportados.push([nombre, nombre]); return decl; });
  codigo = codigo.replace(/^export\s+default\s+/gm, '__exports.default = ');
  codigo = codigo.replace(/^export\s*\{([^}]*)\}[ \t]*;?/gm, (_t, lista) => {
    for (const s of lista.split(',').map((x) => x.trim()).filter(Boolean)) {
      const p = s.split(/\s+as\s+/);
      if (!p.every((x) => /^[\w$]+$/.test(x))) throw new Error('export que no se entiende en ' + ruta + ': ' + s);
      exportados.push([p[1] || p[0], p[0]]);
    }
    return '';
  });
  const resto = /^(import|export)\b.*$/m.exec(codigo);
  if (resto) throw new Error('sintaxis de módulo no soportada en ' + ruta + ': ' + resto[0].slice(0, 80));
  const salida = exportados.map(([pub, local]) => '__exports[' + JSON.stringify(pub) + '] = ' + local + ';').join('\n');
  // 'use strict' porque un módulo ES lo es siempre; no cambia el texto de las funciones.
  return '__def(' + JSON.stringify(ruta) + ', function (__import, __exports) {\n\'use strict\';\n' + codigo + '\n;\n' + salida + '\n});\n';
}

// Mini cargador que corre DENTRO del contexto vm: resuelve los __import en
// orden (cada módulo se evalúa una vez, la primera vez que alguien lo pide).
const CARGADOR = `
const __defs = Object.create(null);
const __hechos = Object.create(null);
function __def(ruta, fn) { __defs[ruta] = fn; }
function __req(ruta) {
  if (__hechos[ruta]) return __hechos[ruta];
  const fn = __defs[ruta];
  if (!fn) throw new Error('módulo sin cargar: ' + ruta);
  const exp = __hechos[ruta] = Object.create(null);
  fn(__req, exp);
  return exp;
}
`;

// Ejecuta los módulos en un contexto aislado y devuelve lo que calcule
// `extraer` (código que corre dentro y deja una cadena JSON).
function evaluarModulos(modulos, extraer, nombre) {
  let programa = CARGADOR;
  for (const [ruta, texto] of modulos) programa += transformarModulo(texto, ruta);
  programa += '\n' + extraer;
  const ctx = vm.createContext(Object.create(null), {
    name: nombre,
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate'
  });
  const salida = new vm.Script(programa, { filename: nombre + '.js' }).runInContext(ctx, { timeout: 10000 });
  if (typeof salida !== 'string') throw new Error(nombre + ': el contexto no devolvió texto');
  return JSON.parse(salida);
}

const EXTRAER_SCRIPTLETS = `(function () {
  const lista = __req(${JSON.stringify(UBO_SCRIPTLETS)}).builtinScriptlets;
  if (!Array.isArray(lista)) throw new Error('uBlock ya no exporta builtinScriptlets');
  return JSON.stringify(lista.map(function (s) {
    return {
      name: String(s && s.name),
      aliases: Array.isArray(s.aliases) ? s.aliases.map(String) : [],
      fn: typeof s.fn === 'function' ? Function.prototype.toString.call(s.fn) : null,
      dependencies: Array.isArray(s.dependencies) ? s.dependencies.map(function (d) {
        return typeof d === 'string' ? d : (d && d.details && typeof d.details.name === 'string' ? d.details.name : null);
      }) : [],
      requiresTrust: s.requiresTrust === true,
      world: typeof s.world === 'string' ? s.world : 'MAIN'
    };
  }));
})()`;

const EXTRAER_SUSTITUTOS = `(function () {
  const mapa = __req(${JSON.stringify(UBO_SUSTITUTOS)}).default;
  if (!mapa || typeof mapa.forEach !== 'function') throw new Error('redirect-resources.js ya no exporta un Map');
  const out = [];
  mapa.forEach(function (v, k) {
    v = v || {};
    out.push({
      name: String(k),
      alias: v.alias === undefined ? [] : [].concat(v.alias).map(String),
      params: Array.isArray(v.params) ? v.params.map(String) : null
    });
  });
  return JSON.stringify(out);
})()`;

/* ---------- Tipos MIME de los sustitutos ----------
   Los mismos que deduce el ensamblador de adblock-rust por la extensión
   (MimeType::from_extension): así un recurso armado aquí es idéntico al que
   armaría Brave con uBlockResources(). */
const MIME_POR_EXTENSION = {
  css: 'text/css', gif: 'image/gif', html: 'text/html', js: 'application/javascript',
  json: 'application/json', mp3: 'audio/mp3', mp4: 'video/mp4', png: 'image/png',
  txt: 'text/plain', xml: 'text/xml'
};
function mimeDe(nombre) {
  const i = nombre.lastIndexOf('.');
  return (i >= 0 && MIME_POR_EXTENSION[nombre.slice(i + 1)]) || 'application/octet-stream';
}

// Expresión que usa adblock-rust para reconocer un scriptlet "moderno": si el
// texto no empieza así, lo trataría como plantilla antigua y no lo llamaría.
const RE_FUNCION_SCRIPTLET = /^function\s+([^(){}\s]+)\s*\(/;

async function enParalelo(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const trabajador = async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
  return out;
}

const b64 = (buf) => Buffer.from(buf).toString('base64');

/**
 * Arma el array de recursos para `Engine.useResources`: los de Brave, los
 * scriptlets de uBlock y los sustitutos de uBlock.
 * @param {(url: string) => Promise<Buffer>} bajar  descarga; debe lanzar si falla
 * @returns {Promise<{ recursos: object[], resumen: object }>}
 */
async function generarRecursos(bajar, { concurrencia = 6 } = {}) {
  const texto = async (url) => (await bajar(url)).toString('utf8');

  // 1) Los propios de Brave, tal cual (ya vienen en el formato del motor).
  const brave = JSON.parse(await texto(BRAVE_URL));
  if (!Array.isArray(brave) || brave.length < 5 || !brave.every((r) => r && typeof r.name === 'string' && r.kind && typeof r.content === 'string')) {
    throw new Error('dist/resources.json de Brave con un formato inesperado');
  }

  // 2) Módulos de scriptlets de uBlock: se parte de scriptlets.js y se sigue
  //    cada import. Así no hace falta la API de GitHub (con su límite de 60
  //    consultas por hora) para saber qué archivos hay.
  const modulos = new Map();
  let pendientes = [UBO_SCRIPTLETS];
  while (pendientes.length) {
    if (modulos.size + pendientes.length > 120) throw new Error('demasiados módulos en los scriptlets de uBlock');
    const textos = await enParalelo(pendientes, concurrencia, (ruta) => texto(UBO_RAIZ + ruta));
    const nuevos = new Set();
    pendientes.forEach((ruta, k) => modulos.set(ruta, textos[k]));
    pendientes.forEach((ruta, k) => { for (const dep of importsDe(textos[k], ruta)) if (!modulos.has(dep)) nuevos.add(dep); });
    pendientes = [...nuevos];
  }
  const scriptlets = evaluarModulos(modulos, EXTRAER_SCRIPTLETS, 'ubo-scriptlets');

  // 3) Sustitutos: el índice (redirect-resources.js) y cada archivo de
  //    web_accessible_resources. Los que llevan `params` (click2load.html) se
  //    saltan, igual que hace el ensamblador de adblock-rust: el motor no sabe
  //    pasarles parámetros.
  const indice = evaluarModulos(new Map([[UBO_SUSTITUTOS, await texto(UBO_RAIZ + UBO_SUSTITUTOS)]]), EXTRAER_SUSTITUTOS, 'ubo-sustitutos')
    .filter((s) => !s.params);
  const binarios = await enParalelo(indice, concurrencia, (s) => bajar(UBO_RAIZ + UBO_WAR + encodeURIComponent(s.name)));

  // ---------- Validación: mejor fallar aquí que inyectar algo roto ----------
  const nombresScriptlets = new Set(scriptlets.map((s) => s.name));
  for (const s of scriptlets) {
    if (!/\.(js|fn)$/.test(s.name)) throw new Error('scriptlet con nombre raro: ' + s.name);
    if (typeof s.fn !== 'string' || !s.fn) throw new Error('scriptlet sin código: ' + s.name);
    // Solo se compila para comprobar la sintaxis; no se ejecuta.
    try { new vm.Script(s.fn, { filename: s.name }); } catch (e) { throw new Error('scriptlet con error de sintaxis: ' + s.name + ' (' + e.message + ')'); }
    if (s.name.endsWith('.js') && !RE_FUNCION_SCRIPTLET.test(s.fn)) throw new Error('scriptlet que adblock-rust no sabría llamar: ' + s.name);
    for (const d of s.dependencies) if (!d || !nombresScriptlets.has(d)) throw new Error('dependencia que falta en ' + s.name + ': ' + d);
  }
  if (scriptlets.filter((s) => s.name.endsWith('.js')).length < 50) throw new Error('muy pocos scriptlets de uBlock: ' + scriptlets.length);
  if (indice.length < 20) throw new Error('muy pocos sustitutos de uBlock: ' + indice.length);

  // ---------- Montaje ----------
  // Primero gana: el motor descarta en silencio un recurso cuyo nombre o alias
  // ya exista. Se comprueba aquí para decir cuál se queda y no depender de eso.
  const recursos = [];
  const usados = new Set();
  const choques = [];
  const anade = (r, origen) => {
    const nombres = [r.name, ...(r.aliases || [])];
    const repetido = nombres.find((n) => usados.has(n));
    if (repetido) { choques.push(origen + ':' + r.name + (repetido !== r.name ? ' (alias ' + repetido + ')' : '')); return; }
    nombres.forEach((n) => usados.add(n));
    recursos.push(r);
  };
  // Scriptlets de uBlock primero: son los que las listas de uBlock esperan
  // encontrar con ese nombre; los sustitutos que coincidan (noeval.js, por
  // ejemplo) son el mismo código en forma de archivo.
  for (const s of scriptlets) {
    const r = {
      name: s.name,
      aliases: s.aliases,
      kind: { mime: s.name.endsWith('.fn') ? 'fn/javascript' : 'application/javascript' },
      content: b64(s.fn)
    };
    if (s.dependencies.length) r.dependencies = s.dependencies;
    if (s.requiresTrust) r.permission = PERMISO_CONFIANZA;
    anade(r, 'ubo');
  }
  indice.forEach((s, k) => {
    const mime = mimeDe(s.name);
    let datos = binarios[k];
    // Igual que el ensamblador de adblock-rust: los de texto, sin retornos de carro.
    if (mime === 'application/javascript' || mime === 'text/html' || mime === 'text/plain') datos = Buffer.from(datos.toString('utf8').replace(/\r/g, ''), 'utf8');
    anade({ name: s.name, aliases: s.alias, kind: { mime }, content: b64(datos) }, 'sustituto');
  });
  for (const r of brave) anade(r, 'brave');

  const resumen = {
    total: recursos.length,
    brave: brave.length,
    scriptlets: scriptlets.filter((s) => s.name.endsWith('.js')).length,
    funciones: scriptlets.filter((s) => s.name.endsWith('.fn')).length,
    confianza: scriptlets.filter((s) => s.requiresTrust).length,
    aislados: scriptlets.filter((s) => s.world === 'ISOLATED').length,
    sustitutos: indice.length,
    modulos: modulos.size,
    choques
  };
  return { recursos, resumen };
}

module.exports = { generarRecursos, PERMISO_CONFIANZA, BRAVE_URL, UBO_RAIZ };
