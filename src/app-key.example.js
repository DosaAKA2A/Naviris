/* Plantilla de src/app-key.js, que NO se versiona.

   Naviris entra solo en la biblioteca de MOOVIN mandando esta clave; el worker
   la cambia por un token con caducidad. Tiene que coincidir con el secret
   NAVIRIS_KEY del worker `moovin` (Iris/moovin/worker).

   Para tener un Naviris que entre solo:
     1. copia este archivo a src/app-key.js
     2. pega dentro la clave (copia local en ~/.moovin-app-key)
   En el CI lo escribe el paso correspondiente desde el secret NAVIRIS_MOOVIN_KEY.

   Sin este archivo Naviris pide el pase como cualquier navegador: no se rompe
   nada, solo se pierde la comodidad. */
module.exports = '';
