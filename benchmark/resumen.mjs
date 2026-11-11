// Junta las medidas y saca las tablas en el formato de PERFORMANCE.md.
//
//   node resumen.mjs <etiqueta>          lee trabajo/medidas/*-<etiqueta>.json, guarda trabajo/resultados-<etiqueta>.json
//                                        (mediana, mínimo, máximo, n y valores sueltos de cada cifra) y saca las tablas
//   node resumen.mjs <resultados.json>   solo saca las tablas de un resultado ya guardado (p. ej. resultados/2026-11-11.json)
//
// Las tablas dan mediana (mínimo–máximo). El p95 solo sale cuando hay 20 valores o más: con 3 o 5
// repeticiones sería el máximo con otro nombre.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = process.argv[2] || 'medida';
const esArchivo = arg.endsWith('.json') && fs.existsSync(arg);

// ---------- estadística y formato ----------
const numeros = (v) => v.filter((n) => typeof n === 'number' && isFinite(n));
const mediana = (v) => { const x = [...v].sort((a, b) => a - b); if (!x.length) return null; const m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
const p95 = (v) => { const x = [...v].sort((a, b) => a - b); return x[Math.ceil(0.95 * x.length) - 1]; };
const est = (v) => { const x = numeros(v); return { mediana: mediana(x), min: x.length ? Math.min(...x) : null, max: x.length ? Math.max(...x) : null, n: x.length, valores: x }; };
const NBSP = ' ';
// Enteros a partir de 100; por debajo, un decimal si la serie los tiene. Coma decimal y espacio de miles desde 10 000.
function num(n, unDecimal = false) {
  if (n == null) return '—';
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  let [ent, dec] = String(Math.abs(r)).split('.');
  if (ent.length > 4) ent = ent.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  if (!dec && unDecimal && Math.abs(n) < 100) dec = '0';
  return (r < 0 ? '−' : '') + ent + (dec ? ',' + dec : '');
}
const celda = (e) => {
  if (!e || !e.n) return '—';
  const d = e.valores.some((v) => !Number.isInteger(v));
  if (e.min === e.max) return num(e.mediana, d);
  return `${num(e.mediana, d)} (${num(e.min, d)}–${num(e.max, d)})` + (e.n >= 20 ? ` · p95 ${num(p95(e.valores), d)}` : '');
};

const NOMBRES = { naviris: 'Naviris', 'naviris-sin': 'Naviris sin bloqueador', electron: 'Electron solo (control)', chrome: 'Chrome', brave: 'Brave', edge: 'Edge', firefox: 'Firefox' };
const ORDEN = Object.keys(NOMBRES);
const nombre = (k) => NOMBRES[k] || k;
const ordena = (claves) => [...claves].sort((a, b) => (ORDEN.indexOf(a) + 1 || 99) - (ORDEN.indexOf(b) + 1 || 99));
const sitioCorto = (s) => s.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '');

