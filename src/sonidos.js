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
  // Casi imperceptible (Dosa, 03/11): los archivos están a -18 LUFS y aquí se bajan unos 26 dB más.
  const VOLUMEN = 0.05;
  // Varias descargas que acaban a la vez suenan una sola vez.
  const ENTRE_IGUALES = 400;
  const ultimo = {};

  /* POR WEB AUDIO, NO CON <audio> (2026-11-17). Un solo <audio> en la interfaz
     ponía en marcha el reproductor multimedia de Chromium y el proceso de la
     GPU se quedaba con ~110 MB más para siempre (medido: 95 MB en reposo sin
     el sonido de arranque, 192 MB con él). Web Audio decodifica el .ogg en la
     propia página y no toca la GPU. El contexto se suspende al acabar cada
     sonido para no tener la salida de audio abierta todo el rato. */
  let ctx = null, sonando = 0;
  const buffers = {};
  const contexto = () => (ctx ||= new AudioContext());
  async function buffer(nombre) {
    if (!buffers[nombre]) {
      buffers[nombre] = fetch(`sonidos/${PALETA}/${nombre}.ogg`)
        .then((r) => r.arrayBuffer()).then((b) => contexto().decodeAudioData(b))
        .catch((e) => { delete buffers[nombre]; throw e; });
    }
    return buffers[nombre];
  }

  /* Reproduce un sonido y devuelve un objeto que avisa con 'playing', 'ended'
     y 'error', como hacía el <audio> (o null si no suena). Quien llama decide
     si los sonidos están activados: este archivo no lee ajustes. */
  window.navSonido = function (nombre) {
    const ahora = Date.now();
    if (ahora - (ultimo[nombre] || 0) < ENTRE_IGUALES) return null;
    ultimo[nombre] = ahora;
    const avisa = new EventTarget();
    const emite = (tipo) => avisa.dispatchEvent(new Event(tipo));
    (async () => {
      try {
        const c = contexto();
        const b = await buffer(nombre);
        if (c.state !== 'running') await c.resume();
        const fuente = c.createBufferSource(); fuente.buffer = b;
        const volumen = c.createGain(); volumen.gain.value = VOLUMEN;
        fuente.connect(volumen).connect(c.destination);
        sonando++;
        fuente.onended = () => {
          if (--sonando === 0) c.suspend().catch(() => {});
          emite('ended');
        };
        fuente.start();
        emite('playing');
      } catch (e) { emite('error'); }
    })();
    return avisa;
  };
})();
