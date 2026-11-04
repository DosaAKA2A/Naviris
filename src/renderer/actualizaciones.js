/* Actualizaciones (líneas estable y dev) y novedades tras actualizar. */

/* Actualización: dos líneas oficiales (Naviris estable y NavirisDev), ambas
   visibles al buscar; el usuario instala la que quiera desde cualquier versión */
const updStatus = $('#upd-status'), updBtn = $('#upd-btn'), updBar = $('#upd-bar'), updLines = $('#upd-lines');
let updChosen = null;     // línea elegida ('stable'|'dev') mientras descarga
let updReadyLine = null;  // línea ya descargada, lista para instalar
let updAutoLista = null;  // versión estable bajada sola, esperando al cierre
let updBusy = false;
const UPD_LABEL = { stable: 'Naviris', dev: 'NavirisDev' };
function setUpd(text, cls) { updStatus.textContent = text; updStatus.className = cls || ''; }
function updLineEls(line) { return { ver: $('#upd-' + line + '-ver'), btn: $('#upd-' + line + '-btn') }; }
async function showChannels() {
  setUpd('Consultando versiones…'); updBtn.disabled = true;
  const r = await window.navirisApp.updateChannels();
  updBtn.disabled = false;
  if (!r.ok) { setUpd('Error: ' + r.message, 'err'); return; }
  for (const line of ['stable', 'dev']) {
    const info = r[line], { ver, btn } = updLineEls(line);
    if (!info) { ver.textContent = 'no publicada'; btn.classList.add('hidden'); continue; }
    ver.textContent = 'v' + info.version; btn.classList.remove('hidden');
    if (updReadyLine === line) { btn.textContent = 'Reiniciar e instalar'; btn.disabled = false; }
    else if (info.version === r.current) { btn.textContent = 'Instalada'; btn.disabled = true; }
    else { btn.textContent = 'Instalar'; btn.disabled = updBusy; }
  }
  updLines.classList.remove('hidden');
  if (!updBusy && !updReadyLine) setUpd('Estás en la v' + r.current + '. Elige la versión que quieras usar.');
  else if (updAutoLista) setUpd('Naviris v' + updAutoLista + ' lista: se instala sola al cerrar el navegador.', 'hot');
}
async function chooseLine(line) {
  if (updReadyLine === line) { window.navirisApp.updateInstall(); return; }
  if (updBusy || updReadyLine) return;
  updBusy = true; updChosen = line;
  updLineEls('stable').btn.disabled = true; updLineEls('dev').btn.disabled = true;
  const r = await window.navirisApp.updateChoose(line);
  if (r.state === 'dev') { setUpd('Las actualizaciones solo funcionan en la versión instalada.'); updBusy = false; updChosen = null; showChannels(); }
  else if (r.state === 'error') { setUpd('Error: ' + r.message, 'err'); updBusy = false; updChosen = null; showChannels(); }
}
updBtn.addEventListener('click', showChannels);
$('#upd-stable-btn').addEventListener('click', () => chooseLine('stable'));
$('#upd-dev-btn').addEventListener('click', () => chooseLine('dev'));
/* Aviso persistente de version nueva (2026-08-13). En una ventana baja el menu
   se salia de la pantalla y "Buscar actualizaciones" quedaba fuera de alcance:
   ademas de arreglar el menu, conviene que la actualizacion se VEA sin tener
   que ir a buscarla. */
function marcaActualizacion(version) {
  const boton = $('#nav-menu');
  if (boton) { boton.classList.add('hay-update'); boton.title = 'Menú — hay una versión nueva (' + version + ')'; }
  const pop = $('#menu-pop'), entrada = $('#menu-update');
  if (pop && entrada) {
    entrada.classList.remove('hidden'); // nace oculta: sin esto el aviso manual no se veía
    entrada.classList.add('destacado');
    entrada.textContent = 'Actualizar a la ' + version;
    if (pop.firstElementChild !== entrada) pop.insertBefore(entrada, pop.firstElementChild);
  }
}
/* La versión nueva ya se ha descargado sola y se instalará al cerrar. Se avisa
   por dos motivos: para que no sorprenda que al abrir mañana cambie la versión,
   y para poder instalarla YA sin esperar. La entrada del menú vive oculta y
   SOLO existe en este estado (Dosa, 2026-08-18: nada de "buscar
   actualizaciones" a mano; la actualización se anuncia sola). */
