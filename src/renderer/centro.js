/* Centro de rendimiento (Ajustes): cómo va Naviris ahora, la memoria de la sesión y las pruebas de arranque, memoria, carga y renderizado. */

/* Coste: con la página cerrada, nada (ningún temporizador; el oyente de
   visibilidad sale sin hacer nada). Abierta, una consulta al proceso
   principal cada 2 s, que se para si la ventana se minimiza. Las pruebas de
   carga y renderizado montan un webview y un servidor local solo mientras
   duran y los quitan al acabar o al cerrar la página.
   Las cuentas están en src/centro-rendimiento.js (se prueban en test/). */
const cr = window.centroRendimiento;
const crEls = {
  page: $('#centro-page'), cerrar: $('#cr-x'), copiar: $('#cr-copiar'), banco: $('#cr-banco'),
  mem: $('#cr-mem'), memS: $('#cr-mem-s'), cpu: $('#cr-cpu'), tabs: $('#cr-tabs'), tabsS: $('#cr-tabs-s'),
  activo: $('#cr-activo'), activoS: $('#cr-activo-s'), tendG: $('#cr-tend-g polyline'), tendT: $('#cr-tend-t'),
  res: { arranque: $('#cr-r-arranque'), memoria: $('#cr-r-memoria'), carga: $('#cr-r-carga'), render: $('#cr-r-render') }
};
const CR_CADA_MS = 2000;
let crTimer = null;
let crVivo = null;          // la última lectura, para «Copiar resultados»
let crTend = null;          // la tendencia de las muestras guardadas
let crTendDe = 0;           // hora de la última muestra con la que se calculó
let crInfo = null;          // el equipo y el arranque de esta sesión
let crPrueba = 0;           // se incrementa al cancelar: una prueba vieja no apunta nada
let crOcupado = false;
const crResultados = store.get('naviris.centro', null) || {};

const crFecha = (t) => new Date(t).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const crPestanas = () => ({ abiertas: tabs.length, dormidas: tabs.filter((t) => t.asleep).length });

/* ---------- Abrir y cerrar ---------- */
function abreCentro() {
  tabs.forEach((t) => t.webview?.classList.remove('active'));
  els.hub.classList.remove('active'); hideBookmarkPage(); hideAddonsPage(); hideDownloadsPage(); cierraNovedadesPagina(true);
  crEls.page.classList.remove('hidden'); crEls.page.classList.add('active');
  crEls.page.scrollTop = 0;
  pintaResultados();
  cargaInfo();
  arrancaVivo();
}
// Como cierraNovedadesPagina: `soloOculta` cuando quien llama ya activa lo que toca.
function cierraCentro(soloOculta) {
  if (!crEls.page.classList.contains('active')) return false;
  paraVivo();
  cancelaPrueba();
  crEls.page.classList.remove('active'); crEls.page.classList.add('hidden');
  if (soloOculta === true) return true;
  const t = activeTab();
  if (t && t.kind === 'web' && t.webview) t.webview.classList.add('active');
  else els.hub.classList.add('active');
  return true;
}
crEls.cerrar.addEventListener('click', () => cierraCentro());

function arrancaVivo() {
  paraVivo();
  if (document.hidden) return;
  pintaVivo();
  crTimer = setInterval(pintaVivo, CR_CADA_MS);
}
function paraVivo() { clearInterval(crTimer); crTimer = null; }
// Minimizada u oculta no se ve nada: se para, y vuelve al volver.
document.addEventListener('visibilitychange', () => {
  if (!crEls.page.classList.contains('active')) return;
  if (document.hidden) paraVivo(); else arrancaVivo();
});

