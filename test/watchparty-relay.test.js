/* Relay de Watch Party: salas, reenvío, reconexión, anfitrión que se va y
   mensajes inválidos. Sin dependencias (node:test y el WebSocket de Node 22+).

   Por defecto arranca watchparty/server.js en un puerto libre. Con
   WP_RELAY_URL se prueba otro relay con el MISMO protocolo, por ejemplo el
   worker de producción en local:
     cd watchparty/worker && npx wrangler dev --port 8792
     WP_RELAY_URL=ws://127.0.0.1:8792 npm test
   (Nada de esto despliega: wrangler dev corre el worker en tu equipo.) */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

let URL_RELAY = process.env.WP_RELAY_URL || '';
let srv = null;

function puertoLibre() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

before(async () => {
  if (URL_RELAY) return;
  const port = await puertoLibre();
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'watchparty', 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => {
    srv.stdout.on('data', (d) => { if (/escuchando/.test(String(d))) res(); });
    srv.on('exit', (c) => rej(new Error('server.js salió con ' + c)));
  });
  URL_RELAY = 'ws://127.0.0.1:' + port + '/';
});
// Todos los sockets abiertos se cierran al final, aunque un test falle a medias:
// si no, el proceso de pruebas se queda esperando por ellos.
const vivos = new Set();
after(() => { for (const ws of vivos) { try { ws.close(); } catch { /* ya cerrado */ } } if (srv) srv.kill(); });

/* Cliente de prueba: guarda todo lo que recibe y deja esperar por un mensaje. */
function cliente() {
  const ws = new WebSocket(URL_RELAY);
  vivos.add(ws);
  ws.addEventListener('close', () => vivos.delete(ws));
  const inbox = [];
  const esperas = [];
  let cierre = null;
  ws.addEventListener('message', (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    inbox.push(m);
    for (const w of [...esperas]) if (w.pred(m)) { esperas.splice(esperas.indexOf(w), 1); w.res(m); }
  });
  const cerrado = new Promise((res, rej) => {
    ws.addEventListener('close', (e) => { cierre = { code: e.code, reason: e.reason }; res(cierre); });
    setTimeout(() => rej(new Error('el relay no cerró el socket')), 5000).unref();
  });
  cerrado.catch(() => { /* solo cuenta si un test lo espera */ });
  return {
    ws, inbox, cerrado,
    get cierre() { return cierre; },
    abierto: new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); }),
    send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
    // Espera el primer mensaje (ya llegado o por llegar) que cumpla pred.
    espera(pred, ms = 3000) {
      const ya = inbox.find(pred);
      if (ya) return Promise.resolve(ya);
      return new Promise((res, rej) => {
        const w = { pred, res };
        esperas.push(w);
        setTimeout(() => { const i = esperas.indexOf(w); if (i !== -1) { esperas.splice(i, 1); rej(new Error('no llegó el mensaje esperado')); } }, ms);
      });
    },
    cerrar: () => { try { ws.close(); } catch { /* ya cerrado */ } }
  };
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const salaNueva = () => 'T' + Math.random().toString(36).slice(2, 9).toUpperCase();

// Entra en la sala y espera el `joined`.
async function entra(c, sala, nombre, host, extra = {}) {
  await c.abierto;
  c.send({ t: 'join', room: sala, name: nombre, host, sid: nombre + '-sid', ...extra });
  return c.espera((m) => m.t === 'joined');
}

test('unirse: código normalizado, conteo y aviso a los demás', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente();
  const ja = await entra(A, sala.toLowerCase() + '-', 'Ana', true);
  assert.equal(ja.room, sala);
  assert.equal(ja.n, 1);
  assert.equal(ja.host, true);
  const jb = await entra(B, sala, 'Beto', false);
  assert.equal(jb.n, 2);
  assert.equal(jb.host, false);
  const p = await A.espera((m) => m.t === 'peers' && m.joined);
  assert.deepEqual({ n: p.n, who: p.who, again: p.again }, { n: 2, who: 'Beto', again: false });
  A.cerrar(); B.cerrar();
});

