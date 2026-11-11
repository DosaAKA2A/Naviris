# Naviris

Naviris por **IRIS Studio** — navegador ligero sobre motor Chromium (Electron). Monocromático, de bajo consumo y con herramientas integradas.

## Características

- **Hub personalizable** con widgets (reloj, buscador, accesos, fecha, clima, región, notas) en una grilla editable.
- **Accesos rápidos** con logos monocromáticos y un sidebar con paneles web (WhatsApp, Discord, Claude…).
- **Rat Tool** — descarga video (MP4) y audio (MP3) de YouTube, Instagram, X, TikTok (sin marca de agua), Twitch y más, con yt-dlp + ffmpeg integrados. YouTube exige ahora resolver retos en JavaScript para dar sus formatos, así que el Rat Tool baja también Deno, el motor de JS que yt-dlp usa por defecto (la primera vez que se abre, o solo Deno en instalaciones que ya tenían lo demás).
- **Bloqueador de anuncios** funcional, incluido un saltador de anuncios de YouTube ligero que no ralentiza la reproducción.
- **Detector de recursos gráficos** con previsualización y descarga.
- **Contenido sensible de X** revelable de forma nativa.
- **Gestor de contraseñas** cifrado con tu cuenta de Windows (DPAPI) y verificación con Windows Hello (PIN o biometría) para ver cada contraseña.
- **Búsqueda inteligente** con autocompletado desde tu historial.
- **Navegación privada**, ahorro de energía (duerme pestañas), aceleración por GPU.
- **Marcadores con carpetas**, visor de resoluciones y modo agente (CDP) para automatización.
- **Actualización automática** desde GitHub Releases (menú → Buscar actualizaciones).

## Desarrollo

```bash
npm install
npm run fetch-bin   # descarga yt-dlp.exe, ffmpeg.exe y deno.exe a resources/bin
npm start
```

## Compilar

```bash
npm run dist        # genera instalador NSIS + portable en dist/
```

## Canales, pruebas y publicación

### Canales de actualización

Naviris tiene dos líneas que no se cruzan:

- **Estable** (versiones como `2.8.1`): se publica como release normal de GitHub con el feed `latest.yml`. Las instalaciones estables solo ven estables.
- **Dev** (versiones con `-dev`, como `3.0.0-dev.1`; la instalación se llama NavirisDev): release marcada como *prerelease* con el feed `dev.yml`. Las instalaciones dev solo ven devs.

Desde el menú, en las actualizaciones, se puede instalar a mano la última de la otra línea. Quién escucha qué está en `src/canal-actualizaciones.js`; el feed y sus comprobaciones, en `build/feed-actualizador.js`. Cada versión publicada tiene su entrada en [CHANGELOG.md](CHANGELOG.md) y sus novedades en `novedades/`.

### Cómo se prueba

```bash
npm run check          # node --check de todo src/
npm test               # pruebas unitarias (sin abrir la app)
npm run test:e2e:ci    # la app real, sin red de terceros ni cuentas (repite una vez el archivo que falle)
npm run test:e2e       # todas las de la app real, también las que necesitan YouTube, X o el relay de Watch Party
npm run test:e2e:adblock
```

Las pruebas con la app real arrancan Naviris con un perfil temporal propio y hablan con ella por CDP. El puerto se elige con `NAVIRIS_E2E_PUERTO` (y `NAVIRIS_E2E_PORT` para la de perfiles). `test/actualizador.test.js` pasa los feeds que genera el publicador por el mismo electron-updater de la app, contra un GitHub simulado: comprueba versión, sha512, tamaño y nombre, y que una estable nunca recibe una dev.

En GitHub, el workflow **Pruebas** (`.github/workflows/pruebas.yml`) corre `npm run check`, `npm test` y `npm run test:e2e:ci` en Windows en cada push y pull request a `main` y `v3`. Notas de instalación en CI: `electron` es el de castlabs y viene de GitHub por git (el workflow reescribe ssh a https porque el runner no tiene clave), el binario se baja con `node node_modules/electron/install.js`, `adblock-rs` se compila con Rust (el runner trae rustup) y la firma VMP de Widevine no hace falta para probar.

### Cómo se publica

1. Sube la versión en `package.json` y añade su entrada en `CHANGELOG.md` y en `novedades/`.
2. Exporta un token de GitHub con permiso `repo` (`GH_TOKEN`).
3. `npm run release`: compila con la firma VMP (`npm run dist`) y luego `build/publish-release.js`:
   - corre `npm test` y **no publica si falla**;
   - genera el feed de su línea (`latest.yml` o `dev.yml`, nunca los dos), comprueba que cuadra con el instalador y que la release está marcada como prerelease solo si es dev;
   - sube instalador, portable, blockmap y feed, y vuelve a comprobar el feed tal como lo sirve GitHub.

No se usa `electron-builder --publish`: sus dos publicadores (instalador y portable) chocan y dejan la release a medias.

Solo en una emergencia se puede publicar sin pruebas con `NAVIRIS_PUBLICAR_SIN_PRUEBAS=1`; el script lo avisa en la salida. El workflow **Desktop Release** solo compila (sin firma VMP, no se distribuye) y no arranca si **Pruebas** falla.

## Licencia

MIT © IRIS Studio
