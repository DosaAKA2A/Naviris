/* Gestor de contraseñas y de tarjetas. */

/* ============ Gestor de contraseñas ============ */
/* Copiar una contraseña o una tarjeta (auditoría 2026-10). Va por main, que no
   depende del foco: el writeText('') del renderer fallaba en silencio justo en
   el caso normal (pegar en otra aplicación) y el secreto se quedaba en el
   portapapeles. Y a los 20 s solo se borra si sigue ahí: lo que copiaras
   después no se toca. marcaSensible: el widget Portapapeles no lo apunta. */
function copiaSecreto(valor, aviso) {
  marcaSensible(valor);
  window.navirisApp.clipWrite(valor).then((ok) => {
    if (!ok) { toast('No se pudo copiar'); return; }
    toast(aviso);
    setTimeout(async () => { if ((await window.navirisApp.clipRead().catch(() => '')) === valor) window.navirisApp.clipWrite(''); }, 20000);
  });
}
async function renderPasswords() {
  const list = await window.navirisApp.pwList();
  els.pwList.innerHTML = '';
  for (const e of list) {
    const item = document.createElement('div'); item.className = 'pw-item';
    const ic = document.createElement('span'); ic.className = 'pw-ic'; ic.innerHTML = window.icon('key');
    ponFavicon(ic, 'https://' + e.site);
    const info = document.createElement('div'); info.className = 'pw-info';
    const sub = document.createElement('div'); sub.className = 'pw-sub'; sub.textContent = e.username || '••••••••';
    info.innerHTML = `<div class="pw-site">${escapeHtml(e.site)}</div>`; info.appendChild(sub);
    const acts = document.createElement('div'); acts.className = 'pw-acts';
    const eye = document.createElement('button'); eye.title = 'Ver contraseña (Windows Hello)'; eye.innerHTML = window.icon('eye');
    eye.addEventListener('click', async () => {
      eye.disabled = true; const r = await window.navirisApp.pwReveal(e.id); eye.disabled = false;
      if (r.ok) { sub.textContent = r.password; setTimeout(() => { sub.textContent = e.username || '••••••••'; }, 15000); }
      else toast(r.error === 'verificacion cancelada' ? 'Verificación cancelada' : 'No se pudo verificar');
    });
    const copy = document.createElement('button'); copy.title = 'Copiar contraseña (Windows Hello)'; copy.innerHTML = window.icon('clipboard');
    copy.addEventListener('click', async () => {
      copy.disabled = true; const r = await window.navirisApp.pwReveal(e.id); copy.disabled = false;
      if (r.ok) copiaSecreto(r.password, 'Contraseña copiada (se borra en 20 s)');
      else toast('Verificación cancelada');
    });
    const del = document.createElement('button'); del.className = 'del'; del.title = 'Eliminar'; del.innerHTML = window.icon('trash');
    // La papelera está pegada a "Copiar": se confirma, que no hay deshacer.
    del.addEventListener('click', () => promptConfirm('¿Borrar la contraseña de ' + (e.username ? e.username + ' en ' : '') + e.site + '?', 'No se puede deshacer.', async () => { await window.navirisApp.pwDelete(e.id); renderPasswords(); }));
    acts.append(eye, copy, del); item.append(ic, info, acts); els.pwList.appendChild(item);
  }
}
function togglePwPanel(force) {
  const open = force !== undefined ? force : els.pwPanel.classList.contains('hidden');
  // Se repinta la pestaña que está a la vista (antes, siempre Contraseñas aunque se viera Tarjetas)
  if (open) { closeRightPanels(); els.pwPanel.classList.remove('hidden'); els.sbPasswords.classList.add('open'); switchPwTab(!document.getElementById('pw-sec-cards').classList.contains('hidden')); }
  else { els.pwPanel.classList.add('hidden'); els.sbPasswords.classList.remove('open'); els.pwForm.classList.add('hidden'); document.getElementById('card-form').classList.add('hidden'); }
}
els.sbPasswords.addEventListener('click', async () => {
  const info = await window.navirisApp.pwAvailable();
  if (!info.encryption) { toast('El cifrado seguro no está disponible en este sistema'); return; }
  togglePwPanel();
});
$('#pw-close').addEventListener('click', () => togglePwPanel(false));
els.pwAddbtn.addEventListener('click', () => {
  // Abre el formulario de la pestaña activa del panel (contraseñas o tarjetas)
  const enTarjetas = !document.getElementById('pw-sec-cards').classList.contains('hidden');
  if (enTarjetas) { const f = document.getElementById('card-form'); f.classList.toggle('hidden'); document.getElementById('card-number').focus(); return; }
  els.pwForm.classList.toggle('hidden'); els.pwSite.value = ''; els.pwUser.value = ''; els.pwPass.value = ''; els.pwSite.focus();
});
els.pwImport.addEventListener('click', async () => {
  toast('Elige el CSV exportado desde tu navegador (Configuración → Contraseñas → Exportar)');
  const r = await window.navirisApp.pwImportCsv();
  if (r.ok) { renderPasswords(); toast(`Importadas: ${r.added} nuevas, ${r.updated} actualizadas`); }
  else if (!r.canceled) toast('No se pudo importar: ' + (r.error || 'archivo no válido'));
});
els.pwCancel.addEventListener('click', () => els.pwForm.classList.add('hidden'));
els.pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const site = hostOf(els.pwSite.value.includes('://') ? els.pwSite.value : 'https://' + els.pwSite.value) || els.pwSite.value.trim();
  if (!site || !els.pwPass.value) { toast('Falta el sitio o la contraseña'); return; }
  const r = await window.navirisApp.pwAdd(site, els.pwUser.value.trim(), els.pwPass.value);
  if (r.ok) { els.pwForm.classList.add('hidden'); renderPasswords(); toast('Contraseña guardada y cifrada'); }
  else toast('No se pudo guardar');
});

