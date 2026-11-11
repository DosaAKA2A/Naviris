/* Aspecto del hub: edición, paleta de widgets, temas, fondos, transparencia y estilo del dock. */

/* Edición / personalización del hub */
/* Los menús de la barra del hub son EXCLUYENTES (2026-08-12, Dosa): abrir uno
   cierra los demás, para saltar de Temas a Aspecto con un solo clic en vez de
   cerrar a mano. Devuelve si habia algo abierto (lo usa Escape). */
function cierraMenusHub(excepto) {
  let habia = false;
  const pop = document.getElementById('temas-pop'), bt = document.getElementById('hub-temas');
  if (excepto !== 'temas' && pop && !pop.classList.contains('hidden')) {
    pop.classList.add('hidden'); if (bt) bt.classList.remove('on'); habia = true;
  }
  if (excepto !== 'aspecto' && els.customizePanel && !els.customizePanel.classList.contains('hidden')) {
    els.customizePanel.classList.add('hidden'); habia = true;
  }
  return habia;
}
/* Selector de tema del hub, al lado de Editar */
(() => {
  const boton = document.getElementById('hub-temas');
  const pop = document.getElementById('temas-pop');
  if (!boton || !pop) return;
  const pinta = () => {
    const t = temaActual();
    pop.querySelectorAll('.tema-op').forEach((b) => b.classList.toggle('on', b.dataset.tema === t));
  };
  boton.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrir = pop.classList.contains('hidden');
    cierraMenusHub('temas');
    pop.classList.toggle('hidden', !abrir);
    boton.classList.toggle('on', abrir);
    if (abrir) pinta();
  });
  pop.querySelectorAll('.tema-op').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    aplicaTema(b.dataset.tema);
    pinta();
    pop.classList.add('hidden'); boton.classList.remove('on');
    // lightMode sigue viviendo en los ajustes: lo leen el interruptor de la
    // sidebar, el tema del sistema y la sincronización de la cuenta. Lo
    // encienden los temas CLAROS (claro y rosa); oscuro y mono lo apagan.
    settings = await window.navirisApp.setSettings({ lightMode: esTemaClaro(b.dataset.tema) });
    if (els.optLight) els.optLight.checked = esTemaClaro(b.dataset.tema);
    toast('Tema ' + (NOMBRES[b.dataset.tema] || b.dataset.tema));
  }));
  document.addEventListener('click', (e) => {
    if (pop.classList.contains('hidden')) return;
    if (!pop.contains(e.target) && !boton.contains(e.target)) { pop.classList.add('hidden'); boton.classList.remove('on'); }
  });
})();

/* Editar ya no se bloquea en ventanas pequeñas: al entrar se enseña la maqueta
   ENTERA escalada a lo ancho (con scroll si a lo alto no cabe), así que
   siempre hay celdas donde colocar y lo que se guarda es tu composición real,
   nunca el reflujo. Al salir vuelve el encuadre normal. */
els.hubEdit.addEventListener('click', () => {
  const on = els.hub.classList.toggle('editing'); els.hubEdit.classList.toggle('on', on);
  els.widgetPalette.classList.toggle('hidden', !on); cierraMenusHub();
  els.hubEdit.querySelector('.lbl').textContent = on ? 'Listo' : 'Editar';
  if (on) renderPalette();
  renderHub();
});
function renderPalette() {
  els.paletteList.innerHTML = '';
  for (const key in WIDGET_TYPES) {
    const w = WIDGET_TYPES[key]; const b = document.createElement('button'); b.className = 'pal-item';
    b.innerHTML = `${window.icon(w.icon)}<span>${w.name}</span>`;
    b.addEventListener('click', () => {
      // comprobar HUECO antes de crear: sin sitio se avisa (antes se creaba
      // una copia invisible en silencio por cada clic)
      const def = (TAMANOS[key] || [[2, 1]])[0];
      const tw = Math.min(def[0], ultimoCols), th = def[1];
      const occ = new Set(); delBucket().forEach((x) => ocupa(occ, x));
      const pos = primerHueco(occ, tw, th, ultimoCols);
      if (!pos) { toast(`No hay un hueco de ${tw}×${th} libre para ${w.name} — libera celdas`); return; }
      const nuevo = { id: 'w' + (++widgetSeq) + Date.now(), type: key, col: pos.col, row: pos.row, w: tw, h: th };
      widgets.push(nuevo); fijaGeo(nuevo);
      saveWidgets(); renderHub();
    });
    els.paletteList.appendChild(b);
  }
}
els.hubCustomize.addEventListener('click', (e) => {
  e.stopPropagation();
  const show = els.customizePanel.classList.contains('hidden');
  cierraMenusHub('aspecto');
  els.customizePanel.classList.toggle('hidden', !show);
  els.widgetPalette.classList.add('hidden');
  if (show) renderBgPresets();
});
// Clic fuera: el panel de aspecto se cierra como el de temas.
document.addEventListener('click', (e) => {
  if (els.customizePanel.classList.contains('hidden')) return;
  if (!els.customizePanel.contains(e.target) && !els.hubCustomize.contains(e.target)) els.customizePanel.classList.add('hidden');
});

