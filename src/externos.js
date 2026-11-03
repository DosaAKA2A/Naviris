/* ===== ENLACES QUE ABRE UNA APLICACIÓN DEL EQUIPO (2026-11-03) =====
   mailto:, tel:, magnet: y compañía no hacían nada al pulsarlos: Chromium le
   pide a Electron permiso 'openExternal' y Naviris lo negaba por no estar en
   su lista. Ahora se pregunta en la propia pestaña, como en Chrome, y solo
   para esta lista de esquemas conocidos. Nunca file:, javascript:, data: ni
   los de Windows que lanzan programas o búsquedas del sistema (ms-msdt:,
   search-ms:, ms-officecmd:…), que han servido para atacar.
   Sin Electron, para poder probarlo (test/externos.test.js). */
'use strict';

const ESQUEMAS = new Map([
  ['mailto', 'tu aplicación de correo'],
  ['tel', 'la aplicación de llamadas'],
  ['callto', 'la aplicación de llamadas'],
  ['sip', 'la aplicación de llamadas'],
  ['sms', 'la aplicación de mensajes'],
  ['magnet', 'tu programa de torrents'],
  ['webcal', 'tu calendario'],
  ['steam', 'Steam'],
  ['spotify', 'Spotify'],
  ['discord', 'Discord'],
  ['zoommtg', 'Zoom'],
  ['zoomus', 'Zoom'],
  ['msteams', 'Microsoft Teams'],
  ['slack', 'Slack'],
  ['tg', 'Telegram'],
  ['whatsapp', 'WhatsApp'],
  ['skype', 'Skype'],
  ['ms-windows-store', 'Microsoft Store'],
  ['irc', 'tu programa de IRC'],
  ['ircs', 'tu programa de IRC'],
  ['xmpp', 'tu programa de mensajería'],
  ['bitcoin', 'tu monedero']
]);

const esquemaDe = (url) => {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
};

// La aplicación que abriría (texto para el aviso) o null si no se deja abrir.
function aplicacionPara(url) {
  const s = esquemaDe(url);
  if (!ESQUEMAS.has(s) || String(url).length > 2048) return null;
  return ESQUEMAS.get(s);
}

module.exports = { ESQUEMAS, esquemaDe, aplicacionPara };