// ---------- de las medidas crudas a un resultado ----------
function entorno() {
  const ps = (c) => { try { return execFileSync('powershell', ['-NoProfile', '-Command', c], { encoding: 'utf8' }).trim(); } catch { return null; } };
  const cpu = ps('(Get-CimInstance Win32_Processor | Select-Object -First 1).Name');
  const ram = ps('[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)');
  const so = ps('$o = Get-CimInstance Win32_OperatingSystem; $o.Caption + " " + $o.BuildNumber');
  return [cpu, ram && `${ram} GB`, so].filter(Boolean).join(', ');
}
async function versiones() {
  const { NAVS, REPO } = await import('./lib.mjs');
  const v = {};
  const ver = (exe) => { try { return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim() || null; } catch { return null; } };
  try {
    const pkg = JSON.parse(fs.readFileSync(`${REPO}/package.json`, 'utf8'));
    const el = JSON.parse(fs.readFileSync(`${REPO}/node_modules/electron/package.json`, 'utf8')).version;
    let rev = ''; try { rev = ' ' + execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
    v.naviris = process.env.NAVIRIS_EXE ? `${ver(NAVS.naviris.exe)} (instalado)` : `${pkg.version}${rev}, Electron ${el}`;
  } catch {}
  for (const k of ['chrome', 'brave', 'edge']) if (fs.existsSync(NAVS[k].exe)) v[k] = ver(NAVS[k].exe);
  return v;
}
async function desdeMedidas(etq) {
  const { TRABAJO } = await import('./lib.mjs');
  const lee = (f) => { try { return JSON.parse(fs.readFileSync(`${TRABAJO}/medidas/${f}-${etq}.json`, 'utf8')); } catch { return null; } };
  const M = {};
  const a = lee('arranque');
  if (a) {
    M.arranque = {};
    for (const cual of new Set(a.reps.map((f) => f.cual))) {
      const v = a.reps.filter((f) => f.cual === cual); M.arranque[cual] = {};
      for (const k of ['frio', 'caliente']) for (const m of ['ventanaMs', 'navegableMs']) M.arranque[cual][`${k}.${m}`] = est(v.map((f) => f[k]?.[m]));
    }
  }
  const c = lee('consumo');
  if (c) {
    M.consumo = {};
    for (const cual of new Set(c.filas.map((f) => f.cual))) {
      const v = c.filas.filter((f) => f.cual === cual && !f.error); M.consumo[cual] = {};
      for (const s of SITUACIONES) M.consumo[cual][s] = { wsMB: est(v.map((f) => f[s]?.wsMB)), privateBytesMB: est(v.map((f) => f[s]?.privateBytesMB)), privWsMB: est(v.map((f) => f[s]?.privWsMB)), procesos: est(v.map((f) => f[s]?.procesos)), cpuMsEn40s: est(v.map((f) => f[s]?.cpuMs)) };
    }
  }
  const g = lee('cargas');
  if (g) {
    M.cargas = {};
    const sitios = [...new Set(g.filas.flatMap((f) => f.sitios.map((s) => s.sitio)))];
    for (const cual of new Set(g.filas.map((f) => f.cual))) {
      M.cargas[cual] = {};
      for (const s of sitios) {
        const v = g.filas.filter((f) => f.cual === cual).map((f) => f.sitios.find((x) => x.sitio === s)).filter(Boolean);
        M.cargas[cual][s] = { loadMs: est(v.map((x) => x.loadMs)), lcpMs: est(v.map((x) => x.lcpMs)), ordenLoadMs: est(v.map((x) => x.ordenLoadMs)), recursos: est(v.map((x) => x.recursos)) };
      }
      const suma = (k) => Object.values(M.cargas[cual]).reduce((t, x) => t + (x[k].mediana || 0), 0);
      M.cargas[cual]._suma = { loadMs: suma('loadMs'), lcpMs: suma('lcpMs'), ordenLoadMs: suma('ordenLoadMs') };
    }
  }
  const y = lee('youtube');
  if (y) {
    M.youtube = {};
    for (const cual of new Set(y.filas.map((f) => f.cual))) {
      const v = y.filas.filter((f) => f.cual === cual && f.medida).map((f) => f.medida);
      M.youtube[cual] = { cpuMs60s: est(v.map((x) => x.cpuMs)), wsMB: est(v.map((x) => x.wsMB)), privateBytesMB: est(v.map((x) => x.privateBytesMB)), procesos: est(v.map((x) => x.procesos)), frames: est(v.map((x) => x.frames)), perdidos: est(v.map((x) => x.perdidos)), avanceS: est(v.map((x) => x.avanceS)), calidad: [...new Set(v.map((x) => x.calidad.join('→')))], codec: [...new Set(v.map((x) => x.codec))], anuncios: y.filas.filter((f) => f.cual === cual).map((f) => f.muestrasConAnuncio) };
    }
  }
  const b = lee('bench');
  if (b) {
    M.bench = {};
    for (const cual of new Set(b.filas.map((f) => f.cual))) {
      const v = b.filas.filter((f) => f.cual === cual); M.bench[cual] = {};
      for (const k of ['speedometer', 'jetstream', 'motionmark']) M.bench[cual][k] = est(v.map((f) => f[k]?.puntos));
      M.bench[cual].viewport = [...new Set(v.map((f) => f.speedometerViewport).filter(Boolean))];
    }
  }
  const r = {
    fecha: new Date().toISOString().slice(0, 10), etiqueta: etq, equipo: entorno(), versiones: await versiones(),
    unidades: UNIDADES, estadistica: 'cada cifra: mediana, min, max, n y valores sueltos', medidas: M
  };
  fs.writeFileSync(`${TRABAJO}/resultados-${etq}.json`, JSON.stringify(r, null, 1));
  console.error(`Guardado en ${TRABAJO}/resultados-${etq}.json`);
  return r;
}
const SITUACIONES = ['reposo', 'unoDelante', 'cincoDelante', 'cincoFondo', 'diezDelante', 'diezFondo'];
const UNIDADES = {
  arranque: 'ms desde el lanzamiento; frio = carpeta de perfil vacía, caliente = segundo arranque del mismo perfil',
  consumo: 'MB de todo el árbol de procesos; cpuMsEn40s = ms de CPU de todo el árbol en 40 s',
  cargas: 'ms; loadMs = navigationStart→loadEventEnd; lcpMs = Largest Contentful Paint; caché vacía',
  youtube: 'ventana de 60 s', bench: 'puntos, más es mejor'
};

// ---------- tablas ----------
function tablas(r) {
  const M = r.medidas; let md = '';
  const fila = (cols) => `| ${cols.join(' | ')} |\n`;
  const cab = (cols) => fila(cols) + fila(cols.map(() => '---'));
  const reps = (o) => Math.max(...Object.values(o).flatMap((x) => Object.values(x)).map((e) => e?.n || 0));

  if (M.arranque) {
    md += `\n#### Arranque · ms, mediana (mín–máx) de ${reps(M.arranque)} repeticiones\n\n`;
    md += cab(['', 'Ventana, perfil nuevo', 'Página cargada, perfil nuevo', 'Ventana, perfil existente', 'Página cargada, perfil existente']);
    for (const k of ordena(Object.keys(M.arranque))) { const x = M.arranque[k]; md += fila([nombre(k), celda(x['frio.ventanaMs']), celda(x['frio.navegableMs']), celda(x['caliente.ventanaMs']), celda(x['caliente.navegableMs'])]); }
  }
  if (M.consumo) {
    const n = Math.max(...Object.values(M.consumo).map((x) => x.reposo.privateBytesMB.n));
    const cols = ['', 'Reposo', '1 sitio', '5 sitios, uno delante', '5 sitios al fondo', '10 sitios, uno delante', '10 sitios al fondo'];
    for (const [tit, k] of [['Private bytes (MB)', 'privateBytesMB'], ['Working set privado (MB)', 'privWsMB'], ['CPU de todo el árbol (ms en 40 s)', 'cpuMsEn40s']]) {
      md += `\n#### ${tit} · mediana (mín–máx) de ${n} sesiones\n\n` + cab(cols);
      for (const c of ordena(Object.keys(M.consumo))) md += fila([nombre(c), ...SITUACIONES.map((s) => celda(M.consumo[c][s][k]))]);
    }
    md += `\n#### Procesos abiertos · mediana\n\n` + cab(cols);
    for (const c of ordena(Object.keys(M.consumo))) md += fila([nombre(c), ...SITUACIONES.map((s) => num(M.consumo[c][s].procesos.mediana))]);
  }
  if (M.cargas) {
    const cuales = ordena(Object.keys(M.cargas));
    const sitios = Object.keys(M.cargas[cuales[0]]).filter((s) => s !== '_suma');
    const n = M.cargas[cuales[0]][sitios[0]].loadMs.n;
    for (const [tit, k] of [['Carga, navigationStart → load (ms)', 'loadMs'], ['LCP (ms)', 'lcpMs']]) {
      md += `\n#### ${tit} · mediana (mín–máx) de ${n} pasadas con caché vacía\n\n` + cab(['Sitio', ...cuales.map(nombre)]);
      for (const s of sitios) md += fila([sitioCorto(s), ...cuales.map((c) => celda(M.cargas[c][s]?.[k]))]);
      md += fila(['**Suma de medianas**', ...cuales.map((c) => `**${num(M.cargas[c]._suma[k])}**`)]);
    }
  }
  if (M.youtube) {
    const n = Math.max(...Object.values(M.youtube).map((x) => x.cpuMs60s.n));
    md += `\n#### YouTube, 60 s de video · mediana (mín–máx) de ${n} pasadas\n\n`;
    md += cab(['', 'CPU (ms en 60 s)', 'Private bytes (MB)', 'Working set (MB)', 'Procesos', 'Frames', 'Perdidos']);
    for (const c of ordena(Object.keys(M.youtube))) { const x = M.youtube[c]; md += fila([nombre(c), celda(x.cpuMs60s), celda(x.privateBytesMB), celda(x.wsMB), celda(x.procesos), celda(x.frames), celda(x.perdidos)]); }
  }
  if (M.bench) {
    const n = Math.max(...Object.values(M.bench).map((x) => x.speedometer.n));
    md += `\n#### Benchmarks · puntos, más es mejor, mediana (mín–máx) de ${n} pasadas\n\n`;
    md += cab(['', 'Speedometer 3.1', 'JetStream 2.2', 'MotionMark 1.3.1', 'Área de página']);
    for (const c of ordena(Object.keys(M.bench))) { const x = M.bench[c]; md += fila([nombre(c), celda(x.speedometer), celda(x.jetstream), celda(x.motionmark), x.viewport.map((v) => v.replace(/ dpr.*/, '').replace('x', '×')).join(', ')]); }
  }
  const ad = r.antesDespues;
  if (ad) {
    md += `\n#### ${ad.titulo} · ms, mediana (mín–máx) de ${ad.arranque.antes['frio.ventanaMs'].n} pasadas intercaladas\n\n`;
    md += cab(['', 'Ventana, perfil nuevo', 'Página cargada, perfil nuevo', 'Ventana, perfil existente', 'Página cargada, perfil existente']);
    for (const [k, t] of [['antes', ad.nombres.antes], ['despues', ad.nombres.despues]]) { const x = ad.arranque[k]; md += fila([t, celda(x['frio.ventanaMs']), celda(x['frio.navegableMs']), celda(x['caliente.ventanaMs']), celda(x['caliente.navegableMs'])]); }
    if (ad.tendencias) {
      md += `\n#### Repintado del hub pasados 2 min · 25 s, mediana (mín–máx) de ${ad.tendencias.antes.cpuMs25s.n} pasadas\n\n`;
      md += cab(['', 'CPU (ms)', 'Pico de private bytes (MB)', 'Procesos nuevos']);
      for (const [k, t] of [['antes', ad.nombres.antes], ['despues', ad.nombres.despues]]) { const x = ad.tendencias[k]; md += fila([t, celda(x.cpuMs25s), celda(x.picoPrivateBytesMB), celda(x.procesosNuevos)]); }
    }
  }
  return md;
}

const r = esArchivo ? JSON.parse(fs.readFileSync(arg, 'utf8')) : await desdeMedidas(arg);
process.stdout.write(tablas(r));
