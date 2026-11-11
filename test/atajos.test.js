// Tabla de atajos (src/atajos.js): la misma para main y para el renderer.
// npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { ATAJOS, comandoDe, cierraConAtajo } = require('../src/atajos');

const t = (key, mods = {}) => ({ key, control: false, shift: false, alt: false, ...mods });
const ctrl = (key, m = {}) => t(key, { control: true, ...m });

test('los de siempre siguen igual', () => {
  assert.equal(comandoDe(t('F5')), 'reload');
  assert.equal(comandoDe(ctrl('r')), 'reload');
  assert.equal(comandoDe(ctrl('R', { shift: true })), 'reload-hard');
  assert.equal(comandoDe(t('F5', { shift: true })), 'reload-hard');
  assert.equal(comandoDe(ctrl('F5')), 'reload-hard');
  assert.equal(comandoDe(ctrl('t')), 'new-tab');
  assert.equal(comandoDe(ctrl('T', { shift: true })), 'reopen-tab');
  assert.equal(comandoDe(ctrl('w')), 'close-tab');
  assert.equal(comandoDe(ctrl('Tab')), 'next-tab');
  assert.equal(comandoDe(ctrl('Tab', { shift: true })), 'prev-tab');
  assert.equal(comandoDe(t('ArrowLeft', { alt: true })), 'back');
  assert.equal(comandoDe(ctrl('f')), 'find');
  assert.equal(comandoDe(ctrl('+', { shift: true })), 'zoom-in');
  assert.equal(comandoDe(ctrl('-')), 'zoom-out');
  assert.equal(comandoDe(ctrl('0')), 'zoom-reset');
  assert.equal(comandoDe(t('F11')), 'fullscreen');
  assert.equal(comandoDe(t('F12')), 'devtools');
});

test('los que faltaban (informe de huecos)', () => {
  assert.equal(comandoDe(ctrl('n')), 'new-window');
  assert.equal(comandoDe(ctrl('N', { shift: true })), 'new-private');
  assert.equal(comandoDe(ctrl('F4')), 'close-tab');
  assert.equal(comandoDe(ctrl('k')), 'focus-search');
  assert.equal(comandoDe(ctrl('e')), 'focus-search');
  assert.equal(comandoDe(ctrl('g')), 'find-next');
  assert.equal(comandoDe(ctrl('G', { shift: true })), 'find-prev');
  assert.equal(comandoDe(t('F3')), 'find-next');
  assert.equal(comandoDe(t('F3', { shift: true })), 'find-prev');
  assert.equal(comandoDe(ctrl('u')), 'view-source');
  assert.equal(comandoDe(ctrl('s')), 'save-page');
  assert.equal(comandoDe(ctrl('Delete', { shift: true })), 'clear-data');
  assert.equal(comandoDe(ctrl('I', { shift: true })), 'devtools');
});

test('Ctrl+Mayús+RePág/AvPág mueve la pestaña; sin Mayús cambia de pestaña', () => {
  assert.equal(comandoDe(ctrl('PageDown')), 'next-tab');
  assert.equal(comandoDe(ctrl('PageUp')), 'prev-tab');
  assert.equal(comandoDe(ctrl('PageDown', { shift: true })), 'move-tab-right');
  assert.equal(comandoDe(ctrl('PageUp', { shift: true })), 'move-tab-left');
});

test('Ctrl+1…9 van a la pestaña; AltGr (Ctrl+Alt) no es un atajo', () => {
  assert.equal(comandoDe(ctrl('1')), 'tab-1');
  assert.equal(comandoDe(ctrl('9')), 'tab-9');
  assert.equal(comandoDe(ctrl('2', { alt: true })), null);   // AltGr+2 = @ en el teclado español
  assert.equal(comandoDe(ctrl('e', { alt: true })), null);   // AltGr+E = €
  assert.equal(comandoDe(t('a')), null);
  assert.equal(comandoDe(ctrl('c')), null);                  // copiar: no es nuestro
  assert.equal(comandoDe(ctrl('v')), null);
});

test('con el foco en la web, main solo corta los reservados', () => {
  const r = (i) => comandoDe(i, { soloReservados: true });
  assert.equal(r(ctrl('t')), 'new-tab');
  assert.equal(r(ctrl('w')), 'close-tab');
  assert.equal(r(ctrl('n')), 'new-window');
  assert.equal(r(t('F5')), 'reload');
  // La web los ve primero: Ctrl+K en Docs/Slack, Ctrl+S en un editor, Ctrl+G ir a línea…
  for (const i of [ctrl('k'), ctrl('e'), ctrl('s'), ctrl('g'), ctrl('u'), ctrl('p'), ctrl('PageDown'), ctrl('PageDown', { shift: true })]) {
    assert.equal(r(i), null, i.key);
  }
  // …pero si no los usa, el webview los reenvía y el renderer sí los atiende.
  assert.equal(comandoDe(ctrl('k')), 'focus-search');
});

test('con los atajos apagados solo quedan F11 y F12', () => {
  const off = (i) => comandoDe(i, { activos: false });
  assert.equal(off(ctrl('t')), null);
  assert.equal(off(t('F5')), null);
  assert.equal(off(t('F11')), 'fullscreen');
  assert.equal(off(t('F12')), 'devtools');
});

test('cada pulsación tiene como mucho un comando (sin entradas que se pisen)', () => {
  const teclas = new Set(ATAJOS.flatMap((a) => a.k));
  const combos = [];
  for (const c of [false, true]) for (const s of [false, true]) for (const a of [false, true]) combos.push({ control: c, shift: s, alt: a });
  for (const k of teclas) {
    for (const m of combos) {
      const que = ATAJOS.filter((x) => x.k.includes(k) && x.mod({ key: k, ...m }));
      assert.ok(que.length <= 1, `${k} ${JSON.stringify(m)} -> ${que.map((x) => x.cmd)}`);
    }
  }
});

test('Ctrl+W no cierra las fijadas', () => {
  assert.equal(cierraConAtajo({ id: 1, pinned: true }), false);
  assert.equal(cierraConAtajo({ id: 1, pinned: false }), true);
  assert.equal(cierraConAtajo({ id: 1 }), true);
  assert.equal(cierraConAtajo(null), false);
});
