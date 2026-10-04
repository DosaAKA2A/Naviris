/* Naviris addon: Sound Booster v1.0.0
   Amplifica el volumen de la pestaña activa por encima del 100% (hasta 500%)
   con la Web Audio API (GainNode). Control con deslizador y niveles rápidos.
   UI minimalista monocroma, sin emojis. */
(function () {
  let pop = null;
  let btnRef = null;
  // El nivel de la pestaña activa: cada pestaña lleva el suyo y se lee al abrir
  // el panel (un nivel global guardado enseñaba "300%" en una pestaña al 100%).
  let level = 100;

  // Colores del tema, con el valor de siempre de respaldo: el panel se ve como el
  // resto de Naviris en los temas claros y no mete lila en el monocromo.
  const T = { line2: 'var(--line-2, #2c2c32)', text: 'var(--text, #ececef)', muted: 'var(--muted, #8b8d94)', dim: 'var(--dim, #5c5e64)', realce: 'var(--realce, #b98cff)' };

  // Código que se inyecta en la página: crea un AudioContext con un GainNode y
  // encamina cada <video>/<audio> por él. gain 1 = 100%. createMediaElementSource
  // solo se puede llamar una vez por elemento (por eso el WeakSet).
  // Un medio de OTRO origen sin CORS no se engancha: Chromium lo pasaría a
  // Web Audio en silencio y no tiene vuelta atrás (solo recargando). Si no
  // queda ninguno que amplificar, se devuelve "unsupported" y sale el aviso.
  // Los medios que aparecen después se enganchan al dar play, con un solo
  // listener (antes un observer sobre todo el DOM, para siempre).
  function applyCode(gain) {
    return '(function(){try{' +
      'if(!window.__navBoost){var C=window.AudioContext||window.webkitAudioContext;if(!C)return "unsupported";' +
      'var ctx=new C();var g=ctx.createGain();g.connect(ctx.destination);' +
      'window.__navBoost={ctx:ctx,gain:g,seen:new WeakSet(),n:0,ajeno:false};' +
      'var sirve=function(el){if(el.srcObject)return true;var u=el.currentSrc;if(!u)return false;if(el.crossOrigin!=null||/^(blob|data):/.test(u))return true;' +
      'try{return new URL(u,location.href).origin===location.origin}catch(e){return false}};' +
      'var engancha=function(el){var B=window.__navBoost;if(!el||!/^(VIDEO|AUDIO)$/.test(el.tagName)||B.seen.has(el))return;' +
      'if(!sirve(el)){if(el.currentSrc)B.ajeno=true;return}' +
      'try{var s=B.ctx.createMediaElementSource(el);s.connect(B.gain);B.seen.add(el);B.n++}catch(e){}};' +
      'var hook=function(){document.querySelectorAll("video,audio").forEach(engancha)};' +
      'window.__navBoost.hook=hook;hook();' +
      'document.addEventListener("play",function(e){engancha(e.target)},true);}' +
      'var B=window.__navBoost;B.hook();' +
      'if(B.ctx.state==="suspended"){B.ctx.resume();}' +
      'if(!B.n&&B.ajeno){B.gain.gain.value=1;return "unsupported";}' +
      'B.gain.gain.value=' + (gain / 100) + ';' +
      'return "ok";}catch(e){return "error:"+e.message;}})()';
  }

  async function apply() {
    const wv = naviris.activeWebview();
    if (!wv) { naviris.toast('Abre una página con audio o video'); return; }
    try {
      const r = await wv.executeJavaScript(applyCode(level));
      // Sin nada que amplificar, la pestaña se queda al 100% y el panel lo dice.
      if (r === 'unsupported') { naviris.toast('Esta página no permite amplificar el audio'); level = 100; render(); pintaBoton(); }
    } catch (e) { /* nada */ }
  }

  // Desde el deslizador no se rehace el panel: sustituía el <input> a cada paso
  // y el arrastre (o el foco, con el teclado) se perdía. Se pinta en su sitio.
  function setLevel(v, desdeDeslizador) {
    level = Math.max(100, Math.min(500, Math.round(v)));
    apply();
    if (desdeDeslizador) pintaNivel(); else render();
    pintaBoton();
  }
  function pintaNivel() {
    if (!pop) return;
    const p = pop.querySelector('#nvb-pct');
    if (p) { p.textContent = level + '%'; p.style.color = level > 100 ? T.realce : T.muted; }
    pop.querySelectorAll('[data-nvb]').forEach((b) => {
      const sel = +b.dataset.nvb === level;
      b.style.borderColor = sel ? T.realce : T.line2;
      b.style.background = sel ? 'color-mix(in srgb, ' + T.realce + ' 15%, transparent)' : 'none';
      b.style.color = sel ? T.text : T.muted;
    });
  }
  function pintaBoton() {
    const b = document.getElementById('adt-sound-booster');
    if (b) b.style.color = level > 100 ? T.realce : '';
  }
  async function nivelDeLaPestana() {
    const wv = naviris.activeWebview();
    if (!wv) return 100;
    try {
      const v = await wv.executeJavaScript('window.__navBoost ? Math.round(window.__navBoost.gain.gain.value * 100) : 100');
      return Math.max(100, Math.min(500, Math.round(+v) || 100));
    } catch (e) { return 100; }
  }

  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', onAway, true); } }
  function onAway(e) { if (pop && !pop.contains(e.target) && (!btnRef || !btnRef.contains(e.target))) closePop(); }

  function render() {
    if (!pop) return;
    const quick = [100, 150, 200, 300, 500];
    pop.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin:0 2px 12px">' +
        '<span style="display:inline-flex;width:15px;height:15px;color:' + T.realce + '">' + window.icon('speaker-wave') + '</span>' +
        '<span style="font-size:13px;font-weight:600;color:' + T.text + '">Sound Booster</span>' +
        '<span id="nvb-pct" style="margin-left:auto;font-family:ui-monospace,monospace;font-size:13px;color:' + (level > 100 ? T.realce : T.muted) + '">' + level + '%</span>' +
      '</div>' +
      '<input id="nvb-range" type="range" min="100" max="500" step="10" value="' + level + '" style="width:100%;accent-color:' + T.realce + '">' +
      '<div style="display:flex;gap:6px;margin-top:12px">' +
        quick.map((q) => '<button data-nvb="' + q + '" style="flex:1;padding:6px 0;border:1px solid ' + (q === level ? T.realce : T.line2) + ';border-radius:8px;font-size:11px;cursor:pointer;background:' + (q === level ? 'color-mix(in srgb, ' + T.realce + ' 15%, transparent)' : 'none') + ';color:' + (q === level ? T.text : T.muted) + '">' + q + '%</button>').join('') +
      '</div>' +
      '<div style="font-size:10.5px;color:' + T.dim + ';margin-top:11px;line-height:1.5">Amplifica solo esta pestaña. Algunos sitios con audio protegido pueden no permitirlo.</div>';
    pop.querySelector('#nvb-range').addEventListener('input', (e) => setLevel(+e.target.value, true));
    pop.querySelectorAll('[data-nvb]').forEach((b) => b.addEventListener('click', () => setLevel(+b.dataset.nvb)));
  }

  function openPop(btn) {
    if (pop) { closePop(); return; }
    btnRef = btn;
    const r = btn.getBoundingClientRect();
    pop = document.createElement('div');
    pop.style.cssText = 'position:fixed;left:' + Math.round(r.right + 10) + 'px;top:' + Math.round(Math.min(r.top, innerHeight - 200)) + 'px;' +
      'z-index:99999;background:var(--bg-3, #17171b);border:1px solid ' + T.line2 + ';border-radius:12px;padding:13px;width:250px;' +
      'box-shadow:0 16px 44px var(--shadow-pop, rgba(0,0,0,.55));color:' + T.text + ';';
    document.body.appendChild(pop);
    document.addEventListener('mousedown', onAway, true);
    render();
  }

  naviris.registerTool({
    id: 'sound-booster',
    label: 'Sound Booster — amplifica el volumen de la pestaña',
    icon: 'speaker-wave',
    onClick: async (btn) => {
      if (!pop) { level = await nivelDeLaPestana(); pintaBoton(); }
      openPop(btn);
    }
  });
})();
