/* Naviris Watch Party — servidor de sincronización en Cloudflare Workers
   ---------------------------------------------------------------------------
   Port del server.js de Node al runtime de Workers. Mismo protocolo de
   aplicación (join / ev / beat / chat, respuestas joined / peers / error):
   el addon no distingue entre ambos servidores.

   Un único Durable Object ("global") gestiona todas las salas; los sockets
   usan la API de hibernación (webSocketMessage/webSocketClose) para que el
   objeto pueda dormir entre mensajes sin cortar las conexiones. La sala y el
   nombre de cada socket viajan en su attachment (sobrevive a la hibernación).

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

export class PartyRoom {
  constructor(state) { this.state = state; }

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
  broadcast(code, obj, except) {
    const str = JSON.stringify(obj);
    for (const w of this.members(code)) if (w !== except) { try { w.send(str); } catch { /* socket muerto */ } }
  }
  leave(ws) {
    const m = this.meta(ws); if (!m.room) return;
    ws.serializeAttachment({});
    const n = this.members(m.room).length;
    if (n > 0) this.broadcast(m.room, { t: 'peers', n, who: m.name, left: true }, null);
  }

  webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return; // solo texto
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') {
      const code = String(m.room || '').toUpperCase().slice(0, 12).replace(/[^A-Z0-9]/g, '');
      if (!code) { this.send(ws, { t: 'error', msg: 'sala invalida' }); return; }
      this.leave(ws);
      const meta = { room: code, name: String(m.name || 'anon').slice(0, 32), host: !!m.host };
      ws.serializeAttachment(meta);
      const n = this.members(code).length;
      this.send(ws, { t: 'joined', room: code, n, host: meta.host });
      this.broadcast(code, { t: 'peers', n, who: meta.name, joined: true }, ws);
      return;
    }
    const meta = this.meta(ws);
    if (!meta.room) return; // el resto requiere estar en una sala
    if (m.t === 'ev' || m.t === 'beat' || m.t === 'chat') {
      // Reenviar tal cual a los demás de la sala (nunca al emisor: evita eco).
      // `host` lo pone el servidor desde el attachment del join, no el cliente:
      // es el único dato de quién manda en el que el receptor puede confiar, y
      // sin él no puede distinguir un cambio de video del anfitrión de uno de
      // otro invitado (y acababa descartando los dos).
      m.from = meta.name;
      m.host = !!meta.host;
      this.broadcast(meta.room, m, ws);
    }
  }

  webSocketClose(ws) { this.leave(ws); }
  webSocketError(ws) { this.leave(ws); }
}
