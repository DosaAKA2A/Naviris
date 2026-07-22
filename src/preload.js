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
  ytDownload: (url, mode) => ipcRenderer.invoke('yt:download', { url, mode }),
  ytAvailable: () => ipcRenderer.invoke('yt:available'),
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

  onOpenUrl: (cb) => ipcRenderer.on('tab:open-url', (_e, url) => cb(url)),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url)
});
