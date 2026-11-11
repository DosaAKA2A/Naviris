// Paso de la sesión vieja (persist:cobalt) a la nueva con muchos archivos, en la app de verdad
// (P2 de la auditoría de seguridad): el splash sale enseguida, antes de que acabe la copia, dice
// «Actualizando tu perfil» mientras dura, el proceso principal sigue respondiendo y la ventana
// arranca ya con la sesión nueva entera. Perfil temporal propio; no toca nada más.
// NAVIRIS_E2E_PUERTO=9423 npm run test:e2e   (o: node --test test/e2e/migracion.e2e.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { conecta, lista, espera, RAIZ, PUERTO } = require('./naviris');

const ARCHIVOS = 20000; // como el caso medido en la auditoría: lo que tarda es el número de archivos
const ahora = () => Number(process.hrtime.bigint() / 1000000n);

test('con una sesión vieja grande el splash avisa y la app arranca con la sesión nueva', { timeout: 180000 }, async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-migra-'));
  const vieja = path.join(perfil, 'Partitions', 'cobalt');
  const nueva = path.join(perfil, 'Partitions', 'naviris');
  const datos = Buffer.alloc(1024, 'n');
  for (let i = 0; i < ARCHIVOS; i++) {
    const f = path.join(vieja, 'File System', String(i % 100), String(i));
    if (i < 100) fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, datos);
  }
  fs.mkdirSync(path.join(vieja, 'Network'), { recursive: true });
  fs.writeFileSync(path.join(vieja, 'Network', 'Cookies'), 'cookies de la sesión vieja');
  fs.mkdirSync(path.join(vieja, 'Cache', 'Cache_Data'), { recursive: true });
  fs.writeFileSync(path.join(vieja, 'Cache', 'Cache_Data', 'data_0'), 'caché');

  const t0 = ahora();
  const app = spawn(require('electron'), ['.', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil.split('\\').join('/')}`], { cwd: RAIZ, stdio: 'ignore' });
  const m = { huecoMaximo: 0 };
  let splash = null;
  try {
    // Mientras arranca: cuándo sale el splash, qué dice, si el proceso principal contesta y cuándo hay interfaz.
    let ultimaRespuesta = null;
    while (ahora() - t0 < 120000) {
      let objetivos = null;
      try { objetivos = await lista(); } catch { /* aún no escucha */ }
      if (objetivos) {
        const t = ahora();
        if (ultimaRespuesta !== null) m.huecoMaximo = Math.max(m.huecoMaximo, t - ultimaRespuesta);
        ultimaRespuesta = t;
        const s = objetivos.find((x) => x.type === 'page' && /splash\.html/.test(x.url));
        if (s && !m.splash) { m.splash = t - t0; m.copiaAcabadaAlSalirElSplash = fs.existsSync(nueva); splash = await conecta(s.webSocketDebuggerUrl); }
        if (splash && !m.texto) {
          const texto = await splash.evalua(`(() => { const e = document.getElementById('etapa'); return e && e.classList.contains('visible') ? e.textContent : ''; })()`).catch(() => '');
          if (texto) { m.texto = texto; m.textoA = t - t0; }
        }
        const ui = objetivos.find((x) => x.type === 'page' && /index\.html/.test(x.url));
        if (ui) { m.interfaz = t - t0; m.urlInterfaz = ui.url; break; }
      }
      await espera(100);
    }
    console.log('medido (ms desde que se lanza):', JSON.stringify(m));

    assert.ok(m.splash, 'el splash no salió');
    assert.equal(m.copiaAcabadaAlSalirElSplash, false, 'el splash salió cuando la copia ya había acabado: se ha esperado sin ventana');
    assert.equal(m.texto, 'Actualizando tu perfil', 'el splash no dijo que se está actualizando el perfil');
    assert.ok(m.interfaz, 'la interfaz no llegó a cargar');
    assert.ok(m.huecoMaximo < 1500, `el proceso principal dejó de contestar ${m.huecoMaximo} ms`);
    assert.doesNotMatch(m.urlInterfaz, /particion=/, 'la interfaz arrancó con la sesión vieja');
    let copiados = 0;
    for (let i = 0; i < 100; i++) copiados += fs.readdirSync(path.join(nueva, 'File System', String(i))).length;
    assert.equal(copiados, ARCHIVOS, 'faltan archivos en la sesión nueva');
    assert.equal(fs.readFileSync(path.join(nueva, 'Network', 'Cookies'), 'utf8'), 'cookies de la sesión vieja');
    assert.equal(fs.existsSync(path.join(nueva, 'Cache', 'Cache_Data', 'data_0')), true, 'la caché no se movió');
    assert.equal(fs.existsSync(path.join(vieja, 'Network', 'Cookies')), true, 'la sesión vieja se queda para la 2.x');
  } finally {
    if (splash) splash.cierra();
    try {
      const v = await (await fetch(`http://127.0.0.1:${PUERTO}/json/version`)).json();
      const b = await conecta(v.webSocketDebuggerUrl);
      b.envia('Browser.close').catch(() => {});
      await espera(1500);
      b.cierra();
    } catch { /* ya cerrada */ }
    if (app.exitCode === null) app.kill();
    await espera(500);
    fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