// Fondos oscuros pero con tinte de color distinguible (gris oscuro por defecto)
const BACKGROUNDS = [
  // Predeterminado: CARBÓN puro. El lima es color de ESTADO (hover, activo),
  // NO tiñe el fondo. La textura la pone el grano de #hub::after.
  'radial-gradient(130% 100% at 80% 0%, #1c1c1c 0%, #121212 45%, #0a0a0a 100%)',
  'linear-gradient(135deg, #2f2f38 0%, #16161b 100%)',                 // Grafito claro
  'radial-gradient(120% 80% at 50% -10%, #2a1d44 0%, #0c0a16 62%)',    // Violeta
  'radial-gradient(120% 80% at 50% -10%, #132a4a 0%, #080d18 62%)',    // Azul
  'radial-gradient(120% 80% at 50% -10%, #0e3330 0%, #070f0e 62%)',    // Teal
  'radial-gradient(120% 80% at 50% -10%, #3a1420 0%, #120809 62%)',    // Vino
  'radial-gradient(120% 80% at 50% -10%, #35240c 0%, #120c06 62%)',    // Ámbar
  'radial-gradient(120% 80% at 50% -10%, #123326 0%, #070f0b 62%)',    // Bosque
  'radial-gradient(120% 80% at 50% -10%, #1c2740 0%, #0b0e15 62%)',    // Acero
  'linear-gradient(135deg, #2a1030 0%, #100a1e 45%, #0a0a0d 100%)'     // Aurora
];
// Los MISMOS diez fondos en versión clara, en el mismo orden: el fondo guardado
// se sigue identificando por su valor oscuro (canónico) y aquí se traduce según
// el tema, de modo que cambiar de claro a oscuro conserva el fondo elegido.
const BACKGROUNDS_LIGHT = [
  // Predeterminado claro: blanco con tinte rojo-naranja suave (la gama del
  // logo claro de Naviris)
  'radial-gradient(120% 90% at 75% 5%, #ffe7dd 0%, #f6efec 45%, #eceef2 100%)',
  'linear-gradient(135deg, #f4f5f8 0%, #dcdfe6 100%)',                 // Grafito claro
  'radial-gradient(120% 80% at 50% -10%, #ece4fb 0%, #dcd6ea 62%)',    // Violeta
  'radial-gradient(120% 80% at 50% -10%, #e0ecfb 0%, #d2dcea 62%)',    // Azul
  'radial-gradient(120% 80% at 50% -10%, #ddf1ec 0%, #cfe2dd 62%)',    // Teal
  'radial-gradient(120% 80% at 50% -10%, #fae2e8 0%, #ebd3d8 62%)',    // Vino
  'radial-gradient(120% 80% at 50% -10%, #faeddb 0%, #ecdfcd 62%)',    // Ámbar
  'radial-gradient(120% 80% at 50% -10%, #ddf0e5 0%, #cfe1d7 62%)',    // Bosque
  'radial-gradient(120% 80% at 50% -10%, #e2e8f3 0%, #d3d9e5 62%)',    // Acero
  'linear-gradient(135deg, #f2e3f5 0%, #e4dff0 45%, #e9eaee 100%)'     // Aurora
];
// Y en versión rosa pastel para el tema rosa (2.7.3-dev.16): todos claros y
// rosados, conservando un matiz propio para que el selector siga ofreciendo
// variedad. Mismo orden y misma identidad canónica (el valor oscuro).
const BACKGROUNDS_ROSA = [
  // El primer fondo rosa (malla luminosa) se retiro por decision de Dosa
  // (2026-08-12): este slot toma el ULTIMO fondo (Aurora rosa), que pasa a ser
  // el predeterminado del tema rosa.
  'linear-gradient(135deg, #fce4f2 0%, #ecdcf4 45%, #fdeff6 100%)',
  'linear-gradient(135deg, #fef6fa 0%, #f2dbe7 100%)',                 // Porcelana
  'radial-gradient(120% 80% at 50% -10%, #f3e6fb 0%, #ecd9ef 62%)',    // Lila
  'radial-gradient(120% 80% at 50% -10%, #e6e9fb 0%, #e0d7ec 62%)',    // Celeste
  'radial-gradient(120% 80% at 50% -10%, #def2ec 0%, #d5e5e2 62%)',    // Menta
  'radial-gradient(120% 80% at 50% -10%, #fbdde8 0%, #f3cfdd 62%)',    // Fresa
  'radial-gradient(120% 80% at 50% -10%, #fdeadf 0%, #f4dcd2 62%)',    // Melocotón
  'radial-gradient(120% 80% at 50% -10%, #e0f2e8 0%, #d6e6dc 62%)',    // Verde pastel
  'radial-gradient(120% 80% at 50% -10%, #e7ebf5 0%, #dcdfeb 62%)',    // Gris perla
  'linear-gradient(135deg, #fce4f2 0%, #ecdcf4 45%, #fdeff6 100%)'     // Aurora rosa
];
/* Los mismos diez slots para el tema Naviris (.mono), en gris NEUTRO y sobre
   CARBON, no sobre negro puro: Dosa lo pidio expreso el 2026-08-21 ("no quiero
   que sea tan oscuro"). Cambia la geometria y la profundidad para que el
   selector siga ofreciendo diez miniaturas distintas. Misma identidad
   canonica (el valor del tema Acid). */