function marcaListaParaInstalar(version) {
  const boton = $('#nav-menu');
  if (boton) { boton.classList.add('hay-update'); boton.title = 'Menú — Naviris ' + version + ' lista para instalar'; }
  const pop = $('#menu-pop'), entrada = $('#menu-update');
  if (pop && entrada) {
    entrada.classList.remove('hidden');
    entrada.classList.add('destacado');
    entrada.textContent = 'Reiniciar e instalar la ' + version;
    if (pop.firstElementChild !== entrada) pop.insertBefore(entrada, pop.firstElementChild);
  }
}
window.navirisApp.onUpdateStatus((s) => {
  if (s.state === 'available') {
    // Solo se descarga si el usuario eligió línea; el aviso silencioso de arranque solo notifica
    if (!updChosen) {
      // …salvo en la estable, que se baja sola en segundo plano: ahí no hay
      // nada que pedirle al usuario, se le avisa cuando ya está lista.
      if (s.auto) return;
      // Un toast se va solo y el usuario se queda sin enterarse. Ademas se
      // marca el boton del menu con un punto, que no caduca, y la entrada de
      // actualizar sube ARRIBA del todo mientras haya version nueva.
      marcaActualizacion(s.version);
      if ($('#about-modal').classList.contains('hidden')) toast('Nueva versión de Naviris disponible: menú → Actualizar');
      return;
    }
    setUpd('Descargando ' + UPD_LABEL[updChosen] + ' v' + s.version + '…'); updBar.classList.remove('hidden');
    window.navirisApp.updateDownload();
  } else if (s.state === 'latest') {
    if (updChosen) { setUpd('Ya estás en la última versión de ' + UPD_LABEL[updChosen] + '.'); updBusy = false; updChosen = null; showChannels(); }
  } else if (s.state === 'downloading') {
    if (updChosen) { setUpd('Descargando ' + UPD_LABEL[updChosen] + '… ' + s.percent + '%'); updBar.classList.remove('hidden'); updBar.querySelector('i').style.width = s.percent + '%'; }
  } else if (s.state === 'downloaded') {
    if (!updChosen) {
      if (!s.auto) return;
      if (updAutoLista === s.version) return; // el reloj vuelve a mirar cada 2 h: avisar UNA vez
      updAutoLista = s.version; updReadyLine = /-dev/i.test(s.version) ? 'dev' : 'stable';
      marcaListaParaInstalar(s.version);
      toast('Naviris v' + s.version + ' lista: se instala sola al cerrar el navegador');
      return;
    }
    updReadyLine = updChosen; updChosen = null; updBusy = false;
    updBar.classList.add('hidden');
    setUpd(UPD_LABEL[updReadyLine] + ' v' + s.version + ' lista para instalar.', 'hot');
    const { btn } = updLineEls(updReadyLine); btn.textContent = 'Reiniciar e instalar'; btn.disabled = false;
  } else if (s.state === 'error') {
    if (updChosen || updBusy) { setUpd('Error al actualizar: ' + s.message, 'err'); updBusy = false; updChosen = null; }
  }
});

/* ===== Novedades tras actualizar (2026-08-17) =====
   Naviris se instala solo y en silencio, así que sin esto la actualización sería
   invisible: te cambia el navegador debajo y nadie te cuenta qué. El panel sale
   UNA vez, al primer arranque de la versión nueva (quién decide eso es el main:
   compara la versión guardada con la que corre). */

/* Las notas de una release de Naviris vienen en DOS formatos, y los dos tienen
   que entrar aquí:
   - PROSA, que es el formato real de este proyecto: párrafos separados por una
     línea en blanco, escritos para que los lea gente (mirar v2.7.5 o v2.7.6-dev.2).
   - VIÑETAS del changelog que GitHub genera solo cuando la release se crea sin
     notas ("* mensaje del commit by @usuario in <enlace>").
   Cazado a tiempo: una primera versión solo aceptaba viñetas y con las notas de
   verdad devolvía la lista VACÍA, así que el panel siempre habría caído al texto
   de respaldo sin contar ni un cambio. */
