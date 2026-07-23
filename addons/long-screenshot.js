/* Naviris addon: Captura larga v1.1.0
   Herramienta del sidebar: el usuario elige cuánto capturar (lo visible,
   2 o 4 pantallas, la página completa o un número a medida) y el addon
   hace scroll, captura cada tramo y lo une en un solo PNG. */
(function () {
  let pop = null;

  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', onAway, true); } }
  function onAway(e) { if (pop && !pop.contains(e.target)) closePop(); }

  function showChooser(btn) {
    closePop();
    const r = btn.getBoundingClientRect();
    pop = document.createElement('div');
    pop.style.cssText = 'position:fixed;left:' + Math.round(r.right + 10) + 'px;top:' + Math.round(Math.min(r.top, innerHeight - 240)) + 'px;' +
      'z-index:99999;background:#17171b;border:1px solid #2c2c32;border-radius:12px;padding:10px;width:210px;' +
      'box-shadow:0 16px 44px rgba(0,0,0,.6);font-size:12.5px;color:#ececef;';
    pop.innerHTML = '<div style="font-weight:600;margin:2px 4px 8px">¿Cuánto capturar?</div>';
    const mk = (label, segs) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;margin:2px 0;border:none;background:none;color:#ececef;border-radius:8px;cursor:pointer;font-size:12.5px;';
      b.addEventListener('mouseenter', () => { b.style.background = 'rgba(255,255,255,.07)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
      b.addEventListener('click', () => { closePop(); capture(btn, segs); });
      pop.appendChild(b);
      return b;
    };
    mk('Solo lo visible', 1);
    mk('2 pantallas', 2);
    mk('4 pantallas', 4);
    mk('Toda la página', Infinity);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:6px 4px 2px;';
    row.innerHTML = '<span style="color:#8b8d94">A medida:</span>';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '1'; inp.max = '40'; inp.placeholder = 'nº';
    inp.style.cssText = 'width:52px;background:#101014;border:1px solid #2c2c32;border-radius:7px;color:#ececef;padding:5px 7px;font-size:12px;';
    const go = document.createElement('button');
    go.textContent = 'Capturar';
    go.style.cssText = 'flex:1;padding:6px 8px;border:1px solid #2c2c32;background:rgba(255,255,255,.06);color:#ececef;border-radius:7px;cursor:pointer;font-size:12px;';
    go.addEventListener('click', () => { const n = Math.max(1, Math.min(40, +inp.value || 1)); closePop(); capture(btn, n); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    row.append(inp, go);
    pop.appendChild(row);
    document.body.appendChild(pop);
    document.addEventListener('mousedown', onAway, true);
    inp.focus();
  }

  async function capture(btn, maxScreens) {
    const wv = naviris.activeWebview();
    if (!wv) { naviris.toast('Abre una página web para capturarla'); return; }
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    naviris.toast(maxScreens === 1 ? 'Capturando lo visible…' : 'Capturando ' + (maxScreens === Infinity ? 'toda la página' : maxScreens + ' pantallas') + '…');
    try {
      const m = await wv.executeJavaScript(`(() => ({
        w: document.documentElement.clientWidth,
        h: document.documentElement.clientHeight,
        total: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
        y0: window.scrollY,
        dpr: window.devicePixelRatio || 1
      }))()`);
      // Límite pedido por el usuario (pantallas) + límite duro del canvas
      let total = Math.min(m.total, Math.floor(30000 / (m.dpr || 1)));
      if (maxScreens !== Infinity) total = Math.min(total, m.h * maxScreens);

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

      const startY = maxScreens === 1 ? m.y0 : 0; // "solo lo visible" captura donde estás
      const shots = [];
      let y = startY;
      while (y < startY + total) {
        if (maxScreens !== 1) await wv.executeJavaScript(`window.scrollTo({top: ${y}, behavior: 'instant'})`);
        if (shots.length > 0) await wv.executeJavaScript(HIDE_FIXED);
        if (maxScreens !== 1) await new Promise((r) => setTimeout(r, 400));
        const realY = await wv.executeJavaScript('window.scrollY');
        const img = await wv.capturePage();
        shots.push({ img, y: realY - startY });
        if (maxScreens === 1) break;
        if (realY + m.h >= Math.min(startY + total, m.total) - 1) break;
        if (shots.length > 1 && realY <= shots[shots.length - 2].y + startY) break;
        y += m.h;
      }
      if (maxScreens !== 1) {
        await wv.executeJavaScript(UNDO);
        await wv.executeJavaScript(`window.scrollTo({top: ${m.y0}, behavior: 'instant'})`);
      }

      const first = shots[0].img.getSize();
      const scale = first.width / m.w;
      const lastBottom = shots[shots.length - 1].y + m.h;
      const canvas = document.createElement('canvas');
      canvas.width = first.width;
      canvas.height = Math.min(Math.round(Math.min(total, lastBottom) * scale), 32000);
      const ctx = canvas.getContext('2d');
      for (const s of shots) {
        const blob = await (await fetch(s.img.toDataURL())).blob();
        const bmp = await createImageBitmap(blob);
        ctx.drawImage(bmp, 0, Math.round(s.y * scale));
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const r = await naviris.savePng(canvas.toDataURL('image/png'), 'captura-' + stamp + '.png');
      naviris.toast(r.ok ? 'Captura guardada (' + shots.length + ' tramo' + (shots.length === 1 ? '' : 's') + ')' : (r.canceled ? 'Captura cancelada' : 'Error al guardar: ' + (r.message || '')));
    } catch (e) {
      naviris.toast('No se pudo capturar: ' + (e && e.message || e));
    } finally {
      btn.classList.remove('busy');
    }
  }

  naviris.registerTool({
    id: 'long-screenshot',
    label: 'Captura de página — elige cuánto fotografiar',
    icon: 'camera',
    onClick: (btn) => showChooser(btn)
  });
})();
