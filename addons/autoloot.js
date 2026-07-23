/* Naviris addon oficial: AutoLoot v1.1.0
   Una sola acción: Rat Loot — silencia, baja la resolución (solo esa pestaña)
   y reclama puntos y drops en segundo plano, agrupado a la izquierda.
   UI minimalista monocroma: iconos SVG del sistema, sin emojis. */
(function () {
  let pop = null;
  let btnRef = null;

  const API = () => (typeof naviris !== 'undefined' && naviris.loot) ? naviris.loot : null;
  const ico = (name, size, color) =>
    '<span style="display:inline-flex;width:' + size + 'px;height:' + size + 'px;color:' + color + ';flex:none">' + window.icon(name) + '</span>';
  const esc = (t) => String(t || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const T = {
    bg: '#17171b', line: '#232327', line2: '#2c2c32',
    text: '#ececef', muted: '#8b8d94', dim: '#5c5e64',
    violet: '#b98cff', green: '#9ee2b8', red: '#e6a9b4',
    mono: 'ui-monospace, Consolas, monospace'
  };
  const label = (t, extra) =>
    '<div style="display:flex;align-items:baseline;margin:14px 2px 7px;font-family:' + T.mono + ';font-size:9.5px;letter-spacing:1.2px;color:' + T.dim + '">' +
    t + (extra ? '<span style="margin-left:auto;letter-spacing:.3px">' + extra + '</span>' : '') + '</div>';

  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', onAway, true); } }
  function onAway(e) { if (pop && !pop.contains(e.target) && (!btnRef || !btnRef.contains(e.target))) closePop(); }

  function render() {
    if (!pop) return;
    const st = API().state();
    const pts = st.log.filter((l) => l.kind === 'points').length;
    const drops = st.log.filter((l) => l.kind === 'drop').length;

    let html = '<div style="display:flex;align-items:center;gap:8px;margin:2px 2px 12px">' +
      ico('gift', 15, T.violet) +
      '<span style="font-family:' + T.mono + ';font-size:11px;letter-spacing:2px;color:' + T.text + '">AUTOLOOT</span></div>';

    // Única acción
    html += '<button id="nvl-go" ' + (st.activeIsTwitch ? '' : 'disabled ') +
      'style="width:100%;padding:11px 12px;border:none;border-radius:10px;font-weight:700;font-size:13px;letter-spacing:.3px;' +
      (st.activeIsTwitch
        ? 'background:linear-gradient(120deg,#7b5cc4,#9147ff);color:#fff;cursor:pointer'
        : 'background:rgba(255,255,255,.05);color:' + T.dim + ';cursor:default') +
      '">Rat Loot</button>';
    html += '<div style="font-size:11px;color:' + T.dim + ';margin:8px 2px 0;line-height:1.55">' +
      (st.activeIsTwitch
        ? 'Silencia, baja la resolución de esta pestaña y reclama puntos y drops en segundo plano, agrupada a la izquierda.'
        : 'Abre un canal de Twitch para empezar.') + '</div>';

    // Canales farmeando
    if (st.sessions.length) {
      html += label('FARMEANDO', String(st.sessions.length));
      for (const s of st.sessions) {
        html += '<div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid ' + T.line + ';border-radius:9px;margin:5px 0">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:' + T.green + ';flex:none"></span>' +
          '<span style="flex:1;font-size:12px;color:' + T.text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.title) + '</span>' +
          '<span style="font-family:' + T.mono + ';font-size:11px;color:' + T.green + '">' + s.claims + '</span>' +
          '<button data-nvl-focus="' + s.id + '" style="border:none;background:none;color:' + T.muted + ';cursor:pointer;font-size:11px;padding:2px 4px">ir</button>' +
          '<button data-nvl-stop="' + s.id + '" style="border:none;background:none;color:' + T.red + ';cursor:pointer;font-size:11px;padding:2px 4px">parar</button>' +
          '</div>';
      }
    }

    // Loot obtenido
    html += label('LOOT OBTENIDO', pts + ' puntos &middot; ' + drops + ' drops');
    if (!st.log.length) {
      html += '<div style="font-size:11.5px;color:' + T.dim + ';margin:2px 2px">Aún no se ha reclamado nada.</div>';
    } else {
      html += '<div style="max-height:168px;overflow-y:auto;border-top:1px solid ' + T.line + '">';
      for (const l of st.log.slice(0, 40)) {
        const when = new Date(l.t).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        html += '<div style="display:flex;align-items:center;gap:9px;font-size:11.5px;padding:6px 2px;border-bottom:1px solid ' + T.line + '">' +
          ico(l.kind === 'drop' ? 'gift' : 'star', 13, l.kind === 'drop' ? T.violet : T.muted) +
          '<span style="flex:1;color:' + T.text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.channel || 'Twitch') + '</span>' +
          '<span style="font-family:' + T.mono + ';font-size:10px;color:' + T.dim + '">' + when + '</span></div>';
      }
      html += '</div>' +
        '<button id="nvl-clear" style="margin-top:10px;border:1px solid ' + T.line2 + ';background:none;color:' + T.muted + ';border-radius:8px;padding:6px 11px;font-size:11px;cursor:pointer">Vaciar registro</button>';
    }

    pop.innerHTML = html;
    const go = pop.querySelector('#nvl-go');
    if (go && st.activeIsTwitch) go.addEventListener('click', () => { API().ratLoot(); render(); });
    const clear = pop.querySelector('#nvl-clear');
    if (clear) clear.addEventListener('click', () => { API().clearLog(); render(); });
    pop.querySelectorAll('[data-nvl-focus]').forEach((b) => b.addEventListener('click', () => { API().focus(+b.dataset.nvlFocus); closePop(); }));
    pop.querySelectorAll('[data-nvl-stop]').forEach((b) => b.addEventListener('click', () => { API().stop(+b.dataset.nvlStop); render(); }));
  }

  function openPop(btn) {
    if (pop) { closePop(); return; }
    btnRef = btn;
    const r = btn.getBoundingClientRect();
    pop = document.createElement('div');
    pop.style.cssText = 'position:fixed;left:' + Math.round(r.right + 10) + 'px;top:' + Math.round(Math.min(r.top, innerHeight - 440)) + 'px;' +
      'z-index:99999;background:' + T.bg + ';border:1px solid ' + T.line2 + ';border-radius:13px;padding:13px;width:268px;' +
      'box-shadow:0 16px 44px rgba(0,0,0,.6);color:' + T.text + ';';
    document.body.appendChild(pop);
    document.addEventListener('mousedown', onAway, true);
    render();
  }

  naviris.registerTool({
    id: 'autoloot',
    label: 'AutoLoot — Rat Loot de puntos y drops de Twitch',
    icon: 'gift',
    onClick: (btn) => {
      if (!API()) { naviris.toast('Actualiza Naviris (v2.3+) para usar AutoLoot'); return; }
      openPop(btn);
    }
  });

  // Ilumina el botón del sidebar mientras hay sesiones. OJO: color inline, NO la
  // clase .busy — esa clase desactiva el clic (pointer-events:none) y bloqueaba
  // reabrir el panel con una sesión activa.
  if (API()) {
    API().onChange((st) => {
      const b = document.getElementById('adt-autoloot');
      if (b) b.style.color = st.sessions.length ? '#9ee2b8' : '';
      if (pop) render();
    });
  }
})();