function limpiaNotas(md) {
  const fuera = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu; // sin emojis (regla del proyecto)
  const pule = (t) => t
    .replace(/\s+by\s+@[\w-]+(\s+in\s+\S+)?$/i, '')  // autoría y enlace del commit
    .replace(/\bhttps?:\/\/\S+/g, '')                 // enlaces sueltos
    .replace(/[*_`#]+/g, '')                          // negritas, cursivas, código, encabezados
    .replace(fuera, '')
    .replace(/\s+/g, ' ')
    .trim();
  const items = [];
  // Los párrafos se separan por líneas en blanco; dentro de uno, cada viñeta
  // es un cambio y la prosa suelta cuenta como uno solo.
  for (const bloque of String(md || '').split(/\n\s*\n/)) {
    const lineas = bloque.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lineas.length) continue;
    if (lineas.some((l) => /^[*-]\s+/.test(l))) {
      for (const l of lineas) {
        if (!/^[*-]\s+/.test(l) || /full changelog/i.test(l)) continue;
        const t = pule(l.replace(/^[*-]\s+/, ''));
        if (t) items.push(t);
      }
    } else {
      const crudo = lineas.join(' ').trim();
      // Un encabezado ("## Novedades", "**Novedades**", "What's Changed") titula
      // la lista, no es un cambio; y el Full Changelog es ruido de plataforma.
      if (/^#{1,6}\s/.test(crudo) || /^\*\*[^*]+\*\*$/.test(crudo)) continue;
      const t = pule(crudo);
      if (t && !/^what'?s changed$/i.test(t) && !/^full changelog/i.test(t)) items.push(t);
    }
  }
  return items.slice(0, 8).map((t) => t.charAt(0).toUpperCase() + t.slice(1));
}

/* ===== PÁGINA de novedades (2026-08-17) =====
   El panel pequeño no da para contar una versión entera. Cuando la versión trae
   una página escrita, se abre ESA; el panel queda de respaldo para las versiones
   que no la tengan.
   El contenido no viaja en el build: se lee de naviris.site, igual que el
   catálogo de addons, así que se escribe y se corrige sin publicar nada. */
const NOV_BASE = 'https://naviris.site/novedades/';
async function paginaNovedades(version) {
  try {
    const r = await fetch(NOV_BASE + encodeURIComponent(version) + '.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && Array.isArray(d.bloques) && d.bloques.length) ? d : null;
  } catch { return null; }
}
function abreNovedadesPagina(d) {
  const pg = $('#nov-page');
  $('#novp-linea').textContent = d.linea === 'dev' ? 'NavirisDev' : 'Naviris';
  $('#novp-tit').textContent = d.titulo || ('Naviris ' + d.version);
  $('#novp-sub').textContent = d.entradilla || '';
  const cont = $('#novp-bloques');
  cont.textContent = '';
  for (const b of d.bloques) {
    const sec = document.createElement('section');
    sec.className = 'novp-bloque';
    if (b.titulo) {
      const h = document.createElement('h2');
      h.className = 'novp-b-tit'; h.textContent = b.titulo;
      sec.appendChild(h);
    }
    if (b.texto) {
      const p = document.createElement('p');
      p.className = 'novp-b-txt'; p.textContent = b.texto; // textContent: el contenido viene de la red
      sec.appendChild(p);
    }
    if (b.imagen) {
      const caja = document.createElement('div');
      caja.className = 'novp-img';
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.alt = b.titulo || '';
      im.src = String(b.imagen);
      // Una imagen que no carga (sin red, ruta mal escrita) no puede dejar un
      // hueco roto en medio del texto: se retira y el bloque sigue leyéndose.
      im.addEventListener('error', () => caja.remove());
      caja.appendChild(im);
      sec.appendChild(caja);
    }
    cont.appendChild(sec);
  }
  tabs.forEach((t) => t.webview?.classList.remove('active'));
  els.hub.classList.remove('active');
  pg.classList.remove('hidden'); pg.classList.add('active');
  pg.scrollTop = 0;
}
/* La capa TAPA el contenido entero (inset:0, z-index 6), así que mientras esté
   abierta el usuario no ve ni sus pestañas ni el hub. Por eso tiene que poder
   salirse SIEMPRE y por donde le dé la gana, no solo por el botón del final:
   se abre sola, la lee quien quiere, y quien no, la cierra (2026-08-18).
   `soloOculta` es para cuando quien llama ya va a activar lo que toca (cambiar
   de pestaña, abrir Marcadores…): ahí no hay que reactivar nada por detrás. */
function cierraNovedadesPagina(soloOculta) {
  const pg = $('#nov-page');
  if (!pg.classList.contains('active')) return false;
  pg.classList.remove('active'); pg.classList.add('hidden');
  if (soloOculta === true) return true;
  const t = activeTab();
  if (t && t.kind === 'web' && t.webview) t.webview.classList.add('active');
  else els.hub.classList.add('active');
  return true;
}
$('#novp-cerrar').addEventListener('click', () => cierraNovedadesPagina());
$('#novp-x').addEventListener('click', () => cierraNovedadesPagina());

async function muestraNovedades() {
  let nov = null;
  try { nov = await window.navirisApp.updateNovedades(); } catch { return; }
  if (!nov) return;
  // Con página escrita para esta versión, se abre la página entera
  const pag = await paginaNovedades(nov.version);
  if (pag) { abreNovedadesPagina(pag); return; }
  $('#nov-ver').textContent = 'Versión ' + nov.version + (nov.anterior ? ' · antes ' + nov.anterior : '');
  const lista = $('#nov-lista');
  lista.textContent = '';
  const items = limpiaNotas(nov.notas);
  if (items.length) {
    for (const t of items) {
      const d = document.createElement('div');
      d.className = 'nov-it';
      d.textContent = t; // textContent, nunca innerHTML: el texto viene de fuera
      lista.appendChild(d);
    }
  } else {
    // Sin notas (sin red, o release recién publicada): enterarte de que cambió
    // sigue siendo lo importante.
    const d = document.createElement('div');
    d.className = 'nov-vacio';
    d.textContent = 'Se instaló sola, sin instalador ni reinicios.';
    lista.appendChild(d);
  }
  $('#nov-modal').classList.remove('hidden');
}
$('#nov-ok').addEventListener('click', () => $('#nov-modal').classList.add('hidden'));
