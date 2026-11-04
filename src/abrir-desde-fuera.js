/* Lo que llega a Naviris desde fuera para abrir: un enlace pulsado en otra
   aplicación (Naviris como navegador predeterminado), un archivo .html o .pdf
   abierto desde el Explorador, o «Naviris.exe <dirección>» en una consola.
   Lo usa main.js al arrancar y cuando otra instancia le pasa lo suyo
   ('second-instance'). Sin Electron, para poder probarlo en test/.

   El instalador registra Naviris como `"Naviris.exe" --single-argument %1`,
   igual que Chrome: Chromium toma todo lo que va detrás como UN solo argumento
   y no lee ahí ninguna opción. Con `"%1"` a secas, un enlace con comillas
   dentro podía colar opciones de Chromium (medido: un enlace terminado en
   `" --remote-debugging-port=9555` abría el puerto de depuración). Node, en
   cambio, sí parte esa línea por los espacios: aquí se vuelve a juntar. */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ARG_UNICO = '--single-argument';

const esArchivo = (ruta) => { try { return fs.statSync(ruta).isFile(); } catch { return false; } };

// Los argumentos de verdad, sin el ejecutable (ni la carpeta de la app con «electron .»).
function argumentos(argv, defaultApp) {
  return argv.slice(defaultApp ? 2 : 1);
}

/* Las opciones que puso quien arrancó Naviris (--user-data-dir y las de
   Chromium). Las que vengan detrás de --single-argument son parte del enlace,
   no opciones. */
function opcionesPropias(argv, defaultApp = false) {
  const args = argumentos(argv, defaultApp);
  const i = args.indexOf(ARG_UNICO);
  return (i < 0 ? args : args.slice(0, i)).filter((a) => a.startsWith('-'));
}

// Un argumento -> la dirección que se abre en una pestaña, o null si no es nada que abrir.
function destinoDe(texto, cwd, existe) {
  const t = String(texto).trim();
  if (!t) return null;
  if (/^(https?|file):/i.test(t)) {
    try { const u = new URL(t); return /^(https?|file):$/.test(u.protocol) ? u.href : null; } catch { return null; }
  }
  // Una ruta: solo si es un archivo que existe (una carpeta o una palabra suelta no se abren).
  const ruta = path.resolve(cwd, t);
  return existe(ruta) ? pathToFileURL(ruta).href : null;
}

/* Las direcciones que hay que abrir, en orden y sin repetir. `cwd` es la
   carpeta desde la que se lanzó (para las rutas relativas de una consola). */
function destinosDeArgumentos(argv, { cwd = process.cwd(), defaultApp = false, existe = esArchivo } = {}) {
  const args = argumentos(argv, defaultApp);
  const i = args.indexOf(ARG_UNICO);
  const candidatos = i >= 0 ? [args.slice(i + 1).join(' ')] : args.filter((a) => !a.startsWith('-'));
  const destinos = [];
  for (const c of candidatos) {
    const d = destinoDe(c, cwd, existe);
    if (d && !destinos.includes(d)) destinos.push(d);
  }
  return destinos;
}

/* Si llega otra instancia mientras esta se está cerrando (el guardado de
   cookies de before-quit tarda hasta 8 s), lo que traía se perdería con ella.
   Estos son los argumentos para relanzar Naviris al acabar de cerrarse: las
   mismas opciones y la carpeta de la app (en desarrollo), y sus destinos. */
function argumentosParaRelanzar(argv, defaultApp, destinos) {
  return [...(defaultApp ? argv.slice(1, 2) : []), ...opcionesPropias(argv, defaultApp), ...destinos];
}

module.exports = { ARG_UNICO, destinosDeArgumentos, opcionesPropias, argumentosParaRelanzar };
