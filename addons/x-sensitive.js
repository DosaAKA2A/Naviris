/* Sensibilidad X — addon de Naviris (kind: tool)
   Muestra el contenido marcado como sensible en X/Twitter sin el aviso de
   "este contenido puede ser delicado": al activarlo, Naviris pulsa por ti el
   "Mostrar" de cada publicación tapada. Un clic en el botón del sidebar lo
   enciende o apaga; azul encendido = activo. El interruptor de siempre dentro
   del Rat Tool sigue existiendo y ambos mueven el mismo ajuste. */
(function () {
  const ID = 'x-sensitive';
  const AZUL = '#1d9bf0'; // azul de X: se ve de un vistazo que el modo está activo

  function pinta(btn, activo) {
    if (!btn) return;
    btn.style.color = activo ? AZUL : '';
    btn.style.filter = activo ? 'drop-shadow(0 0 5px rgba(29,155,240,.75))' : '';
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
