/* Iconos de sitios: marca monocroma, favicon en caché y su color dominante. */

/* ============ Marcas → icono monocromo ============ */
const BRAND_BY_HOST = { 'youtube.com': 'youtube', 'youtu.be': 'youtube', 'twitch.tv': 'twitch', 'discord.com': 'discord', 'whatsapp.com': 'whatsapp', 'github.com': 'github', 'x.com': 'x', 'twitter.com': 'x', 'crunchyroll.com': 'crunchyroll', 'spotify.com': 'spotify', 'reddit.com': 'reddit', 'claude.ai': 'claude', 'mail.google.com': 'gmail', 'instagram.com': 'instagram', 'pinterest.com': 'pinterest', 'pinterest.es': 'pinterest' };
function brandOf(url) { const h = hostOf(url); for (const dom in BRAND_BY_HOST) if (h === dom || h.endsWith('.' + dom)) return BRAND_BY_HOST[dom]; return null; }

/* ============ Favicons + color ============ */
const tileCache = store.get('naviris.tiles4', {});
/* TOPE DE LA CACHÉ (auditoría 2026-10). Los iconos van en base64 dentro de
   localStorage, que comparte cuota con marcadores, hub y notas, y la caché
   crecía sin límite: cada sitio nuevo reescribía la clave entera en el hilo de
   la interfaz. Ahora el icono se guarda reducido a 64 px, se conservan los
   ICONOS_TOPE sitios más recientes (los del dock nunca se tiran), lo que aun
   así pesa demasiado vive solo en memoria y la escritura espera a que acabe la
   ráfaga. Lo podado es caché: se vuelve a pedir cuando haga falta. */
const ICONOS_TOPE = 150, ICONO_LADO = 64, ICONO_BYTES = 24 * 1024;
function escribeTiles() {
  const fijos = new Set(dials.map((d) => hostOf(d.url)));
  const sobran = Object.keys(tileCache).length - ICONOS_TOPE;
  if (sobran > 0) Object.keys(tileCache).filter((h) => !fijos.has(h))
    .sort((a, b) => tileCache[a].ts - tileCache[b].ts).slice(0, sobran).forEach((h) => delete tileCache[h]);
  const guardar = {};
  for (const [h, e] of Object.entries(tileCache)) if (!e.icon || e.icon.length <= ICONO_BYTES) guardar[h] = e;
  store.set('naviris.tiles4', guardar);
}
let tilesPend = null;
const saveTiles = () => { clearTimeout(tilesPend); tilesPend = setTimeout(escribeTiles, 1000); };
// Limpieza de lo que ya estaba guardado: los iconos enormes se tiran (se piden
// de nuevo, ya reducidos, al usarlos) y la caché se poda al tope.
{
  let tocada = Object.keys(tileCache).length > ICONOS_TOPE;
  for (const h in tileCache) if ((tileCache[h]?.icon || '').length > ICONO_BYTES) { delete tileCache[h]; tocada = true; }
  if (tocada) saveTiles();
}
// Raster de más de 64 px -> PNG de 64 px (dock y accesos lo pintan a 30-34 px).
// Los SVG se quedan como vienen: son vectores y no se pixelan.
function reduceIcono(dataUrl) {
  if (!dataUrl || /^data:image\/svg/i.test(dataUrl)) return Promise.resolve(dataUrl);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const lado = Math.max(img.naturalWidth, img.naturalHeight);
      if (lado <= ICONO_LADO) return resolve(dataUrl);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * ICONO_LADO / lado));
      c.height = Math.max(1, Math.round(img.naturalHeight * ICONO_LADO / lado));
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      let r = dataUrl; try { r = c.toDataURL('image/png'); } catch { /* se queda el original */ }
      resolve(r.length < dataUrl.length ? r : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function dominantColor(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 32, 32);
      let d; try { d = ctx.getImageData(0, 0, 32, 32).data; } catch { return resolve(null); }
      const bk = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]; if (a < 200) continue;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 242 && mn > 230) continue; if (mx < 20) continue;
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
        const e = bk.get(key) || { n: 0, r: 0, g: 0, b: 0, s: 0 }; e.n++; e.r += r; e.g += g; e.b += b; e.s += sat; bk.set(key, e);
      }
      let best = null, bs = 0;
      for (const e of bk.values()) { const sc = e.n * (0.45 + (e.s / e.n) * 1.8); if (sc > bs) { bs = sc; best = e; } }
      resolve(best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
/* De la lista que da `page-favicon-updated`, la mejor. SVG primero (no se
   pixela nunca), luego el de Apple (suele ser de 180 px), luego PNG, y el
   .ico el ultimo: casi siempre son 16 px y es lo que se veia borroso. */
function mejorIcono(lista) {
  const nota = (u) => (/\.svg(\?|$)/i.test(u) ? 4 : /apple-touch/i.test(u) ? 3
    : /\.png(\?|$)/i.test(u) ? 2 : /\.ico(\?|$)/i.test(u) ? 1 : 2);
  return (lista || []).filter((u) => /^https?:/i.test(u))
    .sort((a, b) => nota(b) - nota(a))[0] || null;
}
async function getTile(url, iconUrl) {
  const host = hostOf(url); if (!host) return null;
  const c = tileCache[host];
  /* Con un icono declarado por la pagina se rehace la ficha aunque haya una
     cacheada: la de antes salio del servicio de Google y esta es la de casa. */
  if (c && !iconUrl && Date.now() - c.ts < 14 * 864e5) return c;
  if (c && iconUrl && c.propio && Date.now() - c.ts < 14 * 864e5) return c;
  const icon = await reduceIcono(await window.navirisApp.fetchFavicon(url, iconUrl));
  const color = icon ? await dominantColor(icon) : null;
  const entry = { icon, color, ts: Date.now(), propio: !!iconUrl };
  if (!icon && c) return c;   // si el de la pagina falla, se deja el que habia
  tileCache[host] = entry; saveTiles(); return entry;
}
// Cambia el icono provisional de `ic` por el favicon del sitio, si lo hay.
function ponFavicon(ic, url) {
  getTile(url).then((t) => { if (t?.icon) { const im = document.createElement('img'); im.src = t.icon; ic.innerHTML = ''; ic.appendChild(im); } });
}
