// Cuentas del Centro de rendimiento (src/centro-rendimiento.js): sin DOM ni Electron.
// npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../src/centro-rendimiento');

// Procesos como los devuelve app.getAppMetrics() en Windows (memoria en KB).
const METS = [
  { pid: 1, type: 'Browser', creationTime: 1700000000000, cpu: { percentCPUUsage: 12 }, memory: { workingSetSize: 200000, privateBytes: 90000 } },
  { pid: 2, type: 'GPU', cpu: { percentCPUUsage: 30 }, memory: { workingSetSize: 300000, privateBytes: 150000 } },
  { pid: 3, type: 'Tab', cpu: { percentCPUUsage: 50 }, memory: { workingSetSize: 400000, privateBytes: 250000 } },
  { pid: 4, type: 'Tab', cpu: { percentCPUUsage: 4 }, memory: { workingSetSize: 100000, privateBytes: 60000 } },
  { pid: 5, type: 'Utility', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 50000, privateBytes: 20000 } },
  { pid: 6, type: 'Zygote', cpu: {}, memory: { workingSetSize: 1000 } }
];

test('la memoria es la privada, como el Administrador de tareas; si no hay, el working set', () => {
  assert.equal(c.memoriaKb(METS[0]), 90000);
  assert.equal(c.memoriaKb(METS[5]), 1000);
  assert.equal(c.memoriaKb({}), 0);
  assert.equal(c.memoriaKb(null), 0);
});

test('suma todo el árbol de procesos', () => {
  const s = c.sumaMetricas(METS, 8);
  assert.equal(s.memoriaKb, 90000 + 150000 + 250000 + 60000 + 20000 + 1000);
  assert.equal(s.procesos, 6);
  // 96 % de un núcleo repartido entre 8 núcleos lógicos
  assert.equal(s.cpu, 12);
  assert.deepEqual(c.sumaMetricas([], 4), { memoriaKb: 0, cpu: 0, procesos: 0 });
  assert.deepEqual(c.sumaMetricas(undefined, 4), { memoriaKb: 0, cpu: 0, procesos: 0 });
});

test('el procesador se da sobre el equipo entero: entre 0 y 100, con un decimal', () => {
  assert.equal(c.porcentajeCpu(100, 4), 25);
  assert.equal(c.porcentajeCpu(1, 3), 0.3);
  assert.equal(c.porcentajeCpu(900, 8), 100);      // nunca más del 100 %
  assert.equal(c.porcentajeCpu(-5, 8), 0);
  assert.equal(c.porcentajeCpu(50, 0), 50);       // sin núcleos conocidos, uno
  assert.equal(c.porcentajeCpu(undefined, 8), 0);
});

test('la foto de la memoria agrupa por tipo, en palabras de todos los días y de mayor a menor', () => {
  const g = c.agrupaProcesos(METS);
  assert.deepEqual(g.map((x) => x.nombre), ['Páginas e interfaz', 'Gráficos', 'Proceso principal', 'Servicios (red, audio, almacenamiento)', 'Otros']);
  assert.deepEqual(g[0], { clave: 'Tab', nombre: 'Páginas e interfaz', kb: 310000, procesos: 2 });
  assert.equal(g.reduce((s, x) => s + x.kb, 0), c.sumaMetricas(METS, 1).memoriaKb);
});

test('el arranque se cuenta desde que se creó el proceso', () => {
  assert.equal(c.inicioDelProceso(METS, 5), 1700000000000);
  assert.equal(c.inicioDelProceso([], 5), 5);
  const t0 = 1700000000000;
  assert.deepEqual(c.tramosArranque({ inicio: t0, listo: t0 + 412.4, interfaz: t0 + 900, visible: t0 + 1500 }), { listo: 412, interfaz: 900, visible: 1500 });
  // Un hito que aún no llegó (o anterior al inicio) no se inventa
  assert.deepEqual(c.tramosArranque({ inicio: t0, listo: t0 + 400, interfaz: 0, visible: t0 - 5 }), { listo: 400, interfaz: null, visible: null });
  assert.equal(c.tramosArranque({ inicio: 0 }), null);
  assert.equal(c.tramosArranque(null), null);
});

test('formato de memoria, tiempos y duraciones', () => {
  assert.equal(c.formatoMemoria(512 * 1024), '512 MB');
  assert.equal(c.formatoMemoria(1.45 * 1024 * 1024), '1.4 GB');
  assert.equal(c.formatoMemoria(12 * 1024 * 1024), '12 GB');
  assert.equal(c.formatoMemoria(0), '0 MB');
  assert.equal(c.formatoMs(85.4), '85 ms');
  assert.equal(c.formatoMs(1234), '1.23 s');
  assert.equal(c.formatoMs(12345), '12.3 s');
  assert.equal(c.formatoMs(null), '—');
  assert.equal(c.formatoDuracion(42000), '42 s');
  assert.equal(c.formatoDuracion(45 * 60000), '45 min');
  assert.equal(c.formatoDuracion(3 * 3600000), '3 h');
  assert.equal(c.formatoDuracion(3 * 3600000 + 12 * 60000), '3 h 12 min');
  assert.equal(c.formatoDuracion(26 * 3600000), '1 d 2 h');
  assert.equal(c.formatoDuracion(-5), '0 s');
});

