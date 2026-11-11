// Conjunto fijo de sitios. Los 5 primeros son los de «5 sitios» en consumo.mjs; los 10, los de «10 sitios».
// N=5 en el entorno recorta la lista (para una pasada rápida).
export const SITIOS_TODOS = [
  'https://es.wikipedia.org/wiki/Navegador_web',
  'https://github.com/electron/electron',
  'https://www.youtube.com/',
  'https://developer.mozilla.org/es/',
  'https://www.bbc.com/mundo',
  'https://news.ycombinator.com/',
  'https://www.reddit.com/r/programming/',
  'https://www.amazon.com/',
  'https://www.nytimes.com/',
  'https://elcomercio.pe/'
];
export const SITIOS = process.env.N ? SITIOS_TODOS.slice(0, Number(process.env.N)) : SITIOS_TODOS;
// Big Buck Bunny 60 fps (Blender, canal oficial): estable, largo y con 1080p60.
export const VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
