/* A qué línea de actualizaciones escucha una instalación (lo aplica main.js en
   el autoUpdater). Las versiones con sufijo "-dev" (p. ej. 2.6.0-dev.1) siguen
   su PROPIO canal (dev.yml) y solo reciben otras dev; la estable (sin sufijo)
   sigue el canal por defecto (latest.yml). El ajuste "Actualizaciones dev"
   (devUpdates) deja que cualquier instalación se apunte al canal dev, o que una
   -dev vuelva a la estable, lo que exige permitir el "downgrade"
   (2.6.0-dev.1 → 2.5.10). test/actualizador.test.js lo pasa por el
   electron-updater de verdad contra una lista de releases simulada. */
function canalDeActualizacion(version, devUpdates) {
  const esDev = /-dev/i.test(String(version));
  const quiereDev = typeof devUpdates === 'boolean' ? devUpdates : esDev;
  return { channel: quiereDev ? 'dev' : 'latest', allowPrerelease: quiereDev, allowDowngrade: !quiereDev && esDev };
}

module.exports = { canalDeActualizacion };
