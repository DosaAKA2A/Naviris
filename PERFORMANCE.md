# Rendimiento de Naviris

Naviris frente a Google Chrome y Brave en un mismo equipo: arranque, memoria y CPU, carga de páginas, video de YouTube y benchmarks estándar. Todo lo de esta página se midió el 11 de noviembre de 2026 con los guiones de [`benchmark/`](benchmark/), y cada valor suelto está en [`benchmark/resultados/2026-11-11.json`](benchmark/resultados/2026-11-11.json). Si tienes Windows, puedes repetirlo en tu equipo.

La idea es contar en qué casos Naviris gasta menos, cuánto y en cuáles gasta más. No sale primero en todo.

## En resumen

- **Con muchas pestañas abiertas, Naviris usa menos memoria que Chrome.** Con 10 sitios al fondo ocupa 1803 MB frente a 1939 MB de Chrome (7 % menos) y 1821 MB de Brave. Abre 19 procesos; Chrome, 29.
- **Las páginas se ven antes.** Con el bloqueador activado, la suma del LCP de 10 sitios da 6,4 s, frente a 7,9 s de Brave, que también bloquea. Con el bloqueador apagado queda a la par de Chrome en tiempo de carga y algo por delante en LCP (6,8 s frente a 7,3 s).
- **En JavaScript queda a 1–3 % de Chrome** (Speedometer 3.1 y JetStream 2.2), dentro de lo que varían las pasadas. Supera a Brave en Speedometer.
- **YouTube va igual que en los otros dos:** cero frames perdidos en 60 s de video a 60 fps, con la misma memoria y una CPU dentro de la misma horquilla.
- **La ventana aparece 1,1 s más tarde que la de Chrome.** Casi todo es la animación de arranque, que dura como mínimo 1,05 s; la página ya está cargada detrás a los 0,37 s.
- **En reposo gasta unos 85 MB más que Chrome** (347 frente a 261 MB), casi todo en el proceso de la GPU.
- **En gráficos pesados (MotionMark) saca un 40 % menos que Chrome.** Viene de Electron: el mismo Electron sin nada de Naviris saca lo mismo.

A cambio de esos 85 MB en reposo y de ese segundo al abrir, Naviris trae de fábrica el bloqueador de anuncios, el Rat Tool para bajar video y audio, AutoClaim para los drops de Twitch, Watch Party y los espacios protegidos. En Chrome, algo parecido pasa por instalar extensiones, y eso no está medido aquí.

## Equipo y versiones

| | |
|---|---|
| Procesador | AMD Ryzen 7 9800X3D (8 núcleos, 16 hilos) |
| Memoria | 32 GB |
| Sistema | Windows 11 Pro, compilación 26200 |
| Naviris | 3.0.0 en desarrollo, commit `f1b6bd2`, ejecutado desde el código (`electron .`) con Electron 45.2.1+wvcus = Chromium 156.0.8078.75 |
| Google Chrome | 157.0.8103.40 |
| Brave | 1.99.56 (Chromium 157) |
| Control | El mismo Electron 45.2.1 de Naviris con una ventana en blanco y nada de Naviris |

