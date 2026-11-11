# Historial de cambios

Lo que cambia en cada versión de Naviris para escritorio, de la más nueva a la más vieja. Las versiones **estables** llegan a todas las instalaciones; las **dev** (con `-dev`) solo a NavirisDev. Las notas largas de cada versión, con imágenes, están en `novedades/`.

## 3.0.0 · estable · 11 de noviembre de 2026

Naviris 3 llega a todos. Trae todo lo de la 3.0.0-dev.1 (abajo) y además:

- **Motor al día**: Electron 45 con Chromium 156. Copiar y pegar desde las webs funciona como en Chrome.
- **Actualizaciones firmadas**: Naviris solo instala versiones y complementos firmados por nosotros. Si una firma no cuadra, no descarga nada y te lleva a naviris.site.
- **Más seguro**: la interfaz ya no se carga como archivo del disco, las descargas peligrosas preguntan antes de abrirse y las contraseñas se guardan por sitio y protocolo.
- **Watch Party 2.9.0**: el servidor decide quién es el anfitrión, así nadie con el código puede hacerse pasar por él.
- **Más rápido al abrir**: Tendencias ya no recarga cada vez que se repinta el hub y el bloqueador carga sin retrasar la ventana. Si la migración del perfil tarda, verás el arranque en vez de una espera en blanco.

## 3.0.0-dev.1 · dev · 4 de noviembre de 2026

Primera versión de Naviris 3, un remaster completo.

- **Arranque nuevo**: la lente del logo se abre con un muelle, con sonidos propios y mucho más bajos. La ventana aparece en cuanto la interfaz está lista y el sonido suena entero.
- **Estética nueva**: barra, pestañas, menús de clic derecho propios, descargas, avisos y un dock que puedes elegir.
- **Lo que faltaba frente a Chrome**: atajos de teclado, corrector, avisos de la página (alert, confirm, prompt) dentro de la pestaña sin congelar el navegador, descargas y buscador a elegir. F5 recarga siempre y el freno de recargas sigue parando los bucles de las webs.
- **Una sola ventana**: si Naviris ya está abierto, lo que abras desde fuera (un enlace, un archivo) llega a esa ventana. Se puede poner como navegador predeterminado.
- **Más ligero**: las pestañas que no ves dejan de gastar procesador sin cortar el sonido, y el hub se adapta al tamaño de la pantalla sin reordenarse.
- **Ventanas emergentes**: solo se abren con un clic tuyo. Si una se bloquea, aparece un aviso y «Permitir» la abre en ese momento.
- **Seguridad**: una web ya no puede controlar la ventana que abre (sin marco, encima de todo, invisible o fuera de la pantalla), y una página guardada en tu equipo no puede leer otros archivos del disco.
- **Bloqueador**: lista de Peter Lowe, respaldo si el motor se cuelga, ocultado genérico, menos rastro en YouTube y avisos de cookies cerrados también dentro de los marcos. Los avisos de cookies los decides tú.
- **Rat Tool**: videos en H.264, ffmpeg 9, rutas con tildes, la calidad que eliges, binarios verificados y cookies de YouTube solo cuando hacen falta.
- **Sesiones**: el aviso de salir de una página ya no congela el navegador, los inicios de sesión en ventanita funcionan y las cookies de los marcos de otras webs ya no se mezclan con las del sitio (se limpian una vez las que se mezclaron).
- **Watch Party** se reconecta sola si se cae la conexión, y la pausa ya no hace eco. Los videos de X con tarjeta se reproducen sin abrir la web y AutoClaim cuenta bien.
- **Fuera el nombre viejo**: todo se llama Naviris por dentro. Tu perfil se pasa al nombre nuevo sin perder nada, y lo viejo se queda por si vuelves a la 2.x.
- **Por dentro**: la interfaz deja de ser un solo archivo enorme y pasa a 29 módulos, sin cambiar nada de lo que se ve.

## 2.8.1 · estable · 11 de octubre de 2026

Todo lo de la serie 2.8.1-dev llega a la estable.

