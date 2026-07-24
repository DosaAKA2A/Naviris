/* Naviris addon: Valve Rat Tool v1.5.0
   Se inyecta en steamcommunity.com. Funciones al estilo Steam Inventory Helper:
   - Precio de Steam bajo cada objeto (moneda de tu cartera, caché 24 h)
   - Precio de mercado real de Skinport (CS2) vía su API pública (USD, caché 1 h)
   - Valor total del inventario visible con selector de mercado (Steam/Skinport)
   - Venta rápida al precio actual del mercado de Steam
   - Ofertas de intercambio: suma el valor de cada lado (en el mercado elegido)
   - Barra de herramientas del inventario: buscar por nombre, ordenar la página
     (precio ↑/↓, nombre) y modo selección con suma del valor de lo seleccionado
   - Venta masiva con el MISMO criterio que SIH: pone lo seleccionado a la venta al
     precio más bajo del mercado (POST directo a market/sellitem/, neto del vendedor
     calculado con los helpers de Steam sobre lowest_price, sin rebaja). Pide
     confirmación antes de publicar.
   Respeta el límite de Steam (~20 consultas/min) con una cola; solo pide precio
   de los objetos de la página visible (no de las miles de páginas ocultas).
   Nota: la comparativa multi-mercado (Buff163/CSFloat…) que ofrece SIH usa su
   backend propio; aquí se usa la API pública de Skinport, un mercado real de
   referencia. El agregado de csgotrader que usábamos dejó de estar disponible. */
