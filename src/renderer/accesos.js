/* Accesos del hub: lista, biblioteca de sitios y dock. */

/* ============ Accesos del hub (dials) ============ */
const DEFAULT_DIALS = [
  { name: 'YouTube', url: 'https://www.youtube.com' }, { name: 'Twitch', url: 'https://www.twitch.tv' },
  { name: 'Discord', url: 'https://discord.com/app' }, { name: 'WhatsApp', url: 'https://web.whatsapp.com' },
  { name: 'Crunchyroll', url: 'https://www.crunchyroll.com' }, { name: 'GitHub', url: 'https://github.com' },
  { name: 'Gmail', url: 'https://mail.google.com' },
  { name: 'Pinterest', url: 'https://www.pinterest.com' }, { name: 'IRIS', url: 'https://iris.it.com' }
];
let dials = store.get('naviris.dials', DEFAULT_DIALS);
/* ===== BIBLIOTECA DE SITIOS (2026-09-09) =====
   Los habituales a un clic, con el logo ya en el tono del tema: si tenemos la
   marca en brands.js se usa esa, y si no el favicon del sitio con el mismo
   filtro monocromo que los accesos (getTile ya lo cachea). */
const LIBRERIA = [
  { name: 'Google', url: 'https://www.google.com' }, { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'Gmail', url: 'https://mail.google.com' }, { name: 'Drive', url: 'https://drive.google.com' },
  { name: 'WhatsApp', url: 'https://web.whatsapp.com' }, { name: 'Instagram', url: 'https://www.instagram.com' },
  { name: 'Facebook', url: 'https://www.facebook.com' }, { name: 'X', url: 'https://x.com' },
  { name: 'Pinterest', url: 'https://www.pinterest.com' }, { name: 'TikTok', url: 'https://www.tiktok.com' },
  { name: 'Reddit', url: 'https://www.reddit.com' }, { name: 'Discord', url: 'https://discord.com/app' },
  { name: 'Twitch', url: 'https://www.twitch.tv' }, { name: 'Spotify', url: 'https://open.spotify.com' },
  { name: 'Netflix', url: 'https://www.netflix.com' }, { name: 'Crunchyroll', url: 'https://www.crunchyroll.com' },
  { name: 'Prime Video', url: 'https://www.primevideo.com' }, { name: 'Disney+', url: 'https://www.disneyplus.com' },
  { name: 'GitHub', url: 'https://github.com' }, { name: 'ChatGPT', url: 'https://chatgpt.com' },
  { name: 'Claude', url: 'https://claude.ai' }, { name: 'Wikipedia', url: 'https://es.wikipedia.org' },
  { name: 'Amazon', url: 'https://www.amazon.com' }, { name: 'LinkedIn', url: 'https://www.linkedin.com' },
  { name: 'Steam', url: 'https://store.steampowered.com' }, { name: 'Telegram', url: 'https://web.telegram.org' },
  { name: 'Notion', url: 'https://www.notion.so' }, { name: 'Figma', url: 'https://www.figma.com' },
  { name: 'MOOVIN', url: 'https://moovin.live' }, { name: 'IRIS', url: 'https://iris.it.com' }
];
function renderLibreria() {
  const g = els.libGrid; if (!g) return;
  g.innerHTML = '';
  const puestos = new Set(dials.map((d) => hostOf(d.url)));
  for (const sitio of LIBRERIA) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lib-item';
    if (puestos.has(hostOf(sitio.url))) { b.classList.add('puesto'); b.title = 'Ya lo tienes en el hub'; }
    const ic = document.createElement('span'); ic.className = 'lib-ic';
    const marca = brandOf(sitio.url);
    if (/(^|\.)iris\.it\.com$/.test(hostOf(sitio.url))) ic.innerHTML = window.irisFlat(24);
    else if (marca && window.brandIcon(marca)) ic.innerHTML = window.brandIcon(marca);
    else { ic.innerHTML = window.icon('star'); ponFavicon(ic, sitio.url); }
    const n = document.createElement('span'); n.className = 'lib-nom'; n.textContent = sitio.name;
    b.append(ic, n);
    b.addEventListener('click', () => {
      dials.push({ name: sitio.name, url: sitio.url });
      store.set('naviris.dials', dials);
      els.dialModal.classList.add('hidden');
      renderHub(); toast(sitio.name + ' añadido al hub');
    });
    g.appendChild(b);
  }
}
function removeDial(d) { dials = dials.filter((x) => x !== d); store.set('naviris.dials', dials); renderHub(); }

// Logos de los dials: SIEMPRE monocromos. La opción "Logos a color" se
// eliminó del producto (decisión del usuario 2026-08-11: rompía la estética
// de vidrio y paleta única del hub).
function styleDial(tile, letter, d) {
  const brand = brandOf(d.url);
  // iris.it.com lleva SU logo oficial (nunca una inicial ni el favicon)
  try {
    if (/(^|\.)iris\.it\.com$/.test(new URL(d.url).hostname)) {
      const m = document.createElement('span'); m.className = 'd-mono d-iris';
      m.innerHTML = window.irisFlat(40); // monocromo, como el resto de marcas
      tile.appendChild(m); letter.remove(); return;
    }
  } catch { /* url rara: sigue el camino normal */ }
  // El fondo y el filtro del favicon los pone el CSS (tokens --tile-default y
  // --fav-filter): antes se fijaban aquí en línea y en modo claro quedaban
  // tiles negros con iconos aclarados sobre un hub blanco.
  if (brand && window.brandIcon(brand)) {
    const m = document.createElement('span'); m.className = 'd-mono'; m.innerHTML = window.brandIcon(brand);
    tile.appendChild(m); letter.remove(); return;
  }
  getTile(d.url).then((t) => { if (t?.icon) { const im = document.createElement('img'); im.className = 'd-fav'; im.src = t.icon; tile.style.setProperty('--icon-sz', '34px'); im.onload = () => letter.remove(); im.onerror = () => im.remove(); tile.appendChild(im); } });
}
let dialDrag = null;
/* ===== DOCK de los accesos (2026-08-21) =====
   Al entrar en un acceso, el crece y sus VECINOS se apartan y crecen menos,
   como el dock de macOS. Dos decisiones que importan:

   · Los vecinos se calculan por la FILA PINTADA (offsetTop), no por el orden
     del DOM. La rejilla es auto-fit y envuelve, asi que el siguiente del DOM
     puede ser el primero de la fila de abajo: con selectores de hermanos
     (+ / :has) se empujaba un tile que no esta al lado.
   · Solo escucha ENTRAR y SALIR, nunca mousemove. El dock de verdad magnifica
     segun la distancia al cursor y eso obliga a trabajar en cada fotograma;
     aqui son tres escalones fijos y cero coste mientras no te muevas de tile.

   Solo toca transform (por variables CSS), como manda la regla del proyecto. */