- Google y YouTube dejan iniciar sesión otra vez, sin el aviso de navegador no seguro. YouTube ya no se queda en negro.
- El hub, rehecho: baldosas opacas, accesos en un dock, pestaña activa bien marcada y transparencia a tu gusto.
- Más ligero y más seguro: en reposo gasta menos de la mitad, los espacios protegidos ya no se abren sin su contraseña y hay una página de error propia.
- Las páginas protegidas por Cloudflare entran solas. Outlook vuelve a dejar entrar y el Rat Tool baja otra vez de YouTube, Instagram y X.
- Ctrl más la rueda del mouse hace zoom, F5 recarga siempre, los enlaces visitados ya no se tiñen de morado y los iconos de la barra lateral quedan centrados.

## 2.8.1-dev.16 · dev · 11 de octubre de 2026

- El inicio de sesión de Google ya no sufre bloqueos.
- El bloqueador respeta las excepciones y YouTube ve menos rastro de él.

## 2.8.1-dev.15 · dev · 7 de octubre de 2026

- YouTube ya no se queda en negro.
- El bloqueador vuelve a usar scriptlets y sustitutos, armados desde uBlock y Brave, para que YouTube no lo detecte.
- Ante el muro anti-bloqueador de YouTube, un reintento y, si sigue, un aviso con la lista blanca.

## 2.8.1-dev.14 · dev · 6 de octubre de 2026

- La verificación de Cloudflare pasa sola: todos los marcos y procesos de una pestaña se presentan igual.

## 2.8.1-dev.13 · dev · 5 de octubre de 2026

Revisión completa del navegador.

- Gasta menos de la mitad de procesador en reposo, y una pestaña dormida libera su proceso entero.
- Los espacios con contraseña ya no se pueden abrir sin escribirla, por ningún atajo.
- Página de error propia cuando una dirección no existe o no hay conexión.
- Más de cien arreglos en pestañas, paneles, menús, temas, textos y addons.

## 2.8.1-dev.12 · dev · 26 de septiembre de 2026

- Google y YouTube dejan iniciar sesión otra vez.
- El Rat Tool vuelve a bajar de YouTube: descarga Deno, el motor de JavaScript que necesita yt-dlp.
- Ctrl más la rueda del mouse hace zoom y F5 recarga también en páginas que avisan antes de salir.

## 2.8.1-dev.7 a 2.8.1-dev.11 · dev · 19 de septiembre de 2026

- Outlook vuelve a entrar, también sin el modo agente, y Windows Hello sale delante de Naviris.
- YouTube arranca, también con cuenta, y el Rat Tool baja de Instagram y X.
- El mouse vuelve a su sitio al salir de la pantalla completa de una web.
- Watch Party: el chat se ve en pantalla completa.

## 2.8.1-dev.6 · dev · 9 de septiembre de 2026

- Fuera el morado de los enlaces visitados: cada web pinta sus enlaces.

## 2.8.1-dev.5 · dev · 9 de septiembre de 2026

- El hub se deja editar en pantallas de 1920×1080 y los widgets se adaptan a su alto.

## 2.8.1-dev.4 · dev · 9 de septiembre de 2026

- Transparencia del hub regulable, biblioteca de sitios al añadir un acceso, tarjeta con el color de su marca y barra lateral más compacta.

## 2.8.1-dev.3 · dev · 9 de septiembre de 2026

- El dock ya no tapa los widgets en ventanas pequeñas y la barra lateral pierde los círculos.

## 2.8.1-dev.2 · dev · 9 de septiembre de 2026

- El hub, rehecho: baldosas opacas, accesos en un dock y una composición nueva de fábrica. La pestaña activa por fin se distingue.

## 2.8.1-dev.1 · dev · 9 de septiembre de 2026

- Los iconos de la barra lateral quedan centrados en vertical.

## 2.8.0 · estable · 9 de septiembre de 2026

- Arranque con otra cara: el logo dentro de un anillo que avanza con cada paso real del arranque.
- Tú decides cuándo actualizar: interruptor de actualizaciones automáticas en Ajustes. Apagado, Naviris avisa y no descarga nada.
- Menos código y más seguro: fuera 268 líneas sin uso y el icono que declara una web ya no puede colar código en el navegador.
- El addon Captura larga sale del catálogo y se desinstala solo.
