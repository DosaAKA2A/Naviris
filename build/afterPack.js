// Poda del paquete (2026-08-13, petición de Dosa: "aplica todas las
// optimizaciones posibles"). Electron trae binarios que Naviris no usa y que
// pesan mucho en disco. Se borran DESPUÉS de empaquetar, antes de firmar.
//
// LO QUE SE VA Y LO QUE CUESTA, para que quede escrito:
//  · dxcompiler.dll + dxil.dll (~27 MB) — compilador de shaders de D3D12. Es
//    lo que usa WebGPU. Sin ellos, una web con WebGPU no arranca su contexto
//    (cae a WebGL, que es lo que usa el 99% de lo que se navega).
//  · vk_swiftshader.dll + libvulkan / libEGL de respaldo (~7 MB) — render por
//    software cuando NO hay GPU utilizable. En un equipo con GPU no se toca
//    jamás; en uno sin ella, Chromium ya tiene su propio camino de respaldo.
// NO se toca LICENSES.chromium.html: distribuir las licencias es obligación
// legal, y 20 MB no valen ese problema.
const fs = require('fs');
const path = require('path');

const FUERA = ['dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll'];

exports.default = async function (context) {
  const dir = context.appOutDir;
  let total = 0;
  for (const nombre of FUERA) {
    const f = path.join(dir, nombre);
    try {
      const kb = fs.statSync(f).size;
      fs.unlinkSync(f);
      total += kb;
      console.log(`  poda: fuera ${nombre} (${(kb / 1048576).toFixed(1)} MB)`);
    } catch { /* no estaba: nada que podar */ }
  }
  if (total) console.log(`  poda: ${(total / 1048576).toFixed(1)} MB menos en el instalado`);
};
