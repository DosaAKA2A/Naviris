/* Avisos de las páginas: permisos, ventanas emergentes bloqueadas y diálogos dentro de su pestaña. */

/* ============ Permisos de sitios ============ */
const PERM_LABELS = { media: 'usar la cámara y el micrófono', geolocation: 'saber tu ubicación', notifications: 'enviarte notificaciones', midi: 'usar dispositivos MIDI', midiSysex: 'usar dispositivos MIDI', 'clipboard-read': 'leer tu portapapeles', hid: 'acceder a dispositivos HID', serial: 'acceder a puertos serie', usb: 'acceder a dispositivos USB', bluetooth: 'usar Bluetooth' };
const PERM_SHORT = { popups: 'Ventanas emergentes', media: 'Cámara y micrófono', geolocation: 'Ubicación', notifications: 'Notificaciones', midi: 'MIDI', midiSysex: 'MIDI', 'clipboard-read': 'Portapapeles', hid: 'Dispositivos HID', serial: 'Puertos serie', usb: 'USB', bluetooth: 'Bluetooth' };
const ICONO_PERMISO = { notifications: 'bell', media: 'camera', geolocation: 'map-pin', 'clipboard-read': 'clipboard' };
let permQueue = [];
function showNextPerm() {
  if (!permQueue.length) { els.permBar.classList.add('hidden'); return; }
  const req = permQueue[0];
  let what = PERM_LABELS[req.permission] || ('usar ' + req.permission);
  if (req.permission === 'media' && req.mediaTypes && req.mediaTypes.length) {
    const m = req.mediaTypes;
    what = m.includes('video') && m.includes('audio') ? 'usar la cámara y el micrófono' : m.includes('video') ? 'usar la cámara' : 'usar el micrófono';
  }
  let host = req.origin; try { host = new URL(req.origin).hostname.replace(/^www\./, ''); } catch {}
  els.permText.innerHTML = `<b>${escapeHtml(host)}</b> quiere ${escapeHtml(what)}.`;
  // El icono dice de qué va (campana para las notificaciones, como en la propuesta)
  els.permBar.querySelector('.perm-ic').innerHTML = window.icon(ICONO_PERMISO[req.permission] || 'lock-closed');
  els.permRemember.checked = true;
  els.permBar.classList.remove('hidden');
}
function answerPerm(decision) {
  const req = permQueue.shift(); if (!req) return;
  window.navirisApp.permRespond(req.id, decision, els.permRemember.checked);
  showNextPerm();
}
window.navirisApp.onPermAsk((req) => { permQueue.push(req); if (permQueue.length === 1) showNextPerm(); });
els.permAllow.addEventListener('click', () => answerPerm('allow'));
els.permBlock.addEventListener('click', () => answerPerm('block'));

/* Ventanas emergentes que una web intentó abrir sin un clic (ver src/emergentes.js
   en main): aviso en la barra, solo de la pestaña que se está viendo, con un botón
   para permitirlas en ese sitio, que abre ya lo bloqueado en esa pestaña (main).
   Lo permitido sale en los permisos guardados. */
const emergEls = { bar: document.getElementById('emerg-bar'), text: document.getElementById('emerg-text') };
let emergAviso = null;   // { tab, wc, origen, n }
function ocultaEmergentes() { emergEls.bar.classList.add('hidden'); emergAviso = null; }
window.navirisApp.onEmergenteBloqueada((p) => {
  const tab = pestanaDeWebContents(p.wc);
  if (!tab || tab.id !== activeId) return;
  if (emergAviso && emergAviso.tab === tab.id && emergAviso.origen === p.origen) emergAviso.n++;
  else emergAviso = { tab: tab.id, wc: p.wc, origen: p.origen, n: 1 };
  let host = p.origen; try { host = new URL(p.origen).hostname.replace(/^www\./, ''); } catch { /* nada */ }
  emergEls.text.innerHTML = (emergAviso.n === 1 ? 'Se bloqueó una ventana emergente de ' : `Se bloquearon ${emergAviso.n} ventanas emergentes de `) + `<b>${escapeHtml(host)}</b>.`;
  emergEls.bar.classList.remove('hidden');
});
document.getElementById('emerg-allow').addEventListener('click', () => {
  if (emergAviso) { window.navirisApp.permitirEmergentes(emergAviso.origen, emergAviso.wc); toast('Ventanas emergentes permitidas en este sitio'); }
  ocultaEmergentes();
});
document.getElementById('emerg-close').addEventListener('click', ocultaEmergentes);

