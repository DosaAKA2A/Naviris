/* Naviris addon oficial: Rat Loot v1.2.0
   Sesiones de recolección de Twitch: Activar (silencia, resolución mínima solo
   en esa pestaña, reclama puntos y drops, agrupada a la izquierda), lista de
   sesiones activas y sección de historial del loot obtenido.
   Panel lateral grande (mismo estilo que los paneles nativos). Sin emojis. */
(function () {
  let panel = null;
  let view = 'sesiones'; // 'sesiones' | 'historial'

  const API = () => (typeof naviris !== 'undefined' && naviris.loot) ? naviris.loot : null;
  const ico = (name, size, color) =>
    '<span style="display:inline-flex;width:' + size + 'px;height:' + size + 'px;color:' + color + ';flex:none">' + window.icon(name) + '</span>';
  const esc = (t) => String(t || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const T = {
    line: '#232327', line2: '#2c2c32', text: '#ececef', muted: '#8b8d94', dim: '#5c5e64',
    violet: '#b98cff', green: '#9ee2b8', red: '#e6a9b4', mono: 'ui-monospace, Consolas, monospace'
  };
  const label = (t, extra) =>
    '<div style="display:flex;align-items:baseline;margin:16px 2px 8px;font-family:' + T.mono + ';font-size:9.5px;letter-spacing:1.2px;color:' + T.dim + '">' +
    t + (extra !== undefined ? '<span style="margin-left:auto;letter-spacing:.3px">' + extra + '</span>' : '') + '</div>';

  function closePanel() {
    if (panel) { panel.remove(); panel = null; }
    const b = document.getElementById('adt-autoloot');
    if (b) b.classList.remove('open');
  }

  function tabBtn(id, text, active) {
    return '<button data-nvl-view="' + id + '" style="flex:1;padding:7px 0;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;' +
      (active ? 'background:rgba(255,255,255,.09);color:' + T.text : 'background:none;color:' + T.muted) + '">' + text + '</button>';
  }

  function render() {
    if (!panel) return;
    const st = API().state();
    const pts = st.log.filter((l) => l.kind === 'points').length;
    const drops = st.log.filter((l) => l.kind === 'drop').length;

    let html =
      '<div style="display:flex;align-items:center;gap:9px;padding:14px 16px 10px">' +
        ico('gift', 16, T.violet) +
        '<span style="font-size:13.5px;font-weight:600;color:' + T.text + '">Rat Loot</span>' +
        '<button id="nvl-close" style="margin-left:auto;border:none;background:none;color:' + T.muted + ';cursor:pointer;width:26px;height:26px;display:flex;align-items:center;justify-content:center">' + ico('x-mark', 15, 'currentColor') + '</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin:0 16px 6px;padding:4px;border:1px solid ' + T.line + ';border-radius:10px">' +
        tabBtn('sesiones', 'Sesiones', view === 'sesiones') +
        tabBtn('historial', 'Historial', view === 'historial') +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:6px 16px 16px">';

    if (view === 'sesiones') {
      html += '<button id="nvl-go" ' + (st.activeIsTwitch ? '' : 'disabled ') +
        'style="width:100%;margin-top:8px;padding:12px;border:none;border-radius:10px;font-weight:700;font-size:13.5px;letter-spacing:.3px;' +
        (st.activeIsTwitch
          ? 'background:linear-gradient(120deg,#7b5cc4,#9147ff);color:#fff;cursor:pointer'
          : 'background:rgba(255,255,255,.05);color:' + T.dim + ';cursor:default') +
        '">Activar</button>';
      html += '<div style="font-size:11px;color:' + T.dim + ';margin:9px 2px 0;line-height:1.55">' +
        (st.activeIsTwitch
          ? 'Silencia el canal, baja la resolución solo en esa pestaña y reclama puntos y drops en segundo plano, agrupada a la izquierda.'
          : 'Abre un canal de Twitch para poder activar una sesión.') + '</div>';

      html += label('SESIONES ACTIVAS', String(st.sessions.length));
      if (!st.sessions.length) {
        html += '<div style="font-size:11.5px;color:' + T.dim + '">No hay sesiones recolectando ahora mismo.</div>';
      } else {
        for (const s of st.sessions) {
          html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid ' + T.line + ';border-radius:10px;margin:6px 0">' +
            '<span style="width:6px;height:6px;border-radius:50%;background:' + T.green + ';flex:none"></span>' +
            '<span style="flex:1;min-width:0;font-size:12.5px;color:' + T.text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.title) + '</span>' +
            '<span title="Reclamos en esta sesión" style="font-family:' + T.mono + ';font-size:11.5px;color:' + T.green + '">' + s.claims + '</span>' +
            '<button data-nvl-focus="' + s.id + '" style="border:none;background:none;color:' + T.muted + ';cursor:pointer;font-size:11.5px;padding:2px 5px">ir</button>' +
            '<button data-nvl-stop="' + s.id + '" style="border:none;background:none;color:' + T.red + ';cursor:pointer;font-size:11.5px;padding:2px 5px">parar</button>' +
            '</div>';
        }
      }
    } else {
      html += label('LOOT OBTENIDO', pts + ' puntos &middot; ' + drops + ' drops');
      if (!st.log.length) {
        html += '<div style="font-size:11.5px;color:' + T.dim + '">Aún no se ha reclamado nada. Activa una sesión en un canal de Twitch.</div>';
      } else {
        for (const l of st.log) {
          const when = new Date(l.t).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          html += '<div style="display:flex;align-items:center;gap:10px;font-size:12px;padding:8px 2px;border-bottom:1px solid ' + T.line + '">' +
            ico(l.kind === 'drop' ? 'gift' : 'star', 14, l.kind === 'drop' ? T.violet : T.muted) +
            '<span style="flex:1;min-width:0;color:' + T.text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.channel || 'Twitch') + '</span>' +
            '<span style="font-family:' + T.mono + ';font-size:10.5px;color:' + T.dim + '">' + when + '</span></div>';
        }
        html += '<button id="nvl-clear" style="margin-top:12px;border:1px solid ' + T.line2 + ';background:none;color:' + T.muted + ';border-radius:8px;padding:7px 12px;font-size:11.5px;cursor:pointer">Vaciar historial</button>';
      }
    }
    html += '</div>';

    panel.innerHTML = html;
    panel.querySelector('#nvl-close').addEventListener('click', closePanel);
    panel.querySelectorAll('[data-nvl-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.nvlView; render(); }));
    const go = panel.querySelector('#nvl-go');
    if (go && st.activeIsTwitch) go.addEventListener('click', () => { API().ratLoot(); render(); });
    const clear = panel.querySelector('#nvl-clear');
    if (clear) clear.addEventListener('click', () => { API().clearLog(); render(); });
    panel.querySelectorAll('[data-nvl-focus]').forEach((b) => b.addEventListener('click', () => { API().focus(+b.dataset.nvlFocus); }));
    panel.querySelectorAll('[data-nvl-stop]').forEach((b) => b.addEventListener('click', () => { API().stop(+b.dataset.nvlStop); render(); }));
  }

  function openPanel() {
    if (panel) { closePanel(); return; }
    panel = document.createElement('aside');
    panel.className = 'side-panel'; // mismo estilo que los paneles nativos de Naviris
    document.body.appendChild(panel);
    const b = document.getElementById('adt-autoloot');
    if (b) b.classList.add('open');
    view = 'sesiones';
    render();
  }

  naviris.registerTool({
    id: 'autoloot',
    label: 'Rat Loot — sesiones de puntos y drops de Twitch',
    icon: 'gift',
    onClick: () => {
      if (!API()) { naviris.toast('Actualiza Naviris (v2.3+) para usar Rat Loot'); return; }
      openPanel();
    }
  });

  // Ilumina el botón mientras hay sesiones (color inline: la clase .busy
  // desactivaría el clic) y refresca el panel abierto en cada cambio.
  if (API()) {
    API().onChange(() => {
      const b = document.getElementById('adt-autoloot');
      if (b) b.style.color = API().state().sessions.length ? '#9ee2b8' : '';
      if (panel) render();
    });
  }
})();
