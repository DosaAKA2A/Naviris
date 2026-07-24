# Naviris Watch Party

Ver series/pelis a la vez con amigos en **Crunchyroll** y **Netflix**, estilo
Teleparty pero más simple y sin depender de servicios de terceros.

## Cómo funciona (importante)

**No se transmite vídeo.** Cada persona reproduce su **propia copia** con su
**propia cuenta**; lo único que viaja por la red son las **señales de control**
(play / pausa / seek), el latido del anfitrión y el chat. Esto lo hace ligero y
evita problemas de DRM/derechos: por el cable solo va "ve al minuto 12:34".

Consecuencia: cada participante necesita su suscripción y que el título esté
disponible en su región.

Dos piezas:

- **`server.js`** — relay WebSocket con salas efímeras en memoria. Sin
  dependencias externas (hace el handshake y el framing con módulos nativos de
  Node). Reenvía los mensajes entre los miembros de una sala; nunca al emisor.
- **`../addons/watch-party.js`** — addon de Naviris que se inyecta en
  crunchyroll.com / netflix.com: pone un panel para crear/unirse a una sala,
  lee y controla el reproductor de la página, y sincroniza vía el servidor.
  Anfitrión-autoritativo: quien crea la sala emite su tiempo cada 2 s y los
  demás corrigen si se desvían más de 1,5 s. Cualquiera puede dar play/pausa/seek.

## Requisito de reproducción: Widevine

Crunchyroll y Netflix usan **DRM Widevine**. Electron estándar no lo trae, así
que Naviris **no puede reproducir** ese vídeo hasta migrar la base a
**castlabs "Electron for Content Security" (ECS)**, que empaqueta el CDM:

1. `package.json` → `"electron": "github:castlabs/electron-releases#v33.2.0+wvcus"`
   (mismo Electron 33.2.0 que ya usamos, solo que con Widevine).
2. `src/main.js` ya inicializa el componente antes de crear ventanas
   (`await components.whenReady()`, con guard para Electron estándar).
3. Para el instalable (release) hace falta **firma VMP** con la herramienta
   gratuita de castlabs (`castlabs-evs`) como paso de `electron-builder`. En
   desarrollo (`npm start`) Widevine funciona sin firmar para poder probar.

El addon en sí **no** depende de Widevine; se puede desarrollar/probar la
sincronía sobre cualquier `<video>`.

## Desplegar el servidor

Necesita un host Node encendido con **TLS (wss://)** — porque las páginas de
Crunchyroll/Netflix son https y no pueden abrir un `ws://` inseguro.

```bash
# local (pruebas)
node server.js                 # escucha en :8787 ; GET /health -> ok

# producción: detrás de un proxy con TLS (Caddy/Nginx) o en Fly.io / Railway /
# Cloudflare, exponiendo wss://party.naviris.site  ->  127.0.0.1:8787
PORT=8787 node server.js
```

Luego, en el addon, `SERVER` apunta a esa URL (o se puede sobreescribir con
`localStorage.__navPartyServer`).

## Probar

```bash
node test.js     # 2 clientes simulados en una sala: relay, sin eco, peers, chat, latido
```