async function showPermManager() {
  const perms = await window.navirisApp.permList();
  els.permList.innerHTML = '';
  const keys = Object.keys(perms);
  for (const key of keys) {
    const [origin, type] = key.split('|');
    let host = origin; try { host = new URL(origin).hostname.replace(/^www\./, ''); } catch {}
    const row = document.createElement('div'); row.className = 'perm-row';
    const info = document.createElement('div'); info.className = 'pr-info';
    info.innerHTML = `<div class="pr-site">${escapeHtml(host)}</div><div class="pr-perm">${escapeHtml(PERM_SHORT[type] || type)}</div>`;
    const state = document.createElement('span'); state.className = 'pr-state ' + (perms[key] === 'allow' ? 'allow' : 'block'); state.textContent = perms[key] === 'allow' ? 'Permitido' : 'Bloqueado';
    const x = document.createElement('button'); x.className = 'pr-x'; x.title = 'Revocar'; x.innerHTML = window.icon('trash');
    x.addEventListener('click', async () => { await window.navirisApp.permRemove(key); showPermManager(); });
    row.append(info, state, x); els.permList.appendChild(row);
  }
  els.permModal.classList.remove('hidden');
}
els.permModalClose.addEventListener('click', () => els.permModal.classList.add('hidden'));
els.permClearAll.addEventListener('click', async () => {
  const n = Object.keys(await window.navirisApp.permList()).length;
  if (!n) { toast('No hay permisos guardados'); return; }
  promptConfirm('¿Borrar todos los permisos?', (n === 1 ? 'Se borra el permiso guardado.' : 'Se borran los ' + n + ' permisos guardados.') + ' Cada sitio te lo volverá a pedir.', async () => { await window.navirisApp.permClear(); showPermManager(); toast('Permisos borrados'); });
});

/* ===== DIÁLOGOS DE LA PÁGINA, DENTRO DE SU PESTAÑA (2026-11-03) =====
   alert, confirm y prompt (y «abrir con otra aplicación» de un mailto: o un
   magnet:) llegan de main con el id de su webview. Se pintan encima de SU
   pestaña y solo cuando es la que se ve: cambiar de pestaña lo esconde y
   volver lo enseña, como en Chrome. El resto de la ventana sigue funcionando.
   Mientras está abierto, esa página está parada esperando la respuesta. */
function dialogoDe(tab) { return tab && tab.dialogos && tab.dialogos[0]; }
function pintaDialogo() {
  const tab = activeTab(), d = dialogoDe(tab), caja = els.tabDialogo;
  caja.classList.toggle('hidden', !d);
  if (!d) return;
  if (caja.dataset.id === d.id) return;   // ya pintado: no se pisa lo que se esté escribiendo
  caja.dataset.id = d.id;
  const host = hostOf(d.origen) || d.origen || 'Esta página';
  const externo = d.tipo === 'externo';
  els.tdTit.textContent = externo ? '¿Abrir ' + d.aplicacion + '?' : host + ' dice';
  els.tdTexto.textContent = externo ? host + ' quiere abrir este enlace fuera de Naviris.' : d.texto;
  els.tdTexto.classList.toggle('hidden', !externo && !d.texto);
  els.tdUrl.textContent = externo ? d.texto : '';
  els.tdUrl.classList.toggle('hidden', !externo);
  els.tdValor.classList.toggle('hidden', d.tipo !== 'prompt');
  els.tdValor.value = d.tipo === 'prompt' ? (d.valor || '') : '';
  // Como Chrome: la casilla sale a partir del segundo aviso del mismo documento.
  els.tdSilenciar.checked = false;
  els.tdSilencio.classList.toggle('hidden', externo || (tab.avisos || 0) < 2);
  els.tdCancelar.classList.toggle('hidden', d.tipo === 'alert');
  els.tdAceptar.textContent = externo ? 'Abrir' : 'Aceptar';
  const foco = d.tipo === 'prompt' ? els.tdValor : els.tdAceptar;
  requestAnimationFrame(() => { foco.focus(); if (d.tipo === 'prompt') els.tdValor.select(); });
}
function quitaDialogo(id) {
  for (const t of tabs) {
    if (!t.dialogos) continue;
    const i = t.dialogos.findIndex((x) => x.id === id);
    if (i !== -1) { t.dialogos.splice(i, 1); break; }
  }
  if (els.tabDialogo.dataset.id === id) delete els.tabDialogo.dataset.id;
  pintaDialogo();
}
function respondeDialogo(ok) {
  const d = dialogoDe(activeTab()); if (!d) return;
  window.navirisApp.respondeDialogo({ id: d.id, ok, valor: d.tipo === 'prompt' ? els.tdValor.value : null, silenciar: els.tdSilenciar.checked });
  quitaDialogo(d.id);
  try { activeWv()?.focus(); } catch { /* nada */ }
}
window.navirisApp.onDialogo((d) => {
  const tab = pestanaDeWebContents(d.wc);
  if (!tab) { window.navirisApp.respondeDialogo({ id: d.id, ok: false }); return; }
  if (d.tipo !== 'externo') tab.avisos = (tab.avisos || 0) + 1;
  (tab.dialogos || (tab.dialogos = [])).push(d);
  if (tab.id === activeId) pintaDialogo();
});
window.navirisApp.onDialogoFin(quitaDialogo);
els.tdAceptar.addEventListener('click', () => respondeDialogo(true));
els.tdCancelar.addEventListener('click', () => respondeDialogo(false));
els.tabDialogo.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); respondeDialogo(dialogoDe(activeTab())?.tipo === 'alert'); }
  else if (e.key === 'Enter' && e.target !== els.tdCancelar) { e.preventDefault(); e.stopPropagation(); respondeDialogo(true); }
});
