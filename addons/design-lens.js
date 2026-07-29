/* Inspector de diseño — addon de Naviris (kind: tool)
   Radiografía de diseño de la página activa, pensada para diseñadores:
   tipografías y tamaños en uso, paleta de colores y fondos, escala de
   espaciado (márgenes, rellenos y sangrías), radios de borde e interlineados.
   Incluye un selector de elemento: pasa el ratón, haz clic y ves la ficha
   completa de ese elemento (fuente, peso, color, margen, relleno, radio…).
   Cada valor se copia al portapapeles con un clic. */
(function () {
  var BTN_ID = 'adt-design-lens';

  /* ---------- Código que corre DENTRO de la página ---------- */
  // Radiografía: recorre el DOM visible (tope 4000 nodos) y agrega los valores
  // computados. Devuelve el resumen directamente (executeJavaScript lo espera).
  var SCAN = '(' + function () {
    var fam = {}, sizes = {}, colors = {}, bgs = {}, radii = {}, spacing = {}, lh = {}, indents = {};
    var add = function (m, k) { if (!k) return; m[k] = (m[k] || 0) + 1; };
    var all = document.querySelectorAll('body *');
    var n = 0;
    for (var i = 0; i < all.length && n < 4000; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      n++;
      var cs = getComputedStyle(el);
      add(fam, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      var conTexto = false;
      for (var j = 0; j < el.childNodes.length; j++) { var nd = el.childNodes[j]; if (nd.nodeType === 3 && nd.textContent.trim()) { conTexto = true; break; } }
      if (conTexto) {
        add(sizes, cs.fontSize);
        add(colors, cs.color);
        add(lh, cs.lineHeight);
        if (cs.textIndent && cs.textIndent !== '0px') add(indents, cs.textIndent);
      }
      var bg = cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') add(bgs, bg);
      var br = cs.borderRadius;
      if (br && br !== '0px') add(radii, br.split(' ')[0]);
      var esp = [cs.marginTop, cs.marginBottom, cs.paddingTop, cs.paddingLeft, cs.paddingRight];
      for (var k = 0; k < esp.length; k++) { var v = esp[k]; if (v && v !== '0px' && v.slice(-2) === 'px') add(spacing, v); }
    }
    var top = function (m, c) { return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, c); };
    return {
      titulo: document.title, vw: innerWidth, vh: innerHeight, nodos: n,
      fuentes: top(fam, 6), tamanos: top(sizes, 8), colores: top(colors, 8), fondos: top(bgs, 6),
      radios: top(radii, 5), espaciado: top(spacing, 9), interlineados: top(lh, 4), sangrias: top(indents, 4)
    };
  } + ')()';

  // Selector de elemento: resalta al pasar el ratón, informa al hacer clic
  // (console.log con prefijo NAVLENS|) y se limpia solo. Escape cancela.
  var PICKER = '(' + function () {
    if (window.__navLens) return; window.__navLens = 1;
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:1.5px solid #b98cff;background:rgba(185,140,255,.14);border-radius:3px';
    document.documentElement.appendChild(box);
    var move = function (e) { var r = e.target.getBoundingClientRect(); box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px'; };
    var fin = function () { removeEventListener('mousemove', move, true); removeEventListener('click', clic, true); removeEventListener('keydown', esc, true); box.remove(); delete window.__navLens; };
    var clic = function (e) {
      e.preventDefault(); e.stopPropagation();
      var t = e.target, cs = getComputedStyle(t), r = t.getBoundingClientRect();
      var info = {
        tag: t.tagName.toLowerCase(), clase: (typeof t.className === 'string' ? t.className : '').split(/\s+/).slice(0, 3).join(' '),
        fuente: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), tam: cs.fontSize, peso: cs.fontWeight,
        interlineado: cs.lineHeight, tracking: cs.letterSpacing, color: cs.color, fondo: cs.backgroundColor,
        margen: cs.margin, relleno: cs.padding, radio: cs.borderRadius,
        sombra: cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 90) : '',
        ancho: Math.round(r.width), alto: Math.round(r.height)
      };
      console.log('NAVLENS|' + JSON.stringify(info));
      fin();
    };
    var esc = function (e) { if (e.key === 'Escape') { fin(); console.log('NAVLENS|CANCEL'); } };
    addEventListener('mousemove', move, true); addEventListener('click', clic, true); addEventListener('keydown', esc, true);
  } + ')()';

  /* ---------- Estilos (reusa side-panel-left y lp- del core) ---------- */
  var css = document.createElement('style');
  css.id = 'nvl-style';
  css.textContent = [
    '#nvl-panel{width:330px;max-height:640px}',
    '#nvl-panel .lp-body{padding:10px 16px 18px}',
    '.nvl-lbl{margin:16px 2px 8px;font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--dim,#5c5e64)}',
    '.nvl-lbl:first-child{margin-top:6px}',
    '.nvl-hint{font-size:12.5px;color:var(--muted,#8b8d94);line-height:1.6;margin:4px 2px 2px}',
    '.nvl-row{display:flex;gap:8px;margin-top:10px}',
    '.nvl-btn{flex:1;border:none;border-radius:10px;padding:11px 14px;font-size:12.5px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.08);color:var(--text,#ececef);transition:background .12s}',
    '.nvl-btn:hover{background:rgba(255,255,255,.15)}',
    /* Fichas clicables: cualquier valor se copia con un clic */
    '.nvl-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.nvl-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#232327);border-radius:8px;padding:4px 9px;font-size:11.5px;font-family:var(--mono,ui-monospace,monospace);color:var(--text,#ececef);cursor:pointer;transition:border-color .12s}',
    '.nvl-chip:hover{border-color:var(--muted,#8b8d94)}',
    '.nvl-chip .n{color:var(--dim,#5c5e64);font-size:10px}',
    '.nvl-chip .sw{width:11px;height:11px;border-radius:3px;border:1px solid rgba(255,255,255,.25);flex:none}',
    /* Ficha del elemento elegido */
    '.nvl-ficha{border:1px solid var(--line,#232327);border-radius:11px;padding:10px 12px;margin-top:8px}',
    '.nvl-ficha .t{font-family:var(--mono,ui-monospace,monospace);font-size:12px;color:var(--violet,#b98cff);margin-bottom:6px}',
    '.nvl-kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:2.5px 0;cursor:pointer;border-radius:5px}',
    '.nvl-kv:hover{background:rgba(255,255,255,.05)}',
    '.nvl-kv .k{color:var(--muted,#8b8d94);flex:none}',
    '.nvl-kv .v{font-family:var(--mono,ui-monospace,monospace);color:var(--text,#ececef);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.nvl-picking{color:var(--violet,#b98cff)!important}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- Panel ---------- */
  var panel = document.createElement('aside');
  panel.id = 'nvl-panel';
  panel.className = 'side-panel-left hidden';
  panel.innerHTML =
    '<div class="lp-head"><span class="lp-title"><span id="nvl-ico"></span> Inspector de diseño</span>' +
    '<button id="nvl-close" class="lp-x" title="Cerrar"></button></div>' +
    '<div id="nvl-body" class="lp-body"></div>';
  document.body.appendChild(panel);

  // Iconos propios inline (stroke currentColor) para no depender del core
  var ICON_RULER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 2.5 21.5 6.5 6.5 21.5 2.5 17.5Z"/><path d="M14.5 5.5 16 7M11.5 8.5 13 10M8.5 11.5 10 13M5.5 14.5 7 16"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg>';
  panel.querySelector('#nvl-ico').innerHTML = ICON_RULER;
  panel.querySelector('#nvl-ico').style.cssText = 'display:inline-flex;width:15px;height:15px;color:var(--violet,#b98cff)';
  panel.querySelector('#nvl-close').innerHTML = ICON_X;
  panel.querySelector('#nvl-close').addEventListener('click', function () { panel.classList.add('hidden'); });

  var body = panel.querySelector('#nvl-body');
  var escapadas = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return escapadas[c]; }); }

  // rgb(a) → hex corto para diseñadores; deja pasar lo que no sea rgb
  function hex(c) {
    var m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c);
    if (!m) return c;
    var h = '#' + [m[1], m[2], m[3]].map(function (x) { return (+x).toString(16).padStart(2, '0'); }).join('');
    return m[4] !== undefined && +m[4] < 1 ? h + ' ' + Math.round(+m[4] * 100) + '%' : h;
  }
  function copiar(v) { navigator.clipboard.writeText(v).then(function () { naviris.toast('Copiado: ' + v); }, function () { naviris.toast('No se pudo copiar'); }); }

  function chips(pares, conMuestra) {
    var div = document.createElement('div'); div.className = 'nvl-chips';
    pares.forEach(function (p) {
      var val = conMuestra ? hex(p[0]) : p[0];
      var ch = document.createElement('button'); ch.className = 'nvl-chip'; ch.title = 'Copiar ' + val;
      ch.innerHTML = (conMuestra ? '<span class="sw" style="background:' + esc(p[0]) + '"></span>' : '') + esc(val) + '<span class="n">×' + p[1] + '</span>';
      ch.addEventListener('click', function () { copiar(val); });
      div.appendChild(ch);
    });
    return div;
  }
  function seccion(titulo) { var l = document.createElement('div'); l.className = 'nvl-lbl'; l.textContent = titulo; body.appendChild(l); }

  function pintaResumen(d) {
    body.innerHTML = '';
    var intro = document.createElement('div'); intro.className = 'nvl-hint';
    intro.textContent = d.titulo ? d.titulo + ' — ' + d.vw + '×' + d.vh + ' px, ' + d.nodos + ' elementos' : d.vw + '×' + d.vh + ' px';
    body.appendChild(intro);
    body.appendChild(botonera());
    if (d.fuentes.length) { seccion('Tipografías'); body.appendChild(chips(d.fuentes)); }
    if (d.tamanos.length) { seccion('Tamaños de texto'); body.appendChild(chips(d.tamanos)); }
    if (d.colores.length) { seccion('Colores de texto'); body.appendChild(chips(d.colores, true)); }
    if (d.fondos.length) { seccion('Fondos'); body.appendChild(chips(d.fondos, true)); }
    if (d.espaciado.length) { seccion('Espaciado (márgenes y rellenos)'); body.appendChild(chips(d.espaciado)); }
    if (d.sangrias.length) { seccion('Sangrías'); body.appendChild(chips(d.sangrias)); }
    if (d.interlineados.length) { seccion('Interlineados'); body.appendChild(chips(d.interlineados)); }
    if (d.radios.length) { seccion('Radios de borde'); body.appendChild(chips(d.radios)); }
  }

  function pintaFicha(f) {
    var ficha = document.createElement('div'); ficha.className = 'nvl-ficha';
    var kv = function (k, v, copia) {
      if (!v || v === 'none' || v === 'normal') return '';
      var val = copia === 'hex' ? hex(v) : v;
      return '<div class="nvl-kv" data-copy="' + esc(val) + '"><span class="k">' + esc(k) + '</span><span class="v" title="' + esc(val) + '">' + esc(val) + '</span></div>';
    };
    ficha.innerHTML = '<div class="t">&lt;' + esc(f.tag) + '&gt;' + (f.clase ? ' .' + esc(f.clase.split(' ')[0]) : '') + ' — ' + f.ancho + '×' + f.alto + ' px</div>' +
      kv('Fuente', f.fuente) + kv('Tamaño', f.tam) + kv('Peso', f.peso) + kv('Interlineado', f.interlineado) +
      kv('Tracking', f.tracking) + kv('Color', f.color, 'hex') + kv('Fondo', f.fondo === 'rgba(0, 0, 0, 0)' ? '' : f.fondo, 'hex') +
      kv('Margen', f.margen) + kv('Relleno', f.relleno) + kv('Radio', f.radio === '0px' ? '' : f.radio) + kv('Sombra', f.sombra);
    ficha.querySelectorAll('.nvl-kv').forEach(function (row) { row.addEventListener('click', function () { copiar(row.dataset.copy); }); });
    var prev = body.querySelector('.nvl-ficha'); if (prev) prev.remove();
    var botones = body.querySelector('.nvl-row');
    botones ? botones.after(ficha) : body.appendChild(ficha);
  }

  /* ---------- Acciones ---------- */
  var escuchados = new WeakSet(); // webviews con listener de console-message ya puesto
  function conWebview() {
    var wv = naviris.activeWebview();
    if (!wv) { naviris.toast('Abre una página para inspeccionarla'); return null; }
    if (!escuchados.has(wv)) {
      escuchados.add(wv);
      wv.addEventListener('console-message', function (ev) {
        var m = ev.message || '';
        if (m.slice(0, 8) !== 'NAVLENS|') return;
        var raw = m.slice(8);
        var btn = document.getElementById('nvl-pick'); if (btn) btn.classList.remove('nvl-picking');
        if (raw === 'CANCEL') return;
        try { pintaFicha(JSON.parse(raw)); } catch (e) { /* nada */ }
      });
    }
    return wv;
  }
  function escanear() {
    var wv = conWebview(); if (!wv) return;
    wv.executeJavaScript(SCAN, true).then(pintaResumen, function () { naviris.toast('No se pudo escanear esta página'); });
  }
  function elegir() {
    var wv = conWebview(); if (!wv) return;
    var btn = document.getElementById('nvl-pick'); if (btn) btn.classList.add('nvl-picking');
    naviris.toast('Haz clic en un elemento de la página (Escape cancela)');
    wv.executeJavaScript(PICKER, true).catch(function () { naviris.toast('No se pudo activar el selector'); });
  }
  function botonera() {
    var row = document.createElement('div'); row.className = 'nvl-row';
    var b1 = document.createElement('button'); b1.className = 'nvl-btn'; b1.textContent = 'Escanear página'; b1.addEventListener('click', escanear);
    var b2 = document.createElement('button'); b2.className = 'nvl-btn'; b2.id = 'nvl-pick'; b2.textContent = 'Elegir elemento'; b2.addEventListener('click', elegir);
    row.append(b1, b2);
    return row;
  }
  function estadoInicial() {
    body.innerHTML = '<div class="nvl-hint">Radiografía de diseño de la página activa: tipografías, tamaños, colores, espaciado y sangrías. O elige un elemento concreto y copia cualquiera de sus valores con un clic.</div>';
    body.appendChild(botonera());
  }
  estadoInicial();

  /* ---------- Botón del sidebar ---------- */
  naviris.registerTool({
    id: 'design-lens',
    label: 'Inspector de diseño: tipografías, colores y espaciado de la página',
    icon: 'magnifying-glass',
    onClick: function () {
      var abierto = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      if (!abierto) { var wv = naviris.activeWebview(); if (wv) escanear(); }
    }
  });
  var btn = document.getElementById(BTN_ID);
  if (btn) btn.innerHTML = ICON_RULER;

  // Si quitan el addon (botón fuera del DOM), el panel y estilos se limpian solos
  var vigia = setInterval(function () {
    if (!document.getElementById(BTN_ID)) { clearInterval(vigia); panel.remove(); css.remove(); }
  }, 3000);
})();
