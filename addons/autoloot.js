/* Naviris addon oficial: AutoLoot v1.0.0
   La esencia: dejar un canal de Twitch recolectando puntos y drops en segundo
   plano — silenciado, en resolución mínima (solo esa pestaña) y agrupado como
   primera pestaña a la izquierda — mientras tú navegas a lo tuyo.
   Una sola acción: Rat Loot. El registro del loot obtenido vive aquí. */
(function () {
  let pop = null;
  let btnRef = null;

  const API = () => (typeof naviris !== 'undefined' && naviris.loot) ? naviris.loot : null;

  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', onAway, true); } }
  function onAway(e) { if (pop && !pop.contains(e.target) && (!btnRef || !btnRef.contains(e.target))) closePop(); }

  const esc = (t) => String(t || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  function render() {
    if (!pop) return;
    const st = API().state();
    const pts = st.log.filter((l) => l.kind === 'points').length;
    const drops = st.log.filter((l) => l.kind === 'drop').length;

    let html = '<div style="font-weight:700;font-size:13px;margin:2px 4px 10px;display:flex;align-items:center;gap:8px">' +
      '<span style="color:#b98cff">🎁</span> AutoLoot</div>';

    // Acción principal: Rat Loot
    html += '<button id="nvl-go" style="width:100%;padding:10px 12px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12.5px;' +
      (st.activeIsTwitch
        ? 'background:linear-gradient(120deg,#7b5cc4,#9147ff);color:#fff'
        : 'background:rgba(255,255,255,.06);color:#8b8d94;cursor:default') + '">' +
      (st.activeIsTwitch ? 'Rat Loot en este canal' : 'Abre un canal de Twitch para empezar') + '</button>';
    html += '<div style="font-size:11px;color:#8b8d94;margin:7px 4px 0;line-height:1.5">Silencia, baja la resolución solo en esa pestaña y la agrupa a la izquierda mientras reclama puntos y drops.</div>';

    // Sesiones activas
    if (st.sessions.length) {
      html += '<div style="font-size:11px;letter-spacing:.4px;color:#8b8d94;margin:12px 4px 6px">RECOLECTANDO · ' + st.sessions.length + '</div>';
      for (const s of st.sessions) {
        html += '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid #232327;border-radius:9px;margin:4px 0">' +
          '<span style="color:#9ee2b8">●</span>' +
          '<span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.title) + '</span>' +
          '<span style="font-size:11px;color:#9ee2b8">' + s.claims + '</span>' +
          '<button data-nvl-focus="' + s.id + '" style="border:none;background:none;color:#8b8d94;cursor:pointer;font-size:11px">ir</button>' +
          '<button data-nvl-stop="' + s.id + '" style="border:none;background:none;color:#e6a9b4;cursor:pointer;font-size:11px">parar</button>' +
          '</div>';
      }
    }

    // Loot obtenido (función movida desde el antiguo panel del sidebar)
    html += '<div style="display:flex;align-items:center;margin:12px 4px 6px">' +
      '<span style="font-size:11px;letter-spacing:.4px;color:#8b8d94">LOOT OBTENIDO</span>' +
      '<span style="margin-left:auto;font-size:11px;color:#8b8d94">' + pts + ' puntos · ' + drops + ' drops</span></div>';
    if (!st.log.length) {
      html += '<div style="font-size:11.5px;color:#5c5e64;margin:4px">Aún no se ha reclamado nada.</div>';
    } else {
      html += '<div style="max-height:150px;overflow-y:auto">';
      for (const l of st.log.slice(0, 30)) {
        const when = new Date(l.t).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        html += '<div style="display:flex;gap:7px;font-size:11.5px;padding:4px 4px;border-bottom:1px solid rgba(255,255,255,.04)">' +
          '<span>' + (l.kind === 'drop' ? '🎁' : '⭐') + '</span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.channel || 'Twitch') + '</span>' +
          '<span style="color:#5c5e64">' + when + '</span></div>';
      }
      html += '</div><button id="nvl-clear" style="margin-top:8px;border:1px solid #2c2c32;background:none;color:#8b8d94;border-radius:7px;padding:5px 10px;font-size:11px;cursor:pointer">Vaciar registro</button>';
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
    pop.style.cssText = 'position:fixed;left:' + Math.round(r.right + 10) + 'px;top:' + Math.round(Math.min(r.top, innerHeight - 420)) + 'px;' +
      'z-index:99999;background:#17171b;border:1px solid #2c2c32;border-radius:12px;padding:12px;width:264px;' +
      'box-shadow:0 16px 44px rgba(0,0,0,.6);color:#ececef;';
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

  // El botón del sidebar se ilumina mientras hay sesiones recolectando
  if (API()) {
    API().onChange((st) => {
      const b = document.getElementById('adt-autoloot');
      if (b) b.classList.toggle('busy', st.sessions.length > 0);
      if (pop) render();
    });
  }
})();