/* ---------- Ahora ---------- */
async function pintaVivo() {
  const v = await window.navirisApp.centroVivo().catch(() => null);
  if (!v || !crEls.page.classList.contains('active')) return;
  const p = crPestanas();
  crVivo = { memoriaKb: v.memoriaKb, cpu: v.cpu, procesos: v.procesos, pestanas: p.abiertas, dormidas: p.dormidas, activoMs: v.ahora - v.inicio };
  crEls.mem.textContent = cr.formatoMemoria(v.memoriaKb);
  crEls.memS.textContent = v.procesos === 1 ? 'En 1 proceso' : `En ${v.procesos} procesos`;
  crEls.cpu.textContent = v.cpu.toFixed(1) + ' %';
  crEls.tabs.textContent = String(p.abiertas);
  crEls.tabsS.textContent = !p.dormidas ? 'Ninguna dormida' : p.dormidas === 1 ? '1 dormida' : `${p.dormidas} dormidas`;
  crEls.activo.textContent = cr.formatoDuracion(crVivo.activoMs);
  crEls.activoS.textContent = 'Desde las ' + new Date(v.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  pintaTendencia(v.muestras, { t: v.ahora, kb: v.memoriaKb });
  // Abierto nada más arrancar: el hito de la ventana visible llega un poco después.
  if (crInfo && crInfo.arranque && crInfo.arranque.visible == null) cargaInfo();
}

/* La línea de la memoria en la sesión: una muestra cada 5 min (las toma el
   proceso principal) más la lectura de ahora. Sin ejes ni adornos: la forma y
   una frase que la explica. La tendencia sale solo de las muestras guardadas y
   se recalcula cuando llega una nueva: con las de 24 h son unos 10 ms. */
function pintaTendencia(muestras, ahora) {
  const ultima = muestras.length ? muestras[muestras.length - 1].t : 0;
  if (!crTend || ultima !== crTendDe) { crTend = cr.tendencia(muestras); crTendDe = ultima; }
  const m = [...muestras, ahora];
  // Sin muestras guardadas no hay línea que dibujar: fuera el hueco vacío.
  crEls.tendG.parentNode.classList.toggle('hidden', m.length < 2);
  if (m.length < 2) { crEls.tendG.setAttribute('points', ''); }
  else {
    const t0 = m[0].t, dt = Math.max(1, m[m.length - 1].t - t0);
    const kbs = m.map((x) => x.kb), min = Math.min(...kbs), max = Math.max(...kbs);
    const alto = Math.max(max - min, max * 0.1, 1);   // una variación pequeña no puede parecer un acantilado
    const base = min - (alto - (max - min)) / 2;
    crEls.tendG.setAttribute('points', m.map((x) => `${((x.t - t0) / dt * 600).toFixed(1)},${(76 - (x.kb - base) / alto * 72).toFixed(1)}`).join(' '));
  }
  const kbs = m.map((x) => x.kb);
  const rango = m.length > 1 ? ` Entre ${cr.formatoMemoria(Math.min(...kbs))} y ${cr.formatoMemoria(Math.max(...kbs))} en ${cr.formatoDuracion(m[m.length - 1].t - m[0].t)}.` : '';
  crEls.tendT.textContent = crTend.estado === 'pocos'
    ? 'Naviris apunta su memoria cada 5 minutos mientras está abierto. En media hora podrás ver si se mantiene o si crece sin parar.'
    : crTend.estado === 'estable' ? 'Estable: no crece con el tiempo.' + rango
      : crTend.estado === 'sube' ? `Sube unos ${crTend.mbPorHora} MB por hora. Es normal si fuiste abriendo pestañas; si no, alguna página puede estar acumulando memoria.` + rango
        : `Baja unos ${-crTend.mbPorHora} MB por hora.` + rango;
}

/* ---------- Resultados ---------- */
/* Se pide cada vez que se abre: si se abre nada más arrancar, la ventana aún
   no se ha enseñado y ese hito llega después. */
async function cargaInfo() {
  crInfo = await window.navirisApp.centroInfo().catch(() => null) || crInfo;
  if (crInfo && crInfo.arranque) { crResultados.arranque = { fecha: Date.now(), ...crInfo.arranque }; guardaResultados(); }
  pintaResultados();
}
function guardaResultados() { store.set('naviris.centro', crResultados); }

const crCifra = (k, v) => `<div class="cr-mini"><span class="cr-k">${k}</span><span class="cr-mini-v">${v}</span></div>`;
const crFila = (k, v) => `<li><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></li>`;
function pintaResultados() {
  const r = crResultados, el = crEls.res;
  const a = crInfo && crInfo.arranque;
  el.arranque.innerHTML = !a ? '<p class="cr-nota">No disponible en esta sesión.</p>'
    : `<div class="cr-minis">${crCifra('Navegador listo', cr.formatoMs(a.listo))}${crCifra('Interfaz lista', cr.formatoMs(a.interfaz))}${crCifra('Ventana visible', cr.formatoMs(a.visible))}</div>`
      + '<p class="cr-nota">La ventana se enseña al terminar la animación de entrada, así que siempre va un poco detrás de la interfaz.</p>';
  el.memoria.innerHTML = !r.memoria ? '' : `<div class="cr-res-v">${cr.formatoMemoria(r.memoria.totalKb)}</div>`
    + `<p class="cr-nota">Con ${Number(r.memoria.pestanas)} ${r.memoria.pestanas === 1 ? 'pestaña abierta' : 'pestañas abiertas'}${r.memoria.dormidas ? ` (${Number(r.memoria.dormidas)} dormidas)` : ''} · ${crFecha(r.memoria.fecha)}</p>`
    + `<ul class="cr-lista">${r.memoria.grupos.map((g) => crFila(g.nombre, cr.formatoMemoria(g.kb))).join('')}</ul>`;
  el.carga.innerHTML = !r.carga ? '' : `<div class="cr-res-v">${cr.formatoMs(r.carga.media)}</div>`
    + `<p class="cr-nota">De media por página, hasta que termina de cargar · ${crFecha(r.carga.fecha)}</p>`
    + `<ul class="cr-lista">${r.carga.paginas.map((p) => crFila(p.pagina, cr.formatoMs(p.total))).join('')}</ul>`;
  el.render.innerHTML = !r.render ? '' : `<div class="cr-res-v">${Math.round(r.render.fps)} fotogramas por segundo</div>`
    + `<p class="cr-nota">Tu pantalla va a ${Number(r.render.refrescoHz)} Hz · ${crFecha(r.render.fecha)}</p>`
    + `<ul class="cr-lista">${crFila('Fotogramas lentos', `${r.render.lentos} de ${r.render.fotogramas} (${r.render.pctLentos} %)`)}${crFila('El más lento', r.render.peorMs + ' ms')}</ul>`;
}

/* ---------- Pruebas ---------- */
const crEspera = (ms) => new Promise((r) => setTimeout(r, ms));
// Una promesa con tope: si no llega, falla (y el temporizador se va con ella).
function crConTope(promesa, ms) {
  let t;
  return Promise.race([promesa, new Promise((_, mal) => { t = setTimeout(() => mal(new Error('tardó demasiado')), ms); })]).finally(() => clearTimeout(t));
}
/* La página de prueba: un webview en la sesión privada (en memoria, sin
   historial ni caché en disco) a la vista, porque una página que no se ve no
   pinta y no se podría medir el renderizado. */
async function montaBanco() {
  const s = await window.navirisApp.centroPaginas(true).catch(() => null);
  if (!s || !s.ok) throw new Error('no se pudo preparar la página de prueba');
  const base = 'http://127.0.0.1:' + s.puerto;
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'naviris-private');
  wv.setAttribute('src', base + '/vacia');
  crEls.banco.replaceChildren(wv);
  crEls.banco.classList.remove('hidden');
  await crConTope(new Promise((ok) => wv.addEventListener('dom-ready', ok, { once: true })), 15000);
  return { wv, base };
}
function quitaBanco() {
  if (!crEls.banco.firstChild) return;
  crEls.banco.replaceChildren();
  crEls.banco.classList.add('hidden');
  window.navirisApp.centroPaginas(false).catch(() => {});
}
// Cancelar libera los botones al momento: la prueba vieja ya no apunta nada.
function cancelaPrueba() { crPrueba++; quitaBanco(); liberaPruebas(); }
function liberaPruebas() {
  crOcupado = false;
  crEls.page.querySelectorAll('.cr-medir').forEach((b) => { b.disabled = false; b.textContent = 'Medir'; });
}

