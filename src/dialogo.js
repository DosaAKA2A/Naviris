/* El aviso de una ventanita emergente (ver dialogo.html y 'ventanita:dialogo-*'
   en main.js). Lo mismo que pinta pintaDialogo en las pestañas (renderer/avisos.js). */
(function () {
  const $ = (id) => document.getElementById(id);
  const d = window.naviDialogo.datos();
  if (!d) { window.naviDialogo.responde({ ok: false }); return; }
  if (d.tema === 'claro') document.documentElement.classList.add('claro');

  let host = d.origen || '';
  try { host = new URL(d.origen).hostname.replace(/^www\./, ''); } catch { /* sin origen */ }
  host = host || 'Esta página';
  const externo = d.tipo === 'externo';
  $('tit').textContent = externo ? '¿Abrir ' + d.aplicacion + '?' : host + ' dice';
  $('texto').textContent = externo ? host + ' quiere abrir este enlace fuera de Naviris.' : d.texto;
  $('texto').classList.toggle('oculto', !externo && !d.texto);
  $('url').textContent = externo ? d.texto : '';
  $('url').classList.toggle('oculto', !externo);
  $('valor').classList.toggle('oculto', d.tipo !== 'prompt');
  $('valor').value = d.tipo === 'prompt' ? (d.valor || '') : '';
  // Como Chrome y como en las pestañas: la casilla sale a partir del segundo aviso del documento.
  $('silencio').classList.toggle('oculto', externo || (d.avisos || 0) < 2);
  $('cancelar').classList.toggle('oculto', d.tipo === 'alert');
  $('aceptar').textContent = externo ? 'Abrir' : 'Aceptar';

  let hecho = false;
  const responde = (ok) => {
    if (hecho) return;
    hecho = true;
    window.naviDialogo.responde({ ok, valor: d.tipo === 'prompt' ? $('valor').value : null, silenciar: $('silenciar').checked });
  };
  $('aceptar').addEventListener('click', () => responde(true));
  $('cancelar').addEventListener('click', () => responde(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); responde(d.tipo === 'alert'); }
    else if (e.key === 'Enter' && e.target !== $('cancelar')) { e.preventDefault(); responde(true); }
  });
  const foco = d.tipo === 'prompt' ? $('valor') : $('aceptar');
  foco.focus();
  if (d.tipo === 'prompt') $('valor').select();
})();
