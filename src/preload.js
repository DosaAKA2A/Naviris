const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('cobalt', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  newPrivateWindow: () => ipcRenderer.send('win:new-private'),
  onMaximized: (cb) => ipcRenderer.on('win:maximized', (_e, v) => cb(v)),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  restart: () => ipcRenderer.send('app:restart'),
  version: () => ipcRenderer.invoke('app:version'),
  gpuStatus: () => ipcRenderer.invoke('gpu:status'),

  adblockGet: () => ipcRenderer.invoke('adblock:get'),
  adblockSetEnabled: (v) => ipcRenderer.invoke('adblock:set-enabled', v),
  adblockWhitelist: (action, domain) => ipcRenderer.invoke('adblock:whitelist', { action, domain }),

  download: (url, isPrivate) => ipcRenderer.send('download:url', { url, isPrivate }),
  ytDownload: (url, mode, quality) => ipcRenderer.invoke('yt:download', { url, mode, quality }),
  ytFormats: (url) => ipcRenderer.invoke('yt:formats', url),
  ytAvailable: () => ipcRenderer.invoke('yt:available'),
  importAvailable: () => ipcRenderer.invoke('import:available'),
  importBookmarks: (key) => ipcRenderer.invoke('import:bookmarks', key),
  cancelDownload: (id) => ipcRenderer.send('download:cancel', id),
  openDownload: (id) => ipcRenderer.send('download:open', id),
  revealDownload: (id) => ipcRenderer.send('download:reveal', id),
  downloadPath: (id) => ipcRenderer.invoke('download:path', id),
  clearDownloads: () => ipcRenderer.send('download:clear'),
  listDownloadFiles: () => ipcRenderer.invoke('downloads:files'),
  openDownloadFile: (name) => ipcRenderer.send('downloads:open-file', name),
  revealDownloadFile: (name) => ipcRenderer.send('downloads:reveal-file', name),
  openDownloadsFolder: () => ipcRenderer.send('downloads:open-folder'),
  onDownloadNew: (cb) => ipcRenderer.on('download:new', (_e, m) => cb(m)),
  onDownloadUpdate: (cb) => ipcRenderer.on('download:update', (_e, m) => cb(m)),

  fetchFavicon: (pageUrl) => ipcRenderer.invoke('favicon:fetch', pageUrl),

  toggleFullscreen: () => ipcRenderer.send('win:fullscreen'),
  onShortcut: (cb) => ipcRenderer.on('ui:shortcut', (_e, cmd) => cb(cmd)),
  // Clic derecho en la zona de arrastre de la barra: el main lo intercepta
  // ('system-context-menu') y manda las coordenadas ya en píxeles de la página
  onTabstripMenu: (cb) => ipcRenderer.on('ui:tabstrip-menu', (_e, p) => cb(p)),

  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateChannels: () => ipcRenderer.invoke('update:channels'),
  updateChoose: (line) => ipcRenderer.invoke('update:choose', line),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.send('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),

  onOpenUrl: (cb) => ipcRenderer.on('tab:open-url', (_e, payload) => cb(payload)),
  onContextAction: (cb) => ipcRenderer.on('ctx:accion', (_e, m) => cb(m)),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  pwAvailable: () => ipcRenderer.invoke('pw:available'),
  pwList: () => ipcRenderer.invoke('pw:list'),
  pwAdd: (site, username, password) => ipcRenderer.invoke('pw:add', { site, username, password }),
  pwForHost: (host) => ipcRenderer.invoke('pw:for-host', host),
  pwDelete: (id) => ipcRenderer.invoke('pw:delete', id),
  pwImportCsv: () => ipcRenderer.invoke('pw:import-csv'),
  pwReveal: (id) => ipcRenderer.invoke('pw:reveal', id),

  cardsList: () => ipcRenderer.invoke('cards:list'),
  cardsAdd: (card) => ipcRenderer.invoke('cards:add', card),
  cardsDelete: (id) => ipcRenderer.invoke('cards:delete', id),
  cardsReveal: (id) => ipcRenderer.invoke('cards:reveal', id),
  cardsFill: (id) => ipcRenderer.invoke('cards:fill', id),

  addonsCatalog: () => ipcRenderer.invoke('addons:catalog'),
  addonsList: () => ipcRenderer.invoke('addons:list'),
  addonsInstall: (meta) => ipcRenderer.invoke('addons:install', meta),
  addonsUninstall: (id) => ipcRenderer.invoke('addons:uninstall', id),
  addonsToggle: (id, on) => ipcRenderer.invoke('addons:toggle', { id, on }),
  addonsCode: (id) => ipcRenderer.invoke('addons:code', id),
  savePng: (dataUrl, suggestedName) => ipcRenderer.invoke('file:save-png', { dataUrl, suggestedName }),
  // Fondo del hub a resolución completa: copia el archivo a userData.
  // filePath usa webUtils porque File.path se retiró en Electron 32+.
  filePath: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  setWallpaper: (ruta) => ipcRenderer.invoke('hub:set-wallpaper', ruta),
  pickWallpaper: () => ipcRenderer.invoke('hub:pick-wallpaper'),

  siteData: (url, partition) => ipcRenderer.invoke('site:data', { url, partition }),
  siteClear: (url, partition) => ipcRenderer.invoke('site:clear', { url, partition }),
  spotifyLogged: () => ipcRenderer.invoke('spotify:logged'),
  gmailFeed: () => ipcRenderer.invoke('gmail:feed'),
  lensImagen: (datos) => ipcRenderer.invoke('lens:imagen', datos),
  sysStats: () => ipcRenderer.invoke('sys:stats'),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: (t) => ipcRenderer.invoke('clip:write', t),

  onPermAsk: (cb) => ipcRenderer.on('perm:ask', (_e, req) => cb(req)),
  permRespond: (id, decision, remember) => ipcRenderer.send('perm:respond', { id, decision, remember }),
  permList: () => ipcRenderer.invoke('perm:list'),
  permRemove: (key) => ipcRenderer.invoke('perm:remove', key),
  permClear: () => ipcRenderer.invoke('perm:clear'),
  secStatus: () => ipcRenderer.invoke('sec:status')
});