`f1b6bd2` es la 3.0.0 antes de sus dos últimos cambios de rendimiento. Lo que cambian está medido aparte en [«Lo que cambió en la 3.0.0»](#lo-que-cambió-en-la-300).

## Cómo se midió

- **Un navegador a la vez.** Nunca dos abiertos juntos. Cada uno con un perfil propio y controlado por CDP, el protocolo de depuración de Chromium. Entre medida y medida se cierra entero.
- **Configuración de cada uno:**
  - Naviris, tal como viene, con el bloqueador activado. Solo se apagaron los sonidos de la interfaz. Para la comparación con Chrome hay una segunda variante con el bloqueador apagado.
  - Chrome y Brave con `--no-first-run --disable-extensions`, ventana de 1280×800 como la de Naviris, reproducción automática sin gesto (Naviris la trae de serie) y sin cálculo de oclusión de ventanas (`--disable-features=CalculateNativeWinOcclusion`), que Naviris tampoco hace. Así ninguno deja de pintar si algo tapa la ventana.
  - Brave con Shields de serie.
- **Perfiles semilla.** Cada navegador arrancó una vez con perfil vacío y se dejó 2 minutos para su trabajo de primera vez: en Naviris, bajar y montar las listas del bloqueador; en Brave, las suyas y sus componentes. Cada pasada parte de una copia de su semilla: perfil limpio pero ya inicializado.
- **Orden rotado.** En cada repetición cambia qué navegador va primero, para repartir el ruido del equipo.
- **Repeticiones:** arranque 5, memoria y CPU 3 sesiones, carga de páginas 5, YouTube 3 y benchmarks 3.
- **Estadística.** Cada cifra es la mediana, con el mínimo y el máximo entre paréntesis. No hay p95: con 3 a 5 valores sería el máximo con otro nombre. El generador de tablas lo añade solo cuando hay 20 valores o más.
- **Memoria de todo el árbol de procesos.** La cifra principal es *private bytes*: la memoria que el navegador tiene reservada para él solo. Se da también el *working set* privado, que es lo que enseña el Administrador de tareas. El *working set* total no sirve para comparar: cuenta varias veces las páginas compartidas entre procesos, y Electron carga un binario más grande en cada uno.
- **Ruido.** Con cada medida se apuntó cuánta CPU usaba el resto del equipo: entre 1 y 9 % del total, con otras aplicaciones abiertas y sin uso.

## Qué comparación es justa

| Comparación | ¿Justa? | Por qué |
|---|---|---|
| Naviris **sin bloqueador** frente a **Chrome** | Sí | Ninguno bloquea nada. |
| Naviris **con bloqueador** frente a **Brave** | Sí, para carga y memoria con sitios | Los dos usan adblock-rust con listas parecidas. Brave además quita los avisos de cookies por su cuenta; Naviris deja que decidas tú. |
| Naviris con bloqueador frente a Chrome | No | Naviris carga menos cosas, así que lo que gana se debe al bloqueo. |
| JavaScript (Speedometer, JetStream) frente a Chrome | Casi | Naviris lleva Chromium 156 y Chrome, 157. El control con Electron solo separa lo que es de Naviris. |
| MotionMark (gráficos) | Solo frente al control | La distancia con Chrome es de Electron (ver [Benchmarks](#5-benchmarks)). |
| Ventana visible al arrancar | Con cuidado | La de Naviris la marca la duración mínima de su animación de arranque. |

## 1. Arranque

Cada navegador se abre con un enlace a una página local mínima, como al hacer clic en un enlace con el navegador cerrado.

- **Ventana:** desde que se lanza hasta su primera ventana visible de más de 600 px de ancho, mirando cada 5 ms. Así no cuenta la ventanita del logo de Naviris.
- **Página cargada:** hasta el evento `load` de esa página.
- **Perfil nuevo:** carpeta de perfil vacía. **Perfil existente:** segundo arranque del mismo perfil, justo después.
- En los dos casos la caché de disco de Windows estaba caliente. Un arranque en frío de verdad exige reiniciar el equipo y no está medido.

#### Arranque · ms, mediana (mín–máx) de 5 repeticiones

|  | Ventana, perfil nuevo | Página cargada, perfil nuevo | Ventana, perfil existente | Página cargada, perfil existente |
| --- | --- | --- | --- | --- |
| Naviris | 1405 (1381–1413) | 901 (808–1060) | 1287 (1279–1306) | 369 (344–389) |
| Chrome | 169 (165–176) | 242 (241–248) | 170 (158–172) | 202 (200–211) |
| Brave | 211 (202–217) | 266 (250–276) | 192 (186–194) | 263 (261–291) |


Cómo leerlo:
- **Naviris enseña la ventana 1,1 s más tarde que Chrome** (1287 frente a 170 ms con perfil existente). La animación de arranque dura como mínimo 1,05 s por diseño, y la ventana grande sale al terminar. Para entonces la página ya está cargada: a los 369 ms.
- **Sin contar la animación, Naviris queda unos 170 ms detrás de Chrome** con perfil existente (369 frente a 202 ms hasta la página). Electron tarda unos 160 ms en estar listo y montar la interfaz lleva unos 220 ms más, medido con el inspector del proceso principal.
- Con perfil nuevo la diferencia crece: 0,9 s hasta la página frente a 0,24 s de Chrome.
- La primera vez que Naviris se abre en un equipo baja el módulo de video protegido (Widevine) antes de enseñar la ventana. En este equipo fueron 3,3 s, una sola vez. No entra en la tabla.

## 2. Memoria y CPU

En la misma sesión y por este orden. Antes de cada medida, 20 s de espera (15 s si solo se cambia de pestaña) y después 40 s de medida sin tocar nada:

- **Reposo:** la página de inicio.
- **1 sitio:** Wikipedia delante.
- **5 sitios:** Wikipedia, GitHub, YouTube, MDN y BBC Mundo. Primero con el último delante y luego con la página de inicio delante (todo al fondo).
- **10 sitios:** los 5 de antes más Hacker News, Reddit, Amazon, NYTimes y El Comercio, igual.

#### Private bytes (MB) · mediana (mín–máx) de 3 sesiones

|  | Reposo | 1 sitio | 5 sitios, uno delante | 5 sitios al fondo | 10 sitios, uno delante | 10 sitios al fondo |
| --- | --- | --- | --- | --- | --- | --- |
| Naviris | 347 (344–442) | 412 (406–524) | 1117 (1110–1133) | 1081 (1067–1102) | 1890 (1887–1895) | 1803 (1796–1808) |
| Naviris sin bloqueador | 444 (442–447) | 529 (526–529) | 1138 (1134–1141) | 1100 (1096–1101) | 2010 (2003–2014) | 1960 (1953–1976) |
| Chrome | 261 (258–264) | 337 (334–337) | 1074 (1067–1083) | 1037 (1031–1054) | 1986 (1962–2033) | 1939 (1906–1961) |
| Brave | 253 (250–254) | 332 (330–336) | 1097 (1066–1103) | 1045 (1039–1076) | 1916 (1848–1928) | 1821 (1740–1828) |

#### Working set privado (MB) · mediana (mín–máx) de 3 sesiones

|  | Reposo | 1 sitio | 5 sitios, uno delante | 5 sitios al fondo | 10 sitios, uno delante | 10 sitios al fondo |
| --- | --- | --- | --- | --- | --- | --- |
| Naviris | 208 (207–240) | 264 (261–300) | 767 (757–774) | 748 (738–759) | 1429 (1425–1436) | 1350 (1340–1357) |
| Naviris sin bloqueador | 242 (239–243) | 301 (300–304) | 771 (767–781) | 752 (748–757) | 1512 (1507–1517) | 1473 (1467–1482) |
| Chrome | 161 (157–162) | 213 (211–214) | 720 (715–721) | 711 (709–731) | 1484 (1421–1492) | 1425 (1413–1458) |
| Brave | 155 (153–156) | 215 (214–219) | 787 (749–789) | 740 (729–774) | 1489 (1416–1500) | 1386 (1302–1396) |

#### CPU de todo el árbol (ms en 40 s) · mediana (mín–máx) de 3 sesiones

|  | Reposo | 1 sitio | 5 sitios, uno delante | 5 sitios al fondo | 10 sitios, uno delante | 10 sitios al fondo |
| --- | --- | --- | --- | --- | --- | --- |
| Naviris | 297 (250–329) | 4125 (3859–4265) | 407 (314–921) | 282 (125–344) | 14 469 (14 453–14 939) | 407 (282–453) |
| Naviris sin bloqueador | 281 (265–422) | 4188 (4141–4391) | 314 (204–344) | 501 (314–531) | 14 703 (14 142–14 845) | 484 (453–548) |
| Chrome | 297 (219–531) | 4001 (3470–4078) | 344 (266–360) | 470 (312–531) | 13 939 (13 703–15 032) | 454 (376–484) |
| Brave | 422 (391–547) | 3781 (3563–3890) | 703 (657–1047) | 485 (453–797) | 15 281 (14 530–15 453) | 390 (298–548) |

#### Procesos abiertos · mediana

|  | Reposo | 1 sitio | 5 sitios, uno delante | 5 sitios al fondo | 10 sitios, uno delante | 10 sitios al fondo |
| --- | --- | --- | --- | --- | --- | --- |
| Naviris | 4 | 5 | 13 | 13 | 19 | 19 |
| Naviris sin bloqueador | 6 | 7 | 13 | 13 | 23 | 23 |
| Chrome | 12 | 10 | 18 | 18 | 29 | 29 |
| Brave | 7 | 8 | 15 | 15 | 23 | 23 |


Cómo leerlo:
- **Con 10 sitios Naviris usa menos memoria que Chrome:** 1803 frente a 1939 MB al fondo y 1890 frente a 1986 MB con uno delante. Con Brave, la comparación justa con el bloqueador activado, queda a la par: 1803 frente a 1821 MB.
- **Sin bloqueador frente a Chrome**, la comparación justa, queda igual: 1960 frente a 1939 MB con 10 al fondo.
- **Con 5 sitios gasta un poco más:** 1081 MB al fondo frente a 1037 de Chrome y 1045 de Brave, un 4 % más.
- **Abre menos procesos:** 19 con 10 sitios, frente a 29 de Chrome y 23 de Brave. Chrome deja un proceso de reserva para la próxima pestaña, otro para la página de nueva pestaña y más servicios aparte.
- **En reposo gasta unos 85 MB más que Chrome** (347 frente a 261 MB). Casi todo es el proceso de la GPU: 186 a 215 MB, frente a 81 de Chrome y 99 de Brave. La diferencia desaparece con 5 sitios abiertos, donde los tres rondan los 320 a 340 MB de GPU. Parece caché de imágenes y capas del hub (el fondo incluido) que Chromium suelta cuando le hace falta. Es una sospecha: no está desglosado.
- **La variante sin bloqueador en reposo tiene más procesos y unos 100 MB más.** En esa medida seguían abiertas dos páginas ocultas del widget Tendencias. La 3.0.0 cambia ese widget (ver más abajo); el reposo no se ha vuelto a medir.
- **CPU a la par.** Con todo al fondo, Naviris gasta lo mismo o menos que Chrome y Brave. Los 4 s con Wikipedia delante y los 14 s con El Comercio delante salen igual en los tres: esas páginas tienen animaciones.

## 3. Carga de páginas

Cada sitio en una pestaña nueva en primer plano, con la caché vacía. *Load* es el tiempo hasta el evento `load` de la página (desde su `navigationStart`). LCP (*Largest Contentful Paint*) es cuándo se pinta el elemento más grande, lo más parecido a «ya veo la página».

#### Carga, navigationStart → load (ms) · mediana (mín–máx) de 5 pasadas con caché vacía

| Sitio | Naviris | Naviris sin bloqueador | Chrome | Brave |
| --- | --- | --- | --- | --- |
| es.wikipedia.org/wiki/Navegador_web | 341 (334–384) | 379 (376–383) | 375 (375–380) | 405 (356–575) |
| github.com/electron/electron | 948 (932–1014) | 974 (907–1051) | 990 (948–1323) | 1048 (1020–1100) |
| youtube.com | 678 (557–758) | 676 (544–723) | 666 (519–676) | 562 (529–589) |
| developer.mozilla.org/es | 88 (86–102) | 90 (86–93) | 109 (100–125) | 136 (130–144) |
| bbc.com/mundo | 284 (281–337) | 428 (413–445) | 388 (383–426) | 315 (203–333) |
| news.ycombinator.com | 756 (755–810) | 810 (755–811) | 754 (752–763) | 833 (778–836) |
| reddit.com/r/programming | 206 (202–211) | 222 (213–257) | 306 (305–311) | 1040 (1001–1566) |
| amazon.com | 775 (682–812) | 699 (592–991) | 697 (559–779) | 721 (181–899) |
| nytimes.com | 1972 (1731–2017) | 2239 (2221–6380) | 2489 (2317–2634) | 878 (800–907) |
| elcomercio.pe | 326 (295–347) | 995 (631–1114) | 648 (615–948) | 489 (361–825) |
| **Suma de medianas** | **6374** | **7512** | **7422** | **6427** |

#### LCP (ms) · mediana (mín–máx) de 5 pasadas con caché vacía

| Sitio | Naviris | Naviris sin bloqueador | Chrome | Brave |
| --- | --- | --- | --- | --- |
| es.wikipedia.org/wiki/Navegador_web | 324 (320–332) | 320 (316–328) | 524 (520–528) | 356 (352–356) |
| github.com/electron/electron | 848 (760–884) | 792 (748–936) | 956 (908–1016) | 932 (900–988) |
| youtube.com | 704 (680–748) | 708 (668–728) | 720 (636–732) | 660 (616–680) |
| developer.mozilla.org/es | 156 (156–176) | 408 (396–896) | 404 (336–424) | 524 (432–840) |
| bbc.com/mundo | 268 (264–292) | 280 (272–292) | 276 (268–296) | 148 (144–156) |
| news.ycombinator.com | 628 (624–668) | 668 (628–672) | 628 (624–636) | 692 (648–696) |
| reddit.com/r/programming | 136 (132–140) | 140 (140–152) | 240 (236–244) | 628 (596–880) |
| amazon.com | 536 (520–552) | 540 (360–560) | 416 (300–516) | 508 (208–544) |
| nytimes.com | 2616 (2488–2660) | 2736 (2596–6956) | 2856 (2832–3600) | 2888 (2800–2940) |
| elcomercio.pe | 208 (188–216) | 228 (212–664) | 236 (220–340) | 592 (372–804) |
| **Suma de medianas** | **6424** | **6820** | **7256** | **7928** |


Cómo leerlo:
- **Sin bloqueador frente a Chrome:** a la par sitio a sitio. La suma de *load* da 7512 frente a 7422 ms (1 % más) y la de LCP, 6820 frente a 7256 ms (6 % menos), sobre todo por Wikipedia y GitHub.
- **Con bloqueador frente a Brave:** la carga suma lo mismo (6374 frente a 6427 ms) y el LCP sale un 19 % antes (6424 frente a 7928 ms). Brave gana en NYTimes y en el LCP de BBC Mundo; Naviris, en Reddit, MDN y El Comercio.
- Algunos sitios sirven páginas distintas según el navegador. Reddit le da a Brave una página de 79 recursos y a los demás una de 4 o 5. NYTimes llega al tope de 250 recursos medidos en Naviris y Brave, y en Chrome se queda en 51. Por eso vale más mirar sitio a sitio que la suma.

## 4. YouTube

Big Buck Bunny a 60 fps, silenciado y en primer plano. El aviso de cookies se contesta igual en los tres. Ninguna pasada tuvo anuncio. YouTube eligió 480p por el tamaño de la ventana, con AV1 y Opus en los tres.

#### YouTube, 60 s de video · mediana (mín–máx) de 3 pasadas

|  | CPU (ms en 60 s) | Private bytes (MB) | Working set (MB) | Procesos | Frames | Perdidos |
| --- | --- | --- | --- | --- | --- | --- |
| Naviris | 7001 (6438–9781) | 890 (886–925) | 1312 (1302–1350) | 8 | 1830 (1828–1835) | 0 |
| Chrome | 8173 (7063–8516) | 895 (894–899) | 1242 (1232–1255) | 17 (16–17) | 1829 (1828–1830) | 0 |
| Brave | 8844 (6500–9812) | 889 (864–897) | 1149 (1148–1164) | 10 | 1827 (1827–1828) | 0 |


Cómo leerlo: a la par. Ninguno pierde frames y la memoria es la misma. La mediana de CPU de Naviris es la más baja, pero los rangos se solapan tanto que no se puede decir que gaste menos.

## 5. Benchmarks

Speedometer 3.1, JetStream 2.2 y MotionMark 1.3.1 de browserbench.org, uno detrás de otro en la misma sesión. Más es mejor.

#### Benchmarks · puntos, más es mejor, mediana (mín–máx) de 3 pasadas

|  | Speedometer 3.1 | JetStream 2.2 | MotionMark 1.3.1 | Área de página |
| --- | --- | --- | --- | --- |
| Naviris | 40,0 (39,7–40,7) | 462 (455–469) | 1673 (1666–1685) | 1216×692 |
| Electron solo (control) | 40,8 (39,7–40,8) | 467 (429–471) | 1687 (1677–1705) | 1264×735 |
| Chrome | 41,2 (40,8–41,2) | 467 (464–470) | 2800 (2676–2810) | 1264×705 |
| Brave | 38,4 (38,4–38,8) | 468 (463–477) | 1415 (1409–1433) | 1264×711 |


Cómo leerlo:
- **JavaScript:** Naviris queda a 1–3 % de Chrome y del control, dentro de lo que se mueven las pasadas. Ni el bloqueador ni el código que Naviris mete en las páginas dejan una huella medible: cada consulta al motor del bloqueador cuesta entre 0,002 y 0,23 ms (abajo).
- **MotionMark: un 40 % menos que Chrome.** El control, el mismo Electron sin nada de Naviris, saca lo mismo (1687 frente a 1673). La diferencia está entre Electron con Chromium 156 y Chrome 157: versión, compilación o lo que Electron trae distinto en la GPU. Naviris no puede arreglarlo por su cuenta; se volverá a medir con el próximo Electron. Brave saca menos todavía.
- Naviris tiene algo menos de área de página, porque su barra ocupa más que la de Chrome. MotionMark eligió el mismo tamaño de prueba en todos.

### Coste del bloqueador

Medido en Node con [`benchmark/micro-adblock.cjs`](benchmark/micro-adblock.cjs), con el motor de 28 listas de la semilla:

| Operación | Coste |
|---|---|
| Reglas cosméticas de una página (`urlCosmeticResources`) | 0,002 a 0,23 ms por llamada; YouTube es la más cara, con 91 KB de scriptlets |
| Ocultado genérico con 350 clases e ids (`hiddenClassIdSelectors`) | 0,03 ms |
| Decidir si se bloquea una petición (`check`) | unos 0,01 ms |
| Cargar el motor guardado al arrancar | 26 a 37 ms |

## Lo que cambió en la 3.0.0

Después de esta medida entraron dos cambios en la 3.0.0, medidos antes y después con pasadas intercaladas:

- El motor del bloqueador se carga justo después de pedir la ventana, y no antes. No cambia nada de lo que se bloquea: ninguna web carga antes de que esté listo.
- El widget Tendencias guarda las tendencias mundiales 20 minutos. Antes, pasados 2 minutos, cada repintado del hub (cambiar de tema, editar el hub o redimensionar la ventana) volvía a montar páginas ocultas para leerlas.

#### Arranque antes y después de los cambios de la 3.0.0 · ms, mediana (mín–máx) de 8 pasadas intercaladas

|  | Ventana, perfil nuevo | Página cargada, perfil nuevo | Ventana, perfil existente | Página cargada, perfil existente |
| --- | --- | --- | --- | --- |
| f1b6bd2 | 1418 (1383–1445) | 1026 (954–1433) | 1294 (1285–1330) | 372 (355–410) |
| con los cambios de la 3.0.0 | 1434 (1416–1456) | 903 (850–980) | 1298 (1288–1324) | 389 (348–449) |

#### Repintado del hub pasados 2 min · 25 s, mediana (mín–máx) de 3 pasadas

|  | CPU (ms) | Pico de private bytes (MB) | Procesos nuevos |
| --- | --- | --- | --- |
| f1b6bd2 | 672 (594–2406) | 558 (542–613) | 1 (1–6) |
| con los cambios de la 3.0.0 | 203 (172–266) | 463 (459–470) | 0 |


- Con perfil nuevo, la página llega unos 120 ms antes. Con perfil existente no hay diferencia medible, y la ventana no se mueve en ningún caso porque la marca la animación de arranque.
- El repintado del hub ya no abre procesos nuevos: gasta 203 ms de CPU en vez de 672 y un pico de memoria unos 95 MB más bajo.
- Estas dos series se comparan entre sí. No se mezclan con las tablas de arriba, que son de otra sesión.

## Qué falta por medir

- **Edge y Firefox.** Edge ya está preparado en los guiones; Firefox necesita otro camino porque ya no habla CDP.
- **20 y 30 pestañas.** Hasta 10 no hay sorpresas; más allá, no se sabe.
- **Video en 4K** y otras calidades de YouTube. Con la ventana de 1280×800 todo salió a 480p.
- **Descargas:** velocidad y CPU del Rat Tool y de las descargas normales.
- **Una sesión de 2 horas**, con el ahorro de memoria de las pestañas dormidas, que actúa a los 30 minutos.
- **Energía estimada** en un portátil con batería.
- **El instalador.** Todo está medido desde el código con `electron .`, no con la versión empaquetada.
- Un arranque en frío tras reiniciar Windows, equipos con menos memoria y sitios con sesión iniciada.

## Repetirlo

Los guiones, cómo correrlos y qué producen están en [`benchmark/README.md`](benchmark/README.md). La batería entera lleva entre 4 y 5 horas con el equipo libre. Las tablas de esta página salen tal cual de:

```bash
node benchmark/resumen.mjs benchmark/resultados/2026-11-11.json
```