const BACKGROUNDS_MONO = [
  'radial-gradient(130% 100% at 80% 0%, #1c1c1e 0%, #121214 45%, #0b0b0c 100%)', // Carbon (predeterminado; más oscuro desde 2.8.1: las baldosas van encima)
  'linear-gradient(135deg, #3a3a3a 0%, #1f1f1f 100%)',                 // Grafito
  'radial-gradient(120% 80% at 50% -10%, #353535 0%, #171717 62%)',    // Cenit
  'radial-gradient(120% 80% at 20% 0%, #2e2e2e 0%, #161616 62%)',      // Esquina
  'radial-gradient(120% 80% at 80% 100%, #303030 0%, #171717 62%)',    // Contraluz
  'radial-gradient(120% 80% at 50% -10%, #262626 0%, #131313 62%)',    // Tinta
  'linear-gradient(180deg, #2a2a2a 0%, #141414 100%)',                 // Caida
  'linear-gradient(90deg, #151515 0%, #2c2c2c 50%, #151515 100%)',     // Pasillo
  'radial-gradient(120% 80% at 50% 110%, #333333 0%, #171717 60%)',    // Suelo
  'linear-gradient(135deg, #444444 0%, #232323 45%, #151515 100%)'     // Humo
];
/* Fondo por defecto: SIEMPRE el degradado plano del tema (2026-08-12, Dosa).
   Las fotos de src/temas/<tema>/ NO son fondos y nunca lo fueron: son el
   material de los WIDGETS DE IMAGEN, que cargan la del tema activo por su
   `slot` (ver imagenDeTema). Se devuelve la identidad canonica y bgForTheme
   la traduce al juego del tema (grafito en oscuro, gris claro, Aurora rosa). */