test('mediana', () => {
  assert.equal(c.mediana([3, 1, 2]), 2);
  assert.equal(c.mediana([4, 1, 2, 3]), 2.5);
  assert.equal(c.mediana([]), null);
  assert.equal(c.mediana([NaN, 'x', 5]), 5);
});

// Muestras cada 5 min con la memoria (MB) que se le pase
const serie = (mbs) => mbs.map((mb, i) => ({ t: 1700000000000 + i * 300000, kb: mb * 1024 }));

test('tendencia: con pocas muestras no se dice nada', () => {
  assert.equal(c.tendencia([]).estado, 'pocos');
  assert.equal(c.tendencia(serie([800, 900, 1000])).estado, 'pocos');            // 3 muestras
  assert.equal(c.tendencia(serie([800, 800, 800, 800])).estado, 'pocos');        // 15 min
  assert.equal(c.tendencia(serie([800, 800, 800, 800, 800])).minutos, 20);
});

test('tendencia: estable, sube o baja', () => {
  const plana = c.tendencia(serie([800, 820, 790, 810, 805, 795, 800]));
  assert.equal(plana.estado, 'estable');
  // +50 MB cada 5 min = +600 MB por hora
  const sube = c.tendencia(serie([800, 850, 900, 950, 1000, 1050]));
  assert.equal(sube.estado, 'sube');
  assert.equal(sube.mbPorHora, 600);
  assert.equal(c.tendencia(serie([1200, 1150, 1100, 1050, 1000])).estado, 'baja');
  // Con mucha memoria, 5 % por hora no es una fuga: 4 GB que suben 100 MB/h
  const grande = c.tendencia(serie([4096, 4104, 4112, 4120, 4128, 4137, 4145]));
  assert.equal(grande.estado, 'estable');
  // Un salto puntual (abrir una pestaña pesada y cerrarla) no hace subir la recta
  assert.equal(c.tendencia(serie([800, 800, 1400, 800, 800, 800, 800, 800])).estado, 'estable');
});

test('renderizado: fotogramas por segundo, frecuencia de la pantalla y fotogramas lentos', () => {
  const a60 = Array(300).fill(16.7);
  a60[10] = 50; a60[20] = 33.4; a60[30] = 20;   // 20 ms no es lento: no llega a saltarse un refresco
  const r = c.resumenFotogramas(a60);
  assert.equal(r.refrescoHz, 60);
  assert.equal(r.fotogramas, 300);
  assert.equal(r.lentos, 2);
  assert.equal(r.pctLentos, 0.7);
  assert.equal(r.peorMs, 50);
  assert.ok(r.fps > 59 && r.fps < 60, String(r.fps));
  const a144 = Array(700).fill(1000 / 144);
  assert.equal(c.resumenFotogramas(a144).refrescoHz, 144);
  assert.equal(c.resumenFotogramas(a144).lentos, 0);
  assert.equal(c.resumenFotogramas([16, 16]), null);    // muy pocos para decir nada
  assert.equal(c.resumenFotogramas(null), null);
});

test('carga de páginas: mediana por página y media de todas', () => {
  const r = c.resumenCarga([
    { pagina: 'A', total: 100, respuesta: 5, dom: 60 }, { pagina: 'A', total: 300, respuesta: 9, dom: 80 }, { pagina: 'A', total: 110, respuesta: 6, dom: 70 },
    { pagina: 'B', total: 50, respuesta: 2, dom: 30 }, { pagina: 'B', total: 70, respuesta: 4, dom: 40 }
  ]);
  assert.deepEqual(r.paginas, [
    { pagina: 'A', veces: 3, total: 110, respuesta: 6, dom: 70 },
    { pagina: 'B', veces: 2, total: 60, respuesta: 3, dom: 35 }
  ]);
  assert.equal(r.media, 85);
  assert.deepEqual(c.resumenCarga([]), { paginas: [], media: null });
});

test('nombre de Windows a partir de os.release()', () => {
  assert.equal(c.nombreWindows('10.0.26200'), 'Windows 11 (compilación 26200)');
  assert.equal(c.nombreWindows('10.0.19045'), 'Windows 10 (compilación 19045)');
  assert.equal(c.nombreWindows(''), 'Windows');
});

