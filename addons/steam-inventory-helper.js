/* Naviris addon: Inventory Helper para Steam v1.0.0
   Se inyecta en steamcommunity.com. Funciones al estilo Steam Inventory Helper:
   - Precio de mercado bajo cada objeto del inventario (con caché de 24 h)
   - Valor total estimado del inventario visible
   - Venta rápida: pone el objeto a la venta al precio actual del mercado con un clic
   - Ofertas de intercambio: suma el valor de cada lado de la oferta
   Respeta el límite de Steam (~20 consultas de precio por minuto) con una cola. */
(function () {
  if (window.__navSIH) return; window.__navSIH = 1;

  const CCY = (window.g_rgWalletInfo && g_rgWalletInfo.wallet_currency) || 1;

  /* ---------- Cola de precios con caché ---------- */
  let cache = {};
  try { cache = JSON.parse(localStorage.__navSIHprices || '{}'); } catch (e) { cache = {}; }
  const saveCache = () => { try { localStorage.__navSIHprices = JSON.stringify(cache); } catch (e) { /* lleno */ } };
  const queue = []; const queued = new Set(); let pumping = false;

  function getPrice(appid, hashName) {
    const k = appid + '|' + hashName;
    const hit = cache[k];
    if (hit && Date.now() - hit.t < 864e5) return Promise.resolve(hit.p);
    return new Promise((resolve) => {
      queue.push({ appid, hashName, k, resolve });
      pump();
    });
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

  // "12,34€" / "$12.34" → número. Si hay coma y punto, el último es el decimal.
  function money(s) {
    if (!s) return 0;
    let t = String(s).replace(/[^0-9.,]/g, '');
    const lc = t.lastIndexOf(','), lp = t.lastIndexOf('.');
    if (lc > -1 && lp > -1) t = lc > lp ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (lc > -1) t = t.replace(',', '.');
    return parseFloat(t) || 0;
  }
  const symbol = (s) => (String(s).match(/[^\d\s.,-]+/) || [''])[0];

  /* ---------- Estilos ---------- */
  const css = document.createElement('style');
  css.textContent = [
    '.navsih-price{position:absolute;left:2px;right:2px;bottom:2px;background:rgba(0,0,0,.78);color:#9ee2b8;',
    'font:600 10px/1.4 Arial,sans-serif;text-align:center;border-radius:3px;pointer-events:none;z-index:5}',
    '.navsih-price.na{color:#8b8d94}',
    '#navsih-total{position:fixed;right:14px;bottom:14px;z-index:99999;background:#171a21;color:#c7d5e0;border:1px solid #2a475e;',
    'border-radius:8px;padding:10px 14px;font:12px Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)}',
    '#navsih-total b{color:#9ee2b8;font-size:14px}',
    '#navsih-total .sub{color:#66c0f4;font-size:10.5px;margin-top:2px}',
    '.navsih-sell{display:block;margin:6px 0;padding:7px 12px;background:#6fa720;background:linear-gradient(to right,#75b022 5%,#588a1b 95%);',
    'color:#d2e885;border:none;border-radius:2px;font:600 12px Arial,sans-serif;cursor:pointer;width:100%}',
    '.navsih-sell:hover{color:#fff}.navsih-sell[disabled]{opacity:.6;cursor:default}',
    '.navsih-side{margin:4px 0;padding:5px 8px;background:rgba(0,0,0,.35);border-radius:4px;color:#9ee2b8;font:600 11px Arial,sans-serif}'
  ].join('');
  document.documentElement.appendChild(css);

  /* ---------- Inventario ---------- */
  const isInventory = /\/(id|profiles)\/[^/]+\/inventory/.test(location.pathname);
  const isTrade = /\/tradeoffer\//.test(location.pathname);
  const totals = {}; // asetid -> valor numérico

  function descOf(el) {
    // Steam cuelga el asset del propio elemento (rgItem); cubre inventario y trades
    const it = el.rgItem || (el.parentNode && el.parentNode.rgItem);
    if (!it) return null;
    return it.description || it; // según versión, la descripción va anidada o plana
  }

  function tagItem(el) {
    if (el.dataset.navsih) return;
    const d = descOf(el);
    if (!d || !d.market_hash_name) return;
    if (d.marketable === 0 && !d.market_hash_name) return;
    el.dataset.navsih = '1';
    const badge = document.createElement('div');
    badge.className = 'navsih-price'; badge.textContent = '…';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(badge);
    getPrice(d.appid, d.market_hash_name).then((p) => {
      if (p) { badge.textContent = p; totals[el.id || d.appid + d.market_hash_name] = money(p); refreshTotal(symbol(p)); }
      else { badge.textContent = '—'; badge.classList.add('na'); }
    });
  }

  let totalBox = null;
  function refreshTotal(sym) {
    if (!isInventory) return;
    if (!totalBox) {
      totalBox = document.createElement('div'); totalBox.id = 'navsih-total';
      document.body.appendChild(totalBox);
    }
    const vals = Object.values(totals);
    const sum = vals.reduce((a, b) => a + b, 0);
    totalBox.innerHTML = 'Valor estimado (visible): <b>' + sum.toFixed(2) + ' ' + (sym || '') + '</b>' +
      '<div class="sub">' + vals.length + ' objeto(s) con precio · Naviris Inventory Helper</div>';
  }

  /* ---------- Venta rápida ---------- */
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
        // Rellena el diálogo de venta de Steam con el precio del comprador actual
        let tries = 0;
        const t = setInterval(() => {
          const input = document.getElementById('market_sell_buyercurrency_input');
          if (input) {
            clearInterval(t);
            input.value = p.replace(/[^\d.,]/g, '').trim() ? p : input.value;
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

  /* ---------- Ofertas de intercambio: valor por lado ---------- */
  function tradeSideTotals() {
    [['your_slots', 'Tu lado'], ['their_slots', 'Su lado']].forEach(([id, label]) => {
      const zone = document.getElementById(id); if (!zone) return;
      let box = zone.parentNode.querySelector('.navsih-side');
      if (!box) { box = document.createElement('div'); box.className = 'navsih-side'; zone.parentNode.insertBefore(box, zone); }
      let sum = 0, n = 0, pend = 0, sym = '';
      zone.querySelectorAll('.item').forEach((el) => {
        const d = descOf(el); if (!d || !d.market_hash_name) return;
        const k = d.appid + '|' + d.market_hash_name; const hit = cache[k];
        if (hit && hit.p) { sum += money(hit.p); sym = sym || symbol(hit.p); n++; }
        else { pend++; getPrice(d.appid, d.market_hash_name).then(tradeSideTotals); }
      });
      box.textContent = label + ': ' + sum.toFixed(2) + ' ' + sym + ' (' + n + ' con precio' + (pend ? ', ' + pend + ' consultando…' : '') + ')';
    });
  }

  /* ---------- Observadores ---------- */
  function scan() {
    document.querySelectorAll('.inventory_page .itemHolder .item, #your_slots .item, #their_slots .item, .inventory_ctn .itemHolder .item').forEach(tagItem);
    if (isInventory) addQuickSell();
    if (isTrade) tradeSideTotals();
  }
  new MutationObserver(() => { clearTimeout(window.__navSIHt); window.__navSIHt = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 2500);
  scan();
})();
