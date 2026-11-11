// Arranque con perfil nuevo y con perfil existente.
//  · «frio» (perfil nuevo): carpeta de perfil VACÍA; el navegador crea su perfil.
//  · «caliente» (perfil existente): segundo arranque del mismo perfil, justo después de cerrarlo.
// En los dos la caché de disco de Windows ya está caliente: un arranque en frío de verdad exige reiniciar.
// Se lanza cada navegador con un enlace a una página local mínima, como al pulsar un enlace con el
// navegador cerrado. Se mide:
//  · ventanaMs: lanzamiento → primera ventana visible de más de 600 px (ps/ventana-visible.ps1, cada 5 ms);
//  · navegableMs: lanzamiento → evento load de esa página (la página avisa al servidor local con un beacon).
// No usa semillas.
// Uso: node arranque.mjs <repeticiones> [etiqueta] [navs]   (por defecto 5, «medida», naviris,chrome,brave)
import http from 'node:http';
import fs from 'node:fs';
import { TRABAJO, config, familia, espera, borraPerfil, guardaJSON, log, ruido, ventanaVisible, cierraPid, orden, argumentos } from './lib.mjs';

const { REPS, ETQ, CUALES } = argumentos(5, 'naviris,chrome,brave');
const PUERTO_WEB = 9462;

const llegadas = new Map();
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/hecho') { llegadas.set(u.searchParams.get('id'), Date.now()); res.end('ok'); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Listo</title><p>Listo</p><script>addEventListener('load', () => fetch('/hecho?id=' + new URLSearchParams(location.search).get('id'), { cache: 'no-store' }));</script>`);
});
await new Promise((r) => srv.listen(PUERTO_WEB, '127.0.0.1', r));

async function unArranque(cual, perfil, id) {
  const n = config(cual);
  const url = `http://127.0.0.1:${PUERTO_WEB}/listo.html?id=${id}`;
  const fArgs = `${TRABAJO}/logs/args-${id}.json`;
  fs.writeFileSync(fArgs, JSON.stringify([...n.pre, `--user-data-dir=${perfil}`, `--remote-debugging-port=${n.puerto}`, ...n.args, url]));
  // asíncrono: el servidor local tiene que poder apuntar el beacon mientras se espera la ventana
  const v = await ventanaVisible(n.exe, fArgs, n.pre[0]);
  fs.rmSync(fArgs, { force: true });
  fs.appendFileSync(`${TRABAJO}/pids.txt`, `${v.pid} ${cual} arranque ${new Date().toISOString()}\n`);
  let llegada = null;
  for (let i = 0; i < 300 && !llegada; i++) { llegada = llegadas.get(id); if (!llegada) await espera(100); }
  const r = { ventanaMs: v.visibleMs, navegableMs: llegada ? llegada - v.t0 : null, pid: v.pid };
  await espera(8000);
  if (await cierraPid(v.pid, n.puerto)) r.forzado = true;
  await espera(3000);
  return r;
}

const fRes = `${TRABAJO}/medidas/arranque-${ETQ}.json`;
const res = { etiqueta: ETQ, fecha: new Date().toISOString(), reps: [] };
for (let rep = 1; rep <= REPS; rep++) {
  for (const cual of orden(CUALES, rep)) {
    const perfil = `${TRABAJO}/perfiles/arranque-${cual}`;
    await borraPerfil(perfil); fs.mkdirSync(perfil, { recursive: true });
    if (familia(cual) === 'naviris') fs.writeFileSync(`${perfil}/naviris-settings.json`, JSON.stringify({ sonidos: false }));
    const frio = await unArranque(cual, perfil, `${cual}-${rep}-frio`);
    const caliente = await unArranque(cual, perfil, `${cual}-${rep}-caliente`);
    res.reps.push({ rep, cual, frio, caliente, ruido: ruido(2) }); guardaJSON(fRes, res);
    log('arranque', JSON.stringify({ rep, cual, frio, caliente }));
    await borraPerfil(perfil);
  }
}
srv.close();
log('arranque hecho', fRes);
process.exit(0);