test('«Copiar resultados»: texto legible con el equipo y, al final, el JSON', () => {
  const datos = {
    fecha: 1700000000000,
    equipo: { naviris: '3.0.0', chromium: '142.0.0.0', electron: '45.2.1', windows: 'Windows 11 (compilación 26200)', cpu: 'AMD Ryzen 7 7800X3D', nucleos: 16, ramKb: 32 * 1024 * 1024 },
    vivo: { memoriaKb: 900 * 1024, cpu: 1.5, procesos: 9, pestanas: 5, dormidas: 1, activoMs: 3600000 },
    resultados: {
      arranque: { listo: 300, interfaz: 800, visible: 1400 },
      memoria: { totalKb: 1024 * 1024, procesos: 9, pestanas: 5, dormidas: 1, grupos: [{ nombre: 'Gráficos', kb: 200 * 1024, procesos: 1 }] },
      carga: { paginas: [{ pagina: 'Artículo largo', total: 90 }], media: 90 },
      render: { fps: 143.8, refrescoHz: 144, lentos: 3, fotogramas: 719, pctLentos: 0.4, peorMs: 25 }
    },
    tendencia: { estado: 'estable', mbPorHora: 4, minutos: 60 }
  };
  const t = c.textoResultados(datos);
  for (const trozo of ['Naviris 3.0.0 · Chromium 142.0.0.0', 'Windows 11 (compilación 26200)', 'AMD Ryzen 7 7800X3D (16 núcleos lógicos)', 'Memoria del equipo: 32 GB',
    'Memoria de Naviris: 900 MB en 9 procesos', 'Interfaz lista: 800 ms', 'Ventana visible: 1.40 s', 'Gráficos: 200 MB', 'Artículo largo: 90 ms',
    '143.8 fotogramas por segundo (pantalla de 144 Hz)', 'Estable (+4 MB por hora en 60 min)']) {
    assert.ok(t.includes(trozo), trozo);
  }
  const json = JSON.parse(t.slice(t.lastIndexOf('\n') + 1));
  assert.equal(json.equipo.naviris, '3.0.0');
  assert.equal(json.resultados.render.fps, 143.8);
  // Sin pruebas hechas también sale algo útil
  const vacio = c.textoResultados({ equipo: {}, resultados: {} });
  assert.match(vacio, /Centro de rendimiento/);
  assert.doesNotMatch(vacio, /Arranque|Renderizado/);
});

test('páginas de prueba: siempre las mismas, y nada fuera de la lista', () => {
  for (const p of c.PAGINAS_CARGA) {
    const r = c.paginaDePrueba(p.ruta + '?vuelta=2');
    assert.match(r.tipo, /^text\/html/, p.ruta);
    assert.equal(r.cuerpo, c.paginaDePrueba(p.ruta).cuerpo, 'determinista');
  }
  assert.ok(c.paginaDePrueba('/texto').cuerpo.length > 50000, 'el artículo es largo');
  assert.equal((c.paginaDePrueba('/imagenes').cuerpo.match(/<img /g) || []).length, 48);
  assert.equal(c.paginaDePrueba('/img/47.svg').tipo, 'image/svg+xml');
  assert.equal((c.paginaDePrueba('/scripts').cuerpo.match(/<script src=/g) || []).length, 12);
  assert.match(c.paginaDePrueba('/js/11.js').tipo, /javascript/);
  assert.match(c.paginaDePrueba('/animacion').cuerpo, /window\.__mide=/);
  for (const mala of ['/img/48.svg', '/js/12.js', '/../main.js', '/', '/texto/', 'http://evil/', '', undefined]) assert.equal(c.paginaDePrueba(mala), null, String(mala));
});

test('las páginas de prueba no piden nada fuera de 127.0.0.1', () => {
  for (const ruta of ['/vacia', '/texto', '/imagenes', '/scripts', '/animacion', '/js/0.js']) {
    assert.doesNotMatch(c.paginaDePrueba(ruta).cuerpo, /(https?:)?\/\/(?!www\.w3\.org\/2000\/svg)/, ruta);
  }
});

test('la interfaz carga el módulo y el centro abre desde el menú', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.ok(html.indexOf('<script src="centro-rendimiento.js">') < html.indexOf('<script src="renderer/nucleo.js"'));
  assert.match(html, /<button data-action="centro">Centro de rendimiento<\/button>/);
  const menu = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'menu-principal.js'), 'utf8');
  assert.match(menu, /if \(a === 'centro'\) abreCentro\(\);/);
});

test('el centro no deja temporizadores vivos al cerrarse', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'centro.js'), 'utf8');
  const cierra = js.slice(js.indexOf('function cierraCentro('), js.indexOf('crEls.cerrar.addEventListener'));
  assert.match(cierra, /paraVivo\(\);/);
  assert.match(cierra, /cancelaPrueba\(\);/);
  assert.equal((js.match(/setInterval\(/g) || []).length, 1, 'un único intervalo, el de «Ahora»');
  assert.match(js, /function paraVivo\(\) \{ clearInterval\(crTimer\); crTimer = null; \}/);
  // Y lo cierran las demás páginas y el cambio de pestaña
  for (const f of ['pestanas.js', 'marcadores.js', 'addons.js', 'descargas.js', 'barra-direcciones.js', 'actualizaciones.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', f), 'utf8'), /cierraCentro\(true\)/, f);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'atajos-teclado.js'), 'utf8'), /if \(cierraCentro\(\)\) return;/);
});
