/* Naviris addon: Sound Booster v1.0.0
   Amplifica el volumen de la pestaña activa por encima del 100% (hasta 500%)
   con la Web Audio API (GainNode). Control con deslizador y niveles rápidos.
   UI minimalista monocroma, sin emojis. */
(function () {
  let pop = null;
  let btnRef = null;
  const KEY = '__navBoostLevel';
  let level = Math.max(100, Math.min(500, parseInt(localStorage[KEY] || '100', 10) || 100));

  const T = { line: '#232327', line2: '#2c2c32', text: '#ececef', muted: '#8b8d94', dim: '#5c5e64', violet: '#b98cff' };

  // Código que se inyecta en la página: crea un AudioContext con un GainNode y
  // encamina cada <video>/<audio> por él. gain 1 = 100%. createMediaElementSource
  // solo se puede llamar una vez por elemento (por eso el WeakSet).
  function applyCode(gain) {
    return '(function(){try{' +
      'if(!window.__navBoost){var C=window.AudioContext||window.webkitAudioContext;if(!C)return "unsupported";' +
      'var ctx=new C();var g=ctx.createGain();g.connect(ctx.destination);' +
      'window.__navBoost={ctx:ctx,gain:g,seen:new WeakSet()};' +
      'var hook=function(){document.querySelectorAll("video,audio").forEach(function(el){' +
      'if(window.__navBoost.seen.has(el))return;try{var s=window.__navBoost.ctx.createMediaElementSource(el);' +
      's.connect(window.__navBoost.gain);window.__navBoost.seen.add(el);}catch(e){}});};' +
      'window.__navBoost.hook=hook;hook();' +
      'try{new MutationObserver(hook).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}}' +
      'var B=window.__navBoost;B.hook();' +
      'if(B.ctx.state==="suspended"){B.ctx.resume();}' +
      'B.gain.gain.value=' + (gain / 100) + ';' +
      'return "ok";}catch(e){return "error:"+e.message;}})()';
  }

  async function apply() {
    const wv = naviris.activeWebview();
    if (!wv) { naviris.toast('Abre una página con audio o vídeo'); return; }
    try {
      const r = await wv.executeJavaScript(applyCode(level));
      if (r === 'unsupported') naviris.toast('Esta página no permite amplificar el audio');
    } catch (e) { /* nada */ }
  }

  function setLevel(v) {
    level = Math.max(100, Math.min(500, Math.round(v)));
    localStorage[KEY] = String(level);
    apply();
    render();
  }

  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', onAway, true); } }
  function onAway(e) { if (pop && !pop.contains(e.target) && (!btnRef || !btnRef.contains(e.target))) closePop(); }

  function render() {
    if (!pop) return;
    const quick = [100, 150, 200, 300, 500];
    pop.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin:0 2px 12px">' +
        '<span style="display:inline-flex;width:15px;height:15px;color:' + T.violet + '">' + window.icon('speaker-wave') + '</span>' +
        '<span style="font-size:13px;font-weight:600;color:' + T.text + '">Sound Booster</span>' +
        '<span style="margin-left:auto;font-family:ui-monospace,monospace;font-size:13px;color:' + (level > 100 ? T.violet : T.muted) + '">' + level + '%</span>' +
      '</div>' +
      '<input id="nvb-range" type="range" min="100" max="500" step="10" value="' + level + '" style="width:100%;accent-color:' + T.violet + '">' +
      '<div style="display:flex;gap:6px;margin-top:12px">' +
        quick.map((q) => '<button data-nvb="' + q + '" style="flex:1;padding:6px 0;border:1px solid ' + (q === level ? T.violet : T.line2) + ';border-radius:8px;font-size:11px;cursor:pointer;background:' + (q === level ? 'rgba(185,140,255,.15)' : 'none') + ';color:' + (q === level ? T.text : T.muted) + '">' + q + '%</button>').join('') +
      '</div>' +
      '<div style="font-size:10.5px;color:' + T.dim + ';margin-top:11px;line-height:1.5">Amplifica solo esta pestaña. Algunas webs con audio protegido pueden no permitirlo.</div>';
    pop.querySelector('#nvb-range').addEventListener('input', (e) => setLevel(+e.target.value));
    pop.querySelectorAll('[data-nvb]').forEach((b) => b.addEventListener('click', () => setLevel(+b.dataset.nvb)));
  }

  function openPop(btn) {
    if (pop) { closePop(); return; }
    btnRef = btn;
    const r = btn.getBoundingClientRect();
    pop = document.createElement('div');
    pop.style.cssText = 'position:fixed;left:' + Math.round(r.right + 10) + 'px;top:' + Math.round(Math.min(r.top, innerHeight - 200)) + 'px;' +
      'z-index:99999;background:#17171b;border:1px solid ' + T.line2 + ';border-radius:12px;padding:13px;width:250px;' +
      'box-shadow:0 16px 44px rgba(0,0,0,.55);color:' + T.text + ';';
    document.body.appendChild(pop);
    document.addEventListener('mousedown', onAway, true);
    render();
  }

  naviris.registerTool({
    id: 'sound-booster',
    label: 'Sound Booster — amplifica el volumen de la pestaña',
    icon: 'speaker-wave',
    onClick: (btn) => {
      const b = document.getElementById('adt-sound-booster');
      if (b) b.style.color = level > 100 ? '#b98cff' : '';
      openPop(btn);
    }
  });
})();