test('reenvío: ev, beat, chat y perfil llegan a los demás, nunca al emisor', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente(), C = cliente();
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  await entra(C, sala, 'Caro', false);
  await A.espera((m) => m.t === 'peers' && m.who === 'Caro');
  const antesA = A.inbox.length;
  A.send({ t: 'ev', kind: 'play', time: 12.5 });
  A.send({ t: 'beat', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', time: 42, paused: false });
  A.send({ t: 'chat', msg: 'hola' });
  A.send({ t: 'perfil', foto: 'data:image/png;base64,AAAA' });
  for (const X of [B, C]) {
    const ev = await X.espera((m) => m.t === 'ev');
    assert.deepEqual({ kind: ev.kind, time: ev.time, from: ev.from, host: ev.host }, { kind: 'play', time: 12.5, from: 'Ana', host: true });
    const beat = await X.espera((m) => m.t === 'beat');
    assert.equal(beat.time, 42);
    assert.equal(beat.host, true);
    assert.equal((await X.espera((m) => m.t === 'chat')).msg, 'hola');
    assert.equal((await X.espera((m) => m.t === 'perfil')).from, 'Ana');
  }
  await dormir(200);
  assert.equal(A.inbox.length, antesA, 'el emisor no recibe su propio eco');
  A.cerrar(); B.cerrar(); C.cerrar();
});

test('quién manda lo dice el relay: un invitado no se hace pasar por el anfitrión', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente();
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  B.send({ t: 'beat', time: 1, paused: true, host: true, from: 'Ana' });
  B.send({ t: 'ev', kind: 'pause', time: 1, host: true, from: 'Ana' });
  B.send({ t: 'chat', msg: 'soy Ana', who: 'Ana' });
  const ev = await A.espera((m) => m.t === 'ev');
  assert.equal(ev.host, false);
  assert.equal(ev.from, 'Beto');
  const chat = await A.espera((m) => m.t === 'chat');
  assert.equal(chat.from, 'Beto');
  assert.equal('who' in chat, false, 'el who del cliente se borra');
  assert.equal(A.inbox.some((m) => m.t === 'beat'), false, 'el latido de un invitado no llega');
  A.cerrar(); B.cerrar();
});

test('anfitrión: lo es quien crea la sala, solo él recibe la clave y un impostor con host:true entra como invitado', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente(), X = cliente();
  const ja = await entra(A, sala, 'Ana', true);
  assert.equal(ja.host, true);
  assert.match(ja.clave, /^[0-9a-f]{48}$/);
  const jb = await entra(B, sala, 'Beto', false);
  assert.equal('clave' in jb, false);
  const jx = await entra(X, sala, 'Xavi', true, { clave: 'f'.repeat(48) });
  assert.equal(jx.host, false);
  assert.equal('clave' in jx, false);
  X.send({ t: 'beat', time: 999, paused: true, url: 'https://www.youtube.com/watch?v=otro1234' });
  X.send({ t: 'ev', kind: 'nav', url: 'https://www.youtube.com/watch?v=otro1234' });
  X.send({ t: 'chat', msg: 'hola' });
  assert.equal((await B.espera((m) => m.t === 'chat')).from, 'Xavi');
  const nav = await A.espera((m) => m.t === 'ev');
  assert.equal(nav.host, false, 'el nav del impostor solo le llega al anfitrión, marcado como de invitado');
  await dormir(200);
  assert.equal(B.inbox.some((m) => m.t === 'beat' || m.t === 'ev'), false, 'a los invitados no les llega nada de eso');
  assert.equal(A.inbox.some((m) => m.t === 'beat'), false);
  A.cerrar(); B.cerrar(); X.cerrar();
});

test('órdenes de invitados: a todos solo si el anfitrión lo permite; si no, solo al anfitrión', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente(), C = cliente();
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  await entra(C, sala, 'Caro', false);
  await A.espera((m) => m.t === 'peers' && m.who === 'Caro');
  // Por defecto: reproducción abierta, cambio de video cerrado.
  B.send({ t: 'ev', kind: 'nav', url: 'https://www.youtube.com/watch?v=otro1234' });
  B.send({ t: 'ev', kind: 'pause', time: 10 });
  assert.equal((await C.espera((m) => m.t === 'ev')).kind, 'pause');
  await A.espera((m) => m.t === 'ev' && m.kind === 'pause');
  assert.equal(A.inbox.some((m) => m.t === 'ev' && m.kind === 'nav'), true);
  // Control exclusivo y cambio de video abierto, anunciados en el latido.
  A.send({ t: 'beat', time: 11, lock: true, nlock: false });
  await B.espera((m) => m.t === 'beat');
  B.send({ t: 'ev', kind: 'play', time: 11 });
  B.send({ t: 'ev', kind: 'nav', url: 'https://www.youtube.com/watch?v=nuevo123' });
  assert.equal((await C.espera((m) => m.t === 'ev' && m.kind === 'nav')).host, false);
  await A.espera((m) => m.t === 'ev' && m.kind === 'play');
  await dormir(200);
  assert.equal(C.inbox.some((m) => m.t === 'ev' && m.kind === 'play'), false, 'el play prohibido no llega a los invitados');
  A.cerrar(); B.cerrar(); C.cerrar();
});

