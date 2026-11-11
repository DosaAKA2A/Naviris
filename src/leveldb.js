/* ===== LECTOR DE LEVELDB, SOLO PARA LEER (2026-11-11) =====
   Chromium guarda el localStorage de cada sesión en una base LevelDB
   («Local Storage/leveldb»). Al pasar la interfaz de file:// a naviris://app
   (ver protocolo.js) hay que traer lo que guardaba con el origen viejo, y con la
   fuse GrantFileProtocolExtraPrivileges apagada ninguna página ni DevTools lo
   puede leer ya (medido: file:// da SecurityError y DOMStorage devuelve []).
   Así que se lee el disco directamente.

   Lo justo del formato para leer, sin escribir nunca:
   · CURRENT dice qué MANIFEST vale, y el MANIFEST qué tablas (.ldb) están vivas
     y desde qué registro (.log) hay que leer.
   · .log: bloques de 32 KB con registros (CRC32C, longitud, tipo) que llevan
     lotes de escrituras con su número de secuencia.
   · .ldb: tablas con bloques comprimidos con Snappy, índice al final.
   De cada clave gana la escritura con el número de secuencia más alto; si es un
   borrado, la clave no existe. Cualquier cosa que no cuadre lanza: es mejor no
   migrar (y reintentar) que migrar algo a medias. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

class Corrupta extends Error {}
const falla = (que) => { throw new Corrupta('LevelDB ilegible: ' + que); };

function varint(b, p) {
  let n = 0, mult = 1;
  for (let i = 0; i < 10; i++) {
    if (p >= b.length) falla('varint cortado');
    const x = b[p++];
    n += (x & 0x7f) * mult;
    if (x < 0x80) return [n, p];
    mult *= 128;
  }
  return falla('varint demasiado largo');
}

// Trozo con su longitud delante (varint).
function trozo(b, p) {
  const [n, q] = varint(b, p);
  if (q + n > b.length) falla('trozo cortado');
  return [b.subarray(q, q + n), q + n];
}

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32c(...partes) {
  let c = 0xffffffff;
  for (const b of partes) for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// LevelDB guarda el CRC "enmascarado" para que un CRC de datos con CRC no se confunda.
const desenmascara = (m) => { const r = (m - 0xa282ead8) >>> 0; return ((r >>> 17) | (r << 15)) >>> 0; };

function snappy(b) {
  let [largo, p] = varint(b, 0);
  const out = Buffer.alloc(largo);
  let o = 0;
  while (p < b.length) {
    const tag = b[p++];
    const tipo = tag & 3;
    if (tipo === 0) {
      let n = tag >>> 2;
      if (n >= 60) {
        const bytes = n - 59;
        if (p + bytes > b.length) falla('snappy: literal cortado');
        n = b.readUIntLE(p, bytes); p += bytes;
      }
      n += 1;
      if (p + n > b.length || o + n > largo) falla('snappy: literal fuera');
      b.copy(out, o, p, p + n); o += n; p += n;
      continue;
    }
    let n, dist;
    if (tipo === 1) { n = ((tag >>> 2) & 7) + 4; if (p >= b.length) falla('snappy: copia cortada'); dist = ((tag >>> 5) << 8) | b[p++]; }
    else if (tipo === 2) { n = (tag >>> 2) + 1; if (p + 2 > b.length) falla('snappy: copia cortada'); dist = b.readUInt16LE(p); p += 2; }
    else { n = (tag >>> 2) + 1; if (p + 4 > b.length) falla('snappy: copia cortada'); dist = b.readUInt32LE(p); p += 4; }
    if (!dist || dist > o || o + n > largo) falla('snappy: copia fuera');
    for (let i = 0; i < n; i++, o++) out[o] = out[o - dist];   // de byte en byte: puede solaparse
  }
  if (o !== largo) falla('snappy: largo distinto');
  return out;
}

// Registros completos de un archivo de registro (.log o MANIFEST). Lo que está a
// medio escribir al final (un corte) o con el CRC mal se descarta, como LevelDB.
const BLOQUE_LOG = 32768;
function registros(b) {
  const out = [];
  let partes = null;
  for (let inicio = 0; inicio < b.length; inicio += BLOQUE_LOG) {
    const fin = Math.min(inicio + BLOQUE_LOG, b.length);
    let p = inicio;
    while (p + 7 <= fin) {
      const largo = b.readUInt16LE(p + 4), tipo = b[p + 6];
      if (tipo === 0 && largo === 0) break;                       // relleno del bloque
      if (p + 7 + largo > fin) break;
      const datos = b.subarray(p + 7, p + 7 + largo);
      const bien = desenmascara(b.readUInt32LE(p)) === crc32c(b.subarray(p + 6, p + 7), datos);
      p += 7 + largo;
      if (!bien) { partes = null; continue; }
      if (tipo === 1) { out.push(datos); partes = null; }
      else if (tipo === 2) partes = [datos];
      else if (tipo === 3) { if (partes) partes.push(datos); }
      else if (tipo === 4) { if (partes) out.push(Buffer.concat([...partes, datos])); partes = null; }
    }
  }
  return out;
}

// Un bloque de una tabla: sus datos, comprimidos o no, con su CRC detrás.
function bloque(b, desde, largo) {
  if (desde + largo + 5 > b.length) falla('bloque fuera de la tabla');
  const datos = b.subarray(desde, desde + largo);
  const tipo = b.subarray(desde + largo, desde + largo + 1);
  if (desenmascara(b.readUInt32LE(desde + largo + 1)) !== crc32c(datos, tipo)) falla('CRC de bloque');
  if (tipo[0] === 0) return datos;
  if (tipo[0] === 1) return snappy(datos);
  return falla('compresión desconocida');
}

function* entradas(blq) {
  if (blq.length < 4) falla('bloque vacío');
  const reinicios = blq.readUInt32LE(blq.length - 4);
  const limite = blq.length - 4 - 4 * reinicios;
  if (limite < 0) falla('bloque mal formado');
  let p = 0, ultima = Buffer.alloc(0);
  while (p < limite) {
    let comun, propia, largo;
    [comun, p] = varint(blq, p); [propia, p] = varint(blq, p); [largo, p] = varint(blq, p);
    if (comun > ultima.length || p + propia + largo > limite) falla('entrada mal formada');
    const clave = Buffer.concat([ultima.subarray(0, comun), blq.subarray(p, p + propia)]);
    p += propia;
    yield [clave, blq.subarray(p, p + largo)];
    p += largo;
    ultima = clave;
  }
}

const MAGIA = Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
function leeTabla(b, apunta) {
  if (b.length < 48 || !b.subarray(b.length - 8).equals(MAGIA)) falla('tabla sin pie');
  const pie = b.subarray(b.length - 48);
  let p = 0, idx, idxLargo;
  [, p] = varint(pie, p); [, p] = varint(pie, p);                   // metaíndice: no hace falta
  [idx, p] = varint(pie, p); [idxLargo] = varint(pie, p);
  for (const [, mano] of entradas(bloque(b, idx, idxLargo))) {
    const [desde, q] = varint(mano, 0);
    const [largo] = varint(mano, q);
    for (const [interna, valor] of entradas(bloque(b, desde, largo))) {
      if (interna.length < 8) falla('clave interna corta');
      const cola = interna.subarray(interna.length - 8);
      if (cola[7] !== 0) falla('secuencia demasiado alta');
      apunta(interna.subarray(0, interna.length - 8), cola.readUIntLE(1, 6), cola[0], valor);
    }
  }
}

function leeLote(r, apunta) {
  if (r.length < 12) falla('lote corto');
  if (r.readUInt16LE(6) !== 0) falla('secuencia demasiado alta');
  const base = r.readUIntLE(0, 6), n = r.readUInt32LE(8);
  let p = 12;
  for (let i = 0; i < n; i++) {
    const tipo = r[p++];
    let clave, valor = null;
    [clave, p] = trozo(r, p);
    if (tipo === 1) [valor, p] = trozo(r, p);
    else if (tipo !== 0) falla('tipo de escritura desconocido');
    apunta(clave, base + i, tipo, valor);
  }
}

// Lo que el MANIFEST da por vivo: tablas y desde qué registro leer. null si no se puede saber.
function vivos(dir) {
  let manifiesto;
  try { manifiesto = fs.readFileSync(path.join(dir, fs.readFileSync(path.join(dir, 'CURRENT'), 'utf8').trim())); } catch { return null; }
  const tablas = new Set();
  let desdeLog = 0, logPrevio = 0;
  for (const r of registros(manifiesto)) {
    let p = 0;
    while (p < r.length) {
      let tag, n;
      [tag, p] = varint(r, p);
      if (tag === 1) [, p] = trozo(r, p);                                // comparador
      else if (tag === 2) [desdeLog, p] = varint(r, p);
      else if (tag === 3 || tag === 4) [, p] = varint(r, p);             // siguiente archivo, última secuencia
      else if (tag === 5) { [, p] = varint(r, p); [, p] = trozo(r, p); }  // puntero de compactación
      else if (tag === 6) { [, p] = varint(r, p); [n, p] = varint(r, p); tablas.delete(n); }
      else if (tag === 7) { [, p] = varint(r, p); [n, p] = varint(r, p); [, p] = varint(r, p); [, p] = trozo(r, p); [, p] = trozo(r, p); tablas.add(n); }
      else if (tag === 9) [logPrevio, p] = varint(r, p);
      else falla('MANIFEST con una etiqueta desconocida');
    }
  }
  return { tablas, esLog: (n) => n >= desdeLog || (logPrevio > 0 && n === logPrevio) };
}

/* Todas las claves vivas de la base: Map(clave en latin1 -> Buffer del valor).
   Si el MANIFEST no se deja leer se leen todos los archivos que haya (LevelDB
   borra los viejos al abrirse, así que en la práctica son los vivos). */
