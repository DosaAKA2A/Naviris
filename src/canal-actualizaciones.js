/* A qué línea de actualizaciones escucha una instalación (lo aplica main.js en
   el autoUpdater). Las versiones con sufijo "-dev" (p. ej. 2.6.0-dev.1) siguen
   su PROPIO canal (dev.yml) y solo reciben otras dev; la estable (sin sufijo)
   sigue el canal por defecto (latest.yml). El ajuste "Actualizaciones dev"
   (devUpdates) deja que cualquier instalación se apunte al canal dev, o que una
   -dev vuelva a la estable, lo que exige permitir el "downgrade"
   (2.6.0-dev.1 → 2.5.10). test/actualizador.test.js lo pasa por el
   electron-updater de verdad contra una lista de releases simulada. */
const esDev = (version) => /-dev/i.test(String(version));
// El feed en el que se publica cada versión (y junto al que va su firma, ver firmas.js).
const feedDe = (version) => (esDev(version) ? 'dev.yml' : 'latest.yml');

function canalDeActualizacion(version, devUpdates) {
  const dev = esDev(version);
  const quiereDev = typeof devUpdates === 'boolean' ? devUpdates : dev;
  return { channel: quiereDev ? 'dev' : 'latest', allowPrerelease: quiereDev, allowDowngrade: !quiereDev && dev };
}

module.exports = { esDev, feedDe, canalDeActualizacion };
