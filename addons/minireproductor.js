/* Minireproductor — addon de Naviris (kind: tool)
   Saca el video de la pestaña activa a la ventanita flotante del sistema
   (picture-in-picture), que queda por encima de cualquier aplicación.
   La ventanita es del sistema y no admite controles propios, así que el
   volumen se maneja desde Naviris: con el video flotando, el botón del
   sidebar abre un panel con el deslizador (manda sobre el mismo video,
   aunque cambies de pestaña) y el botón de devolverlo a la página.
   El segundo argumento de executeJavaScript es el gesto de usuario: sin él
   Chromium rechaza la llamada con NotAllowedError. */
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

  // La pestaña dueña del video flotante: el volumen debe llegarle a ELLA
  // aunque el usuario esté mirando otra.
  let wvPip = null;
  let panel = null;

  function pinta(btn, activo) {
    if (!btn) return;
    btn.style.color = activo ? ROSA : '';
    btn.title = activo
      ? 'Minireproductor: ACTIVO — clic para el volumen y devolver el video a la página.'
      : 'Minireproductor: saca el video de la pestaña a una ventanita que queda por encima de todo.';
  }

  function cerrarPanel() { if (panel) { panel.remove(); panel = null; } }

  async function volumenActual() {
    try {
      const v = await wvPip.executeJavaScript('document.pictureInPictureElement ? Math.round(document.pictureInPictureElement.volume * 100) : null');
      return typeof v === 'number' ? v : null;
    } catch { return null; }
  }

  function ponVolumen(pct) {
    // muted a la par: bajar a 0 silencia de verdad y subir lo recupera
    try { wvPip.executeJavaScript(`(() => { const v = document.pictureInPictureElement; if (v) { v.volume = ${pct} / 100; v.muted = ${pct} === 0; } })()`); } catch { /* la pestaña pudo cerrarse */ }
  }

  async function abrirPanel(btn) {
    cerrarPanel();
    const vol = await volumenActual();
    if (vol === null) { pinta(btn, false); naviris.toast('El video ya no está en el minireproductor'); return; }
    const r = btn.getBoundingClientRect();
    panel = document.createElement('div');
    panel.id = 'mrp-panel';
    panel.style.cssText = 'position:fixed;z-index:9999;left:' + Math.round(r.right + 10) + 'px;top:' + Math.round(r.top - 8) + 'px;' +
      'background:var(--bg-3);border:1px solid var(--line-2);border-radius:12px;padding:12px 14px;min-width:210px;' +
      'box-shadow:0 12px 34px var(--shadow-pop);color:var(--text);font-size:12.5px;';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;">' +
        '<span style="font-weight:600;">Minireproductor</span>' +
        '<span id="mrp-pct" style="color:var(--text-dim);">' + vol + '%</span>' +
      '</div>' +
      '<input id="mrp-vol" type="range" min="0" max="100" step="1" value="' + vol + '" style="width:100%;accent-color:var(--accent);display:block;">' +
      '<button id="mrp-back" style="margin-top:11px;width:100%;border:1px solid var(--line-2);background:var(--btn);color:var(--text);' +
        'border-radius:8px;padding:6px 0;cursor:pointer;font-family:inherit;font-size:12.5px;">Devolver a la página</button>';
    document.body.appendChild(panel);
    const slider = panel.querySelector('#mrp-vol');
    const pct = panel.querySelector('#mrp-pct');
    slider.addEventListener('input', () => { pct.textContent = slider.value + '%'; ponVolumen(Number(slider.value)); });
    panel.querySelector('#mrp-back').addEventListener('click', async () => {
      try { await wvPip.executeJavaScript('document.exitPictureInPicture()', true); } catch { /* nada */ }
      cerrarPanel(); wvPip = null; pinta(btn, false);
      naviris.toast('Video devuelto a la página');
    });
    // Se cierra al clicar fuera (como los popovers de Naviris)
    setTimeout(() => {
      const fuera = (e) => { if (panel && !panel.contains(e.target) && e.target !== btn) { cerrarPanel(); document.removeEventListener('mousedown', fuera, true); } };
      document.addEventListener('mousedown', fuera, true);
    }, 0);
  }

  naviris.registerTool({
    id: ID,
    label: 'Minireproductor: saca el video de la pestaña a una ventanita que queda por encima de todo',
    icon: 'pip',
    onClick: async (btn) => {
      // Con el video ya flotando, el botón abre/cierra el panel de volumen
      if (wvPip) {
        if (panel) { cerrarPanel(); return; }
        return abrirPanel(btn);
      }
      const wv = naviris.activeWebview();
      if (!wv) { naviris.toast('Abre primero una página con video'); return; }
      try {
        const r = await wv.executeJavaScript(PIP_JS, true);
        if (r === 'sin-video') naviris.toast('No hay ningún video en esta página');
        else if (String(r).startsWith('error:')) naviris.toast('Esta página no deja usar el minireproductor');
        else if (r === 'ok') { wvPip = wv; pinta(btn, true); abrirPanel(btn); }
      } catch { naviris.toast('No se pudo abrir el minireproductor'); }
    },
    onUnload: () => { cerrarPanel(); wvPip = null; }
  });

  /* El video también sale de la ventanita por su cuenta (la X de la propia
     ventanita, cambiar de página, cerrar la pestaña): refresco perezoso que
     apaga el botón y cierra el panel, y que se auto-limpia si quitan el addon
     (botón fuera del DOM). */
  const timer = setInterval(async () => {
    const btn = document.getElementById('adt-' + ID);
    if (!btn) { clearInterval(timer); cerrarPanel(); return; }
    if (!wvPip) return; // apagado: nada que comprobar, no se molesta a la página
    let sigue = false;
    try { sigue = !!(await wvPip.executeJavaScript('!!document.pictureInPictureElement')); } catch { /* pestaña cerrada */ }
    if (!sigue) { wvPip = null; cerrarPanel(); pinta(btn, false); }
  }, 4000);
})();
