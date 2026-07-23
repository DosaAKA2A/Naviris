/* Naviris addon: Captura larga v1.0.0
   Herramienta: captura la página completa haciendo scroll y une los tramos en un PNG. */
(function () {
  naviris.registerTool({
    id: 'long-screenshot',
    label: 'Captura larga de la página',
    icon: 'camera',
    onClick: async (btn) => {
      const wv = naviris.activeWebview();
      if (!wv) { naviris.toast('Abre una página web para capturarla'); return; }
      if (btn.classList.contains('busy')) return;
      btn.classList.add('busy');
      naviris.toast('Capturando página completa…');
      try {
        const m = await wv.executeJavaScript(`(() => ({
          w: document.documentElement.clientWidth,
          h: document.documentElement.clientHeight,
          total: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
          y0: window.scrollY,
          dpr: window.devicePixelRatio || 1
        }))()`);
        // Límite de canvas (~32k px): recorta capturas absurdamente largas
        const total = Math.min(m.total, Math.floor(30000 / (m.dpr || 1)));

        // Los elementos fijos (headers, banners de cookies) se ocultan a partir
        // del segundo tramo para que no se repitan en cada trozo de la imagen.
        const HIDE_FIXED = `(() => {
          if (document.getElementById('__navShotStyle')) return;
          document.querySelectorAll('body *').forEach((el) => {
            const p = getComputedStyle(el).position;
            if (p === 'fixed' || p === 'sticky') el.setAttribute('data-navshot-fix', '');
          });
          const s = document.createElement('style'); s.id = '__navShotStyle';
          s.textContent = '[data-navshot-fix]{visibility:hidden !important}';
          document.documentElement.appendChild(s);
        })()`;
        const UNDO = `(() => {
          const s = document.getElementById('__navShotStyle'); if (s) s.remove();
          document.querySelectorAll('[data-navshot-fix]').forEach((el) => el.removeAttribute('data-navshot-fix'));
        })()`;

        const shots = [];
        let y = 0;
        while (y < total) {
          await wv.executeJavaScript(`window.scrollTo({top: ${y}, behavior: 'instant'})`);
          if (y > 0) await wv.executeJavaScript(HIDE_FIXED);
          await new Promise((r) => setTimeout(r, 400)); // deja cargar el contenido perezoso
          const realY = await wv.executeJavaScript('window.scrollY');
          const img = await wv.capturePage();
          shots.push({ img, y: realY });
          if (realY + m.h >= total - 1) break;
          if (shots.length > 1 && realY <= shots[shots.length - 2].y) break; // la página no avanzó más
          y += m.h;
        }
        await wv.executeJavaScript(UNDO);
        await wv.executeJavaScript(`window.scrollTo({top: ${m.y0}, behavior: 'instant'})`);

        const first = shots[0].img.getSize();
        const scale = first.width / m.w; // píxeles reales (según el zoom/DPI)
        const canvas = document.createElement('canvas');
        canvas.width = first.width;
        canvas.height = Math.min(Math.round(total * scale), 32000);
        const ctx = canvas.getContext('2d');
        for (const s of shots) {
          const blob = await (await fetch(s.img.toDataURL())).blob();
          const bmp = await createImageBitmap(blob);
          ctx.drawImage(bmp, 0, Math.round(s.y * scale));
        }
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const r = await naviris.savePng(canvas.toDataURL('image/png'), 'captura-larga-' + stamp + '.png');
        naviris.toast(r.ok ? 'Captura larga guardada (' + shots.length + ' tramos)' : (r.canceled ? 'Captura cancelada' : 'Error al guardar: ' + (r.message || '')));
      } catch (e) {
        naviris.toast('No se pudo capturar: ' + (e && e.message || e));
      } finally {
        btn.classList.remove('busy');
      }
    }
  });
})();
