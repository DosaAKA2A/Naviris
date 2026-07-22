// Preload que corre dentro de cada webview (sitio). Detecta formularios de login
// para capturar contraseñas al iniciar sesión y para autorrellenarlas después.
// Se comunica con la interfaz de Cobalt (host) mediante ipcRenderer.sendToHost.
const { ipcRenderer } = require('electron');

function findLogin() {
  const pass = document.querySelector('input[type="password"]:not([disabled])');
  if (!pass) return null;
  const scope = pass.form || document;
  let user = scope.querySelector('input[autocomplete="username"], input[autocomplete="email"], input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i]');
  if (!user) {
    // El input de texto que precede al campo de contraseña
    const texts = Array.from(scope.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])'));
    user = texts.filter((t) => pass.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING).pop() || texts[0] || null;
  }
  return { pass, user };
}

// --- Captura al enviar el formulario ---
function tryCapture(root) {
  try {
    const pass = (root.querySelector ? root.querySelector('input[type="password"]') : null) || document.querySelector('input[type="password"]');
    if (!pass || !pass.value) return;
    const l = findLogin();
    ipcRenderer.sendToHost('cobalt-capture', {
      url: location.href,
      username: (l && l.user && l.user.value) || '',
      password: pass.value
    });
  } catch (e) { /* nada */ }
}
document.addEventListener('submit', (e) => tryCapture(e.target), true);
// Muchos logins son botones sin submit: capturar también al pulsar un botón si hay contraseña escrita
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button, input[type="submit"], [role="button"]');
  if (b) setTimeout(() => tryCapture(document), 0);
}, true);

// --- Aviso de formulario de login (para ofrecer autorrelleno) ---
let announced = false;
function announce() {
  if (announced) return;
  if (findLogin()) { announced = true; ipcRenderer.sendToHost('cobalt-loginform', { url: location.href }); }
}
if (document.readyState !== 'loading') announce();
document.addEventListener('DOMContentLoaded', announce);
// Reintentos para SPAs que montan el formulario después
[600, 1500, 3000].forEach((ms) => setTimeout(announce, ms));
try {
  const obs = new MutationObserver(() => announce());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 8000);
} catch (e) { /* nada */ }

// --- Rellenar cuando el host lo pida (tras verificación de Windows) ---
ipcRenderer.on('cobalt-fill', (_e, cred) => {
  const l = findLogin();
  if (!l) return;
  const set = (el, val) => {
    if (!el || val == null) return;
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    try { setter ? setter.call(el, val) : (el.value = val); } catch { el.value = val; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (cred.username && l.user) set(l.user, cred.username);
  set(l.pass, cred.password);
});