function defaultBgTema() { return BACKGROUNDS[0]; }
// Un fondo de temas/ guardado como fondo del hub es de la version que se
// equivoco: se descarta y el tema vuelve a su degradado.
const esFotoDeTema = (v) => typeof v === 'string' && /url\("?temas\//.test(v);
// Clave de store por tema: cada tema recuerda su propio fondo.
function bgThemeKey(tema) { return 'naviris.hubBg.' + (tema || temaActual()); }
/* Hasta dev.48 el fondo era UNO para toda la app (naviris.hubBg). Esa clave se
   retira sin heredarla: cada tema arranca con SU predeterminado (el primero de
   su paleta, el mas oscuro en el tema oscuro) y desde ahi se elige. Tiene que
   correr ANTES del primer applyTheme(), que ya escribe la clave del tema. */
function migraFondoPorTema() {
  for (const t of TEMAS) if (esFotoDeTema(store.get(bgThemeKey(t), null))) store.del(bgThemeKey(t));
  store.del('naviris.hubBg');
}

// Traduce el fondo canónico (oscuro) al del tema activo. Las imágenes propias
// del usuario se dejan intactas: son suyas y no se reinterpretan.
function bgForTheme(v) {
  if (!v || v.startsWith('url(')) return v;
  const i = BACKGROUNDS.indexOf(v);
  if (i < 0) return v;
  const raiz = document.documentElement.classList;
  if (raiz.contains('rosa')) return BACKGROUNDS_ROSA[i];
  if (raiz.contains('mono')) return BACKGROUNDS_MONO[i];
  return raiz.contains('light') ? BACKGROUNDS_LIGHT[i] : BACKGROUNDS[i];
}
function applyBackground(v) {
  if (v === 'transparent') v = BACKGROUNDS[0]; // el modo transparente se retiró (creaba capas de sombra)
  if (esFotoDeTema(v)) v = BACKGROUNDS[0];     // las fotos de los widgets no son fondo (ni llegando por sincronización)
  // Identidades viejas del fondo predeterminado (antes de la gama cálida):
  // quien lo tenía elegido pasa al predeterminado nuevo, no a "fondo custom"
  if (v === 'linear-gradient(160deg, #26262d 0%, #191920 100%)' || v === 'linear-gradient(160deg, #fdf1f6 0%, #f6dde9 100%)'
    || v === 'radial-gradient(110% 85% at 70% 8%, #262218 0%, #16140f 52%, #0e0d0b 100%)'
    || v === 'radial-gradient(110% 85% at 70% 8%, #232323 0%, #141414 52%, #0d0d0d 100%)'
    || v === 'linear-gradient(160deg, #eceef2 0%, #dfe2e8 100%)'
    || v === 'radial-gradient(130% 100% at 80% 0%, #322752 0%, #1c1730 45%, #100d17 100%)'
    || v === 'radial-gradient(130% 100% at 80% 0%, #23260f 0%, #141508 42%, #0a0a06 100%)') v = BACKGROUNDS[0];
  let i = BACKGROUNDS_LIGHT.indexOf(v);
  if (i < 0) i = BACKGROUNDS_ROSA.indexOf(v);
  if (i < 0) i = BACKGROUNDS_MONO.indexOf(v);
  if (i >= 0) v = BACKGROUNDS[i]; // se guarda siempre el valor oscuro como identidad
  els.hub.style.setProperty('--hub-bg', bgForTheme(v));
  store.set(bgThemeKey(), v);
  // Liquid glass Fase 2: la refracción SVG solo vale la pena sobre una FOTO
  // cuando el fondo es una imagen del usuario (valor url(...)).
  ajustarVidrioAlFondo(v); // mide el brillo de la foto → #hub.bg-claro (baldosas blancas)
  document.querySelectorAll('.bg-thumb').forEach((t) => t.classList.toggle('sel', t.dataset.bg === v));
}
/* El tinte del vidrio sigue al FONDO, no al tema (2026-08-11): sobre una foto
   clara, el cristal ahumado del tema oscuro se veía como manchas negras (lo
   detectó Dosa con su fondo rojo). Se mide el brillo medio de la foto en un
   canvas de 32×32 y #hub.bg-claro cambia los tokens del vidrio al juego blanco
   (definido en styles.css). Con degradados del tema, la clase se quita. */
function ajustarVidrioAlFondo(v) {
  const m = typeof v === 'string' && v.match(/url\("?([^")]+)"?\)/);
  if (!m) { els.hub.classList.remove('bg-claro'); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 32, 32);
      const d = x.getImageData(0, 0, 32, 32).data; let v = 0;
      // Brillo HSV (max r/g/b) → TINTE del vidrio (bg-claro): un rojo vivo
      // "se ve" claro (V≈.65) aunque su luminancia sea baja. El texto flotante
      // ya no mide nada: lleva halo oscuro que funciona sobre cualquier foto.
      for (let i = 0; i < d.length; i += 4) v += Math.max(d[i], d[i + 1], d[i + 2]);
      els.hub.classList.toggle('bg-claro', v / (d.length / 4) / 255 > .48);
    } catch { /* canvas contaminado u otro fallo: se queda el vidrio del tema */ }
  };
  img.onerror = () => els.hub.classList.remove('bg-claro');
  img.src = m[1];
}

/* Al cambiar de tamaño el hub (ventana, panel lateral, barra de marcadores o
   el propio hub al aparecer) la rejilla se REENCUADRA: escala y posición, sin
   rehacer ni un widget, en el mismo fotograma (el ResizeObserver llega después
   de maquetar y antes de pintar, una vez por fotograma como mucho: no hace
   falta otro freno). Solo si cambia el modo (maqueta, scroll o reflujo) o las
   columnas del reflujo hay que repintar los widgets, y eso se agrupa: arrastrar
   el borde de la ventana no rehace el hub en cada paso. Antes todo esperaba
   250 ms y repintaba entero. */
