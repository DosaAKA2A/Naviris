/* ===== A QUÉ PÁGINAS SE OFRECE UNA CONTRASEÑA GUARDADA =====
   El sitio: el host exacto o uno de sus subdominios (sameSite). El esquema
   (auditoría #9, 2026-11-11): la contraseña se guarda con el esquema de la
   página donde se escribió. Una capturada en https solo se ofrece y se rellena
   en https: una página http del mismo host la puede servir cualquiera de la
   misma red. Una capturada en http vale en los dos (la web pasó a https), como
   en Chrome.
   Las guardadas antes no llevan esquema. Si el sitio guardado es una dirección
   entera (las del CSV de otro navegador) manda la suya; si es solo el host, se
   toma https, salvo en los del equipo o la red de casa (el router en
   192.168.1.1, un NAS, localhost…), que casi siempre van por http y donde ya se
   usaban así. La migración solo añade el esquema: no quita ni cambia nada más.
   Va aparte de main.js para poder probarlo sin Electron (test/credenciales.test.js). */
'use strict';

function normHost(s) {
  let h = String(s || '');
  try { h = new URL(/^https?:\/\//.test(h) ? h : 'https://' + h).hostname; } catch { /* nada */ }
  return h.toLowerCase().replace(/^www\./, '');
}
// Sufijos públicos de dos etiquetas más comunes: nadie "posee" bbc.co.uk como
// co.uk, así que jamás pueden actuar de dominio padre para emparejar.
const SUFIJOS_PUBLICOS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'gov.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in',
  'co.za', 'co.nz', 'co.il', 'co.th', 'com.br', 'com.ar', 'com.mx', 'com.au', 'com.tr', 'com.cn',
  'com.es', 'com.co', 'com.pe', 'com.ve', 'com.uy', 'com.py', 'com.ec', 'com.bo', 'com.do',
  'com.gt', 'com.pa', 'com.sv', 'com.hn', 'com.ni', 'com.pr', 'com.tw', 'com.hk', 'com.sg',
  'com.my', 'com.ph', 'com.vn', 'com.pk', 'com.sa', 'com.eg', 'com.ng', 'com.pl', 'com.ua',
  'com.ru', 'org.br', 'net.br', 'gov.br', 'edu.br', 'org.au', 'net.au', 'gov.au', 'edu.au'
]);
const esSufijoPublico = (h) => SUFIJOS_PUBLICOS.has(h) || h.split('.').length < 2;
// ¿La credencial guardada para `saved` vale en la página `current`?
// Coincidencia EXACTA de host, o que uno sea subdominio del otro (bbc.co.uk
// vale en login.bbc.co.uk). ANTES esto reducía el host a sus dos últimas
// etiquetas: bbc.co.uk y evil.co.uk quedaban ambos en "co.uk", así que un
// dominio recién registrado bajo un sufijo de dos partes recibía la oferta de
// autorrellenar credenciales de OTRO sitio. Sin la lista de sufijos públicos
// entera, exigir el host completo como sufijo es la regla segura.
function sameSite(saved, current) {
  const a = normHost(saved), b = normHost(current);
  if (!a || !b) return false;
  if (a === b) return true;
  if (esSufijoPublico(a) || esSufijoPublico(b)) return false;
  return b.endsWith('.' + a) || a.endsWith('.' + b);
}

// Equipos de la red de casa o del propio equipo: nombres sin punto (router,
// nas), .local/.lan/.home/.internal, localhost e IP privadas, de enlace local o
// de bucle (IPv4 e IPv6).
function esHostLocal(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || /\.(localhost|local|lan|home|internal|home\.arpa)$/.test(h)) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  return !h.includes('.');
}

const ESQUEMAS = new Set(['http', 'https']);
// El esquema de una credencial: el suyo, el de la dirección guardada o el que se le supone.
function esquemaDe(entrada) {
  if (entrada && ESQUEMAS.has(entrada.esquema)) return entrada.esquema;
  const site = String((entrada && entrada.site) || '');
  if (/^http:\/\//i.test(site)) return 'http';
  if (/^https:\/\//i.test(site)) return 'https';
  return esHostLocal(normHost(site)) ? 'http' : 'https';
}

// ¿Se ofrece la credencial en una página de ese host y ese esquema?
function valeEn(entrada, host, esquema) {
  if (!sameSite(entrada && entrada.site, host)) return false;
  return esquemaDe(entrada) === 'http' || esquema === 'https';
}

// Las credenciales que valen en esa página, primero las de su mismo esquema.
function paraLaPagina(lista, host, esquema) {
  const valen = lista.filter((e) => valeEn(e, host, esquema));
  return [...valen.filter((e) => esquemaDe(e) === esquema), ...valen.filter((e) => esquemaDe(e) !== esquema)];
}

// La credencial que se actualiza al guardar (mismo host y usuario): la del
// mismo esquema o, si se guarda en https, la que había de http (la web pasó a
// https). Una de https nunca la pisa una contraseña escrita en http.
function existente(lista, site, usuario, esquema) {
  const mismas = lista.filter((e) => e.username === usuario && normHost(e.site) === normHost(site));
  return mismas.find((e) => esquemaDe(e) === esquema) || (esquema === 'https' && mismas.find((e) => esquemaDe(e) === 'http')) || null;
}

// Pone el esquema a las que no lo llevan. Devuelve cuántas cambió.
function migra(lista) {
  let cambiadas = 0;
  for (const e of lista) {
    if (e && typeof e === 'object' && !ESQUEMAS.has(e.esquema)) { e.esquema = esquemaDe(e); cambiadas++; }
  }
  return cambiadas;
}

module.exports = { normHost, sameSite, esHostLocal, esquemaDe, valeEn, paraLaPagina, existente, migra };
