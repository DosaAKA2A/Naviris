// Fuses del instalable (auditoría #4, parte «endurece»): sin RunAsNode, sin
// NODE_OPTIONS, sin --inspect, la app solo desde app.asar y con su integridad
// comprobada. Mira tres cosas: que package.json las pide con los nombres que
// entiende electron-builder (si uno está mal escrito se ignora sin avisar), que
// el orden del empaquetado deja la firma VMP para el final y que el código no
// necesita ninguna de las puertas que se cierran.
// Se ejecuta con: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
const FUSES = PKG.build.electronFuses;

test('package.json pide las siete fuses', () => {
  assert.deepEqual(FUSES, {
    grantFileProtocolExtraPrivileges: false,
    enableCookieEncryption: true,
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true
  });
});

test('electron-builder traduce cada una a su fuse de Electron', async () => {
  const { PlatformPackager } = require('app-builder-lib');
  const { FuseV1Options } = require('@electron/fuses');
  const config = await PlatformPackager.prototype.generateFuseConfig.call({}, FUSES);
  assert.equal(config[FuseV1Options.RunAsNode], false);
  assert.equal(config[FuseV1Options.EnableNodeOptionsEnvironmentVariable], false);
  assert.equal(config[FuseV1Options.EnableNodeCliInspectArguments], false);
  assert.equal(config[FuseV1Options.OnlyLoadAppFromAsar], true);
  assert.equal(config[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true);
  assert.equal(config[FuseV1Options.GrantFileProtocolExtraPrivileges], false);
  assert.equal(config[FuseV1Options.EnableCookieEncryption], true);
});

test('orden del empaquetado: asar e integridad, afterPack, fuses, Authenticode y la firma VMP al final', () => {
  // El asar va empaquetado (sin él no hay integridad que comprobar ni OnlyLoadAppFromAsar que valga).
  assert.notEqual(PKG.build.asar, false);
  assert.equal(PKG.build.afterSign, 'build/evs-sign.js');
  assert.equal(PKG.build.afterPack, 'build/afterPack.js');
  // electron-builder: la huella del asar se mete en el exe antes de afterPack, las
  // fuses se ponen después de afterPack y justo antes de firmar, y afterSign va
  // detrás de la firma. Si una versión nueva cambia ese orden, esto avisa.
  const pp = fs.readFileSync(require.resolve('app-builder-lib/out/platformPackager.js'), 'utf8');
  const i = (s) => { const n = pp.indexOf(s); assert.ok(n >= 0, 'no está: ' + s); return n; };
  assert.ok(i('asarIntegrity = await') < i('await this.info.emitAfterPack(packContext)'));
  assert.ok(i('await this.info.emitAfterPack(packContext)') < i('await this.doAddElectronFuses(packContext)'));
  assert.ok(i('await this.doAddElectronFuses(packContext)') < i('await this.doSignAfterPack('));
  assert.ok(i('await this.signApp(packContext, isAsar)') < i('await this.info.emitAfterSign(packContext)'));
  // afterPack solo borra DLL sueltas: no toca el exe, ni app.asar, ni nada de resources/.
  const poda = fs.readFileSync(path.join(RAIZ, 'build', 'afterPack.js'), 'utf8');
  const fuera = JSON.parse(/const FUERA = (\[[^\]]*\])/.exec(poda)[1].replace(/'/g, '"'));
  assert.ok(fuera.length && fuera.every((f) => /^[\w-]+\.dll$/i.test(f)), JSON.stringify(fuera));
  assert.doesNotMatch(poda, /asar|resources|\.exe/i);
  // La firma VMP es lo último y solo firma y verifica (no reescribe el paquete).
  const evs = fs.readFileSync(path.join(RAIZ, 'build', 'evs-sign.js'), 'utf8');
  assert.match(evs, /'sign-pkg', appOutDir/);
  assert.match(evs, /'verify-pkg', appOutDir/);
});

test('el código no necesita RunAsNode, NODE_OPTIONS ni el inspector', () => {
  const archivos = [];
  const recorre = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) recorre(f);
      else if (f.endsWith('.js')) archivos.push(f);
    }
  };
  recorre(path.join(RAIZ, 'src'));
  for (const f of archivos) {
    const t = fs.readFileSync(f, 'utf8');
    const rel = path.relative(RAIZ, f);
    assert.doesNotMatch(t, /ELECTRON_RUN_AS_NODE|NODE_OPTIONS|utilityProcess|\.fork\(|--inspect/, rel);
    // Nada lanza el propio ejecutable de Naviris como si fuera node.
    assert.doesNotMatch(t, /(spawn|execFile|exec)\w*\(\s*process\.execPath/, rel);
  }
  // Los hilos del bloqueador son worker_threads: van dentro del proceso y leen del asar.
  assert.match(fs.readFileSync(path.join(RAIZ, 'src', 'adblock.js'), 'utf8'), /require\('worker_threads'\)/);
});
