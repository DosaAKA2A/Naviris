# Licencias de los recursos del bloqueador

`resources.json` lo genera `npm run adblock-recursos` (ver `src/adblock-recursos.js`)
a partir de código de terceros. Naviris no lo modifica: lo empaqueta tal cual para
que las listas de filtros tengan con qué trabajar (scriptlets y sustitutos).

- **uBlock Origin** (scriptlets de `src/js/resources/` y sustitutos de
  `src/web_accessible_resources/`): © Raymond Hill y colaboradores, licencia
  GPLv3. Fuente: https://github.com/gorhill/uBlock
- **Brave adblock-resources** (los 17 recursos propios de Brave en
  `dist/resources.json`): © Brave Software, licencia MPL-2.0. Fuente:
  https://github.com/brave/adblock-resources

Estos recursos se inyectan en las páginas web como datos de las listas de
filtros; no forman parte del código de Naviris ni se enlazan con él.