const DOCK = [[1.18, 0], [1.07, 6], [1.03, 3]];   // [escala, apartado px] por distancia
function armaDock(grid) {
  const limpia = () => grid.querySelectorAll('.dial').forEach((x) => { x.style.removeProperty('--dk-e'); x.style.removeProperty('--dk-x'); });
  grid.addEventListener('mouseleave', limpia);
  grid.addEventListener('mouseover', (e) => {
    const d = e.target.closest('.dial');
    // En modo edicion mandan el meneo y el arrastre: el dock se aparta. La
    // repisa de vidrio no magnifica: cada icono sube solo (CSS).
    if (!d || !grid.contains(d) || els.hub.classList.contains('editing') || grid.classList.contains('repisa')) { limpia(); return; }
    const fila = [...grid.querySelectorAll('.dial')].filter((x) => x.offsetTop === d.offsetTop)
      .sort((a, b) => a.offsetLeft - b.offsetLeft);
    limpia();
    const i = fila.indexOf(d);
    fila.forEach((x, j) => {
      const k = j - i, paso = DOCK[Math.abs(k)];
      if (!paso) return;
      x.style.setProperty('--dk-e', paso[0]);
      x.style.setProperty('--dk-x', (k > 0 ? paso[1] : -paso[1]) + 'px');
    });
  });
}
function makeDialEl(d) {
  const el = document.createElement('div'); el.className = 'dial'; el.title = d.url;
  // Alcanzable con Tab y abrible con Enter, como un enlace (auditoría 2026-10)
  el.tabIndex = 0; el.setAttribute('role', 'link'); el.setAttribute('aria-label', d.name);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el && !els.hub.classList.contains('editing')) navigateActive(d.url); });
  // En modo Editar, los tiles se reordenan arrastrando DENTRO del contenedor
  el.addEventListener('mousedown', () => { if (els.hub.classList.contains('editing')) el.draggable = true; });
  el.addEventListener('dragstart', (e) => {
    if (!els.hub.classList.contains('editing')) { e.preventDefault(); return; }
    e.stopPropagation(); dialDrag = d; els.hub.classList.add('arrastrando'); e.dataTransfer.setData('text/dial', d.url);
  });
  el.addEventListener('dragover', (e) => { if (dialDrag && dialDrag !== d) { e.preventDefault(); e.stopPropagation(); el.classList.add('dial-dest'); } });
  el.addEventListener('dragleave', () => el.classList.remove('dial-dest'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('dial-dest');
    if (!dialDrag || dialDrag === d) return;
    e.preventDefault(); e.stopPropagation();
    const desde = dials.indexOf(dialDrag), hasta = dials.indexOf(d);
    if (desde < 0 || hasta < 0) return;
    dials.splice(desde, 1); dials.splice(hasta, 0, dialDrag);
    dialDrag = null; store.set('naviris.dials', dials); renderHub();
  });
  el.addEventListener('dragend', () => { el.draggable = false; dialDrag = null; els.hub.classList.remove('arrastrando'); document.querySelectorAll('.dial-dest').forEach((x) => x.classList.remove('dial-dest')); });
  const tile = document.createElement('div'); tile.className = 'd-tile';
  const letter = document.createElement('span'); letter.className = 'd-letter'; letter.textContent = (d.name[0] || '·').toUpperCase(); tile.appendChild(letter);
  styleDial(tile, letter, d);
  const name = document.createElement('div'); name.className = 'd-name'; name.textContent = d.name;
  const x = document.createElement('button'); x.className = 'd-x'; x.title = 'Eliminar'; x.innerHTML = window.icon('x-mark'); x.addEventListener('click', (e) => { e.stopPropagation(); removeDial(d); });
  el.append(tile, name, x);
  el.addEventListener('click', () => { if (!els.hub.classList.contains('editing')) navigateActive(d.url); });
  el.addEventListener('auxclick', (e) => { if (e.button === 1 && !els.hub.classList.contains('editing')) { e.preventDefault(); openBackground(d.url); } });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (els.hub.classList.contains('editing')) return; showCtxMenu(e.clientX, e.clientY, linkMenu(d.url, () => removeDial(d))); });
  return el;
}

$('#dial-cancel').addEventListener('click', () => els.dialModal.classList.add('hidden'));
$('#dial-save').addEventListener('click', () => { const name = els.dialName.value.trim(); const url = toUrl(els.dialUrl.value); if (!name || !url) return; dials.push({ name, url }); store.set('naviris.dials', dials); renderHub(); els.dialModal.classList.add('hidden'); });
