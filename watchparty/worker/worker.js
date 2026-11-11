/* Naviris Watch Party — servidor de sincronización en Cloudflare Workers
   ---------------------------------------------------------------------------
   Port del server.js de Node al runtime de Workers. Mismo protocolo de
   aplicación (join / ev / beat / chat / perfil / ping, respuestas joined /
   peers / rol / pong / error):
   el addon no distingue entre ambos servidores. Lo hablan el addon de Naviris
   y la página de MOOVIN; cualquier cambio va en los DOS servidores.

   Un único Durable Object ("global") gestiona todas las salas; los sockets
   usan la API de hibernación (webSocketMessage/webSocketClose) para que el
   objeto pueda dormir entre mensajes sin cortar las conexiones. La sala, el
   nombre y el papel de cada socket viajan en su attachment (sobrevive a la
   hibernación), y con ellos el estado de la sala (`sala`, ver abajo), copiado
   en el de cada miembro: dura lo que dura la sala, sin almacenamiento aparte.

   Desplegar:  npx wrangler deploy   (desde watchparty/worker/)
   Salud:      GET /health -> "ok"
*/
const MAX_MSG = 64 * 1024; // 64 KB por mensaje: de sobra para señales y chat

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
      return env.PARTY.get(env.PARTY.idFromName('global')).fetch(request);
    }
    return new Response('Naviris Watch Party server.');
  }
};

/* Vigía de la conexión: el cliente manda `ping` cada pocos segundos y se le
   contesta `pong` sin despertar al objeto (respuesta automática de la API de
   hibernación; exige el texto exacto, por eso webSocketMessage también lo
   contesta por si llega escrito de otra forma). */
const PING = '{"t":"ping"}';
const PONG = '{"t":"pong"}';

/* Quién es el anfitrión lo decide el relay, no el cliente: antes bastaba con
   mandar `host: true` en el join para mandar en cualquier sala de la que se
   supiera el código. Cada sala guarda:
     clave    secreto del anfitrión: se acuña al crear la sala y solo se le
              manda a él (en su `joined`); con ella vuelve a serlo tras recargar.
     hostSid  la sesión (`sid`) del anfitrión: los clientes viejos no conocen la
              clave, pero al reconectar repiten su sid, que nunca se reenvía.
     tuvo     si alguien ha sido ya anfitrión de la sala.
     lock / nlock  los permisos que el anfitrión anuncia en su latido.
   Se es anfitrión al crear la sala (entrar el primero pidiéndolo), con la
   clave, con el sid del anfitrión o pidiéndolo en una sala que aún no ha tenido
   anfitrión. Fuera de eso se entra como invitado aunque se pida. */
