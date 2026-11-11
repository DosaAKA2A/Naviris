// Memoria y CPU de todo el árbol de procesos (perfil copiado de su semilla).
// Situaciones, en la misma sesión y por este orden (20 s de asiento, o 15 s al cambiar solo de pestaña,
// y 40 s de medida sin tocar nada):
//   reposo (página de inicio) · 1 sitio delante · 5 sitios con el último delante · 5 sitios con la página
//   de inicio delante (todo al fondo) · 10 sitios con el último delante · 10 sitios todo al fondo.
// Si se corta, al volver a correrlo con la misma etiqueta sigue donde se quedó.
// Uso: node consumo.mjs <repeticiones> [etiqueta] [navs]   (por defecto 3, «medida», naviris,chrome,brave,naviris-sin)
import { TRABAJO, lanza, prepara, cierra, espera, copiaPerfil, borraPerfil, procesos, abrePestana, inicioDelante, guardaJSON, leeJSON, log, ruido, memoriaLibreMB, orden, argumentos } from './lib.mjs';
import { SITIOS } from './sitios.mjs';

const { REPS, ETQ, CUALES } = argumentos(3, 'naviris,chrome,brave,naviris-sin');
const MED = 40, ASIENTO = 20, CAMBIO = 15;
const fRes = `${TRABAJO}/medidas/consumo-${ETQ}.json`;
const res = leeJSON(fRes, { etiqueta: ETQ, fecha: new Date().toISOString(), filas: [] });

async function mide(b, fila, nombre) {
  const r = await procesos(b.pid, MED, `${TRABAJO}/medidas/procesos/${ETQ}-${b.cual}-${fila.rep}-${nombre}.txt`);
  fila[nombre] = { ...r, libreMB: memoriaLibreMB(), ruido: ruido(2).slice(0, 3) };
  log(b.cual, fila.rep, nombre, JSON.stringify({ ws: r.wsMB, priv: r.privateBytesMB, privWs: r.privWsMB, proc: r.procesos, cpu: r.cpuMs }));
}
async function abreVarias(b, urls) {
  for (const u of urls) { const p = await abrePestana(b, u); await espera(7000); p.s.cierra(); }
}

for (let rep = 1; rep <= REPS; rep++) {
  for (const cual of orden(CUALES, rep)) {
    if (res.filas.some((f) => f.rep === rep && f.cual === cual && f.diezFondo)) continue;   // ya hecha
    const perfil = `${TRABAJO}/perfiles/consumo-${cual}`;
    copiaPerfil(`${TRABAJO}/semillas/${cual}`, perfil);
    const b = lanza(cual, perfil, { log: `${TRABAJO}/logs/consumo-${ETQ}-${cual}.log` });
    const fila = { rep, cual, inicio: new Date().toISOString() };
    try {
      await prepara(b);
      await espera(ASIENTO * 1000);
      await mide(b, fila, 'reposo');
      await abreVarias(b, SITIOS.slice(0, 1));
      await espera(ASIENTO * 1000);
      await mide(b, fila, 'unoDelante');
      await abreVarias(b, SITIOS.slice(1, 5));
      await espera(ASIENTO * 1000);
      await mide(b, fila, 'cincoDelante');
      fila.inicioDelante5 = await inicioDelante(b);
      await espera(CAMBIO * 1000);
      await mide(b, fila, 'cincoFondo');
      await abreVarias(b, SITIOS.slice(5, 10));
      await espera(ASIENTO * 1000);
      await mide(b, fila, 'diezDelante');
      fila.inicioDelante10 = await inicioDelante(b);
      await espera(CAMBIO * 1000);
      await mide(b, fila, 'diezFondo');
    } catch (e) { fila.error = String(e && e.stack || e).slice(0, 500); log('ERROR', cual, rep, fila.error); }
    fila.cierre = await cierra(b);
    res.filas = res.filas.filter((f) => !(f.rep === rep && f.cual === cual));
    res.filas.push(fila); guardaJSON(fRes, res);
    await borraPerfil(perfil);
  }
}
log('consumo hecho', fRes);
process.exit(0);
