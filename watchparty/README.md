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
  Netflix, la suya interna). Se sirve desde `naviris.site/addons/`: publicarlo
  es empujar al repo y subir la versión en `addons/catalog.json`. OJO: lo que
  ya está instalado NO se actualiza solo; cada persona tiene que darle a
  «Actualizar a vX» en la página de addons (hasta entonces sigue con su copia
  en `userData/addons/`).
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
| `join` | todos | `room`, `name`, `host` (lo pide; lo decide el relay), `clave` (la de anfitrión, si se tiene), `sid` (sesión del cliente), `again` al reconectar, `foto` opcional (una vez) |
| `beat` | anfitrión, cada 2 s | `url` (canónica), `tit`, `time`, `paused`, `lock`, `nlock` |
| `ev` | quien actúa | `kind`: `play` / `pause` / `seek` (+ `time`) o `nav` (+ `url`) |
| `chat` | todos | `msg` |
| `perfil` | todos, al entrar y cuando entra otro | `foto` (data URI png/jpeg/webp) |
| `ping` | el addon, cada 15 s | nada: el relay contesta `pong` solo a quien lo manda |

`ping`/`pong` es el vigía de la conexión: un socket puede morir sin avisar
(suspensión, cambio de red) y seguir "abierto". Si el relay ya contestó algún
`pong` y pasan 40 s sin llegar nada, el addon da el socket por muerto y vuelve
a entrar. Contra un relay sin `pong` no vigila. En el worker lo contesta la
respuesta automática de la API de hibernación, sin despertar al objeto.
Un mensaje de más de 64 KB cierra ese socket con el código 1009 (en los dos).

El relay reenvía `ev`, `beat`, `chat` y `perfil` a todos menos al emisor, añadiendo
`from` y `host` (del attachment del join: es el único dato de quién manda en
el que se puede confiar) y borrando el `who` que mande el cliente. Responde `joined` al que entra y avisa a los demás
con `peers` (`n`, `who`, `joined` / `left`, `again`). Con `sid`, un socket
viejo de la misma sesión se cierra en silencio al reconectar: sin eso la sala
contaba a la misma persona dos veces y anunciaba un "salió" fantasma.

**Quién es el anfitrión lo decide el relay**, no el `host` del join (antes
cualquiera con el código entraba como anfitrión y movía a toda la sala). Es
anfitrión quien crea la sala (entra el primero pidiéndolo), quien presenta la
`clave` de la sala, quien repite el `sid` del anfitrión (así reconectan los
clientes viejos, que no conocen la clave; el sid nunca se reenvía) o quien lo
pide en una sala que aún no ha tenido anfitrión. Los demás son invitados
aunque lo pidan. La `clave` va solo en el `joined` del anfitrión; si otra
sesión vuelve con ella, la anterior pasa a invitado y recibe `rol`
(`host: false`). Una sala vacía se olvida: el siguiente que entra la crea.

Con eso el relay filtra: el `beat` solo se reenvía si es del anfitrión (y de
él toma `lock`/`nlock`); el `ev` de un invitado llega a todos si el
anfitrión lo permite (play/pausa/salto sin control exclusivo, `nav` con el
cambio de video abierto) y si no, solo al anfitrión, que decide (la pantalla
de MOOVIN obedece así a su mando, que entra como invitado). Ningún `beat` ni
`nav` que apunte a iris.it.com (caducado) se reenvía.

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
npm test           # test/watchparty-relay.test.js contra server.js y
                   # test/watchparty-worker.test.js (el worker con un Durable Object simulado)
npm run test:e2e   # test/e2e/watch-party.test.js: dos Naviris reales en YouTube
```

`npm test` arranca `server.js` en un puerto libre y prueba salas, reenvío,
reconexión con `sid`, anfitrión que se va, `ping`, mensajes inválidos y el
tope de 64 KB. La MISMA batería sirve para el worker sin desplegarlo:

```bash
cd watchparty/worker && npx wrangler dev --port 8792      # en otra consola
WP_RELAY_URL=ws://127.0.0.1:8792 npm test
```

El e2e abre dos Naviris desde el repo (perfiles temporales, puertos CDP
`WP_E2E_PUERTOS`, por defecto 9402 y 9412), carga el addon del repo en la
interfaz por CDP, crea la sala en uno, entra con el código desde el hub del
otro y comprueba play, pausa, salto y chat en los dos sentidos contra el relay
de producción (o el de `WP_E2E_RELAY`, p. ej. `ws://127.0.0.1:8792` con
`wrangler dev`: recarga la interfaz sin CSP para poder conectar). Necesita red. Un perfil nuevo en la UE ve el aviso de cookies
de YouTube, que pausa el video hasta que se responde: el test lo rechaza.

## Reproducción con DRM

Crunchyroll, Netflix y Disney+ usan Widevine. Naviris lo trae desde la 2.6
(castlabs Electron + firma VMP de producción en `build/evs-sign.js`); el addon
en sí no depende de Widevine y la sincronía se prueba sobre cualquier
`<video>` (YouTube, MOOVIN).
