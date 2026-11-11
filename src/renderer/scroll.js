/* Barra de scroll propia de la interfaz. */

/* ===== Scroll propio de Naviris (2026-08-11) =====
   El scrollbar nativo rompía las esquinas redondeadas de las piezas flotantes.
   Este dibuja una barra flotante sobre cada contenedor: aparece al rodar, el
   pulgar se ESTIRA mientras ruedas y vuelve a su grosor al parar, y se puede
   arrastrar. Solo anima transform/opacity (regla de rendimiento del proyecto).
   Se auto-aplica a lo que scrollee y se re-mide con ResizeObserver. */
(function scrollPropio() {
  const MARGEN = 12;     // px que el pulgar NUNCA invade arriba y abajo
  const OCULTAR = 900;   // ms sin rodar -> el pulgar vuelve a su grosor
  const DESVANECER = 1400; // ms sin rodar -> la barra se va
  const puestos = new WeakMap();   // contenedor → su barra

  function montar(host) {
    /* Las listas se repintan con `innerHTML = ''` y eso se lleva la barra: se
       vuelve a poner la misma, con sus listeners, en vez de quedarse sin ella. */
    const ya = puestos.get(host);
    if (ya) { if (ya.parentNode !== host) host.appendChild(ya); return; }
    if (!host.isConnected) return;
    host.classList.add('nvs-host');
    // La barra va dentro del propio contenedor, así hereda su recorte redondeado
    const pos = getComputedStyle(host).position;
    if (pos === 'static') host.style.position = 'relative';
    const bar = document.createElement('div'); bar.className = 'nvs-bar';
    const thumb = document.createElement('div'); thumb.className = 'nvs-thumb';
    bar.appendChild(thumb); host.appendChild(bar);
    puestos.set(host, bar);

    let tRod = null, tFade = null;
    const medir = () => {
      if (bar.parentNode !== host) host.appendChild(bar);   // ver montar()
      const alto = host.clientHeight, total = host.scrollHeight;
      if (total <= alto + 1) { bar.classList.remove('visible'); return; }
      bar.style.height = alto + 'px';
      bar.style.top = host.scrollTop + 'px'; // la barra viaja con el contenido
      /* El pulgar NO llega a los extremos (2026-08-13). Al tocar techo o suelo
         quedaba pegado al canto del contenedor —y contra su esquina redondeada—
         y se veia como un pegote. Se le reserva un margen arriba y abajo, y el
         recorrido se reparte dentro de ese hueco. */
      const util = Math.max(40, alto - MARGEN * 2);
      const h = Math.max(28, Math.round(util * alto / total));
      const y = MARGEN + Math.round((util - h) * (host.scrollTop / (total - alto)));
      thumb.style.height = h + 'px';
      thumb.style.top = y + 'px';
    };
    const rodando = () => {
      medir();
      bar.classList.add('visible', 'rodando');
      clearTimeout(tRod); clearTimeout(tFade);
      tRod = setTimeout(() => bar.classList.remove('rodando'), OCULTAR);
      tFade = setTimeout(() => bar.classList.remove('visible'), DESVANECER);
    };
    host.addEventListener('scroll', rodando, { passive: true });
    host.addEventListener('mouseenter', () => { medir(); if (host.scrollHeight > host.clientHeight + 1) bar.classList.add('visible'); });
    host.addEventListener('mouseleave', () => { if (!bar.classList.contains('rodando')) bar.classList.remove('visible'); });
    try { new ResizeObserver(medir).observe(host); } catch { /* navegador viejo */ }

    // Arrastrar el pulgar
    let arrastre = null;
    const mueve = (e) => {
      if (!arrastre) return;
      const alto = host.clientHeight, total = host.scrollHeight;
      const h = thumb.offsetHeight;
      const recorrido = Math.max(40, alto - MARGEN * 2) - h;   // el mismo hueco que usa medir()
      if (recorrido <= 0) return;
      host.scrollTop = arrastre.top0 + (e.clientY - arrastre.y0) / arrastre.zoom * ((total - alto) / recorrido);
    };
    const suelta = () => {
      arrastre = null; rodando();
      window.removeEventListener('mousemove', mueve); window.removeEventListener('mouseup', suelta);
    };
    thumb.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      // Dentro del hub escalado el ratón va en px de pantalla y el contenedor en
      // los suyos: sin esto el pulgar corría más o menos que el puntero.
      arrastre = { y0: e.clientY, top0: host.scrollTop, zoom: (host.getBoundingClientRect().height / host.offsetHeight) || 1 };
      bar.classList.add('visible', 'rodando');
      // En window solo mientras se arrastra: fijos, cada contenedor dejaba dos para siempre.
      window.addEventListener('mousemove', mueve); window.addEventListener('mouseup', suelta);
    });
    medir();
  }

  // Contenedores que scrollean en la UI (los webviews conservan el suyo)
  /* REGLA (Dosa, 2026-08-13): NINGUN scroll de Naviris usa la barra del
     sistema. Todo lo que scrollee en la interfaz entra en esta lista — los
     menus y popovers se sumaron al limitarlos al alto de la ventana, que es
     cuando empezaron a scrollear. */
  const SEL = '#hub .hub-scroll, .overlay-page, .lp-body, .hub-panel, #history-list, #dl-list, #pw-list, #card-list, #mp-grid, #suggest, #res-list, #perm-list, .sp-list, .spl-lista, .ml-lista, .xt-lista, .au-lista, #menu-pop, #shield-pop, #res-pop, #rat-pop, #site-pop, .ctx-menu, .temas-pop, .modal-card, .bm-folder-pop, .lib-grid, .nov-lista, #perf-list, #find-otras, .cal-lista, .nt-lista, #vtabs-slot';
  /* Con `raiz`, solo lo de dentro (y ella misma): lo usan los widgets y menús que
     rehacen su lista sin un clic que dispare el repaso (Enter, una espera, el
     botón derecho). Sin ella, todo el documento. */
  const barrer = (raiz) => {
    const r = raiz instanceof Element ? raiz : document;
    if (r !== document && r.matches(SEL)) montar(r);
    r.querySelectorAll(SEL).forEach(montar);
  };
  /* El hub y sus widgets se pintan DESPUÉS de este repaso inicial, y luego cada
     vez que se recompone: sin esta puerta, listas como la de Spotify se
     quedaban con la barra del sistema. renderHub la llama al terminar. */
  window.nvsRepasa = barrer;
  barrer();
  // Los paneles y páginas se crean al vuelo: se revisan al abrirse
  document.addEventListener('click', () => setTimeout(barrer, 120), true);
  window.addEventListener('resize', barrer);
})();
