/* Sensibilidad X — addon de Naviris (kind: tool)
   Muestra el contenido marcado como sensible en X/Twitter sin el aviso de
   "este contenido puede ser delicado": al activarlo, Naviris pulsa por ti el
   "Mostrar" de cada publicación tapada. Un clic en el botón del sidebar lo
   enciende o apaga; encendido = en el color del tema (Dosa, 2026-09-09: "debe
   tomar el color del tema, no ser azul"). El interruptor de siempre dentro del
   Rat Tool sigue existiendo y ambos mueven el mismo ajuste. */
(function () {
  const ID = 'x-sensitive';
  // El realce del tema activo: el botón encendido va a juego con Naviris en
  // lugar de meter el azul de X en un riel monocromo.
  const REALCE = 'var(--realce)';

  function pinta(btn, activo) {
    if (!btn) return;
    btn.style.color = activo ? REALCE : '';
    btn.style.filter = '';
    btn.title = activo
      ? 'Sensibilidad X: ACTIVO — el contenido sensible se muestra sin avisos. Clic para restaurar los avisos.'
      : 'Sensibilidad X: ver el contenido sensible de X/Twitter sin el aviso. Clic para activar.';
  }

  naviris.registerTool({
    id: ID,
    label: 'Sensibilidad X: muestra el contenido sensible de X/Twitter sin avisos',
    icon: 'eye',
    onClick: async (btn) => {
      const activo = await naviris.xSensitive.set(!naviris.xSensitive.get());
      pinta(btn, activo);
      naviris.toast(activo ? 'Contenido sensible visible en X' : 'Sensibilidad de X restaurada');
    }
  });

  pinta(document.getElementById('adt-' + ID), naviris.xSensitive.get());

  // El ajuste también puede cambiar desde el Rat Tool: refresco perezoso del
  // color, que además se auto-limpia si quitan el addon (botón fuera del DOM).
  const timer = setInterval(() => {
    const btn = document.getElementById('adt-' + ID);
    if (!btn) { clearInterval(timer); return; }
    pinta(btn, naviris.xSensitive.get());
  }, 3000);
})();
