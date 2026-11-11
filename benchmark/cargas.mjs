// Tiempo de carga de los 10 sitios de sitios.mjs (perfil copiado de su semilla, caché vacía).
// Cada sitio en una pestaña nueva en primer plano; se espera al load (tope 30 s) y 4 s más, se lee y se cierra.
//  · loadMs: navigationStart → loadEventEnd (Navigation Timing de la propia página);
//  · lcpMs: Largest Contentful Paint (PerformanceObserver con buffered);
//  · ordenLoadMs: desde que se pide la pestaña hasta el load, con el reloj del sistema (incluye crear la
//    pestaña y su proceso);
//  · recursos: entradas de Resource Timing (tope de 250 si la página no lo sube).
// Uso: node cargas.mjs <repeticiones> [etiqueta] [navs]   (por defecto 5, «medida», naviris,chrome,brave,naviris-sin)
import { TRABAJO, lanza, prepara, cierra, espera, copiaPerfil, borraPerfil, abrePestana, cierraPestana, guardaJSON, leeJSON, log, hasta, orden, argumentos } from './lib.mjs';
import { SITIOS } from './sitios.mjs';

const { REPS, ETQ, CUALES } = argumentos(5, 'naviris,chrome,brave,naviris-sin');
const fRes = `${TRABAJO}/medidas/cargas-${ETQ}.json`;
const res = leeJSON(fRes, { etiqueta: ETQ, fecha: new Date().toISOString(), filas: [] });

const LEE = `(async () => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const lcp = await new Promise((r) => { let v = null; try { new PerformanceObserver((l) => { const e = l.getEntries(); if (e.length) v = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {} setTimeout(() => r(v), 400); });
  return { loadMs: n.loadEventEnd ? Math.round(n.loadEventEnd) : null, dclMs: n.domContentLoadedEventEnd ? Math.round(n.domContentLoadedEventEnd) : null, ttfbMs: Math.round(n.responseStart || 0),
    lcpMs: lcp == null ? null : Math.round(lcp), loadEpoch: n.loadEventEnd ? Math.round(performance.timeOrigin + n.loadEventEnd) : null,
    recursos: performance.getEntriesByType('resource').length, url: location.href.slice(0, 100), visible: document.visibilityState };
})()`;

for (let rep = 1; rep <= REPS; rep++) {
  for (const cual of orden(CUALES, rep)) {
    if (res.filas.some((f) => f.rep === rep && f.cual === cual && f.sitios?.length === SITIOS.length)) continue;
    const perfil = `${TRABAJO}/perfiles/cargas-${cual}`;
    copiaPerfil(`${TRABAJO}/semillas/${cual}`, perfil);
    const b = lanza(cual, perfil, { log: `${TRABAJO}/logs/cargas-${ETQ}-${cual}.log` });
    const fila = { rep, cual, inicio: new Date().toISOString(), sitios: [] };
    try {
      await prepara(b);
      await espera(15000);
      for (const url of SITIOS) {
        const t = Date.now();
        let p, m;
        try {
          p = await abrePestana(b, url);
          await hasta(() => p.s.ev('document.readyState === "complete" && location.href !== "about:blank"', 3000), 30000, 250).catch(() => null);
          await espera(4000);
          m = await p.s.ev(LEE, 5000);
          m.ordenLoadMs = m.loadEpoch ? m.loadEpoch - t : null;
        } catch (e) { m = { error: String(e).slice(0, 200) }; }
        fila.sitios.push({ sitio: url, ...m });
        log(cual, rep, url, JSON.stringify({ load: m.loadMs, lcp: m.lcpMs, orden: m.ordenLoadMs, rec: m.recursos, vis: m.visible, err: m.error }));
        if (p) await cierraPestana(b, p).catch(() => {});
        await espera(1500);
      }
    } catch (e) { fila.error = String(e && e.stack || e).slice(0, 500); log('ERROR', cual, rep, fila.error); }
    fila.cierre = await cierra(b);
    res.filas = res.filas.filter((f) => !(f.rep === rep && f.cual === cual));
    res.filas.push(fila); guardaJSON(fRes, res);
    await borraPerfil(perfil);
  }
}
log('cargas hecho', fRes);
process.exit(0);