/* ============ Gestor de tarjetas (pestaña del panel de contraseñas) ============ */
const cardEls = {
  tabPw: $('#pw-tab-pw'), tabCards: $('#pw-tab-cards'), secPw: $('#pw-sec-pw'), secCards: $('#pw-sec-cards'),
  form: $('#card-form'), number: $('#card-number'), holder: $('#card-holder'), month: $('#card-month'), year: $('#card-year'),
  cancel: $('#card-cancel'), list: $('#card-list')
};
function switchPwTab(cards) {
  cardEls.tabPw.classList.toggle('active', !cards); cardEls.tabCards.classList.toggle('active', cards);
  cardEls.secPw.classList.toggle('hidden', cards); cardEls.secCards.classList.toggle('hidden', !cards);
  document.querySelector('#pw-panel .mp-head > span').textContent = cards ? 'Tarjetas' : 'Contraseñas';
  els.pwImport.classList.toggle('hidden', cards); // el CSV es solo de contraseñas
  if (cards) renderCards(); else renderPasswords();
}
cardEls.tabPw.addEventListener('click', () => switchPwTab(false));
cardEls.tabCards.addEventListener('click', () => switchPwTab(true));
async function renderCards() {
  const list = await window.navirisApp.cardsList();
  cardEls.list.innerHTML = '';
  for (const c of list) {
    const item = document.createElement('div'); item.className = 'pw-item';
    const ic = document.createElement('span'); ic.className = 'pw-ic card-chip'; ic.textContent = c.brand === 'American Express' ? 'AmEx' : c.brand.slice(0, 4);
    const info = document.createElement('div'); info.className = 'pw-info';
    const num = document.createElement('div'); num.className = 'pw-site card-num'; num.textContent = '•••• ' + c.last4;
    const sub = document.createElement('div'); sub.className = 'pw-sub';
    sub.textContent = `${c.brand} · ${String(c.expMonth).padStart(2, '0')}/${c.expYear}` + (c.holder ? ' · ' + c.holder : '');
    info.append(num, sub);
    const acts = document.createElement('div'); acts.className = 'pw-acts';
    const eye = document.createElement('button'); eye.title = 'Ver número completo (Windows Hello)'; eye.innerHTML = window.icon('eye');
    eye.addEventListener('click', async () => {
      eye.disabled = true; const r = await window.navirisApp.cardsReveal(c.id); eye.disabled = false;
      if (r.ok) { num.textContent = r.number.replace(/(\d{4})(?=\d)/g, '$1 '); setTimeout(() => { num.textContent = '•••• ' + c.last4; }, 15000); }
      else toast(r.error === 'verificacion cancelada' ? 'Verificación cancelada' : 'No se pudo verificar');
    });
    const copy = document.createElement('button'); copy.title = 'Copiar número (Windows Hello)'; copy.innerHTML = window.icon('clipboard');
    copy.addEventListener('click', async () => {
      copy.disabled = true; const r = await window.navirisApp.cardsReveal(c.id); copy.disabled = false;
      if (r.ok) copiaSecreto(r.number, 'Número copiado (se borra en 20 s)');
      else toast('Verificación cancelada');
    });
    const del = document.createElement('button'); del.className = 'del'; del.title = 'Eliminar'; del.innerHTML = window.icon('trash');
    del.addEventListener('click', () => promptConfirm('¿Borrar la tarjeta ' + c.brand + ' •••• ' + c.last4 + '?', 'No se puede deshacer.', async () => { await window.navirisApp.cardsDelete(c.id); renderCards(); }));
    acts.append(eye, copy, del); item.append(ic, info, acts); cardEls.list.appendChild(item);
  }
}
cardEls.cancel.addEventListener('click', () => cardEls.form.classList.add('hidden'));
cardEls.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await window.navirisApp.cardsAdd({ number: cardEls.number.value, holder: cardEls.holder.value.trim(), expMonth: cardEls.month.value, expYear: cardEls.year.value });
  if (r.ok) { cardEls.form.classList.add('hidden'); cardEls.number.value = cardEls.holder.value = cardEls.month.value = cardEls.year.value = ''; renderCards(); toast(r.updated ? 'Tarjeta actualizada' : 'Tarjeta guardada y cifrada'); }
  else toast(r.error || 'No se pudo guardar');
});
// El número se agrupa de 4 en 4 mientras se escribe, como en los formularios de pago
cardEls.number.addEventListener('input', () => {
  const digits = cardEls.number.value.replace(/\D/g, '').slice(0, 19);
  cardEls.number.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
});
