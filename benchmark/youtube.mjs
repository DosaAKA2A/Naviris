// Un video de YouTube 60 s en primer plano: CPU y memoria de todo el árbol, frames perdidos, calidad y códec.
// Perfil copiado de su semilla. El aviso de cookies se contesta igual en todos (cookie SOCS de «rechazar»).
// Video silenciado. Si sale un anuncio (Chrome no bloquea), se espera a que termine o se salta antes de medir.
// YouTube puede recargar una vez la página al poco de abrirla (?themeRefresh=1) y cambiar el <video>:
// el guion reintenta hasta que haya uno reproduciéndose.
// Uso: node youtube.mjs <repeticiones> [etiqueta] [navs]   (por defecto 3, «medida», naviris,chrome,brave)
import { TRABAJO, lanza, prepara, cierra, espera, copiaPerfil, borraPerfil, abrePestana, procesos, guardaJSON, leeJSON, log, hasta, ruido, memoriaLibreMB, orden, argumentos } from './lib.mjs';
import { VIDEO } from './sitios.mjs';

const { REPS, ETQ, CUALES } = argumentos(3, 'naviris,chrome,brave');
const fRes = `${TRABAJO}/medidas/youtube-${ETQ}.json`;
const res = leeJSON(fRes, { etiqueta: ETQ, fecha: new Date().toISOString(), video: VIDEO, filas: [] });

const ESTADO = `(() => {
  const v = document.querySelector('video'), mp = document.querySelector('#movie_player');
  if (!v) return null;
  const q = v.getVideoPlaybackQuality();
  let codec = null; try { codec = mp.getStatsForNerds().codecs; } catch {}
  return { t: v.currentTime, pausado: v.paused, total: q.totalVideoFrames, perdidos: q.droppedVideoFrames, anuncio: !!(mp && mp.classList.contains('ad-showing')),
    calidad: mp && mp.getPlaybackQuality ? mp.getPlaybackQuality() : null, codec, ancho: v.videoWidth, alto: v.videoHeight, url: location.href.slice(0, 80) };
})()`;
const SIGUE = `(() => { const v = document.querySelector('video'); if (v) { v.muted = true; if (v.paused) v.play().catch(() => {}); } return true; })()`;
const SALTA = `(() => { const s = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern'); if (s) s.click(); return ${SIGUE}; })()`;

for (let rep = 1; rep <= REPS; rep++) {
  for (const cual of orden(CUALES, rep)) {
    if (res.filas.some((f) => f.rep === rep && f.cual === cual && f.medida)) continue;
    const perfil = `${TRABAJO}/perfiles/youtube-${cual}`;
    copiaPerfil(`${TRABAJO}/semillas/${cual}`, perfil);
    const b = lanza(cual, perfil, { log: `${TRABAJO}/logs/youtube-${ETQ}-${cual}.log` });
    const fila = { rep, cual, inicio: new Date().toISOString() };
    try {
      await prepara(b);
      await espera(15000);
      const p = await abrePestana(b, 'https://www.youtube.com/robots.txt');
      await hasta(() => p.s.ev('document.readyState === "complete" && location.hostname === "www.youtube.com"', 3000), 20000);
      fila.cookie = (await p.s.envia('Network.setCookie', { name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/', secure: true, expires: Date.now() / 1000 + 3e7 })).success;
      await p.s.envia('Page.navigate', { url: VIDEO });
      await hasta(() => p.s.ev(`!!document.querySelector('video') && document.querySelector('video').readyState >= 2`, 3000), 45000, 500);
      await hasta(() => p.s.ev(`(() => { const v = document.querySelector('video'); if (!v) return false; v.muted = true; return v.play().then(() => true, () => false); })()`, 5000), 30000, 1000);
      // anuncios: esperar a que acaben (tope 120 s), saltándolos si se puede
      const t0 = Date.now(); let anuncios = 0;
      while (Date.now() - t0 < 120000) {
        const e = await p.s.ev(ESTADO, 3000);
        if (e && !e.anuncio && !e.pausado && e.t > 0.5) break;
        if (e && e.anuncio) anuncios++;
        await p.s.ev(e && e.anuncio ? SALTA : SIGUE, 3000).catch(() => {});
        await espera(1000);
      }
      fila.esperaAnunciosMs = Date.now() - t0; fila.muestrasConAnuncio = anuncios;
      await espera(5000);   // que se asiente la calidad
      const a = await p.s.ev(ESTADO, 3000);
      const pr = await procesos(b.pid, 60, `${TRABAJO}/medidas/procesos/${ETQ}-youtube-${cual}-${rep}.txt`);
      const z = await p.s.ev(ESTADO, 3000);
      fila.medida = { ...pr, avanceS: +(z.t - a.t).toFixed(1), frames: z.total - a.total, perdidos: z.perdidos - a.perdidos, pausadoAlFinal: z.pausado,
        anuncioAlFinal: z.anuncio, calidad: [a.calidad, z.calidad], codec: z.codec, res: `${z.ancho}x${z.alto}`, libreMB: memoriaLibreMB(), ruido: ruido(2).slice(0, 3) };
      fila.documentos = await p.s.ev('performance.getEntriesByType("navigation").length');
      log(cual, rep, 'youtube', JSON.stringify({ cpu: pr.cpuMs, ws: pr.wsMB, priv: pr.privateBytesMB, avance: fila.medida.avanceS, frames: fila.medida.frames, perdidos: fila.medida.perdidos, cal: fila.medida.calidad, codec: z.codec, anuncios }));
      p.s.cierra();
    } catch (e) { fila.error = String(e && e.stack || e).slice(0, 500); log('ERROR', cual, rep, fila.error); }
    fila.cierre = await cierra(b);
    res.filas = res.filas.filter((f) => !(f.rep === rep && f.cual === cual));
    res.filas.push(fila); guardaJSON(fRes, res);
    await borraPerfil(perfil);
  }
}
log('youtube hecho', fRes);
process.exit(0);