function nuevaClave() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function mismaClave(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/* iris.it.com caducó y hoy lo sirve un aparcado: no se reenvía ningún cambio
   de video ni latido que apunte ahí. Los addons viejos aún lo toman por MOOVIN. */
function urlVetada(u) {
  try { return /(^|\.)iris\.it\.com$/i.test(new URL(String(u)).hostname); } catch { return false; }
}
/* Órdenes de un invitado que llegan a todos: play/pausa/salto si el anfitrión
   no activó el control exclusivo y nav si no cerró el cambio de video. Las
   demás (las prohibidas y las que solo entiende la pantalla de MOOVIN, que es
   la anfitriona de su mando: subs, audio, vol, salir) llegan solo al
   anfitrión, que decide si las obedece. */
function paraTodos(m, sala) {
  if (m.kind === 'play' || m.kind === 'pause' || m.kind === 'seek') return !sala.lock;
  if (m.kind === 'nav') return !sala.nlock;
  return false;
}

export class PartyRoom {
  constructor(state) {
    this.state = state;
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  meta(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  members(code) { return this.state.getWebSockets().filter((w) => this.meta(w).room === code); }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch { /* socket muerto */ } }
  broadcast(code, obj, except, soloHost) {
    const str = JSON.stringify(obj);
    for (const w of this.members(code)) {
      if (w === except || (soloHost && !this.meta(w).host)) continue;
      try { w.send(str); } catch { /* socket muerto */ }
    }
  }
  // Estado de la sala: el mismo en el attachment de cada miembro.
  sala(code) { for (const w of this.members(code)) { const s = this.meta(w).sala; if (s) return s; } return null; }
  guardaSala(code, sala) { for (const w of this.members(code)) w.serializeAttachment({ ...this.meta(w), sala }); }
  leave(ws) {
    const m = this.meta(ws); if (!m.room) return;
    ws.serializeAttachment({});
    const n = this.members(m.room).length;
    if (n > 0) this.broadcast(m.room, { t: 'peers', n, who: m.name, left: true }, null);
  }

  webSocketMessage(ws, data) {
    if (typeof data !== 'string') return; // solo texto
    // Lo mismo que server.js: un mensaje que se pasa del tope cierra el socket.
    if (data.length > MAX_MSG) { try { ws.close(1009, 'mensaje demasiado grande'); } catch { /* ya cerrado */ } return; }
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') { this.send(ws, { t: 'pong' }); return; }
    if (m.t === 'join') {
      const code = String(m.room || '').toUpperCase().slice(0, 12).replace(/[^A-Z0-9]/g, '');
      if (!code) { this.send(ws, { t: 'error', msg: 'sala invalida' }); return; }
      this.leave(ws);
      /* `sid` identifica la SESIÓN del cliente (lo genera él al entrar y lo
         repite al reconectar). Si en la sala queda un socket viejo con el
         mismo sid — el portátil se suspendió, la red dio un bache — se cierra
         aquí en silencio: sin él la sala contaba a la misma persona dos veces
         ("3 personas" con dos dentro) y al morir el viejo anunciaba un "salió"
         de alguien que seguía ahí. `again` va en el aviso para que el chat
         diga "volvió a conectarse" y no "se unió". */
      const sid = String(m.sid || '').slice(0, 40);
      let again = !!m.again;
      if (sid) {
        for (const w of this.members(code)) {
          if (w !== ws && this.meta(w).sid === sid) {
            w.serializeAttachment({});   // sin sala: su cierre no anuncia nada
            try { w.close(1000, 'reemplazado'); } catch { /* ya muerto */ }
            again = true;
          }
        }
      }
      const otros = this.members(code);
      // Sala vacía = sala nueva (también si quien vuelve era el único dentro).
      let sala = (otros.length && this.sala(code)) || { clave: nuevaClave(), hostSid: '', tuvo: false, lock: false, nlock: true };
      const host = !!m.host && (!otros.length || !sala.tuvo || mismaClave(m.clave, sala.clave) || (!!sid && sid === sala.hostSid));
      if (host) {
        sala = { ...sala, hostSid: sid, tuvo: true };
        // Un solo anfitrión: el que hubiera (la sesión anterior de quien vuelve
        // con la clave) pasa a invitado y se le avisa.
        for (const w of otros) {
          const o = this.meta(w);
          if (o.host) { w.serializeAttachment({ ...o, host: false }); this.send(w, { t: 'rol', host: false }); }
        }
      }
      const name = String(m.name || 'anon').slice(0, 32);
      ws.serializeAttachment({ room: code, name, host, sid });
      this.guardaSala(code, sala);
      const n = otros.length + 1;
      const joined = { t: 'joined', room: code, n, host };
      if (host) joined.clave = sala.clave;
      this.send(ws, joined);
      this.broadcast(code, { t: 'peers', n, who: name, joined: true, again }, ws);
      return;
    }
    const meta = this.meta(ws);
    if (!meta.room) return; // el resto requiere estar en una sala
    // `perfil` lleva la foto de la cuenta, una vez al entrar: el join no se
    // reenvía y en cada mensaje serían kilobytes por latido. Los clientes que no
    // lo conocen lo ignoran.
    if (m.t === 'ev' || m.t === 'beat' || m.t === 'chat' || m.t === 'perfil') {
      // `host` lo pone el servidor desde el attachment del join, no el cliente:
      // es el único dato de quién manda en el que el receptor puede confiar, y
      // sin él no puede distinguir un cambio de video del anfitrión de uno de
      // otro invitado (y acababa descartando los dos). Por lo mismo, el `who`
      // que mande el cliente se borra: quién habla lo dice `from`.
      delete m.who;
      m.from = meta.name;
      m.host = !!meta.host;
      // Sockets abiertos antes del despliegue no traen `sala`: se toma la de otro o una neutra.
      const sala = meta.sala || this.sala(meta.room) || { clave: '', hostSid: '', tuvo: true, lock: false, nlock: true };
      if ((m.t === 'beat' || m.kind === 'nav') && urlVetada(m.url)) return;
      if (m.t === 'beat') {
        // El latido solo vale del anfitrión; con él anuncia sus permisos.
        if (!meta.host) return;
        const lock = !!m.lock, nlock = m.nlock !== false;
        if (lock !== sala.lock || nlock !== sala.nlock) this.guardaSala(meta.room, { ...sala, lock, nlock });
      }
      // Reenviar a los demás de la sala (nunca al emisor: evita eco); lo que el
      // anfitrión no permite a los invitados, solo a él.
      const soloHost = m.t === 'ev' && !meta.host && !paraTodos(m, sala);
      this.broadcast(meta.room, m, ws, soloHost);
    }
  }

  webSocketClose(ws) { this.leave(ws); }
  webSocketError(ws) { this.leave(ws); }
}
