/* Cuenta Naviris — worker de sincronización (Cloudflare Workers + KV).
 *
 * Modelo: cuenta = correo + contraseña (PBKDF2-SHA256, 100k iteraciones, salt
 * por cuenta). Un token opaco de sesión (32 bytes aleatorios) con caducidad de
 * 90 días en KV. Los datos sincronizados son un blob JSON por cuenta
 * (preferencias, marcadores, accesos, widgets, notas del hub) con updatedAt
 * para last-write-wins en el cliente. Sin contraseñas ni tarjetas: esas nunca
 * salen del equipo.
 *
 * KV (binding SYNC):
 *   acct:<email> -> { salt, hash, created }
 *   tok:<token>  -> email                (expirationTtl 90 dias)
 *   sync:<email> -> { data, updatedAt }
 */
'use strict';

const TOKEN_TTL = 90 * 24 * 3600;
const MAX_BLOB = 300 * 1024; // 300 KB de datos por cuenta: de sobra para preferencias
const ITER = 100000;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }
});

const normEmail = (e) => String(e || '').trim().toLowerCase();
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

async function pbkdf2(password, saltB64) {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
function randB64(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b));
}
function randToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Comparación en tiempo constante para no filtrar el hash por timing
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function auth(env, req) {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  return env.SYNC.get('tok:' + m[1]);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return json({ ok: true });
    if (url.pathname === '/health') return json({ ok: true, service: 'naviris-account' });

    try {
      if (req.method === 'POST' && url.pathname === '/register') {
        const { email, password } = await req.json();
        const em = normEmail(email);
        if (!emailOk(em)) return json({ ok: false, error: 'Correo no válido' }, 400);
        if (String(password || '').length < 8) return json({ ok: false, error: 'La contraseña necesita al menos 8 caracteres' }, 400);
        if (await env.SYNC.get('acct:' + em)) return json({ ok: false, error: 'Ya existe una cuenta con ese correo' }, 409);
        const salt = randB64(16);
        const hash = await pbkdf2(String(password), salt);
        await env.SYNC.put('acct:' + em, JSON.stringify({ salt, hash, created: Date.now() }));
        const token = randToken();
        await env.SYNC.put('tok:' + token, em, { expirationTtl: TOKEN_TTL });
        return json({ ok: true, token, email: em });
      }

      if (req.method === 'POST' && url.pathname === '/login') {
        const { email, password } = await req.json();
        const em = normEmail(email);
        const acct = JSON.parse((await env.SYNC.get('acct:' + em)) || 'null');
        if (!acct) return json({ ok: false, error: 'No hay ninguna cuenta con ese correo' }, 404);
        const hash = await pbkdf2(String(password || ''), acct.salt);
        if (!safeEqual(hash, acct.hash)) return json({ ok: false, error: 'Contraseña incorrecta' }, 401);
        const token = randToken();
        await env.SYNC.put('tok:' + token, em, { expirationTtl: TOKEN_TTL });
        return json({ ok: true, token, email: em });
      }

      if (req.method === 'POST' && url.pathname === '/logout') {
        const h = (req.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
        if (h) await env.SYNC.delete('tok:' + h[1]);
        return json({ ok: true });
      }

      if (url.pathname === '/sync') {
        const em = await auth(env, req);
        if (!em) return json({ ok: false, error: 'Sesión caducada: vuelve a entrar' }, 401);
        if (req.method === 'GET') {
          const blob = JSON.parse((await env.SYNC.get('sync:' + em)) || 'null');
          return json({ ok: true, data: blob ? blob.data : null, updatedAt: blob ? blob.updatedAt : 0 });
        }
        if (req.method === 'PUT') {
          const body = await req.text();
          if (body.length > MAX_BLOB) return json({ ok: false, error: 'Datos demasiado grandes' }, 413);
          const { data } = JSON.parse(body);
          const updatedAt = Date.now();
          await env.SYNC.put('sync:' + em, JSON.stringify({ data, updatedAt }));
          return json({ ok: true, updatedAt });
        }
      }

      return json({ ok: false, error: 'Ruta desconocida' }, 404);
    } catch (e) {
      return json({ ok: false, error: 'Petición no válida' }, 400);
    }
  }
};