(function () {
  if (window.__navSIH) return; window.__navSIH = 1;

  const CCY = (window.g_rgWalletInfo && g_rgWalletInfo.wallet_currency) || 1;

  /* ---------- Cola de precios de Steam con caché ---------- */
  let cache = {};
  try { cache = JSON.parse(localStorage.__navSIHprices || '{}'); } catch (e) { cache = {}; }
  const saveCache = () => { try { localStorage.__navSIHprices = JSON.stringify(cache); } catch (e) { /* lleno */ } };
  const queue = []; let pumping = false;

  function getPrice(appid, hashName) {
    const k = appid + '|' + hashName;
    const hit = cache[k];
    if (hit && Date.now() - hit.t < 864e5) return Promise.resolve(hit.p);
    return new Promise((resolve) => { queue.push({ appid, hashName, k, resolve }); pump(); });
  }
  async function pump() {
    if (pumping) return; pumping = true;
    while (queue.length) {
      const q = queue.shift();
      const again = cache[q.k];
      if (again && Date.now() - again.t < 864e5) { q.resolve(again.p); continue; }
      try {
        const r = await fetch('https://steamcommunity.com/market/priceoverview/?appid=' + q.appid +
          '&currency=' + CCY + '&market_hash_name=' + encodeURIComponent(q.hashName));
        const j = await r.json();
        const p = (j && j.success && (j.lowest_price || j.median_price)) || null;
        cache[q.k] = { p, t: Date.now() }; saveCache();
        q.resolve(p);
      } catch (e) { q.resolve(null); }
      await new Promise((r) => setTimeout(r, 3200)); // límite de Steam
    }
    pumping = false;
  }

  function money(s) {
    if (!s) return 0;
    let t = String(s).replace(/[^0-9.,]/g, '');
    const lc = t.lastIndexOf(','), lp = t.lastIndexOf('.');
    if (lc > -1 && lp > -1) t = lc > lp ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (lc > -1) t = t.replace(',', '.');
    return parseFloat(t) || 0;
  }
  const symbol = (s) => (String(s).match(/[^\d\s.,-]+/) || [''])[0];
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  /* ---------- Precios de mercado real: Skinport API (CS2, USD) ----------
     El agregado de csgotrader (prices_v6) dejó de servirse; Skinport tiene API
     pública y fiable (min_price = venta más barata). Naviris abre CORS para
     api.skinport.com. Se cachea 1 h (Skinport pide no consultarla más seguido). */
  const SKINPORT_URL = 'https://api.skinport.com/v1/items?app_id=730&currency=USD';
  let agg = null, aggLoading = null; // agg: Map hashName -> { skinport:precioUSD }
  function loadAgg() {
    if (agg) return Promise.resolve();
    if (aggLoading) return aggLoading;
    aggLoading = (async () => {
      try {
        const c = await caches.open('navsih-skinport');
        let res = await c.match(SKINPORT_URL);
        const stale = res && (Date.now() - new Date(res.headers.get('date') || 0).getTime() > 36e5);
        if (!res || stale) {
          const fresh = await fetch(SKINPORT_URL);
          if (fresh && fresh.ok) { try { await c.put(SKINPORT_URL, fresh.clone()); } catch (e) {} res = fresh; }
        }
        if (res) {
          const arr = await res.json();
          agg = new Map();
          for (const it of arr) {
            const p = num(it.min_price != null ? it.min_price : it.suggested_price);
            if (it.market_hash_name && p > 0) agg.set(it.market_hash_name, { skinport: p });
          }
        }
      } catch (e) { /* seguimos solo con Steam */ }
    })();
    return aggLoading;
  }
  const MARKETS = [['skinport', 'Skinport', (e) => num(e.skinport)]];
  function marketPrices(hashName) {
    const e = agg && agg.get ? agg.get(hashName) : null;
    if (!e) return null;
    const out = {};
    for (const [k, , get] of MARKETS) { const v = get(e); if (v > 0) out[k] = v; }
    return Object.keys(out).length ? out : null;
  }
  let market = localStorage.__navSIHmarket || 'steam';

  /* ---------- Estilos ---------- */
  const css = document.createElement('style');
  css.textContent = [
    '.navsih-price{position:absolute;left:2px;right:2px;bottom:2px;background:rgba(0,0,0,.8);color:#9ee2b8;',
    'font:600 10px/1.35 Arial,sans-serif;text-align:center;border-radius:3px;pointer-events:auto;z-index:5}',
    '.navsih-price.na{color:#8b8d94}',
    '.navsih-price .alt{display:block;color:#66c0f4;font-weight:500}',
    '#navsih-total{position:fixed;right:14px;bottom:14px;z-index:99999;background:#171a21;color:#c7d5e0;border:1px solid #2a475e;',
    'border-radius:8px;padding:10px 14px;font:12px Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)}',
    '#navsih-total b{color:#9ee2b8;font-size:14px}',
    '#navsih-total .sub{color:#66c0f4;font-size:10.5px;margin-top:2px}',
    '#navsih-total select{margin-left:6px;background:#101014;color:#c7d5e0;border:1px solid #2a475e;border-radius:4px;font-size:11px;padding:2px 4px}',
    '.navsih-sell{display:block;margin:6px 0;padding:7px 12px;background:linear-gradient(to right,#75b022 5%,#588a1b 95%);',
    'color:#d2e885;border:none;border-radius:2px;font:600 12px Arial,sans-serif;cursor:pointer;width:100%}',
    '.navsih-sell:hover{color:#fff}.navsih-sell[disabled]{opacity:.6;cursor:default}',
    '.navsih-side{margin:4px 0;padding:5px 8px;background:rgba(0,0,0,.35);border-radius:4px;color:#9ee2b8;font:600 11px Arial,sans-serif}',
    '#navsih-bar{display:flex;gap:8px;align-items:center;margin:6px 0 12px;flex-wrap:wrap;width:100%;box-sizing:border-box}',
    '#navsih-bar input,#navsih-bar select{background:#101822;color:#c7d5e0;border:1px solid #2a475e;border-radius:4px;font:12px Arial,sans-serif;padding:5px 8px}',
    '#navsih-bar input{min-width:190px}',
    '.navsih-tbtn{background:#2a475e;color:#c7d5e0;border:none;border-radius:4px;font:600 12px Arial,sans-serif;padding:6px 12px;cursor:pointer}',
    '.navsih-tbtn:hover{background:#356089}',
    '.navsih-tbtn.on{background:#66c0f4;color:#0b1218}',
    '.navsih-tbtn.sell{background:linear-gradient(to right,#75b022 5%,#588a1b 95%);color:#d2e885}',
    '.navsih-tbtn.sell:hover{color:#fff}',
    '#navsih-selinfo{color:#c7d5e0;font:12px Arial,sans-serif}',
    '#navsih-selinfo b{color:#9ee2b8}',
    'body.navsih-selecting .inventory_page .item{cursor:pointer}',
    '.item.navsih-sel{outline:2px solid #66c0f4!important;outline-offset:-2px;box-shadow:0 0 9px rgba(102,192,244,.75)}'
  ].join('');
  document.documentElement.appendChild(css);

  const isInventory = /\/(id|profiles)\/[^/]+\/inventory/.test(location.pathname);
  const isTrade = /\/tradeoffer\//.test(location.pathname);

  // Registro de objetos etiquetados: para recalcular totales al cambiar de mercado
  const items = []; // { el, d, steamStr, zone: 'inv'|'yours'|'theirs' }

  function descOf(el) {
    const it = el.rgItem || (el.parentNode && el.parentNode.rgItem);
    if (!it) return null;
    return it.description || it;
  }

  function decorate(entry) {
    const { badge, d } = entry;
    const mp = marketPrices(d.market_hash_name);
    if (!mp) return;
    const best = MARKETS.find(([k]) => mp[k]);
    if (best && !badge.querySelector('.alt')) {
      const alt = document.createElement('span');
      alt.className = 'alt';
      alt.textContent = best[1] + ' $' + mp[best[0]].toFixed(2);
      badge.appendChild(alt);
    }
    badge.title = MARKETS.filter(([k]) => mp[k]).map(([k, l]) => l + ': $' + mp[k].toFixed(2) + ' USD').join('  ·  ') || '';
  }

  function tagItem(el, zone) {
    if (el.dataset.navsih) return;
    const rgi = el.rgItem || (el.parentNode && el.parentNode.rgItem);
    const d = descOf(el);
    if (!d || !d.market_hash_name) return;
    el.dataset.navsih = '1';
    const badge = document.createElement('div');
    badge.className = 'navsih-price'; badge.textContent = '…';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(badge);
    const entry = { el, d, item: rgi, badge, steamStr: null, zone };
    items.push(entry);
    getPrice(d.appid, d.market_hash_name).then((p) => {
      if (p) { entry.steamStr = p; badge.firstChild.textContent = p; refreshTotal(); if (zone !== 'inv') tradeTotals(); }
      else { badge.firstChild.textContent = '—'; badge.classList.add('na'); }
    });
    // El texto va en un nodo propio para poder añadir la línea multi-mercado
    badge.textContent = ''; badge.appendChild(document.createTextNode('…'));
    if (String(d.appid) === '730') loadAgg().then(() => { decorate(entry); refreshTotal(); if (zone !== 'inv') tradeTotals(); });
  }

  function sumFor(list) {
    let sum = 0, n = 0, sym = '';
    for (const it of list) {
      if (market === 'steam') {
        if (it.steamStr) { sum += money(it.steamStr); sym = sym || symbol(it.steamStr); n++; }
      } else {
        const mp = marketPrices(it.d.market_hash_name);
        if (mp && mp[market]) { sum += mp[market]; sym = '$'; n++; }
      }
    }
    return { sum, n, sym: sym || (market === 'steam' ? '' : '$') };
  }

  let totalBox = null;
  function refreshTotal() {
    if (!isInventory) return;
    if (!totalBox) {
      totalBox = document.createElement('div'); totalBox.id = 'navsih-total';
      document.body.appendChild(totalBox);
    }
    const { sum, n, sym } = sumFor(items.filter((i) => i.zone === 'inv'));
    const opts = [['steam', 'Steam']].concat(MARKETS.map(([k, l]) => [k, l]))
      .map(([k, l]) => '<option value="' + k + '"' + (k === market ? ' selected' : '') + '>' + l + '</option>').join('');
    totalBox.innerHTML = 'Valor (visible): <b>' + sum.toFixed(2) + ' ' + sym + '</b><select id="navsih-mk">' + opts + '</select>' +
      '<div class="sub">' + n + ' objeto(s) con precio' + (market !== 'steam' ? ' · USD · datos: Skinport' : '') + ' · Valve Rat Tool</div>';
    totalBox.querySelector('#navsih-mk').addEventListener('change', (e) => {
      market = e.target.value; localStorage.__navSIHmarket = market;
      if (market !== 'steam') loadAgg().then(() => { refreshTotal(); tradeTotals(); });
      refreshTotal(); tradeTotals();
    });
  }

  /* ---------- Venta rápida (mercado de Steam) ---------- */
  function addQuickSell() {
    ['iteminfo0', 'iteminfo1'].forEach((base) => {
      const actions = document.getElementById(base + '_market_actions');
      if (!actions || actions.querySelector('.navsih-sell')) return;
      const sel = window.g_ActiveInventory && g_ActiveInventory.selectedItem;
      const d = sel && (sel.description || sel);
      if (!d || !d.marketable) return;
      const b = document.createElement('button');
      b.className = 'navsih-sell';
      b.textContent = 'Venta rápida al precio del mercado';
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Consultando precio…';
        const p = await getPrice(d.appid, d.market_hash_name);
        if (!p) { b.textContent = 'Sin precio de mercado'; return; }
        b.textContent = 'Abriendo venta a ' + p + '…';
        try { window.SellCurrentSelection(); } catch (e) { b.textContent = 'No se pudo abrir la venta'; return; }
        let tries = 0;
        const t = setInterval(() => {
          const input = document.getElementById('market_sell_buyercurrency_input');
          if (input) {
            clearInterval(t);
            input.value = p; input.dispatchEvent(new Event('keyup'));
            const ssa = document.getElementById('market_sell_dialog_accept_ssa');
            if (ssa) ssa.checked = true;
            const ok = document.getElementById('market_sell_dialog_accept');
            if (ok) { ok.click(); setTimeout(() => document.getElementById('market_sell_dialog_ok')?.click(), 600); }
            b.textContent = 'Puesto a la venta ✔';
          } else if (++tries > 40) clearInterval(t);
        }, 150);
      });
      actions.appendChild(b);
    });
  }

  /* ---------- Ofertas de intercambio ---------- */
  function tradeTotals() {
    if (!isTrade) return;
    [['your_slots', 'yours', 'Tu lado'], ['their_slots', 'theirs', 'Su lado']].forEach(([id, zone, label]) => {
      const zoneEl = document.getElementById(id); if (!zoneEl) return;
      let box = zoneEl.parentNode.querySelector('.navsih-side');
      if (!box) { box = document.createElement('div'); box.className = 'navsih-side'; zoneEl.parentNode.insertBefore(box, zoneEl); }
      const inZone = items.filter((i) => i.zone === zone && zoneEl.contains(i.el));
      const { sum, n, sym } = sumFor(inZone);
      const mkLabel = market === 'steam' ? 'Steam' : (MARKETS.find(([k]) => k === market) || [])[1];
      box.textContent = label + ' (' + mkLabel + '): ' + sum.toFixed(2) + ' ' + sym + ' · ' + n + ' con precio';
    });
  }

  /* ---------- Herramientas de inventario: barra (buscar / ordenar / seleccionar) ---------- */
  const selected = new Set();
  let selectMode = false;
  let selling = false;
  function priceOf(e) {
    if (market === 'steam') return e.steamStr ? money(e.steamStr) : -1;
    const mp = marketPrices(e.d.market_hash_name); return mp && mp[market] ? mp[market] : -1;
  }
  function visibleInv() { return items.filter((i) => i.zone === 'inv' && i.el.offsetParent !== null); }
  function holderOf(e) { return (e.el.closest && e.el.closest('.itemHolder')) || e.el; }

  let bar = null;
  const vis = (e) => e && e.offsetParent !== null;
  function buildToolbar() {
    if (!isInventory) return;
    if (bar && document.body.contains(bar)) return;
    // Ancla: encima de la rejilla de inventario visible (fila a lo ancho).
    let anchor = [...document.querySelectorAll('.inventory_ctn')].find(vis), after = false;
    if (!anchor) { anchor = [...document.querySelectorAll('.filter_ctn')].find(vis); after = true; }
    if (!anchor || !anchor.parentNode) return;
    bar = document.createElement('div'); bar.id = 'navsih-bar';
    bar.innerHTML =
      '<input id="navsih-q" placeholder="Buscar por nombre…" spellcheck="false">' +
      '<select id="navsih-sort" title="Ordena la página visible">' +
        '<option value="">Ordenar…</option>' +
        '<option value="pd">Precio ↓</option><option value="pa">Precio ↑</option>' +
        '<option value="nz">Nombre A-Z</option>' +
      '</select>' +
      '<button id="navsih-sel" class="navsih-tbtn">Seleccionar</button>' +
      '<span id="navsih-selinfo"></span>';
    if (after) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    else anchor.parentNode.insertBefore(bar, anchor);
    bar.querySelector('#navsih-q').addEventListener('input', (e) => applyFilter(e.target.value));
    bar.querySelector('#navsih-sort').addEventListener('change', (e) => applySort(e.target.value));
    bar.querySelector('#navsih-sel').addEventListener('click', toggleSelect);
  }
  function applyFilter(text) {
    const q = String(text || '').trim().toLowerCase();
    visibleInv().forEach((e) => {
      const name = String(e.d.market_hash_name || e.d.name || '').toLowerCase();
      holderOf(e).style.display = (!q || name.indexOf(q) !== -1) ? '' : 'none';
    });
  }
  function applySort(mode) {
    if (!mode) return;
    const list = visibleInv().map((e) => ({ e, h: holderOf(e) })).filter((x) => x.h && x.h.parentNode);
    if (!list.length) return;
    list.sort((a, b) => {
      if (mode === 'nz') return String(a.e.d.market_hash_name || '').localeCompare(String(b.e.d.market_hash_name || ''));
      const pa = priceOf(a.e), pb = priceOf(b.e);
      return mode === 'pa' ? (pa - pb) : (pb - pa);
    });
    const parent = list[0].h.parentNode;
    list.forEach((x) => parent.appendChild(x.h));
  }
  function toggleSelect() {
    selectMode = !selectMode;
    const b = document.getElementById('navsih-sel'); if (b) b.classList.toggle('on', selectMode);
    document.body.classList.toggle('navsih-selecting', selectMode);
    if (!selectMode) { selected.clear(); document.querySelectorAll('.item.navsih-sel').forEach((el) => el.classList.remove('navsih-sel')); }
    updateSelInfo();
  }
  function updateSelInfo() {
    const info = document.getElementById('navsih-selinfo'); if (!info) return;
    if (!selectMode) { info.textContent = ''; return; }
    if (selling) return; // no repintar mientras se vende
    const s = sumFor([...selected]);
    const nMkt = [...selected].filter((e) => e.d && e.d.marketable).length;
    info.innerHTML = '<b>' + selected.size + '</b> sel. · <b>' + s.sum.toFixed(2) + ' ' + s.sym + '</b>' +
      (nMkt ? ' <button id="navsih-massell" class="navsih-tbtn sell" title="Pone a la venta cada objeto al precio mas bajo del mercado (criterio SIH)">Vender ' + nMkt + ' al mercado</button>' : '');
    const mb = document.getElementById('navsih-massell');
    if (mb) mb.onclick = massSell;
  }

  /* Neto del vendedor a partir del precio del comprador (mismo algoritmo que SIH:
     parte de lowest_price y descuenta las comisiones de Steam con sus propios helpers). */
  function sellerFromBuyer(buyerCents) {
    if (typeof GetItemPriceFromTotal !== 'function' || typeof GetTotalWithFees !== 'function') return -1;
    const ppct = parseFloat(g_rgWalletInfo.wallet_publisher_fee_percent_default != null ? g_rgWalletInfo.wallet_publisher_fee_percent_default : 0.1);
    const spct = parseFloat(g_rgWalletInfo.wallet_fee_percent != null ? g_rgWalletInfo.wallet_fee_percent : 0.05);
    let target = buyerCents;
    const minBuyer = GetTotalWithFees(g_rgWalletInfo.wallet_market_minimum, ppct, spct, g_rgWalletInfo);
    if (target < minBuyer) target = buyerCents; // fastdelta = 0 (sin rebaja, como SIH por defecto)
    let seller = 0, finalBuyer = 0, adj = target, i = 0;
    while (i++ < 10000) {
      seller = GetItemPriceFromTotal(adj, g_rgWalletInfo);
      finalBuyer = GetTotalWithFees(seller, ppct, spct, g_rgWalletInfo);
      if (finalBuyer <= target) break;
      adj--;
    }
    return seller;
  }

  /* Publica UN objeto a la venta al precio mas bajo del mercado (POST directo a Steam,
     idéntico a Steam Inventory Helper: precio = neto del vendedor sobre lowest_price). */
  async function sellOne(entry) {
    const it = entry.item, d = entry.d;
    if (!it || !d || !d.marketable) return 'no-market';
    const p = await getPrice(d.appid, d.market_hash_name);
    if (!p) return 'sin-precio';
    const buyerCents = Math.round(money(p) * 100);
    if (!(buyerCents > 0)) return 'sin-precio';
    const sellerCents = sellerFromBuyer(buyerCents);
    if (!(sellerCents > 0)) return 'precio-min';
    try {
      const body = new URLSearchParams({
        sessionid: window.g_sessionID, appid: it.appid, contextid: it.contextid,
        assetid: it.assetid, amount: '1', price: String(sellerCents)
      });
      const r = await fetch('https://steamcommunity.com/market/sellitem/', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body
      });
      const j = await r.json().catch(() => null);
      if (j && j.success) return 'ok';
      entry.err = (j && j.message) || ('HTTP ' + r.status);
      return 'fail';
    } catch (e) { return 'error'; }
  }

  async function massSell() {
    if (selling) return;
    const list = [...selected].filter((e) => e.d && e.d.marketable && e.item);
    if (!list.length) return;
    const s = sumFor(list);
    const msg = 'Se pondran a la venta ' + list.length + ' objeto(s) al PRECIO MAS BAJO del mercado de Steam ' +
      '(el mismo criterio que Steam Inventory Helper).\n\nValor aproximado: ' + s.sum.toFixed(2) + ' ' + s.sym +
      '. Steam descuenta su comision de tu parte; puede pedir confirmacion en la app movil.\n\n¿Continuar?';
    if (!window.confirm(msg)) return;
    selling = true;
    const info = document.getElementById('navsih-selinfo');
    let done = 0, fail = 0;
    for (const entry of list) {
      if (info) info.innerHTML = 'Publicando ' + (done + fail + 1) + '/' + list.length + '…';
      let r;
      try { r = await sellOne(entry); } catch (e) { r = 'error'; }
      if (r === 'ok') { selected.delete(entry); if (entry.el) entry.el.classList.remove('navsih-sel'); done++; }
      else fail++;
      await new Promise((res) => setTimeout(res, 1200)); // ritmo suave para Steam
    }
    selling = false;
    if (info) info.innerHTML = 'Listo: <b>' + done + '</b> a la venta' + (fail ? (' · ' + fail + ' sin publicar') : '');
    refreshTotal();
  }

  document.addEventListener('click', (ev) => {
    if (!selectMode || !isInventory || selling) return;
    const itemEl = ev.target.closest && ev.target.closest('.inventory_page .item, .inventory_ctn .item');
    if (!itemEl) return;
    const entry = items.find((i) => i.el === itemEl);
    if (!entry) return;
    ev.stopPropagation(); ev.preventDefault();
    if (selected.has(entry)) { selected.delete(entry); itemEl.classList.remove('navsih-sel'); }
    else { selected.add(entry); itemEl.classList.add('navsih-sel'); }
    updateSelInfo();
  }, true);

  /* ---------- Observadores ---------- */
  function scan() {
    // Solo la página visible: evitar encolar miles de precios (límite de Steam).
    [...document.querySelectorAll('.inventory_page .itemHolder .item, .inventory_ctn .itemHolder .item')]
      .filter((el) => el.offsetParent !== null).forEach((el) => tagItem(el, 'inv'));
    const yours = document.getElementById('your_slots'), theirs = document.getElementById('their_slots');
    if (yours) yours.querySelectorAll('.item').forEach((el) => tagItem(el, 'yours'));
    if (theirs) theirs.querySelectorAll('.item').forEach((el) => tagItem(el, 'theirs'));
    if (isInventory) { addQuickSell(); buildToolbar(); }
    if (isTrade) tradeTotals();
  }
  new MutationObserver(() => { clearTimeout(window.__navSIHt); window.__navSIHt = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 2500);
  scan();
})();
