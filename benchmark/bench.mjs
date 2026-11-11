// Benchmarks de browserbench.org: Speedometer 3.1, JetStream 2.2 y MotionMark 1.3.1, cada uno en una
// pestaña nueva en primer plano, uno detrás de otro en la misma sesión (perfil copiado de su semilla).
// EXTRA="--flag1 --flag2" en el entorno añade opciones de línea de comandos al navegador.
// Uso: node bench.mjs <repeticiones> [etiqueta] [navs] [benchs]
//      (por defecto 3, «medida», naviris,chrome,brave,electron, speedometer,jetstream,motionmark)
import { TRABAJO, lanza, prepara, cierra, espera, copiaPerfil, borraPerfil, abrePestana, cierraPestana, guardaJSON, leeJSON, log, hasta, ruido, orden, argumentos } from './lib.mjs';

const { REPS, ETQ, CUALES } = argumentos(3, 'naviris,chrome,brave,electron');
const BENCHS = (process.argv[5] || 'speedometer,jetstream,motionmark').split(',');
const EXTRA = process.env.EXTRA ? process.env.EXTRA.split(' ') : [];
const fRes = `${TRABAJO}/medidas/bench-${ETQ}.json`;
const res = leeJSON(fRes, { etiqueta: ETQ, fecha: new Date().toISOString(), extra: EXTRA, filas: [] });

const B = {
  speedometer: {
    url: 'https://browserbench.org/Speedometer3.1/?startAutomatically',
    lee: `(() => { const t = document.getElementById('result-number')?.textContent?.trim(); return t ? { puntos: parseFloat(t), texto: t } : null; })()`,
    tope: 600000
  },
  jetstream: {
    url: 'https://browserbench.org/JetStream2.2/',
    listo: `!!window.JetStream && !document.getElementById('status').classList.contains('loading') && !document.getElementById('status').classList.contains('error')`,
    inicia: `(JetStream.start(), true)`,
    lee: `(() => { const s = document.querySelector('#result-summary.done .score'); return s ? { puntos: parseFloat(s.textContent), texto: s.textContent } : null; })()`,
    tope: 900000
  },
  motionmark: {
    url: 'https://browserbench.org/MotionMark1.3.1/',
    listo: `!!window.benchmarkController && document.readyState === 'complete'`,
    inicia: `(benchmarkController.startBenchmark(), true)`,
    lee: `(() => { const s = document.querySelector('#results .score'); const t = s && s.textContent.trim(); if (!t) return null; const r = window.benchmarkRunnerClient && benchmarkRunnerClient.results; return { puntos: parseFloat(t), texto: t, abajo: r ? +r.scoreLowerBound.toFixed(2) : null, arriba: r ? +r.scoreUpperBound.toFixed(2) : null, tam: document.body.className, lienzo: (() => { const c = document.querySelector('#test-container'); return c ? c.offsetWidth + 'x' + c.offsetHeight : null; })() }; })()`,
    tope: 900000
  }
};

for (let rep = 1; rep <= REPS; rep++) {
  for (const cual of orden(CUALES, rep)) {
    if (res.filas.some((f) => f.rep === rep && f.cual === cual && BENCHS.every((k) => f[k] && f[k].puntos))) continue;
    // El control no tiene semilla propia: arranca con perfil vacío.
    const perfil = `${TRABAJO}/perfiles/bench-${cual}`;
    if (cual === 'electron') await borraPerfil(perfil);
    else copiaPerfil(`${TRABAJO}/semillas/${cual}`, perfil);
    const b = lanza(cual, perfil, { log: `${TRABAJO}/logs/bench-${ETQ}-${cual}.log`, extra: EXTRA });
    const fila = { rep, cual, inicio: new Date().toISOString(), ruido: ruido(2).slice(0, 3) };
    try {
      await prepara(b);
      await espera(20000);
      for (const k of BENCHS) {
        const d = B[k]; const t0 = Date.now();
        let p;
        try {
          p = await abrePestana(b, d.url);
          if (d.listo) await hasta(() => p.s.ev(d.listo, 5000), 60000, 500);
          await espera(3000);
          fila[k + 'Viewport'] = await p.s.ev('innerWidth + "x" + innerHeight + " dpr " + devicePixelRatio');
          if (d.inicia) await p.s.ev(d.inicia, 5000);
          fila[k] = await hasta(() => p.s.ev(d.lee, 10000), d.tope, 3000);
          fila[k].segundos = Math.round((Date.now() - t0) / 1000);
        } catch (e) { fila[k] = { error: String(e).slice(0, 200) }; }
        log(cual, rep, k, JSON.stringify(fila[k]), fila[k + 'Viewport']);
        if (p) await cierraPestana(b, p).catch(() => {});
        await espera(5000);
      }
    } catch (e) { fila.error = String(e && e.stack || e).slice(0, 500); log('ERROR', cual, rep, fila.error); }
    fila.cierre = await cierra(b);
    res.filas = res.filas.filter((f) => !(f.rep === rep && f.cual === cual));
    res.filas.push(fila); guardaJSON(fRes, res);
    await borraPerfil(perfil);
  }
}
log('bench hecho', fRes);
process.exit(0);
