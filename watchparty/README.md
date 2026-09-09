# Naviris Watch Party

Ver series y películas a la vez con amigos en **Crunchyroll, Netflix, Disney+,
YouTube y MOOVIN**, estilo Teleparty pero más simple y sin depender de servicios
de terceros.

## Cómo funciona (importante)

**No se transmite video.** Cada persona reproduce su **propia copia** con su
**propia cuenta**; lo único que viaja por la red son las **señales de control**
(play / pausa / salto), el latido del anfitrión y el chat. Esto lo hace ligero y
evita problemas de DRM y de derechos: por el cable solo va "ve al minuto 12:34".

Consecuencia: cada participante necesita su suscripción y que el título esté
disponible en su región. Si la pestaña del invitado no aterriza en el video del
anfitrión (Netflix sin sesión manda a la ficha, un perfil sin elegir, un título
que no existe en su país), el addon avisa y deja un botón para reintentar; no
vuelve a cargar la página por su cuenta.

## Piezas

- **`../addons/watch-party.js`** — el addon de Naviris (kind `tool`, corre en el
  renderer). Botón en el riel que toma el color del sitio de la pestaña activa,
  panel lateral acoplado con sala, chat y estado. En la página solo se inyecta un
  agente mínimo que controla el `<video>` (en YouTube, su API de reproductor; en
  Netflix, la suya interna). Se sirve desde `naviris.site/addons/` y se
  actualiza solo: publicarlo es empujar al repo y subir la versión en
  `addons/catalog.json`.
- **`worker/worker.js`** — el relay de PRODUCCIÓN: Cloudflare Worker + Durable
  Object en la cuenta de Studio Iris (`wss://naviris-party.studio-iris2026.workers.dev`).
  Salas en memoria; sockets con la API de hibernación.
- **`server.js`** — el mismo relay en Node, sin dependencias (handshake y
  framing WebSocket a mano). Sirve para desarrollo y como referencia: cualquier
  cambio de protocolo va en los DOS.
- **MOOVIN** (`moovin.live`, repo Iris) lleva el Watch Party integrado en la
  propia página y habla el MISMO protocolo: una sala creada allí y una creada
  desde el addon son intercambiables. La página expone `window.__moovinAbre(v)`
  para que el addon le cambie la película sin recargar.

## Protocolo (cliente → relay → resto de la sala)

| mensaje | quién | contenido |
|---|---|---|
| `join` | todos | `room`, `name`, `host`, `sid` (sesión del cliente), `again` al reconectar, `foto` opcional (una vez) |
| `beat` | anfitrión, cada 2 s | `url` (canónica), `tit`, `time`, `paused`, `lock`, `nlock` |
| `ev` | quien actúa | `kind`: `play` / `pause` / `seek` (+ `time`) o `nav` (+ `url`) |
| `chat` | todos | `msg` |

El relay reenvía `ev`, `beat` y `chat` a todos menos al emisor, añadiendo
`from` y `host` (del attachment del join: es el único dato de quién manda en
el que se puede confiar). Responde `joined` al que entra y avisa a los demás
con `peers` (`n`, `who`, `joined` / `left`, `again`). Con `sid`, un socket
viejo de la misma sesión se cierra en silencio al reconectar: sin eso la sala
contaba a la misma persona dos veces y anunciaba un "salió" fantasma.

Reglas del cliente: anfitrión-autoritativo (los demás corrigen si se desvían
más de 1,5 s); ventana anti-eco de 900 ms tras aplicar un remoto; el salto se
emite en `seeking`, no en `seeked`; play/pausa/salto solo se aplican estando
en el mismo video que el anfitrión; y nada de lo que llega se carga sin
comprobar que es `https` y de un sitio soportado.

## Desplegar el relay

```bash
cd watchparty/worker
npx wrangler deploy
```

`wrangler.toml` lleva el `account_id` de Studio Iris. OJO: en este PC hay un
`CLOUDFLARE_API_TOKEN` y un `CLOUDFLARE_ACCOUNT_ID` de la cuenta personal en el
entorno; si el deploy no sale por `studio-iris2026.workers.dev`, correrlo con
`env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npx wrangler deploy` para
que use la sesión OAuth de Studio Iris. Salud: `GET /health` → `ok`.

El relay de Node en local: `node server.js` (puerto 8787; `PORT=…` para otro).
El CSP del renderer solo permite el host de producción, así que para probar el
addon contra un relay local hay que añadirlo al `connect-src` de `src/index.html`.

## Probar

```bash
node test.js     # 2 clientes simulados contra server.js: relay, sin eco, peers, chat, latido
```

De punta a punta se prueba con dos Naviris a la vez (perfiles aparte con
`--user-data-dir` y `--remote-debugging-port` distintos), cargando el addon
local en el renderer por CDP y usando el relay real. Última pasada completa:
2026-09-09 (YouTube y MOOVIN con video real).

## Reproducción con DRM

Crunchyroll, Netflix y Disney+ usan Widevine. Naviris lo trae desde la 2.6
(castlabs Electron + firma VMP de producción en `build/evs-sign.js`); el addon
en sí no depende de Widevine y la sincronía se prueba sobre cualquier
`<video>` (YouTube, MOOVIN).
