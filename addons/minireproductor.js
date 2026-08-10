/* Minireproductor — addon de Naviris (kind: tool)
   Saca el video de la pestaña activa a la ventanita flotante del sistema
   (picture-in-picture), que queda por encima de cualquier aplicación; otro
   clic lo devuelve a la página. Elige el video que se ve más grande, igual
   que la extensión Picture-in-Picture de Chrome. El segundo argumento de
   executeJavaScript es el gesto de usuario: sin él Chromium rechaza la
   llamada con NotAllowedError. */
(function () {
  const ID = 'minireproductor';
  const ROSA = 'var(--accent)'; // acento del tema: el botón encendido se ve al tono de la interfaz

  const PIP_JS = `(() => {
    const v = Array.from(document.querySelectorAll('video'))
      .filter((x) => x.readyState !== 0 && !x.disablePictureInPicture)
      .sort((a, b) => {
        const ra = a.getClientRects()[0] || { width: 0, height: 0 };
        const rb = b.getClientRects()[0] || { width: 0, height: 0 };
        return (rb.width * rb.height) - (ra.width * ra.height);
      })[0];
    if (document.pictureInPictureElement) { document.exitPictureInPicture(); return 'salido'; }
    if (!v) return 'sin-video';
    return v.requestPictureInPicture().then(() => 'ok').catch((e) => 'error:' + e.message);
  })()`;

  function pinta(btn, activo) {
    if (!btn) return;
    btn.style.color = activo ? ROSA : '';
    btn.title = activo
      ? 'Minireproductor: ACTIVO — el video está en la ventanita flotante. Clic para devolverlo a la página.'
      : 'Minireproductor: saca el video de la pestaña a una ventanita que queda por encima de todo.';
  }

  naviris.registerTool({
    id: ID,
    label: 'Minireproductor: saca el video de la pestaña a una ventanita que queda por encima de todo',
    icon: 'pip',
    onClick: async (btn) => {
      const wv = naviris.activeWebview();
      if (!wv) { naviris.toast('Abre primero una página con video'); return; }
      try {
        const r = await wv.executeJavaScript(PIP_JS, true);
        if (r === 'sin-video') naviris.toast('No hay ningún video en esta página');
        else if (String(r).startsWith('error:')) naviris.toast('Esta página no deja usar el minireproductor');
        else if (r === 'ok') naviris.toast('Video en el minireproductor');
        if (r === 'ok' || r === 'salido') pinta(btn, r === 'ok');
      } catch { naviris.toast('No se pudo abrir el minireproductor'); }
    }
  });

  /* El video también sale de la ventanita por su cuenta (la X de la propia
     ventanita, cambiar de página, cerrar la pestaña): refresco perezoso del
     color, que además se auto-limpia si quitan el addon (botón fuera del DOM). */
  const timer = setInterval(async () => {
    const btn = document.getElementById('adt-' + ID);
    if (!btn) { clearInterval(timer); return; }
    if (!btn.style.color) return; // apagado: nada que comprobar, no se molesta a la página
    const wv = naviris.activeWebview();
    if (!wv) { pinta(btn, false); return; }
    try { pinta(btn, !!(await wv.executeJavaScript('!!document.pictureInPictureElement'))); }
    catch { pinta(btn, false); }
  }, 4000);
})();
