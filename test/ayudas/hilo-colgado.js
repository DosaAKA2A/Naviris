// Hilo del motor que no contesta nunca (test/adblock.test.js): se queda dando
// vueltas sin soltar la CPU, que es el peor caso para terminarlo.
'use strict';
for (;;) { /* colgado */ }
