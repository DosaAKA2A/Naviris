# Benchmark de Naviris

Los guiones con los que se midió [PERFORMANCE.md](../PERFORMANCE.md). Lanzan cada navegador con un perfil propio, lo manejan por CDP (el protocolo de depuración de Chromium) y miden el árbol de procesos entero con PowerShell. Los resultados del 11 de noviembre de 2026 están en [`resultados/2026-11-11.json`](resultados/2026-11-11.json), con cada valor suelto.

## Qué necesitas

- Windows 10 u 11 y Node 22 o más nuevo (usa el `WebSocket` y el `fetch` de Node, sin dependencias).
- Naviris en una de estas dos formas:
  - el código de este repo con sus dependencias instaladas (`npm install` en la raíz). Es lo que se usó en la medida publicada;
  - un Naviris instalado o portable, indicando su `Naviris.exe` en `NAVIRIS_EXE`.
- Chrome y Brave instalados. Edge es opcional.
- Entre 4 y 5 horas con el equipo libre para la batería entera, sin juegos, descargas ni videos de fondo. Cada medida apunta el uso de CPU del resto del equipo para que se vea con cuánto ruido se midió.

## Rutas

Todo se puede cambiar con variables de entorno. Si no pones nada, se usa lo de la derecha.

| Variable | Por defecto |
|---|---|
| `NAVIRIS_REPO` | la raíz de este repo |
| `NAVIRIS_EXE` | sin valor: se mide el código de `NAVIRIS_REPO` con su Electron |
| `CHROME_EXE` | `%ProgramFiles%\Google\Chrome\Application\chrome.exe` (o la instalación por usuario) |
| `BRAVE_EXE` | `%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe` (o la instalación por usuario) |
| `EDGE_EXE` | `%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe` |
| `NAVIRIS_BENCH_TRABAJO` | `benchmark/trabajo/` (perfiles, semillas, medidas y registros; está en `.gitignore`) |

Los guiones nunca tocan tus perfiles de siempre: cada navegador arranca con `--user-data-dir` dentro de la carpeta de trabajo. Puertos CDP: 9422 para Naviris y el control, 9442 Chrome, 9452 Brave, 9472 Edge, y 9462 para el servidor local del arranque. Si tienes uno de esos navegadores abierto con el mismo puerto de depuración, ciérralo antes.

## Cómo se corre

Todo de una vez:

```bash
node benchmark/corre.mjs              # etiqueta = fecha de hoy
node benchmark/corre.mjs prueba edge  # con Edge además de Naviris, Chrome y Brave
```

O por partes. Todos aceptan `<repeticiones> [etiqueta] [navegadores]`:

```bash
node benchmark/semillas.mjs naviris,chrome,brave     # perfiles semilla, 2 min cada uno
node benchmark/arranque.mjs 5 prueba naviris,chrome,brave
node benchmark/consumo.mjs  3 prueba naviris,naviris-sin,chrome,brave
node benchmark/cargas.mjs   5 prueba naviris,naviris-sin,chrome,brave
node benchmark/youtube.mjs  3 prueba naviris,chrome,brave
node benchmark/bench.mjs    3 prueba naviris,electron,chrome,brave
node benchmark/resumen.mjs  prueba
```

`naviris-sin` es Naviris con el bloqueador apagado y `electron` es el control: el mismo Electron de Naviris con una ventana en blanco (`electron-solo/`). Si un guion se corta, al volver a correrlo con la misma etiqueta sigue donde se quedó (salvo el arranque, que empieza de cero).

| Guion | Qué mide | Tiempo aprox. |
|---|---|---|
| `semillas.mjs` | Crea un perfil inicializado por navegador (listas del bloqueador ya bajadas). El resto parte de una copia | 2 min por navegador |
| `arranque.mjs` | Hasta la primera ventana visible y hasta cargar una página local, con perfil nuevo y con perfil existente | 5 min |
| `consumo.mjs` | Memoria (private bytes, working set privado y total) y CPU de todo el árbol en reposo, con 1, 5 y 10 sitios, delante y al fondo | 2 h |
| `cargas.mjs` | Carga hasta `load` y LCP de 10 sitios con caché vacía | 40 min |
| `youtube.mjs` | 60 s de un video: CPU, memoria y frames perdidos | 20 min |
| `bench.mjs` | Speedometer 3.1, JetStream 2.2 y MotionMark 1.3.1 | 2 h |
| `micro-adblock.cjs` | Coste del motor del bloqueador por consulta, en Node, sin navegador | segundos |
| `resumen.mjs` | Junta todo en `trabajo/resultados-<etiqueta>.json` y saca las tablas de PERFORMANCE.md | — |

## Qué sale

- `trabajo/medidas/<guion>-<etiqueta>.json`: cada pasada con sus cifras y el ruido del equipo en ese momento.
- `trabajo/medidas/procesos/`: el detalle por proceso de cada medida de memoria.
- `trabajo/resultados-<etiqueta>.json`: mediana, mínimo, máximo, n y valores sueltos de cada cifra, más el equipo y las versiones detectadas.
- Las tablas en Markdown por la salida estándar. Con un resultado ya guardado también funciona: `node benchmark/resumen.mjs benchmark/resultados/2026-11-11.json`.

Para publicar unos resultados nuevos, copia `resultados-<etiqueta>.json` a `resultados/AAAA-MM-DD.json` y actualiza PERFORMANCE.md con sus tablas.

## En GitHub Actions

El workflow **Benchmark** (`.github/workflows/benchmark.yml`) se lanza a mano y corre lo que tiene sentido en una máquina virtual: el arranque de Naviris frente al Chrome del runner y el coste del motor del bloqueador. Deja las tablas en el resumen de la ejecución y los JSON como artefacto. Sus cifras solo valen dentro de esa misma ejecución, porque el runner cambia de hardware y de carga. Las comparaciones de PERFORMANCE.md se miden en un equipo fijo.

## Firefox y Edge

Edge ya está: es Chromium y se maneja igual que Chrome. Añádelo con `edge` en la lista de navegadores y crea antes su semilla (`semillas.mjs edge`).

Firefox no está. Ya no habla CDP, así que necesita su propio camino con WebDriver BiDi: abrir pestañas, leer `performance` en la página y cerrar. Lo de medir procesos, el arranque y el resumen sirve tal cual. El sitio para añadirlo es `NAVS` en `lib.mjs`, con un `tipo` nuevo.

## Límites conocidos

- La caché de disco de Windows está caliente en todos los arranques. Un arranque en frío de verdad exige reiniciar el equipo entre pasadas.
- La ventana de 1280×800 hace que YouTube elija 480p. Otras calidades no están medidas.
- Algunos sitios sirven páginas distintas según el navegador (Reddit, NYTimes). Por eso la comparación sitio a sitio vale más que la suma.
- 3 a 5 repeticiones bastan para ver diferencias claras, no para un p95. `resumen.mjs` solo lo calcula con 20 valores o más.
