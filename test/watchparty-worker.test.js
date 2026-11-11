/* Worker de Watch Party (watchparty/worker/worker.js) sin Cloudflare: el
   Durable Object corre en Node sobre un estado y unos sockets de mentira con
   la misma API de hibernación (attachments incluidos, que se copian en cada
   lectura como en el runtime). Prueba quién es anfitrión y qué se reenvía.
   La batería de red completa contra el worker de verdad es
   test/watchparty-relay.test.js con WP_RELAY_URL (wrangler dev). */
'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'watchparty', 'worker', 'worker.js');
let PartyRoom;
before(async () => {
  globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.a = a; this.b = b; } };
  // Como módulo ES desde su texto: el package.json del repo no es "type": "module".
  ({ PartyRoom } = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(WORKER, 'utf8'))));
});

class SocketFalso {
  constructor(estado) { this.estado = estado; this.adjunto = null; this.inbox = []; this.cierre = null; }
  serializeAttachment(v) { this.adjunto = JSON.stringify(v); }
  deserializeAttachment() { return this.adjunto ? JSON.parse(this.adjunto) : null; }
  send(s) { if (this.cierre) throw new Error('socket cerrado'); this.inbox.push(JSON.parse(s)); }
  close(code, reason) { this.cierre = { code, reason }; this.estado.socks.delete(this); }
}
function sala() {
  const estado = { socks: new Set(), getWebSockets() { return [...this.socks]; }, setWebSocketAutoResponse() {} };
  const room = new PartyRoom(estado);
  const conecta = () => { const ws = new SocketFalso(estado); estado.socks.add(ws); return ws; };
  const manda = (ws, o) => room.webSocketMessage(ws, JSON.stringify(o));
  const entra = (nombre, extra = {}) => {
    const ws = conecta();
    manda(ws, { t: 'join', room: 'ABC123', name: nombre, sid: nombre + '-sid', ...extra });
    return ws;
  };
  const sale = (ws) => { estado.socks.delete(ws); room.webSocketClose(ws); };
  return { room, conecta, manda, entra, sale };
}
const joined = (ws) => ws.inbox.find((m) => m.t === 'joined');
const de = (ws, t) => ws.inbox.filter((m) => m.t === t);
const vacia = (...ws) => { for (const w of ws) w.inbox.length = 0; };