function leeBase(dir) {
  const v = vivos(dir);
  const archivos = fs.readdirSync(dir)
    .map((nombre) => { const m = /^(\d+)\.(ldb|sst|log)$/.exec(nombre); return m && { nombre, n: Number(m[1]), log: m[2] === 'log' }; })
    .filter((a) => a && (!v || (a.log ? v.esLog(a.n) : v.tablas.has(a.n))))
    .sort((a, b) => a.n - b.n);
  if (v) for (const n of v.tablas) if (!archivos.some((a) => !a.log && a.n === n)) falla('falta la tabla ' + n);
  const ultimas = new Map();
  const apunta = (clave, seq, tipo, valor) => {
    const k = clave.toString('latin1');
    const antes = ultimas.get(k);
    if (!antes || antes.seq < seq) ultimas.set(k, { seq, valor: tipo === 1 ? Buffer.from(valor) : null });
  };
  for (const a of archivos) {
    const b = fs.readFileSync(path.join(dir, a.nombre));
    if (a.log) for (const r of registros(b)) leeLote(r, apunta);
    else leeTabla(b, apunta);
  }
  const out = new Map();
  for (const [k, { valor }] of ultimas) if (valor) out.set(k, valor);
  return out;
}

module.exports = { leeBase, snappy, registros, crc32c, Corrupta };
