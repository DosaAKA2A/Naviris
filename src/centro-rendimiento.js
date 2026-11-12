/* ===== CENTRO DE RENDIMIENTO (Ajustes) =====
   Las cuentas del Centro de rendimiento, sin DOM ni Electron, para poder
   probarlas (test/centro-rendimiento.test.js). Las usa el proceso principal
   (sumar las métricas de los procesos, las páginas de prueba del servidor
   local) y la interfaz (formatear, resumir las pruebas, el texto de «Copiar
   resultados»).

   Memoria: la PRIVADA de cada proceso, la que enseña el Administrador de
   tareas de Windows (privateBytes). El working set cuenta también las páginas
   compartidas en cada proceso y el total salía unas cuatro veces más alto
   (NAV-VIVO-08). Fuera de Windows no hay privateBytes y se usa el working set.

   Procesador: app.getAppMetrics() da el uso de cada proceso relativo a UN
   núcleo (un proceso que ocupa dos núcleos marca 200). El Administrador de
   tareas lo da sobre el equipo entero, así que la suma se divide entre los
   núcleos lógicos. */
(function (raiz) {
  'use strict';

  const memoriaKb = (p) => (p && p.memory && (p.memory.privateBytes ?? p.memory.workingSetSize)) || 0;
  const cpuDe = (p) => (p && p.cpu && p.cpu.percentCPUUsage) || 0;
  const redondea1 = (n) => Math.round(n * 10) / 10;

  // Uso del procesador sobre el equipo entero (0–100, un decimal).
  function porcentajeCpu(sumaPorNucleo, nucleos) {
    const n = Math.max(1, Math.floor(nucleos) || 1);
    const pct = (Number(sumaPorNucleo) || 0) / n;
    return redondea1(Math.min(100, Math.max(0, pct)));
  }

  // Todo el árbol de procesos de Naviris: memoria en KB, procesador y cuántos.
  function sumaMetricas(mets, nucleos) {
    let kb = 0, cpu = 0;
    for (const p of mets || []) { kb += memoriaKb(p); cpu += cpuDe(p); }
    return { memoriaKb: kb, cpu: porcentajeCpu(cpu, nucleos), procesos: (mets || []).length };
  }

  /* La foto de la memoria, por tipo de proceso, en palabras de todos los días.
     «Tab» en Chromium es cualquier proceso que pinta páginas: las webs y
     también la propia interfaz de Naviris. */
  const GRUPOS = [
    ['Tab', 'Páginas e interfaz'],
    ['GPU', 'Gráficos'],
    ['Browser', 'Proceso principal'],
    ['Utility', 'Servicios (red, audio, almacenamiento)']
  ];
  function agrupaProcesos(mets) {
    const por = new Map();
    for (const p of mets || []) {
      const fijo = GRUPOS.find(([tipo]) => tipo === p.type);
      const clave = fijo ? fijo[0] : 'Otros';
      const g = por.get(clave) || { clave, nombre: fijo ? fijo[1] : 'Otros', kb: 0, procesos: 0 };
      g.kb += memoriaKb(p); g.procesos++;
      por.set(clave, g);
    }
    return [...por.values()].sort((a, b) => b.kb - a.kb);
  }

  // Cuándo arrancó el proceso principal (ms desde 1970). `reserva` si no se sabe.
  function inicioDelProceso(mets, reserva) {
    const b = (mets || []).find((p) => p.type === 'Browser');
    return b && b.creationTime > 0 ? b.creationTime : reserva;
  }

  /* Los tramos del arranque, en ms desde que Windows creó el proceso:
     listo     → Electron y Chromium cargados (app ready)
     interfaz  → la interfaz avisa de que está montada (ui:listo)
     visible   → se enseña la ventana (tras la animación de entrada) */
  function tramosArranque(h) {
    if (!h || !(h.inicio > 0)) return null;
    const desde = (t) => (t > 0 && t >= h.inicio ? Math.round(t - h.inicio) : null);
    return { listo: desde(h.listo), interfaz: desde(h.interfaz), visible: desde(h.visible) };
  }

  // ---------- Formato ----------
  function formatoMemoria(kb) {
    const mb = (Number(kb) || 0) / 1024;
    if (mb >= 1024) return (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB';
    return Math.round(mb) + ' MB';
  }
  function formatoMs(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
  }
  function formatoDuracion(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (s < 60) return s + ' s';
    const min = Math.floor(s / 60);
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60), resto = min % 60;
    if (h < 24) return resto ? `${h} h ${resto} min` : `${h} h`;
    const d = Math.floor(h / 24), hr = h % 24;
    return hr ? `${d} d ${hr} h` : `${d} d`;
  }

  const mediana = (arr) => {
    const v = (arr || []).filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  /* ---------- Tendencia de la memoria en la sesión ----------
     Pendiente de Theil-Sen sobre las muestras ({ t, kb }): la mediana de las
     pendientes entre cada par de muestras, así un pico suelto (una pestaña
     pesada que se abre y se cierra) no tuerce la recta. Con menos de
     cuatro muestras o menos de 20 minutos no se dice nada. Se considera que
     sube o baja si se mueve más de 30 MB por hora o del 5 % de la media por
     hora, lo que sea mayor: abrir y cerrar pestañas mueve la memoria a saltos
     y eso no es una fuga. */
  const TENDENCIA_MIN_MUESTRAS = 4;
  const TENDENCIA_MIN_MS = 20 * 60 * 1000;
  function tendencia(muestras) {
    const m = (muestras || []).filter((x) => x && x.t > 0 && x.kb >= 0);
    const minutos = m.length > 1 ? Math.round((m[m.length - 1].t - m[0].t) / 60000) : 0;
    if (m.length < TENDENCIA_MIN_MUESTRAS || minutos * 60000 < TENDENCIA_MIN_MS) return { estado: 'pocos', mbPorHora: null, minutos };
    const pendientes = [];
    for (let i = 0; i < m.length; i++) {
      for (let j = i + 1; j < m.length; j++) {
        if (m[j].t > m[i].t) pendientes.push((m[j].kb - m[i].kb) / 1024 / ((m[j].t - m[i].t) / 3600000));
      }
    }
    const pendiente = mediana(pendientes) || 0;   // MB por hora
    const my = m.reduce((s, x) => s + x.kb, 0) / m.length / 1024;
    const umbral = Math.max(30, my * 0.05);
    const estado = pendiente > umbral ? 'sube' : pendiente < -umbral ? 'baja' : 'estable';
    return { estado, mbPorHora: Math.round(pendiente), minutos };
  }

  /* ---------- Renderizado ----------
     `intervalos`: ms entre fotogramas seguidos (requestAnimationFrame). La
     frecuencia de la pantalla se estima con la mediana (60, 120, 144 Hz…) y un
     fotograma es lento si tarda más de vez y media lo que toca: se ha saltado
     al menos un refresco. */
  // Frecuencias de pantalla habituales: 1000/mediana da 179 en una de 180 Hz.
  const FRECUENCIAS = [60, 75, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 300, 360, 480, 500];
  const frecuenciaDe = (ms) => {
    const hz = 1000 / ms;
    const cerca = FRECUENCIAS.reduce((m, f) => (Math.abs(hz - f) < Math.abs(hz - m) ? f : m));
    return Math.abs(hz - cerca) / cerca < 0.03 ? cerca : Math.round(hz);
  };
  function resumenFotogramas(intervalos) {
    const v = (intervalos || []).filter((x) => typeof x === 'number' && x > 0 && isFinite(x));
    if (v.length < 10) return null;
    const total = v.reduce((s, x) => s + x, 0);
    const tipico = mediana(v);
    const lentos = v.filter((x) => x > tipico * 1.5).length;
    return {
      fotogramas: v.length,
      fps: redondea1(v.length / (total / 1000)),
      refrescoHz: frecuenciaDe(tipico),
      lentos,
      pctLentos: redondea1(lentos / v.length * 100),
      peorMs: Math.round(Math.max(...v))
    };
  }

  /* ---------- Carga de páginas ----------
     `mediciones`: [{ pagina, total, respuesta, dom }] en ms, varias por página.
     Se resume cada una con la mediana, que no se deja llevar por una vuelta rara. */
  function resumenCarga(mediciones) {
    const por = new Map();
    for (const x of mediciones || []) {
      if (!x || !x.pagina) continue;
      if (!por.has(x.pagina)) por.set(x.pagina, []);
      por.get(x.pagina).push(x);
    }
    const paginas = [...por].map(([pagina, xs]) => ({
      pagina,
      veces: xs.length,
      total: Math.round(mediana(xs.map((x) => x.total))),
      respuesta: Math.round(mediana(xs.map((x) => x.respuesta))),
      dom: Math.round(mediana(xs.map((x) => x.dom)))
    }));
    const totales = paginas.map((p) => p.total);
    return { paginas, media: totales.length ? Math.round(totales.reduce((s, x) => s + x, 0) / totales.length) : null };
  }

  // ---------- El equipo ----------
  // os.release() en Windows: «10.0.<build>». Windows 11 es la build 22000 o más.
  function nombreWindows(release) {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(release || ''));
    if (!m) return 'Windows';
    const build = +m[3];
    if (+m[1] === 10) return (build >= 22000 ? 'Windows 11' : 'Windows 10') + ' (compilación ' + build + ')';
    return 'Windows ' + m[1] + '.' + m[2] + ' (compilación ' + build + ')';
  }

  /* ---------- «Copiar resultados» ----------
     Texto legible y, debajo, los mismos datos en JSON para quien quiera
     procesarlos. No sale de la máquina: va al portapapeles y nada más. */
  function textoResultados(d) {
    const e = d.equipo || {}, r = d.resultados || {};
    const lineas = ['Naviris · Centro de rendimiento', 'Fecha: ' + new Date(d.fecha || Date.now()).toLocaleString('es')];
    lineas.push('', 'Equipo',
      `  Naviris ${e.naviris || '?'} · Chromium ${e.chromium || '?'} · Electron ${e.electron || '?'}`,
      `  ${e.windows || 'Windows'}`,
      `  Procesador: ${e.cpu || '?'} (${e.nucleos || '?'} núcleos lógicos)`,
      `  Memoria del equipo: ${e.ramKb ? formatoMemoria(e.ramKb) : '?'}`);
    if (d.vivo) {
      lineas.push('', 'Ahora',
        `  Memoria de Naviris: ${formatoMemoria(d.vivo.memoriaKb)} en ${d.vivo.procesos} procesos`,
        `  Procesador: ${d.vivo.cpu} %`,
        `  Pestañas: ${d.vivo.pestanas} abiertas, ${d.vivo.dormidas} dormidas`,
        `  Tiempo abierto: ${formatoDuracion(d.vivo.activoMs)}`);
    }
    if (r.arranque) {
      lineas.push('', 'Arranque',
        `  Navegador listo: ${formatoMs(r.arranque.listo)}`,
        `  Interfaz lista: ${formatoMs(r.arranque.interfaz)}`,
        `  Ventana visible: ${formatoMs(r.arranque.visible)}`);
    }
    if (r.memoria) {
      lineas.push('', 'Memoria',
        `  Total: ${formatoMemoria(r.memoria.totalKb)} con ${r.memoria.pestanas} pestañas abiertas (${r.memoria.dormidas} dormidas)`);
      for (const g of r.memoria.grupos || []) lineas.push(`  ${g.nombre}: ${formatoMemoria(g.kb)} (${g.procesos})`);
    }
    if (r.carga) {
      lineas.push('', 'Carga de páginas (local, sin internet)');
      for (const p of r.carga.paginas || []) lineas.push(`  ${p.pagina}: ${formatoMs(p.total)}`);
      lineas.push(`  Promedio: ${formatoMs(r.carga.media)}`);
    }
    if (r.render) {
      lineas.push('', 'Renderizado',
        `  ${r.render.fps} fotogramas por segundo (pantalla de ${r.render.refrescoHz} Hz)`,
        `  Fotogramas lentos: ${r.render.lentos} de ${r.render.fotogramas} (${r.render.pctLentos} %)`,
        `  El más lento: ${r.render.peorMs} ms`);
    }
    if (d.tendencia && d.tendencia.estado !== 'pocos') {
      lineas.push('', 'Memoria en esta sesión',
        `  ${{ sube: 'Sube', baja: 'Baja', estable: 'Estable' }[d.tendencia.estado]} (${d.tendencia.mbPorHora > 0 ? '+' : ''}${d.tendencia.mbPorHora} MB por hora en ${d.tendencia.minutos} min)`);
    }
    lineas.push('', JSON.stringify({ fecha: d.fecha, equipo: e, vivo: d.vivo || null, resultados: r, tendencia: d.tendencia || null }));
    return lineas.join('\n');
  }

  /* ---------- Páginas de prueba ----------
     Las sirve el proceso principal en 127.0.0.1 solo mientras dura la prueba:
     no hace falta internet y siempre son las mismas, así que los números se
     pueden comparar entre equipos y versiones. Devuelve { cuerpo, tipo } o
     null si la ruta no existe. */
  const PAGINAS_CARGA = [
    { ruta: '/texto', nombre: 'Artículo largo' },
    { ruta: '/imagenes', nombre: 'Página con 48 imágenes' },
    { ruta: '/scripts', nombre: 'Página con 12 scripts' }
  ];
  const html = (titulo, cuerpo) => `<!doctype html><html lang="es"><meta charset="utf-8"><title>${titulo}</title><body style="margin:0;font:15px/1.6 system-ui,sans-serif;background:#fff;color:#111">${cuerpo}</body></html>`;
  const FRASES = ['El navegador reparte el trabajo entre varios procesos.', 'Cada pestaña pinta su página en su propio proceso.',
    'La memoria crece con lo que tienes abierto.', 'Una página ligera carga en pocos milisegundos.', 'Los fotogramas se pintan al ritmo de la pantalla.'];
  function paginaDePrueba(ruta) {
    const u = String(ruta || '').split('?')[0];
    if (u === '/vacia') return { tipo: 'text/html; charset=utf-8', cuerpo: html('Prueba', '') };
    if (u === '/texto') {
      let c = '';
      for (let i = 0; i < 160; i++) {
        if (i % 10 === 0) c += `<h2>Sección ${i / 10 + 1}</h2>`;
        let p = '';
        for (let j = 0; j < 8; j++) p += FRASES[(i + j) % FRASES.length] + ' ';
        c += `<p>${p}</p>`;
      }
      return { tipo: 'text/html; charset=utf-8', cuerpo: html('Artículo', `<article style="max-width:720px;margin:auto;padding:24px">${c}</article>`) };
    }
    if (u === '/imagenes') {
      let c = '';
      for (let i = 0; i < 48; i++) c += `<img src="/img/${i}.svg" width="160" height="120" alt="" style="margin:4px">`;
      return { tipo: 'text/html; charset=utf-8', cuerpo: html('Imágenes', c) };
    }
    const img = /^\/img\/(\d{1,2})\.svg$/.exec(u);
    if (img && +img[1] < 48) {
      const n = +img[1], gris = 40 + (n * 37) % 180;
      let formas = '';
      for (let k = 0; k < 30; k++) formas += `<circle cx="${(k * 53 + n * 7) % 160}" cy="${(k * 29 + n * 11) % 120}" r="${4 + (k % 9)}" fill="rgb(${gris},${gris},${gris})" opacity=".6"/>`;
      return { tipo: 'image/svg+xml', cuerpo: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#eee"/>${formas}</svg>` };
    }
    if (u === '/scripts') {
      let c = '<div id="raiz"></div>';
      for (let i = 0; i < 12; i++) c += `<script src="/js/${i}.js"></script>`;
      return { tipo: 'text/html; charset=utf-8', cuerpo: html('Scripts', c) };
    }
    const js = /^\/js\/(\d{1,2})\.js$/.exec(u);
    if (js && +js[1] < 12) {
      // Algo de cálculo y 250 elementos nuevos por script: lo normal de una web con JavaScript.
      return { tipo: 'text/javascript; charset=utf-8', cuerpo: `(function(){var a=[];for(var i=0;i<20000;i++)a.push((i*${+js[1] + 7})%997);a.sort(function(x,y){return x-y});`
        + `var f=document.createDocumentFragment();for(var j=0;j<250;j++){var d=document.createElement('div');d.textContent='Elemento '+j+' · '+a[j*40];f.appendChild(d)}`
        + `document.getElementById('raiz').appendChild(f)})();` };
    }
    if (u === '/animacion') {
      /* 400 cajas que se mueven en cada fotograma y una lista que se desplaza
         sola. window.__mide(ms) devuelve los intervalos entre fotogramas. */
      return { tipo: 'text/html; charset=utf-8', cuerpo: html('Animación', `<div id="cajas" style="position:fixed;inset:0;overflow:hidden"></div>
<div id="lista" style="position:fixed;right:0;top:0;bottom:0;width:40%;overflow:auto;background:#f4f4f4"></div>
<script>
var cajas=document.getElementById('cajas'),lista=document.getElementById('lista'),els=[];
for(var i=0;i<400;i++){var d=document.createElement('div');d.style.cssText='position:absolute;left:0;top:0;width:18px;height:18px;border-radius:4px;background:rgb('+(i%200)+','+(i%200)+','+(i%200)+')';cajas.appendChild(d);els.push(d)}
var t='';for(var k=0;k<2000;k++)t+='<div style="padding:6px 10px;border-bottom:1px solid #ddd">Fila '+k+'</div>';lista.innerHTML=t;
function mueve(ts){var w=cajas.clientWidth*0.6,h=cajas.clientHeight;for(var i=0;i<els.length;i++){var a=ts/700+i;els[i].style.transform='translate('+((Math.sin(a)*.5+.5)*w)+'px,'+((Math.cos(a*1.3)*.5+.5)*h)+'px)'}
lista.scrollTop=(lista.scrollTop+6)%(lista.scrollHeight-lista.clientHeight)}
window.__mide=function(ms){return new Promise(function(fin){var v=[],antes=0,desde=0;function f(ts){mueve(ts);if(antes)v.push(ts-antes);else desde=ts;antes=ts;if(ts-desde<ms)requestAnimationFrame(f);else fin(v)}requestAnimationFrame(f)})};
</script>`) };
    }
    return null;
  }

  const api = {
    memoriaKb, porcentajeCpu, sumaMetricas, agrupaProcesos, inicioDelProceso, tramosArranque,
    formatoMemoria, formatoMs, formatoDuracion, mediana, tendencia, resumenFotogramas, resumenCarga,
    nombreWindows, textoResultados, PAGINAS_CARGA, paginaDePrueba
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.centroRendimiento = api;
})(typeof window !== 'undefined' ? window : globalThis);
