const { contextBridge, ipcRenderer } = require('electron');

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
  onDownloadNew: (cb) => ipcRenderer.on('download:new', (_e, m) => cb(m)),
  onDownloadUpdate: (cb) => ipcRenderer.on('download:update', (_e, m) => cb(m)),

  fetchFavicon: (pageUrl) => ipcRenderer.invoke('favicon:fetch', pageUrl),

  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.send('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s)),

  onOpenUrl: (cb) => ipcRenderer.on('tab:open-url', (_e, payload) => cb(payload)),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  pwAvailable: () => ipcRenderer.invoke('pw:available'),
  pwList: () => ipcRenderer.invoke('pw:list'),
  pwAdd: (site, username, password) => ipcRenderer.invoke('pw:add', { site, username, password }),
  pwForHost: (host) => ipcRenderer.invoke('pw:for-host', host),
  pwDelete: (id) => ipcRenderer.invoke('pw:delete', id),
  pwReveal: (id) => ipcRenderer.invoke('pw:reveal', id),

  onPermAsk: (cb) => ipcRenderer.on('perm:ask', (_e, req) => cb(req)),
  permRespond: (id, decision, remember) => ipcRenderer.send('perm:respond', { id, decision, remember }),
  permList: () => ipcRenderer.invoke('perm:list'),
  permRemove: (key) => ipcRenderer.invoke('perm:remove', key),
  permClear: () => ipcRenderer.invoke('perm:clear'),
  secStatus: () => ipcRenderer.invoke('sec:status')
});
