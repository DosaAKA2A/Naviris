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

// `grupos`: [[máscara de permisos, texto de reglas], ...] (ver adblock.js).
function montaMotor(grupos) {
  // Aquí y no arriba: si adblock-rs falta, adblock.js sigue cargando (sin motor).
  const { Engine, FilterSet } = require('adblock-rs');
  // false = sin modo depuración: guardaba el texto de cada regla (unos 8 MB más
  // en memoria, medido) y no cambia qué se bloquea.
  const set = new FilterSet(false);
  // Siempre con objeto de opciones: el binding lanza si recibe `undefined`.
  for (const [mascara, texto] of grupos) set.addFilters(texto, { permissions: mascara });
  return new Engine(set);
}

if (!isMainThread && workerData && workerData.motorDelBloqueador) {
  const buf = montaMotor(workerData.grupos).serialize();
  parentPort.postMessage(buf, [buf]);
}

module.exports = { montaMotor };
