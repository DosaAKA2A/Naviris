/* ===== ATAJOS DE TECLADO, EN UNA SOLA TABLA (2026-11-03) =====
   Antes había dos listas que se copiaban a mano: ATAJOS_UI en main.js (teclas
   con el foco DENTRO de una web, que main intercepta en before-input-event) y
   el keydown del renderer (foco en la interfaz). Se iban separando: F5 con
   Ctrl recargaba sin caché por un camino y normal por el otro, y Ctrl+W
   cerraba la fijada desde la web pero no desde la interfaz.

   Ahora las dos leen esta tabla. `reservado` dice quién manda con el foco en
   la web, como en Chrome:
     · reservado: el navegador se queda la tecla ANTES que la página (Ctrl+T,
       Ctrl+W, F5…). Main la corta y la manda a la interfaz.
     · sin reservar: la página la ve primero. Si no la usa, el webview reenvía
       la tecla a la interfaz y la atiende el keydown del renderer. Así Ctrl+K
       sigue siendo «insertar enlace» en Google Docs o el buscador de Slack y
       Discord, Ctrl+S guarda en los editores web y Ctrl+G va a la línea en
       los de código; en una página normal hacen lo de Chrome.
   Sin DOM ni Electron, para poder probarla (test/atajos.test.js). */
(function (raiz) {
  const ctrl = (i) => i.control && !i.shift && !i.alt;
  const ctrlMayus = (i) => i.control && i.shift && !i.alt;
  const alt = (i) => i.alt && !i.control && !i.shift;
  const sola = (i) => !i.control && !i.shift && !i.alt;
  const mayus = (i) => i.shift && !i.control && !i.alt;
  // Zoom: en el teclado inglés el + necesita Mayús, así que Mayús no importa.
  const ctrlZoom = (i) => i.control && !i.alt;

  const ATAJOS = [
    // --- Recargar ---
    { k: ['F5'], mod: sola, cmd: 'reload', reservado: true },
    { k: ['F5'], mod: (i) => (i.shift || i.control) && !i.alt, cmd: 'reload-hard', reservado: true },
    { k: ['r'], mod: ctrl, cmd: 'reload', reservado: true },
    { k: ['r'], mod: ctrlMayus, cmd: 'reload-hard', reservado: true },
    // --- Pestañas y ventanas ---
    { k: ['t'], mod: ctrl, cmd: 'new-tab', reservado: true },
    { k: ['t'], mod: ctrlMayus, cmd: 'reopen-tab', reservado: true },
    { k: ['w', 'F4'], mod: ctrl, cmd: 'close-tab', reservado: true },
    { k: ['n'], mod: ctrl, cmd: 'new-window', reservado: true },
    { k: ['n'], mod: ctrlMayus, cmd: 'new-private' },
    { k: ['Tab'], mod: ctrl, cmd: 'next-tab', reservado: true },
    { k: ['Tab'], mod: ctrlMayus, cmd: 'prev-tab', reservado: true },
    { k: ['PageDown'], mod: ctrl, cmd: 'next-tab' },
    { k: ['PageUp'], mod: ctrl, cmd: 'prev-tab' },
    { k: ['PageDown'], mod: ctrlMayus, cmd: 'move-tab-right' },
    { k: ['PageUp'], mod: ctrlMayus, cmd: 'move-tab-left' },
    // --- Navegación ---
    { k: ['ArrowLeft'], mod: alt, cmd: 'back', reservado: true },
    { k: ['ArrowRight'], mod: alt, cmd: 'forward', reservado: true },
    { k: ['Home'], mod: alt, cmd: 'home' },
    // --- Barra de direcciones ---
    { k: ['F6'], mod: () => true, cmd: 'focus-url', reservado: true },
    { k: ['l'], mod: ctrl, cmd: 'focus-url', reservado: true },
    { k: ['d'], mod: alt, cmd: 'focus-url' },
    { k: ['k', 'e'], mod: ctrl, cmd: 'focus-search' },
    // --- Buscar en la página ---
    { k: ['f'], mod: ctrl, cmd: 'find', reservado: true },
    { k: ['F3'], mod: sola, cmd: 'find-next', reservado: true },
    { k: ['F3'], mod: mayus, cmd: 'find-prev', reservado: true },
    { k: ['g'], mod: ctrl, cmd: 'find-next' },
    { k: ['g'], mod: ctrlMayus, cmd: 'find-prev' },
    // --- Página ---
    { k: ['+', '=', 'Add'], mod: ctrlZoom, cmd: 'zoom-in', reservado: true },
    { k: ['-', 'Subtract'], mod: ctrlZoom, cmd: 'zoom-out', reservado: true },
    { k: ['0'], mod: ctrlZoom, cmd: 'zoom-reset', reservado: true },
    { k: ['p'], mod: ctrl, cmd: 'print' },
    { k: ['s'], mod: ctrl, cmd: 'save-page' },
    { k: ['u'], mod: ctrl, cmd: 'view-source' },
    { k: ['d'], mod: ctrl, cmd: 'bookmark', reservado: true },
    { k: ['p'], mod: alt, cmd: 'pip', reservado: true },
    // --- Paneles ---
    { k: ['j'], mod: ctrl, cmd: 'downloads', reservado: true },
    { k: ['h'], mod: ctrl, cmd: 'history', reservado: true },
    { k: ['Delete'], mod: ctrlMayus, cmd: 'clear-data' },
    // --- Ventana ---
    { k: ['F11'], mod: () => true, cmd: 'fullscreen', reservado: true },
    { k: ['F12'], mod: () => true, cmd: 'devtools', reservado: true },
    // Lo daba el menú oculto de Electron, que ya no existe (ver Menu.setApplicationMenu).
    { k: ['i'], mod: ctrlMayus, cmd: 'devtools', reservado: true },
    // Reservado para los addons (naviris.onAtajo en el renderer): sin esto un
    // atajo de addon solo respondería con el foco en la interfaz.
    { k: ['s'], mod: alt, cmd: 'addon-s', reservado: true }
  ];

  // Las teclas que siguen vivas con los atajos apagados (Ajustes): quedarse en
  // pantalla completa o sin DevTools no tiene salida.
  const SIEMPRE = new Set(['F11', 'F12']);

  const igual = (a, b) => a === b || (a.length === 1 && a.toLowerCase() === b.toLowerCase());

  /* El comando de una pulsación, o null. `i` = { key, control, shift, alt }
     (el `input` de before-input-event, o un KeyboardEvent traducido).
     `soloReservados` = el camino de main: solo lo que se le quita a la web. */
  function comandoDe(i, { soloReservados = false, activos = true } = {}) {
    const tecla = String((i && i.key) || '');
    if (!tecla) return null;
    if (!activos && !SIEMPRE.has(tecla)) return null;
    for (const a of ATAJOS) {
      if (soloReservados && !a.reservado) continue;
      if (!a.k.some((k) => igual(tecla, k))) continue;
      if (a.mod(i)) return a.cmd;
    }
    // Ctrl+1…8 va a esa pestaña y Ctrl+9 a la última, como en Chrome.
    if (ctrl(i) && /^[1-9]$/.test(tecla)) return 'tab-' + tecla;
    return null;
  }

  // La pestaña que cierra Ctrl+W (o Ctrl+F4): la activa, salvo si está fijada.
  // Decisión de Dosa (2026-11-03): las fijadas se cierran desde su menú.
  const cierraConAtajo = (tab) => !!tab && !tab.pinned;

  const api = { ATAJOS, comandoDe, cierraConAtajo };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.naviAtajos = api;
})(typeof window !== 'undefined' ? window : globalThis);
