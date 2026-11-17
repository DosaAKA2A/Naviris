/* Preload del webview OCULTO que lee las tendencias de X (widgets.js,
   scrapeOculto). Solo hace falta el texto de la página, así que aquí no hay
   multimedia ni WebRTC.

   POR QUÉ (17/11/2026): la primera vez que una página usa vídeo, audio o
   WebRTC, Chromium le pregunta a la GPU qué codificadores de vídeo tiene, y el
   proceso de la GPU carga los de NVIDIA y AMD (nvencmft*, amdenc64...) y ya
   no los suelta. x.com lo provocaba al abrir Naviris: la GPU pasaba de ~97 MB
   a ~220 MB en reposo con el hub y nada más. Con esto se queda en ~140 (lo
   que queda es la propia página de x.com mientras está montada).

   main.js lo pone en lugar de webview-preload.js cuando la dirección del
   webview lleva la marca #naviris-oculto. */
'use strict';
const { webFrame } = require('electron');

webFrame.executeJavaScript(`(() => {
  const nada = () => {};
  const quita = (k) => { try { delete window[k]; window[k] = undefined; } catch (e) { /* nada */ } };
  const M = HTMLMediaElement.prototype;
  M.load = nada;
  M.play = function () { return Promise.reject(new DOMException('Sin multimedia', 'NotAllowedError')); };
  M.canPlayType = () => '';
  for (const P of [M, HTMLSourceElement.prototype]) Object.defineProperty(P, 'src', { configurable: true, get() { return ''; }, set: nada });
  Object.defineProperty(M, 'srcObject', { configurable: true, get() { return null; }, set: nada });
  const pon = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    if ((this instanceof HTMLMediaElement || this instanceof HTMLSourceElement) && /^src$/i.test(n)) return;
    return pon.call(this, n, v);
  };
  window.Audio = function () { return document.createElement('audio'); };
  for (const k of ['mediaCapabilities', 'mediaDevices']) {
    try { Object.defineProperty(Navigator.prototype, k, { configurable: true, get() { return undefined; } }); } catch (e) { /* nada */ }
  }
  try { delete Navigator.prototype.requestMediaKeySystemAccess; } catch (e) { /* nada */ }
  ['MediaSource', 'ManagedMediaSource', 'WebKitMediaSource', 'RTCPeerConnection', 'webkitRTCPeerConnection',
    'RTCRtpSender', 'RTCRtpReceiver', 'MediaRecorder', 'VideoEncoder', 'VideoDecoder', 'AudioEncoder',
    'AudioDecoder', 'ImageDecoder'].forEach(quita);
})()`).catch(() => {});
