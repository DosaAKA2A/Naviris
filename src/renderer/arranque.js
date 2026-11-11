/* Arranque: carga los addons y monta la interfaz con lo guardado. Va casi al final porque usa todo lo anterior. */

// Los addons se cargan cuando ya está todo lo que su API puede llamar.
loadToolAddons();

/* Arranque */
(async function init() {
  migraFondoPorTema(); // antes de applyTheme(): el es quien aplica el fondo del tema
  settings = await window.navirisApp.getSettings();
  els.optPowersaver.checked = settings.powerSaver; els.optGpu.checked = settings.hardwareAcceleration; els.optAgent.checked = !!settings.agentMode; els.optUpdauto.checked = settings.updatesAuto !== false;
  els.optAtajos.checked = settings.atajos !== false; els.optMousenav.checked = settings.mouseNav !== false;
  els.optPreguntarDescargas.checked = !!settings.preguntarDescargas; pintaBuscador();
  els.optSonidos.checked = settings.sonidos !== false;
  els.optVtabs.checked = !!settings.tabsVerticales; aplicaVerticales(settings.tabsVerticales);
  contenedores = Array.isArray(settings.contenedores) ? settings.contenedores : [];
  espacios = Array.isArray(settings.espacios) ? settings.espacios : [];
  // La ventana privada no hereda el espacio: lo que nace en ella es privado, no del espacio.
  espacioActivo = IS_PRIVATE ? null : (settings.espacioActivo || null);
  /* Se ESPERA antes de restaurar la sesión: las pestañas que se crean al
     arrancar nacen en el espacio activo, y tiene que estar decidido ya. */
  await window.navirisApp.espDesbloqueados().then(async (lista) => {
    espDesbloqueados = new Set(lista || []);
    // Si al arrancar el espacio activo está bloqueado y no se ha abierto en esta
    // sesión, no se entra: se cae al General. Si no, bastaría reiniciar para ver
    // dentro sin escribir la contraseña.
    const esp = espacioActivo ? espacioPorId(espacioActivo) : null;
    if (esp && esp.bloqueado && !espDesbloqueados.has(esp.id)) { espacioActivo = null; renderTabs(true); }
    /* Ya abierto en esta sesión (una ventana más): se cargan SU historial y SUS
       marcadores. Con los generales en memoria, el primer guardado los metería
       en su archivo cifrado. */
    else if (esp && esp.bloqueado) {
      const rd = await window.navirisApp.espDatos(esp.id).catch(() => null);
      if (rd && rd.ok) { history = Array.isArray(rd.datos.historial) ? rd.datos.historial : []; bookmarks = Array.isArray(rd.datos.marcadores) ? rd.datos.marcadores : []; }
    }
  }).catch(() => {});
  // Migración 2.7.3-dev.16: el tema rosa pasó a ser claro. Quien lo eligió en
  // la versión oscura guarda lightMode=false y, sin esto, el arranque lo
  // degradaría a oscuro (y los webviews seguirían renderizando en oscuro).
  if (temaActual() === 'rosa' && !settings.lightMode) settings = await window.navirisApp.setSettings({ lightMode: true });
  els.optLight.checked = !!settings.lightMode; applyTheme(settings.lightMode);
  // Modo agente activo: aviso permanente en la topbar (el puerto CDP está abierto).
  refreshAgentBadge();
  els.optSmartsearch.checked = settings.smartSearch !== false; els.optPasskeys.checked = settings.blockPasskeys !== false;
  const ab = await window.navirisApp.adblockGet(); els.navShield.classList.toggle('off', !ab.enabled);
  if (IS_PRIVATE) { els.privateBadge.classList.remove('hidden'); els.privateBadge.innerHTML = window.icon('eye-slash') + '<span>Privado</span>'; }
  // (el fondo ya lo puso applyTheme: cada tema recuerda el suyo)
  window.navirisApp.version().then((v) => { const el = document.getElementById('hub-version'); if (el) el.textContent = 'Naviris v' + v; });
  els.optRestore.checked = settings.restoreSession !== false;
  renderBookmarksBar(); renderHub();
  if (!IS_PRIVATE) accBootSync(); // cuenta Naviris: baja preferencias si el servidor tiene algo más nuevo
  // Restaura la sesión anterior si el ajuste está activo (por defecto sí, como Brave)
  // La ventana sacada no restaura nada: era copiar todas las pestañas en ella.
  const session = (IS_PRIVATE || SACADA) ? [] : store.get('naviris.session', []);
  if (settings.restoreSession !== false && Array.isArray(session) && session.length) {
    // NINGUNA se carga al arrancar: todas entran DORMIDAS y se abre el hub.
    // Cada pestaña carga solo cuando la seleccionas. Antes se cargaban todas y
    // cualquier página con vídeo se ponía a sonar sola nada más abrir Naviris.
    session.forEach((s) => {
      const t = crearDormida(s); if (s && s.p) t.pinned = true;
      // El icono ya no viaja en la sesión: sale de la caché (sin red si está)
      if (!t.favicon) getTile(t.url).then((x) => { if (x?.icon) { t.favicon = x.icon; renderTabs(); } }).catch(() => {});
    });
    hubDeInicio();
    renderTabs(true);
  } else if (!SACADA) {
    createTab();
  }   // (a la sacada le llega su pestaña justo después de avisar con uiLista)
  /* LA INTERFAZ YA ESTÁ MONTADA. El arranque es ahora una ventana aparte
     (src/splash.html) y ESTA ventana sigue oculta hasta este aviso: así nadie
     ve el esqueleto vacío montándose. El main la enseña y cierra el cuadrado.
     Ver crearSplash()/cerrarSplash() en main.js. */
  window.navirisApp.uiLista();
  // El hub entra escalonado mientras el cuadrado se va: el relevo se solapa,
  // que es lo que hace que parezca una sola secuencia. La clase se quita al
  // terminar, así no queda nada animándose.
  els.hub.classList.add('estrenando');
  if (els.hub.classList.contains('active')) focusUrlbar();
  setTimeout(() => els.hub.classList.remove('estrenando'), 1700);
  // Tras actualizarse sola: panel con lo que cambió (ver actualizaciones.js)
  muestraNovedades();
})();
