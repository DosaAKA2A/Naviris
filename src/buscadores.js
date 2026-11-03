/* ===== MOTOR DE BÚSQUEDA ELEGIBLE (2026-11-03) =====
   Hasta ahora Google iba fijo en la barra. Dosa aprobó dejar elegir entre los
   cuatro de siempre, con Google por defecto. Lo usan la barra de direcciones,
   «Buscar … en una pestaña nueva» del clic derecho y el widget del clima.
   Sin DOM, para poder probarlo (test/buscadores.test.js). */
(function (raiz) {
  const BUSCADORES = {
    google: { nombre: 'Google', url: 'https://www.google.com/search?q=' },
    duckduckgo: { nombre: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
    bing: { nombre: 'Bing', url: 'https://www.bing.com/search?q=' },
    brave: { nombre: 'Brave Search', url: 'https://search.brave.com/search?q=' }
  };
  const POR_DEFECTO = 'google';

  const buscador = (id) => BUSCADORES[id] || BUSCADORES[POR_DEFECTO];
  const urlDeBusqueda = (id, texto) => buscador(id).url + encodeURIComponent(texto);
  // ¿Esta dirección es una búsqueda del motor elegido? (la sugerencia «Buscar» de la barra)
  const esBusqueda = (id, url) => typeof url === 'string' && url.startsWith(buscador(id).url);

  const api = { BUSCADORES, POR_DEFECTO, buscador, urlDeBusqueda, esBusqueda };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.naviBuscadores = api;
})(typeof window !== 'undefined' ? window : globalThis);