let rehaceHub = null, remideTimer = null;
function reencuadra() {
  if (!els.hub.clientWidth || !encuadreHub) return;
  const m = medidasMalla();
  if (m.modo !== encuadreHub.modo || m.cols !== encuadreHub.cols) {
    clearTimeout(rehaceHub); rehaceHub = setTimeout(renderHub, 120);
    return;
  }
  if (m.s !== encuadreHub.s) { clearTimeout(remideTimer); remideTimer = setTimeout(remideListas, 150); }
  if (m.s !== encuadreHub.s || m.x !== encuadreHub.x || m.y !== encuadreHub.y || m.inf !== encuadreHub.inf || m.sup !== encuadreHub.sup) aplicaEncuadre(m);
}
// También la esquina y el dock: la pastilla del clima llega tarde (red) y el
// dock cambia con los accesos, y los dos cuentan como sitio ocupado.
const vigilaEncuadre = new ResizeObserver(reencuadra);
[els.hub, els.hubDock, document.querySelector('.hub-corner')].forEach((el) => vigilaEncuadre.observe(el));
/* ===== TRANSPARENCIA DE LAS BALDOSAS (2026-09-09) =====
   Un solo número (0 = opacas, 65 = muy transparentes) que el CSS reparte entre
   todas las superficies del hub con color-mix. El desenfoque solo se enciende
   por debajo del 100 % de opacidad: quien deje el hub opaco no paga nada. */
function aplicaOpacidad(pct) {
  const p = Math.max(0, Math.min(65, Number(pct) || 0));
  els.hub.style.setProperty('--hub-op', (1 - p / 100).toFixed(3));
  els.hub.classList.toggle('translucido', p > 0);
  if (els.opValor) els.opValor.textContent = p + ' %';
  if (els.opSlider && Number(els.opSlider.value) !== p) els.opSlider.value = p;
  return p;
}
if (els.opSlider) {
  els.opSlider.addEventListener('input', () => {
    store.set('naviris.hubTransparencia', aplicaOpacidad(els.opSlider.value));
  });
}
aplicaOpacidad(store.get('naviris.hubTransparencia', 0));
/* ===== ESTILO DEL DOCK (Naviris 3) =====
   El de siempre, con su contenedor (por defecto), o la repisa de vidrio tenue
   de las propuestas. Sin contenedor no: sobre las fotos se perdía (Dosa,
   2026-11-03). Se elige en «Aspecto del hub». */
const DOCK_ESTILOS = ['contenedor', 'repisa'];
function aplicaDock(estilo) {
  const e = DOCK_ESTILOS.includes(estilo) ? estilo : 'contenedor';
  els.hubDock.classList.toggle('repisa', e === 'repisa');
  document.querySelectorAll('[data-dock]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.dock === e)));
  return e;
}
document.querySelectorAll('[data-dock]').forEach((b) => b.addEventListener('click', () => {
  store.set('naviris.dockEstilo', aplicaDock(b.dataset.dock));
  renderDock();
}));
aplicaDock(store.get('naviris.dockEstilo', 'contenedor'));

function renderBgPresets() {
  els.bgPresets.innerHTML = '';
  // Solo degradados: el aspecto del hub es plano. Las fotos de src/temas/ son
  // de los widgets de imagen y no se ofrecen aqui.
  const saved = store.get(bgThemeKey(), defaultBgTema());
  // Sin repetidos: en rosa, el primero y el ultimo son la misma Aurora, y se
  // veian dos miniaturas identicas. Se pinta la primera vez que aparece.
  const vistos = new Set();
  for (const bg of BACKGROUNDS) {
    const pintado = bgForTheme(bg);
    if (vistos.has(pintado)) continue;
    vistos.add(pintado);
    const th = document.createElement('div');
    th.className = 'bg-thumb' + (saved === bg ? ' sel' : '');
    th.style.background = pintado; th.dataset.bg = bg;
    th.addEventListener('click', () => applyBackground(bg));
    els.bgPresets.appendChild(th);
  }
}
/* Fondo propio: se abre el diálogo del SISTEMA (el <input type="file"> no
   disparaba 'change' al reelegir el mismo archivo y el panel se quedaba
   colgado — lo reportó Dosa el 2026-08-11). Resolución completa: el archivo
   se copia a userData y el hub apunta a él. */
async function elegirFondoPropio() {
  const r = await window.navirisApp.pickWallpaper();
  if (r?.canceled) return;
  if (r?.ok) { applyBackground(`url("${r.url}") center/cover no-repeat`); toast('Fondo actualizado'); return; }
  toast(r?.message || 'No se pudo usar esa imagen');
}
document.querySelector('.wp-custom')?.addEventListener('click', (e) => { e.preventDefault(); elegirFondoPropio(); });
