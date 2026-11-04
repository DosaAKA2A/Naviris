/* Descargas de los binarios, con lo que faltaba para fiarse de ellas:
   · se escribe en "<destino>.descarga" y solo se renombra al final: antes un
     corte a medias dejaba un yt-dlp.exe truncado que ensureBins daba por bueno
     (existía) y el Rat Tool no volvía a funcionar;
   · si en 60 s no llega nada se aborta (net.request no tiene plazo propio);
   · se comprueba el tamaño y, quien llama, la huella SHA-256 publicada;
   · el archivo se cierra antes de renombrarlo o borrarlo (Windows no deja borrar
     uno abierto), y no poder borrar el temporal (el antivirus lo tiene abierto:
     EBUSY) no lanza nada: esto corre desde un temporizador o un evento de red,
     donde una excepción saca el cuadro de error de Electron y la promesa se
     queda sin terminar, con el Rat Tool colgado hasta reiniciar.
   Va aparte de main.js para poder probarlo sin Electron (test/descarga-binarios.test.js). */
const fs = require('node:fs');

// `pide(url)` es net.request en la app.
function creaDownloadTo(pide, plazoMs = 60000) {
  return function downloadTo(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      const tmp = dest + '.descarga';
      const req = pide(url);
      let plazo = null, acabado = false, file = null;
      const cierra = (err) => {
        if (!err) {
          try { fs.renameSync(tmp, dest); resolve(); return; } catch (e) { err = e; }
        }
        try { fs.rmSync(tmp, { force: true }); } catch (e) { console.warn('[Naviris] No se pudo borrar', tmp, e.message); }
        reject(err);
      };
      const fin = (err) => {
        if (acabado) return; acabado = true; clearTimeout(plazo);
        if (err) { try { req.abort(); } catch { /* ya cerrada */ } }
        if (!file || file.closed) { cierra(err); return; }
        file.once('close', () => cierra(err));
        file.destroy();
      };
      const vigila = () => { clearTimeout(plazo); plazo = setTimeout(() => fin(new Error('la descarga se quedó parada')), plazoMs); };
      vigila();
      req.on('response', (res) => {
        if (res.statusCode !== 200) { fin(new Error('HTTP ' + res.statusCode)); return; }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let got = 0;
        file = fs.createWriteStream(tmp);
        file.on('error', fin);
        res.on('data', (c) => {
          if (acabado) return;
          vigila(); got += c.length; file.write(c);
          if (total && onProgress) onProgress(got / total);
        });
        res.on('end', () => { if (!acabado) file.end(() => fin(total && got !== total ? new Error('descarga incompleta') : null)); });
        res.on('error', fin);
      });
      req.on('error', fin);
      req.end();
    });
  };
}

module.exports = { creaDownloadTo };