// navigationStart → fin del evento load, leído de la propia página.
const CR_LEE_CARGA = `new Promise((fin) => { const mira = () => { const n = performance.getEntriesByType('navigation')[0];
  if (n && n.loadEventEnd > 0) fin({ total: n.loadEventEnd - n.startTime, respuesta: n.responseStart - n.startTime, dom: n.domContentLoadedEventEnd - n.startTime });
  else setTimeout(mira, 20); }; mira(); })`;

const CR_PRUEBAS = {
  async memoria() {
    const m = await window.navirisApp.centroMemoria();
    if (!m) throw new Error('sin datos de memoria');
    const p = crPestanas();
    return { totalKb: m.totalKb, procesos: m.procesos, grupos: m.grupos.map(({ nombre, kb, procesos }) => ({ nombre, kb, procesos })), pestanas: p.abiertas, dormidas: p.dormidas };
  },
  async carga(id) {
    const { wv, base } = await montaBanco();
    const med = [];
    for (const p of cr.PAGINAS_CARGA) {
      for (let i = 0; i < 3; i++) {
        if (id !== crPrueba) return null;
        await crConTope(wv.loadURL(`${base}${p.ruta}?vuelta=${i}`), 15000);
        med.push({ pagina: p.nombre, ...(await crConTope(wv.executeJavaScript(CR_LEE_CARGA), 5000)) });
      }
    }
    return cr.resumenCarga(med);
  },
  async render(id) {
    const { wv, base } = await montaBanco();
    await crConTope(wv.loadURL(base + '/animacion'), 15000);
    await crEspera(500);   // que se asiente tras cargar
    if (id !== crPrueba) return null;
    const r = cr.resumenFotogramas(await crConTope(wv.executeJavaScript('window.__mide(5000)'), 15000));
    if (!r) throw new Error('la página no llegó a pintar');
    return r;
  }
};

async function lanzaPrueba(boton) {
  if (crOcupado) return;
  const nombre = boton.dataset.prueba, id = ++crPrueba;
  crOcupado = true;
  crEls.page.querySelectorAll('.cr-medir').forEach((b) => { b.disabled = true; });
  boton.textContent = 'Midiendo…';
  try {
    const r = await CR_PRUEBAS[nombre](id);
    if (r && id === crPrueba) { crResultados[nombre] = { fecha: Date.now(), ...r }; guardaResultados(); pintaResultados(); }
  } catch (e) {
    if (id === crPrueba) toast('No se pudo hacer la prueba: ' + (e && e.message || 'error'));
  } finally {
    if (id === crPrueba) { quitaBanco(); liberaPruebas(); }
  }
}
crEls.page.addEventListener('click', (e) => { const b = e.target.closest('.cr-medir'); if (b) lanzaPrueba(b); });

crEls.copiar.addEventListener('click', async () => {
  await cargaInfo();
  const texto = cr.textoResultados({ fecha: Date.now(), equipo: crInfo && crInfo.equipo, vivo: crVivo, resultados: crResultados, tendencia: crTend });
  toast(await window.navirisApp.clipWrite(texto) ? 'Resultados copiados' : 'No se pudieron copiar los resultados');
});
