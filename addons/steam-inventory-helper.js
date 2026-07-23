/* Naviris addon: Valve Rat Tool v1.1.0
   Se inyecta en steamcommunity.com. Funciones al estilo Steam Inventory Helper:
   - Precio de Steam bajo cada objeto (moneda de tu cartera, caché 24 h)
   - MULTI-MERCADO (CS2): compara con Buff163, Skinport y CSFloat vía el
     agregado público prices.csgotrader.app (precios en USD, refresco diario)
   - Valor total del inventario visible con selector de mercado
   - Venta rápida al precio actual del mercado de Steam
   - Ofertas de intercambio: suma el valor de cada lado (en el mercado elegido)
   Respeta el límite de Steam (~20 consultas/min) con una cola. */
(function () {
  if (window.__navSIH) return; window.__navSIH = 1;

  const CCY = (window.g_rgWalletInfo && g_rgWalletInfo.wallet_currency) || 1;
  const AGG_URL = 'https://prices.csgotrader.app/latest/prices_v6.json';

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

  /* ---------- Agregado multi-mercado (CS2, USD) ---------- */
  let agg = null, aggLoading = null;
  function loadAgg() {
    if (agg) return Promise.resolve();
    if (aggLoading) return aggLoading;
    aggLoading = (async () => {
      try {
        const c = await caches.open('navsih-agg');
        let res = await c.match(AGG_URL);
        const stale = res && (Date.now() - new Date(res.headers.get('date') || 0).getTime() > 864e5);
        if (!res || stale) {
          const fresh = await fetch(AGG_URL); // Naviris abre CORS para este dominio
          if (fresh && fresh.ok) { try { await c.put(AGG_URL, fresh.clone()); } catch (e) {} res = fresh; }
        }
        if (res) agg = await res.json();
      } catch (e) { /* seguimos solo con Steam */ }
    })();
    return aggLoading;
  }
  // [clave, etiqueta, extractor de precio USD]
  const MARKETS = [
    ['buff163', 'Buff163', (e) => num(e.buff163 && e.buff163.starting_at && e.buff163.starting_at.price)],
    ['skinport', 'Skinport', (e) => num(e.skinport && (e.skinport.starting_at != null ? e.skinport.starting_at : e.skinport.suggested_price))],
    ['csfloat', 'CSFloat', (e) => num(e.csfloat && (typeof e.csfloat === 'number' ? e.csfloat : e.csfloat.price))]
  ];
  function marketPrices(hashName) {
    const e = agg && agg[hashName];
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
    '.navsih-side{margin:4px 0;padding:5px 8px;background:rgba(0,0,0,.35);border-radius:4px;color:#9ee2b8;font:600 11px Arial,sans-serif}'
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
    const d = descOf(el);
    if (!d || !d.market_hash_name) return;
    el.dataset.navsih = '1';
    const badge = document.createElement('div');
    badge.className = 'navsih-price'; badge.textContent = '…';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(badge);
    const entry = { el, d, badge, steamStr: null, zone };
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
      '<div class="sub">' + n + ' objeto(s) con precio' + (market !== 'steam' ? ' · USD · datos: csgotrader' : '') + ' · Valve Rat Tool</div>';
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

  /* ---------- Observadores ---------- */
  function scan() {
    document.querySelectorAll('.inventory_page .itemHolder .item, .inventory_ctn .itemHolder .item').forEach((el) => tagItem(el, 'inv'));
    const yours = document.getElementById('your_slots'), theirs = document.getElementById('their_slots');
    if (yours) yours.querySelectorAll('.item').forEach((el) => tagItem(el, 'yours'));
    if (theirs) theirs.querySelectorAll('.item').forEach((el) => tagItem(el, 'theirs'));
    if (isInventory) addQuickSell();
    if (isTrade) tradeTotals();
  }
  new MutationObserver(() => { clearTimeout(window.__navSIHt); window.__navSIHt = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 2500);
  scan();
})();
