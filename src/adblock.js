// Bloqueador de anuncios con el motor de Brave (adblock-rs, el crate adblock-rust
// oficial compilado para Node) y las MISMAS listas que usa Brave: se leen de su
// catálogo público y se refrescan solas cada día, así los cambios que Brave
// publica llegan sin actualizar Naviris.
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');

let Engine = null, FilterSet = null;
try { ({ Engine, FilterSet } = require('adblock-rs')); } catch (e) { console.log('[Naviris] adblock-rs no disponible:', e.message); }

const CATALOG_URL = 'https://raw.githubusercontent.com/brave/adblock-resources/master/filter_lists/list_catalog.json';
const RESOURCES_URL = 'https://raw.githubusercontent.com/brave/adblock-resources/master/resources/resources.json';
const REFRESH_MS = 24 * 3600 * 1000; // cadencia de actualización de listas

const dir = () => path.join(app.getPath('userData'), 'adblock');
const rulesFile = () => path.join(dir(), 'brave-rules.txt');
const resourcesFile = () => path.join(dir(), 'brave-resources.json');
const metaFile = () => path.join(dir(), 'meta.json');

let engine = null;
let meta = { updated: 0, lists: 0 };
let refreshing = false;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    let data = '';
    req.on('response', (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' ' + url)); return; }
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

function buildEngine(rulesText, resourcesJson) {
  if (!Engine) return;
  const set = new FilterSet(true);
  set.addFilters(rulesText);
  const e = new Engine(set);
  if (resourcesJson) { try { e.useResources(JSON.parse(resourcesJson)); } catch (err) { console.log('[Naviris] resources del adblock inválidos:', err.message); } }
  engine = e;
}

async function refresh(force = false) {
  if (!Engine || refreshing) return;
  if (!force && Date.now() - meta.updated < REFRESH_MS) return;
  refreshing = true;
  try {
    const catalog = JSON.parse(await fetchText(CATALOG_URL));
    const urls = [];
    for (const list of catalog) {
      if (!list.default_enabled) continue; // el mismo conjunto activo por defecto en Brave
      for (const s of list.sources || []) if (s.url) urls.push(s.url);
    }
    let rules = '';
    let okLists = 0;
    for (const u of urls) {
      try { rules += (await fetchText(u)) + '\n'; okLists++; } catch (e) { /* una lista caída no rompe el resto */ }
    }
    if (!rules) throw new Error('ninguna lista descargada');
    let resources = '';
    try { resources = await fetchText(RESOURCES_URL); } catch (e) { /* scriptlets opcionales */ }
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(rulesFile(), rules, 'utf8');
    if (resources) fs.writeFileSync(resourcesFile(), resources, 'utf8');
    meta = { updated: Date.now(), lists: okLists };
    fs.writeFileSync(metaFile(), JSON.stringify(meta), 'utf8');
    buildEngine(rules, resources);
    console.log('[Naviris] Listas de Brave actualizadas:', okLists, 'listas,', Math.round(rules.length / 1024), 'KB');
  } catch (e) {
    console.log('[Naviris] No se pudieron actualizar las listas de Brave:', e.message);
  }
  refreshing = false;
}

function init() {
  if (!Engine) return;
  // Arranca con la copia en disco (si existe) y refresca en segundo plano
  try {
    meta = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
  } catch (e) { meta = { updated: 0, lists: 0 }; }
  try {
    if (fs.existsSync(rulesFile())) {
      let res = '';
      try { res = fs.readFileSync(resourcesFile(), 'utf8'); } catch (e) { /* sin scriptlets */ }
      buildEngine(fs.readFileSync(rulesFile(), 'utf8'), res);
    }
  } catch (e) { console.log('[Naviris] No se pudo cargar la caché del adblock:', e.message); }
  setTimeout(() => refresh(), 15000);           // tras el arranque, sin bloquearlo
  setInterval(() => refresh(), 6 * 3600 * 1000); // y comprueba cada 6 h (aplica si tocan 24 h)
}

const TYPE_MAP = {
  mainFrame: 'document', subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script',
  image: 'image', font: 'font', object: 'object', xhr: 'xmlhttprequest', ping: 'ping',
  cspReport: 'csp_report', media: 'media', webSocket: 'websocket', other: 'other'
};

// true = bloquear, false = dejar pasar, null = sin motor (usa el fallback clásico)
function shouldBlock(details) {
  if (!engine) return null;
  try {
    const source = details.referrer || details.url;
    return !!engine.check(details.url, source, TYPE_MAP[details.resourceType] || 'other');
  } catch (e) { return null; }
}

// CSS de ocultado (element hiding de las listas) + scriptlets para una URL
function cosmeticsFor(url) {
  if (!engine) return null;
  try {
    const r = engine.urlCosmeticResources(url);
    if (!r) return null;
    let css = '';
    const sel = r.hide_selectors || [];
    for (let i = 0; i < sel.length; i += 200) css += sel.slice(i, i + 200).join(',') + '{display:none !important}\n';
    return { css, script: r.injected_script || '' };
  } catch (e) { return null; }
}

function status() {
  return { engine: !!engine, lists: meta.lists, updated: meta.updated };
}

module.exports = { init, refresh, shouldBlock, cosmeticsFor, status };
