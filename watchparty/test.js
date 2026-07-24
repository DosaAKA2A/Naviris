/* Prueba del servidor de sincronización: 2 clientes, misma sala.
   Verifica: unión + conteo de peers, relay de eventos (play/seek), chat, y que
   el emisor NO recibe su propio evento (sin eco). Node 18+ (WebSocket global). */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8799;
const URL = 'ws://127.0.0.1:' + PORT + '/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const ws = new WebSocket(URL);
  const inbox = [];
  ws.addEventListener('message', (e) => { try { inbox.push(JSON.parse(e.data)); } catch (x) {} });
  return {
    ready: new Promise((res) => ws.addEventListener('open', res)),
    send: (o) => ws.send(JSON.stringify(o)),
    inbox,
    last: (t) => [...inbox].reverse().find((m) => m.t === t),
    close: () => ws.close()
  };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
  await sleep(700);
  let pass = 0, fail = 0;
  const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
  try {
    const A = client(), B = client();
    await Promise.all([A.ready, B.ready]);

    A.send({ t: 'join', room: 'sala-1', name: 'Dosa', host: true });
    await sleep(150);
    ok(A.last('joined') && A.last('joined').host === true, 'A se une como anfitrion');

    B.send({ t: 'join', room: 'SALA-1', name: 'Amiga', host: false });
    await sleep(200);
    ok(B.last('joined') && B.last('joined').n === 2, 'B se une y ve 2 en la sala');
    ok(A.last('peers') && A.last('peers').n === 2 && A.last('peers').who === 'Amiga', 'A es notificado de que entra Amiga');

    // Evento de reproduccion desde A -> debe llegarle a B, no a A
    const aBefore = A.inbox.length;
    A.send({ t: 'ev', kind: 'play', time: 12.5, at: Date.now() });
    await sleep(200);
    const ev = B.last('ev');
    ok(ev && ev.kind === 'play' && ev.time === 12.5 && ev.from === 'Dosa', 'B recibe play@12.5 con from=Dosa');
    ok(A.inbox.length === aBefore, 'A NO recibe su propio evento (sin eco)');

    // Seek desde B -> llega a A
    B.send({ t: 'ev', kind: 'seek', time: 300, at: Date.now() });
    await sleep(200);
    ok(A.last('ev') && A.last('ev').kind === 'seek' && A.last('ev').time === 300, 'A recibe seek@300 de B');

    // Latido del anfitrion
    A.send({ t: 'beat', time: 42, paused: false, at: Date.now() });
    await sleep(150);
    ok(B.last('beat') && B.last('beat').time === 42 && B.last('beat').paused === false, 'B recibe el latido del anfitrion');

    // Chat
    A.send({ t: 'chat', msg: 'hola!' });
    await sleep(150);
    ok(B.last('chat') && B.last('chat').msg === 'hola!' && B.last('chat').from === 'Dosa', 'B recibe el chat de A');

    // Salida: al cerrar B, A debe ver n=1
    B.close();
    await sleep(250);
    ok(A.last('peers') && A.last('peers').n === 1, 'A ve n=1 cuando B sale');

    A.close();
  } catch (e) {
    console.error('ERROR EN TEST:', e);
    fail++;
  } finally {
    srv.kill();
    console.log('\nRESULTADO: ' + pass + ' OK, ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
  }
})();