test('reconexión del anfitrión: con la clave tras recargar; el viejo, con su sid; sin nada, invitado', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente();
  const { clave } = await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  // Addon 2.x en un bache de red: socket nuevo con el MISMO sid y sin clave.
  const A2 = cliente();
  assert.equal((await entra(A2, sala, 'Ana', true, { again: true })).host, true);
  await A.cerrado;
  A2.send({ t: 'beat', time: 5 });
  assert.equal((await B.espera((m) => m.t === 'beat')).host, true);
  // Recarga: sid nuevo. Sin clave entra como invitado; con ella, anfitrión.
  A2.cerrar();
  await B.espera((m) => m.t === 'peers' && m.left);
  const A3 = cliente();
  assert.equal((await entra(A3, sala, 'Ana', true, { sid: 'recarga-1' })).host, false);
  const A4 = cliente();
  const j4 = await entra(A4, sala, 'Ana', true, { sid: 'recarga-2', clave });
  assert.deepEqual({ host: j4.host, clave: j4.clave }, { host: true, clave });
  A4.send({ t: 'beat', time: 6 });
  assert.equal((await B.espera((m) => m.t === 'beat' && m.time === 6)).host, true);
  // Con la clave desde otra pestaña: el anfitrión anterior pasa a invitado y se le avisa.
  const A5 = cliente();
  assert.equal((await entra(A5, sala, 'Ana', true, { sid: 'otra-pestana', clave })).host, true);
  assert.deepEqual(await A4.espera((m) => m.t === 'rol'), { t: 'rol', host: false });
  A4.send({ t: 'beat', time: 7 });
  await dormir(200);
  assert.equal(B.inbox.some((m) => m.t === 'beat' && m.time === 7), false);
  B.cerrar(); A3.cerrar(); A4.cerrar(); A5.cerrar();
});

test('sala vacía = sala nueva: el primero que la pide es anfitrión con otra clave', async () => {
  const sala = salaNueva();
  const A = cliente();
  const { clave } = await entra(A, sala, 'Ana', true);
  A.cerrar();
  await dormir(300);
  const X = cliente();
  const jx = await entra(X, sala, 'Xavi', true);
  assert.equal(jx.host, true);
  assert.notEqual(jx.clave, clave);
  X.cerrar();
});

test('iris.it.com: no se reenvía ningún latido ni cambio de video que apunte ahí', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente();
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  A.send({ t: 'beat', time: 1, url: 'https://iris.it.com/moovin/?v=x' });
  A.send({ t: 'ev', kind: 'nav', url: 'https://iris.it.com/moovin/' });
  A.send({ t: 'ev', kind: 'nav', url: 'https://moovin.live/?v=x' });
  assert.equal((await B.espera((m) => m.t === 'ev')).url, 'https://moovin.live/?v=x');
  await dormir(200);
  assert.equal(B.inbox.filter((m) => m.t === 'ev' || m.t === 'beat').length, 1);
  A.cerrar(); B.cerrar();
});

test('las salas no se mezclan', async () => {
  const A = cliente(), B = cliente();
  await entra(A, salaNueva(), 'Ana', true);
  await entra(B, salaNueva(), 'Beto', true);
  A.send({ t: 'chat', msg: 'solo para mi sala' });
  await dormir(300);
  assert.equal(B.inbox.some((m) => m.t === 'chat' || m.t === 'peers'), false);
  A.cerrar(); B.cerrar();
});