test('anfitrión real: el que crea la sala lo es y solo él recibe la clave', () => {
  const S = sala();
  const A = S.entra('Ana', { host: true });
  const B = S.entra('Beto');
  assert.equal(joined(A).host, true);
  assert.match(joined(A).clave, /^[0-9a-f]{48}$/);
  assert.equal(joined(B).host, false);
  assert.equal('clave' in joined(B), false);
  assert.equal(B.inbox.some((m) => JSON.stringify(m).includes(joined(A).clave)), false, 'la clave no le llega a nadie más');
  S.manda(A, { t: 'beat', time: 3, paused: false, url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' });
  assert.deepEqual(de(B, 'beat').map((m) => [m.time, m.host, m.from]), [[3, true, 'Ana']]);
});

test('impostor con host:true en una sala con anfitrión entra como invitado y no manda', () => {
  const S = sala();
  const A = S.entra('Ana', { host: true });
  const B = S.entra('Beto');
  const X = S.entra('Xavi', { host: true, clave: 'f'.repeat(48) });
  assert.equal(joined(X).host, false);
  assert.equal('clave' in joined(X), false);
  vacia(A, B);
  S.manda(X, { t: 'beat', time: 999, paused: true, url: 'https://www.youtube.com/watch?v=otro123', host: true });
  S.manda(X, { t: 'ev', kind: 'nav', url: 'https://www.youtube.com/watch?v=otro123', host: true });
  assert.equal(de(B, 'beat').length + de(B, 'ev').length, 0, 'ni latido ni cambio de video a los invitados');
  assert.equal(de(A, 'beat').length, 0);
  assert.equal(de(A, 'ev')[0].host, false, 'el nav le llega al anfitrión marcado como de invitado');
  S.manda(X, { t: 'chat', msg: 'hola' });
  assert.equal(de(B, 'chat')[0].from, 'Xavi', 'el chat sigue siendo de todos');
});

test('órdenes de invitados: llegan a todos solo si el anfitrión lo permite', () => {
  const S = sala();
  const A = S.entra('Ana', { host: true });
  const B = S.entra('Beto');
  const C = S.entra('Caro');
  vacia(A, B, C);
  // Por defecto: reproducción abierta, cambio de video cerrado.
  S.manda(B, { t: 'ev', kind: 'pause', time: 10 });
  S.manda(B, { t: 'ev', kind: 'nav', url: 'https://www.youtube.com/watch?v=otro123' });
  S.manda(B, { t: 'ev', kind: 'vol', v: 0 });
  assert.deepEqual(de(C, 'ev').map((m) => m.kind), ['pause']);
  assert.deepEqual(de(A, 'ev').map((m) => m.kind), ['pause', 'nav', 'vol']);
  // El anfitrión activa el control exclusivo y abre el cambio de video.
  S.manda(A, { t: 'beat', time: 11, lock: true, nlock: false });
  vacia(A, B, C);
  S.manda(B, { t: 'ev', kind: 'play', time: 11 });
  S.manda(B, { t: 'ev', kind: 'nav', url: 'https://www.youtube.com/watch?v=otro123' });
  assert.deepEqual(de(C, 'ev').map((m) => m.kind), ['nav']);
  assert.deepEqual(de(A, 'ev').map((m) => m.kind), ['play', 'nav']);
  // El latido de un invitado no cambia los permisos ni llega a nadie.
  S.manda(B, { t: 'beat', time: 1, lock: false, nlock: false });
  vacia(A, C);
  S.manda(B, { t: 'ev', kind: 'seek', time: 1 });
  assert.equal(de(C, 'ev').length, 0);
  assert.equal(de(A, 'beat').length, 0);
  // Las órdenes del anfitrión llegan siempre.
  S.manda(A, { t: 'ev', kind: 'nav', url: 'https://www.youtube.com/watch?v=nuevo12' });
  assert.equal(de(C, 'ev')[0].host, true);
});

test('reconexión con la clave: tras recargar (otro sid) vuelve a ser anfitrión', () => {
  const S = sala();
  const A = S.entra('Ana', { host: true });
  const clave = joined(A).clave;
  const B = S.entra('Beto');
  S.sale(A);                                         // recarga: el socket se va
  const A2 = S.entra('Ana', { host: true, sid: 'otra-sesion', clave });
  assert.equal(joined(A2).host, true);
  assert.equal(joined(A2).clave, clave, 'la clave se mantiene mientras viva la sala');
  vacia(B);
  S.manda(A2, { t: 'beat', time: 5 });
  assert.equal(de(B, 'beat')[0].host, true);
  // Con el anfitrión anterior aún conectado (otra pestaña): pasa a invitado y se le avisa.
  const A3 = S.entra('Ana', { host: true, sid: 'tercera', clave });
  assert.equal(joined(A3).host, true);
  assert.deepEqual(de(A2, 'rol'), [{ t: 'rol', host: false }]);
  vacia(B);
  S.manda(A2, { t: 'beat', time: 6 });
  assert.equal(de(B, 'beat').length, 0, 'el anfitrión anterior ya no late');
});

test('anfitrión viejo sin clave: crea, reconecta con su sid y no vuelve con otro', () => {
  const S = sala();
  const A = S.entra('Ana', { host: true });           // addon 2.x: sin clave
  assert.equal(joined(A).host, true);
  const B = S.entra('Beto');
  // Bache de red: socket nuevo con el MISMO sid (el viejo puede seguir "vivo").
  const A2 = S.entra('Ana', { host: true, again: true });
  assert.equal(joined(A2).host, true);
  assert.ok(A.cierre, 'el socket viejo se cierra');
  assert.equal(de(B, 'peers').filter((m) => m.left).length, 0, 'sin "salió" fantasma');
  vacia(B);
  S.manda(A2, { t: 'beat', time: 7 });
  assert.equal(de(B, 'beat')[0].host, true);
  // Recarga (sid nuevo, sin clave) con la sala aún viva: entra como invitado.
  S.sale(A2);
  const A3 = S.entra('Ana', { host: true, sid: 'nueva' });
  assert.equal(joined(A3).host, false);
});

test('sala vacía = sala nueva; sala que nunca tuvo anfitrión se lo da al primero que lo pide', () => {
  const S = sala();
  const A = S.entra('Ana', { host: true });
  const clave = joined(A).clave;
  S.sale(A);
  const X = S.entra('Xavi', { host: true });
  assert.equal(joined(X).host, true);
  assert.notEqual(joined(X).clave, clave, 'clave nueva');
  const S2 = sala();
  S2.entra('Beto');
  assert.equal(joined(S2.entra('Caro', { host: true })).host, true);
  assert.equal(joined(S2.entra('Dani', { host: true })).host, false);
});

test('iris.it.com: ni latidos ni cambios de video que apunten ahí', () => {
  const S = sala();
  const A = S.entra('Ana', { host: true });
  const B = S.entra('Beto');
  vacia(B);
  S.manda(A, { t: 'beat', time: 1, url: 'https://iris.it.com/moovin/?v=x' });
  S.manda(A, { t: 'ev', kind: 'nav', url: 'https://www.iris.it.com/moovin/' });
  S.manda(A, { t: 'ev', kind: 'nav', url: 'https://moovin.live/?v=x' });
  assert.deepEqual(de(B, 'ev').map((m) => m.url), ['https://moovin.live/?v=x']);
  assert.equal(de(B, 'beat').length, 0);
});

test('el estado de la sala sobrevive a la hibernación (va en los attachments)', () => {
  const S = sala();
  const A = S.entra('Ana', { host: true });
  const B = S.entra('Beto');
  S.manda(A, { t: 'beat', time: 1, lock: true });
  // El objeto se despierta de cero: mismo estado y sockets, instancia nueva.
  const despierto = new PartyRoom(S.room.state);
  vacia(A, B);
  despierto.webSocketMessage(B, JSON.stringify({ t: 'ev', kind: 'pause', time: 2 }));
  assert.equal(de(A, 'ev').length, 1);
  despierto.webSocketMessage(A, JSON.stringify({ t: 'beat', time: 2 }));
  assert.equal(de(B, 'beat').length, 1);
  assert.ok(JSON.stringify(A.deserializeAttachment()).length < 2048, 'attachment por debajo del tope de 2 KB');
});
