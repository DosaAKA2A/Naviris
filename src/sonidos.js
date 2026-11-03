/* Identidad sonora de Naviris (2026-11-03).

   Cuatro sonidos y ninguno más, cada uno en un momento que el usuario NO ve
   venir o que pasa mientras mira otra cosa:
     arranque  al abrir Naviris, sincronizado con la animación del splash
     descarga  una descarga terminó (suele pasar con Naviris en segundo plano)
     error     una descarga falló
     aviso     salta un recordatorio
   Lo que el usuario provoca con un clic (abrir pestaña, copiar, cerrar) NO
   suena: ya sabe lo que acaba de hacer, y un sonido por clic cansa en un día.

   Motivo común: una quinta ascendente en Re (Re -> La). Las tres paletas lo
   dicen con timbres distintos; los audios se sintetizaron desde cero (sin
   samples) y están igualados a la misma sonoridad (-18 LUFS momentánea,
   pico <= -1 dBFS), así que cambiar de paleta no cambia el volumen.

   CAMBIAR DE PALETA = cambiar PALETA. Las tres están en src/sonidos/:
     'aire'     soplo que se abre y acorde abierto (pensada con el splash 'apertura')
     'grafito'  mazo blando de madera               (pensada con 'firma')
     'cristal'  campana de vidrio                   (pensada con 'icono') */
(() => {
  const PALETA = 'aire';
  // Discreto: los archivos están a -18 LUFS y aquí se bajan 6 dB más.
  const VOLUMEN = 0.5;
  // Varias descargas que acaban a la vez suenan una sola vez.
  const ENTRE_IGUALES = 400;
  const ultimo = {};

  /* Reproduce un sonido y devuelve el <audio> (o null si no suena). Quien
     llama decide si los sonidos están activados: este archivo no lee ajustes. */
  window.navSonido = function (nombre) {
    const ahora = Date.now();
    if (ahora - (ultimo[nombre] || 0) < ENTRE_IGUALES) return null;
    ultimo[nombre] = ahora;
    const a = new Audio(`sonidos/${PALETA}/${nombre}.ogg`);
    a.volume = VOLUMEN;
    a.play().catch(() => {});
    return a;
  };
})();
