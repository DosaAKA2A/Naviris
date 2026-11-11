/* ===== DESCARGAS QUE UNA WEB HACE SOLA (auditoría #8, 2026-11-11) =====
   Hasta ahora una web podía bajar cualquier archivo a Descargas sin que la
   persona tocara nada: un .hta, un .exe o un .js nada más cargar la página
   (medido en la auditoría), y cuantos quisiera. Ahora, como Chrome:
   · Tipos que pueden dañar el equipo (programas, scripts, accesos directos,
     instaladores, imágenes de disco…) bajados SIN gesto de la persona: no se
     guardan solos. Bajan a una carpeta aparte del perfil y la interfaz
     pregunta si conservarlos o descartarlos; solo al conservar pasan a
     Descargas. Lo que la persona inicia (un clic en el enlace, «Guardar el
     destino como…», «Reintentar») sigue igual.
   · Varias descargas seguidas sin gesto: la primera de la página vale; para
     las siguientes el sitio necesita el permiso «descargar varios archivos»,
     que se pregunta en la barra de permisos y se puede recordar. Mientras se
     decide, esas descargas esperan en pausa. Un gesto en la página vuelve a
     dar una descarga libre (el limitador de Chrome hace lo mismo).
   El gesto lo da Chromium (DownloadItem.hasUserGesture): la página no lo puede
   fingir. Va aparte de main.js para poder probarlo sin Electron
   (test/descargas-seguras.test.js). */
'use strict';

/* Los de Windows que Chrome trata como peligrosos sin gesto (ALLOW_ON_USER_GESTURE
   o DANGEROUS en su download_file_types): ejecutables, scripts, instaladores,
   paquetes de apps, accesos directos, ayuda compilada, consolas, macros de
   Office y contenedores que Windows monta y abren sin la marca de la web. */
const PELIGROSAS = new Set(`
  ad ade adp ah air app appinstaller application appref-ms appx appxbundle asp asx bas bat cab chi chm cmd com cpl crt csh
  der diagcab dll drv exe fxp gadget grp hlp hta htt img inf ins iso isp jar jnlp js jse ksh library-ms lnk local
  mad maf mag mam manifest maq mar mas mat mau mav maw mda mdb mde mdt mdw mdz mht mhtml mmc mof msc msh msh1 msh1xml
  msh2 msh2xml mshxml msi msix msixbundle msp mst ocx ops pcd pif pl plg prf prg ps1 ps1xml ps2 ps2xml psc1 psc2 pst
  py pyc pyo pyw rb reg rgs scf scr sct search-ms settingcontent-ms shb shs sys u3p url vb vbe vbs vhd vhdx vsmacros
  vss vst vsw website ws wsc wsf wsh xbap xnk
`.trim().split(/\s+/));

// La extensión como la ve Windows: sin los puntos ni espacios del final ("x.exe. " es un .exe).
function extension(nombre) {
  const limpio = String(nombre || '').replace(/[.\s]+$/, '');
  const i = limpio.lastIndexOf('.');
  return i > 0 ? limpio.slice(i + 1).toLowerCase() : '';
}
const esPeligrosa = (nombre) => PELIGROSAS.has(extension(nombre));

const PERMISO = 'automatic-downloads';
const clavePermiso = (origen) => origen + '|' + PERMISO;

/* Cuántas descargas lleva cada pestaña (o ventanita) desde el último gesto, por
   sitio: al cambiar de sitio empieza de cero. `cuenta` apunta una y dice si esa
   necesita el permiso (la segunda y siguientes sin gesto). */
function creaLimitador() {
  const porContenido = new Map();   // id del webContents -> { origen, previas }
  return {
    cuenta(id, origen, gesto) {
      let e = porContenido.get(id);
      if (!e || e.origen !== origen) e = { origen, previas: 0 };
      const pide = !gesto && e.previas >= 1;
      e.previas = gesto ? 1 : e.previas + 1;
      porContenido.set(id, e);
      return pide;
    }
  };
}

module.exports = { esPeligrosa, extension, creaLimitador, clavePermiso, PERMISO, PELIGROSAS };
