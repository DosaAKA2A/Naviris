# Cobalt

Cobalt por **Studio Iris** — navegador ligero sobre motor Chromium (Electron). Monocromático, de bajo consumo y con herramientas integradas.

## Características

- **Hub personalizable** con widgets (reloj, buscador, accesos, fecha, clima, región, notas) en una grilla editable.
- **Accesos rápidos** con logos monocromáticos y un sidebar con paneles web (WhatsApp, Discord, Claude…).
- **Rat Tool** — descarga vídeo (MP4) y audio (MP3) de YouTube, Instagram, X, TikTok (sin marca de agua), Twitch y más, con yt-dlp + ffmpeg integrados.
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
npm run fetch-bin   # descarga yt-dlp.exe y ffmpeg.exe a resources/bin
npm start
```

## Compilar

```bash
npm run dist        # genera instalador NSIS + portable en dist/
```

## Publicar una nueva versión (auto-update)

1. Sube la versión en `package.json` (p. ej. `1.0.1`).
2. Exporta un token de GitHub con permiso `repo`:
   ```bash
   export GH_TOKEN=tu_token   # en PowerShell: $env:GH_TOKEN="tu_token"
   ```
3. Publica:
   ```bash
   npm run release
   ```
   Esto compila y sube el instalador + `latest.yml` a GitHub Releases. Las copias instaladas detectarán la nueva versión y podrán actualizarse desde el propio navegador.

## Licencia

MIT © Studio Iris
