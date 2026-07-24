/* Naviris Watch Party — servidor de sincronización (relay WebSocket)
   ---------------------------------------------------------------------------
   No transmite vídeo: solo reenvía señales de control (play/pausa/seek), el
   latido del anfitrión y el chat entre los miembros de una misma sala. Cada
   usuario reproduce su propia copia con su propia cuenta (Crunchyroll/Netflix).

   Implementación sin dependencias externas: hace el handshake y el framing de
   WebSocket (solo texto) con módulos nativos de Node. Salas efímeras en memoria.

   Uso:  node server.js            (escucha en el puerto 8787 por defecto)
         PORT=9000 node server.js
   Salud: GET /health -> "ok"
*/
'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8787', 10);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // magic string del protocolo WS
const MAX_MSG = 64 * 1024; // 64 KB por mensaje: de sobra para señales y chat

/* ---------- Salas en memoria ---------- */
const rooms = new Map(); // code -> Set<socket>
function roomOf(code) { let s = rooms.get(code); if (!s) { s = new Set(); rooms.set(code, s); } return s; }
function leave(sock) {
  const code = sock._room; if (!code) return;
  const s = rooms.get(code); if (!s) return;
  s.delete(sock);
  if (s.size === 0) rooms.delete(code);
  else broadcast(code, { t: 'peers', n: s.size }, null);
}

/* ---------- Envío de frames (servidor -> cliente, sin máscara) ---------- */
function sendFrame(sock, str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x81, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  try { sock.write(Buffer.concat([header, payload])); } catch (e) { /* socket muerto */ }
}
function sendJSON(sock, obj) { sendFrame(sock, JSON.stringify(obj)); }
function broadcast(code, obj, except) {
  const s = rooms.get(code); if (!s) return;
  const str = JSON.stringify(obj);
  for (const c of s) if (c !== except) sendFrame(c, str);
}

/* ---------- Manejo de mensajes de aplicación ---------- */
function onMessage(sock, str) {
  let m; try { m = JSON.parse(str); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'join') {
    const code = String(m.room || '').toUpperCase().slice(0, 12).replace(/[^A-Z0-9]/g, '');
    if (!code) { sendJSON(sock, { t: 'error', msg: 'sala invalida' }); return; }
    leave(sock);
    sock._room = code; sock._name = String(m.name || 'anon').slice(0, 32); sock._host = !!m.host;
    const s = roomOf(code); s.add(sock);
    sendJSON(sock, { t: 'joined', room: code, n: s.size, host: sock._host });
    broadcast(code, { t: 'peers', n: s.size, who: sock._name, joined: true }, sock);
    return;
  }
  if (!sock._room) return; // el resto requiere estar en una sala
  if (m.t === 'ev' || m.t === 'beat' || m.t === 'chat') {
    // Reenviar tal cual a los demás de la sala (nunca al emisor: evita eco).
    m.from = sock._name;
    broadcast(sock._room, m, sock);
  }
}

/* ---------- Framing de entrada (cliente -> servidor, enmascarado) ---------- */
function attach(sock) {
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // Procesar tantos frames completos como haya en el buffer.
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0; const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0; let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
      if (len > MAX_MSG) { sock.destroy(); return; }
      const need = offset + (masked ? 4 : 0) + len;
      if (buf.length < need) return; // frame incompleto: esperar más datos
      let payload;
      if (masked) {
        const mask = buf.slice(offset, offset + 4);
        payload = Buffer.alloc(len);
        for (let i = 0; i < len; i++) payload[i] = buf[offset + 4 + i] ^ mask[i & 3];
      } else {
        payload = buf.slice(offset, offset + len);
      }
      buf = buf.slice(need);
      if (opcode === 0x8) { leave(sock); sock.end(); return; }       // close
      else if (opcode === 0x9) { sock.write(Buffer.from([0x8a, 0])); } // ping -> pong
      else if (opcode === 0x1 && fin) { onMessage(sock, payload.toString('utf8')); } // texto
      // (no se soportan frames fragmentados ni binarios: no hacen falta)
    }
  });
  sock.on('close', () => leave(sock));
  sock.on('error', () => leave(sock));
}

/* ---------- HTTP + upgrade a WebSocket ---------- */
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Naviris Watch Party server. Salas activas: ' + rooms.size);
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  attach(socket);
});
server.listen(PORT, () => console.log('[watchparty] escuchando en :' + PORT));
