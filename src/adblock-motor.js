// Montaje del motor del bloqueador (adblock-rs) a partir del texto de las
// listas. Vive aparte de adblock.js porque se usa en DOS hilos:
//   · en un hilo de trabajo (worker_threads), que es lo normal: montar el motor
//     con las listas de Brave cuesta unos 150-200 ms de CPU, y en el hilo
//     principal de Electron eso congelaba la interfaz y TODAS las peticiones
//     de red en cada arranque y en cada actualización de listas (medido el
//     03/11/2026). El hilo devuelve el motor serializado y el principal solo lo
//     carga (deserialize, unos 25 ms).
//   · en el hilo principal, como respaldo si el hilo no se puede crear, y en
//     los tests.
// Aquí no se usa nada de Electron: en un hilo de trabajo no está.
'use strict';

const { isMainThread, parentPort, workerData } = require('worker_threads');

/* Reglas de las listas de Brave que Naviris NO aplica. Se quitan del texto al
   montar el motor, así da igual que la lista se vuelva a bajar.
   · El clic automático en el aviso de cookies de YouTube (Cookie Notices):
     tras ese clic YouTube recarga la página SIEMPRE, y si el consentimiento no
     se llega a guardar el aviso vuelve a salir y el clic se repite sin fin.
     Medido el 21/10/2026: candidato al bucle de recargas que dejaba YouTube en
     blanco (ver frenoDeRecargas en main.js). Sin él, el aviso sale una vez y se
     acepta a mano. Son varias reglas y no todas nombran el aviso: la de
     `button[aria-label*="Accept the use of cookie"]` (con www.youtube.com
     junto a otros dominios) pulsa el mismo botón en inglés y se escapaba
     (03/11/2026). Se quita cualquier clic automático de cookies o
     consentimiento cuyo dominio incluya www.youtube.com. */
const REGLAS_FUERA = [
  /^(?:[^#\n]*,)?www\.youtube\.com(?:,[^#\n]*)?##\+js\(trusted-click-element,[^\n]*(?:consent|cookie)[^\n]*$/gmi
];
const quitaReglas = (texto) => REGLAS_FUERA.reduce((t, re) => t.replace(re, ''), texto);

// `grupos`: [[máscara de permisos, texto de reglas], ...] (ver adblock.js).
function montaMotor(grupos) {
  // Aquí y no arriba: si adblock-rs falta, adblock.js sigue cargando (sin motor).
  const { Engine, FilterSet } = require('adblock-rs');
  // false = sin modo depuración: guardaba el texto de cada regla (unos 8 MB más
  // en memoria, medido) y no cambia qué se bloquea.
  const set = new FilterSet(false);
  // Siempre con objeto de opciones: el binding lanza si recibe `undefined`.
  for (const [mascara, texto] of grupos) set.addFilters(quitaReglas(texto), { permissions: mascara });
  return new Engine(set);
}

if (!isMainThread && workerData && workerData.motorDelBloqueador) {
  const buf = montaMotor(workerData.grupos).serialize();
  parentPort.postMessage(buf, [buf]);
}

module.exports = { montaMotor, REGLAS_FUERA };
