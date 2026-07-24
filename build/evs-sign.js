/* electron-builder afterSign: firma VMP de Widevine con castlabs EVS.
   DEBE ir en afterSign (NO afterPack): el Authenticode (signtool) de electron-builder
   modifica Naviris.exe y invalidaria una firma VMP hecha antes. VMP debe ser lo ULTIMO
   que toca el exe. Un instalable sin esta firma NO reproduce DRM (Crunchyroll da KAT-6005).
   Requiere, en la máquina que hace el build: Python + `pip install castlabs-evs`
   y una sesión EVS ya autenticada (los tokens quedan cacheados tras el signup/reauth).
   La firma es LOCAL: no se exponen credenciales en CI.

   Resuelve el intérprete de Python en este orden:
     1) variable de entorno EVS_PYTHON (ruta a python.exe)
     2) `python` en el PATH
     3) rutas típicas de instalación por usuario en Windows
*/
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolvePython() {
  if (process.env.EVS_PYTHON && fs.existsSync(process.env.EVS_PYTHON)) return process.env.EVS_PYTHON;
  const candidates = ['python', 'python3'];
  const home = process.env.LOCALAPPDATA || '';
  if (home) {
    const base = path.join(home, 'Programs', 'Python');
    try {
      for (const d of fs.readdirSync(base)) {
        const p = path.join(base, d, 'python.exe');
        if (fs.existsSync(p)) candidates.push(p);
      }
    } catch (e) { /* sin instalaciones por usuario */ }
  }
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; }
    catch (e) { /* siguiente */ }
  }
  return null;
}

exports.default = async function (context) {
  // Solo Windows (Widevine/EVS aquí es para el instalable de escritorio).
  if (context.electronPlatformName !== 'win32') return;
  // En CI no hay credenciales EVS: se OMITE la firma para no romper el build.
  // OJO: ese instalable de CI NO reproduce DRM. La release con DRM se compila y
  // firma en LOCAL (npm run dist / release en una máquina con la sesión EVS).
  if (process.env.GITHUB_ACTIONS || process.env.EVS_SKIP) {
    console.warn('[EVS] CI/EVS_SKIP detectado: se OMITE la firma VMP. Este instalable NO reproducirá DRM (Crunchyroll/Netflix). Compila y firma en local para el release con DRM.');
    return;
  }
  const appOutDir = context.appOutDir;
  const python = resolvePython();
  if (!python) {
    throw new Error('[EVS] No se encontró Python. Instala Python + `pip install castlabs-evs` ' +
      'y autentícate (castlabs_evs.account), o define EVS_PYTHON. Sin firma VMP el instalable no reproduce DRM.');
  }
  console.log('[EVS] Firmando VMP (Widevine) con', python, 'en', appOutDir);
  try {
    execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', appOutDir], { stdio: 'inherit' });
    execFileSync(python, ['-m', 'castlabs_evs.vmp', 'verify-pkg', appOutDir], { stdio: 'inherit' });
  } catch (e) {
    throw new Error('[EVS] Falló la firma/verificación VMP: ' + (e && e.message) +
      '. ¿Sesión EVS autenticada? (python -m castlabs_evs.account reauth)');
  }
  console.log('[EVS] Firma VMP correcta.');
};