test('reconexión con el mismo sid: el socket viejo se cierra sin "salió" fantasma', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente();
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  const B2 = cliente();
  const j = await entra(B2, sala, 'Beto', false, { again: true });
  assert.equal(j.n, 2, 'la misma persona no cuenta dos veces');
  const p = await A.espera((m) => m.t === 'peers' && m.joined && m.again);
  assert.equal(p.n, 2);
  await B.cerrado;
  await dormir(300);
  assert.equal(A.inbox.some((m) => m.t === 'peers' && m.left), false);
  // El nuevo socket sigue en la sala
  A.send({ t: 'chat', msg: 'sigues?' });
  assert.equal((await B2.espera((m) => m.t === 'chat')).msg, 'sigues?');
  A.cerrar(); B2.cerrar();
});

test('el anfitrión se va: los demás lo saben una sola vez y siguen conectados', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente(), C = cliente();
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  await entra(C, sala, 'Caro', false);
  await B.espera((m) => m.t === 'peers' && m.who === 'Caro');
  A.cerrar();
  const p = await B.espera((m) => m.t === 'peers' && m.left);
  assert.deepEqual({ n: p.n, who: p.who }, { n: 2, who: 'Ana' });
  await dormir(400);
  assert.equal(B.inbox.filter((m) => m.t === 'peers' && m.left).length, 1, 'un solo "salió"');
  // Sin anfitrión nadie ocupa su puesto: un invitado que lo pide sigue siéndolo
  // y su latido no llega.
  const X = cliente();
  assert.equal((await entra(X, sala, 'Xavi', true)).host, false);
  B.send({ t: 'beat', time: 5, paused: false });
  B.send({ t: 'chat', msg: 'seguimos' });
  await C.espera((m) => m.t === 'chat');
  assert.equal(C.inbox.some((m) => m.t === 'beat'), false);
  B.cerrar(); C.cerrar(); X.cerrar();
});

test('vigía de la conexión: ping recibe pong solo para quien lo manda', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente();
  await A.abierto;
  A.send({ t: 'ping' });
  await A.espera((m) => m.t === 'pong');
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  A.send({ t: 'ping' });
  await A.espera((m) => m.t === 'pong' && A.inbox.filter((x) => x.t === 'pong').length === 2);
  await dormir(200);
  assert.equal(B.inbox.some((m) => m.t === 'pong' || m.t === 'ping'), false);
  A.cerrar(); B.cerrar();
});

test('mensajes inválidos: se ignoran sin romper la sala', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente(), X = cliente();
  await X.abierto;
  X.send({ t: 'chat', msg: 'sin sala' });                  // antes de entrar
  X.send({ t: 'join', room: '!!!' });                       // sala vacía tras limpiar
  assert.equal((await X.espera((m) => m.t === 'error')).msg, 'sala invalida');
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  A.send('esto no es json');
  A.send('null');
  A.send({ sin: 't' });
  A.send({ t: 42 });
  A.send({ t: 'desconocido', x: 1 });
  A.send({ t: 'joined', n: 99 });                           // tipos del relay: no se reenvían
  A.send({ t: 'peers', n: 99, who: 'nadie', left: true });
  await dormir(300);
  assert.equal(B.inbox.filter((m) => m.t !== 'joined').length, 0, 'nada de eso llega a los demás');
  A.send({ t: 'chat', msg: 'sigo aquí' });
  assert.equal((await B.espera((m) => m.t === 'chat')).msg, 'sigo aquí');
  A.cerrar(); B.cerrar(); X.cerrar();
});

test('un mensaje de más de 64 KB cierra ese socket (1009) y la sala sigue', async () => {
  const sala = salaNueva();
  const A = cliente(), B = cliente();
  await entra(A, sala, 'Ana', true);
  await entra(B, sala, 'Beto', false);
  B.send({ t: 'chat', msg: 'x'.repeat(70 * 1024) });
  const c = await B.cerrado;
  assert.equal(c.code, 1009);
  const p = await A.espera((m) => m.t === 'peers' && m.left);
  assert.equal(p.n, 1);
  assert.equal(A.inbox.some((m) => m.t === 'chat'), false);
  A.cerrar();
});

test('salud: GET /health responde ok', async () => {
  const http = URL_RELAY.replace(/^ws/, 'http').replace(/\/?$/, '/health');
  const r = await fetch(http);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
});
