# Seguridad de Naviris

Última revisión: **29 de julio de 2026**, sobre la versión 2.7.3-dev.3.

Este documento cuenta, sin adornos, cómo protege Naviris tus datos, qué se
revisó, qué se encontró y qué queda pendiente. Está escrito para que cualquier
persona que use el navegador pueda juzgar por sí misma si le convence.

---

## Dónde vive cada cosa

| Dato | Dónde se guarda | Cómo se protege | ¿Sale de tu equipo? |
|---|---|---|---|
| Contraseñas de sitios | `cobalt-passwords.json` en tu perfil | Cifradas con `safeStorage` (DPAPI, atado a tu cuenta de Windows). Verlas o autorrellenarlas exige **Windows Hello** | **No, nunca** |
| Tarjetas de crédito | `cobalt-cards.json` en tu perfil | Igual que las contraseñas. En claro solo quedan marca, últimos 4 dígitos y caducidad | **No, nunca** |
| CVC de la tarjeta | En ningún sitio | No se guarda jamás; lo tecleas tú en cada pago | — |
| Historial y sesión | `localStorage` de la interfaz | Local | **No** |
| Preferencias, marcadores, accesos, widgets | Local, y en la nube **solo si creas una cuenta** | En tránsito por HTTPS; en el servidor, ligadas a tu cuenta | Solo con cuenta, y solo eso |
| Contraseña de tu cuenta Naviris | Servidor | PBKDF2-SHA256, 100 000 iteraciones, sal propia por cuenta. **Nunca se guarda la contraseña** | Se envía al entrar, por HTTPS |
| Token de sesión de la cuenta | Servidor y tu equipo | En el servidor se guarda **hasheado** (SHA-256): quien leyera la base de datos no podría suplantarte | — |

**La regla de oro: contraseñas y tarjetas no se sincronizan.** Aunque uses la
cuenta de Naviris en cinco ordenadores, esos datos se quedan en cada equipo.
Es una decisión deliberada: no queremos poder descifrarlos ni aunque quisiéramos.

---

## Cómo está construido el aislamiento

Naviris usa Electron con la configuración estricta:

- **`sandbox: true`** en cada pestaña: el código de las webs corre en un proceso
  con privilegios recortados por el sistema operativo.
- **`contextIsolation: true`** y **`nodeIntegration: false`**: una web no puede
  tocar Node.js ni las funciones internas del navegador.
- **`nodeIntegrationInSubFrames: false`**: los iframes de terceros (anuncios,
  widgets incrustados) no reciben ni siquiera el preload de Naviris, así que un
  anuncio no puede fingir un formulario de acceso para provocar autorrellenos.
- **Aislamiento de sitios** de Chromium activo, y **HTTPS por defecto** con
  reintento en las navegaciones.
- **Permisos denegados por defecto**: cámara, micrófono, ubicación,
  notificaciones, USB, HID, serie, Bluetooth y portapapeles se preguntan
  siempre, se recuerdan por origen, y cualquier permiso no listado se deniega.

---

## Qué se revisó y qué se encontró (29-07-2026)

### 1. Contraseñas ofrecidas a un sitio que no era el suyo — **GRAVE, corregido**

El emparejamiento de credenciales reducía cada dominio a sus **dos últimas
etiquetas**. Para `.com` funciona (`github.com`), pero para los sufijos de dos
partes se rompía:

```
bbc.co.uk       -> "co.uk"
evil.co.uk      -> "co.uk"     <- ¡el mismo!
banco.com.br    -> "com.br"
atacante.com.br -> "com.br"    <- ¡el mismo!
```

**Impacto real:** alguien que registrara `loquesea.co.uk` (o `.com.br`,
`.co.jp`, `.com.mx`, `.com.ar`…) y pusiera un formulario de acceso recibía de
Naviris la oferta de autorrellenar la contraseña guardada de **otro sitio bajo
ese mismo sufijo**. Hacía falta que la persona pulsara «Rellenar» y pasara
Windows Hello, pero la barra decía el nombre de su cuenta real, así que el
engaño era creíble. Afectaba a millones de dominios legítimos.

**Corregido:** el emparejamiento ahora exige **el host completo**: coincidencia
exacta, o que uno sea subdominio del otro (`bbc.co.uk` vale en
`login.bbc.co.uk`). Además se rechazan como dominio padre los sufijos públicos
conocidos. Verificado con una batería de casos, incluidos los cuatro de arriba.

*Efecto secundario aceptado:* una contraseña guardada en `accounts.google.com`
ya no se ofrece en `mail.google.com`. Preferimos pedirte que la guardes dos
veces antes que arriesgarnos a enseñársela a quien no debe.

### 2. La interfaz no tenía Content-Security-Policy — **corregido**

La ventana de Naviris (la que tiene acceso al puente con contraseñas y
tarjetas) no declaraba CSP. Cualquier fallo de tipo XSS en ella —por ejemplo un
título de página malicioso mal escapado— habría podido cargar un script remoto
y llevarse datos.

**Corregido:** CSP estricta (`default-src 'none'`, sin `eval`, sin scripts
remotos) y `connect-src` limitado a los cuatro servicios que la interfaz usa de
verdad: el servidor de cuentas, el del tiempo y las dos fuentes de geolocalización.
Comprobado en vivo: los servicios permitidos funcionan y un dominio cualquiera
queda bloqueado.

*Nota:* se revisó el escapado de todos los datos que vienen de las webs
(títulos, URLs, favicons, nombres de archivo) y estaban correctamente tratados
con `escapeHtml` o `textContent`. La CSP es una segunda barrera, no un parche.

### 3. El IPC sensible no comprobaba quién llamaba — **corregido**

Los canales de contraseñas, tarjetas, ajustes y addons atendían a cualquier
proceso. Con el aislamiento actual una web no puede llegar ahí, pero era una
única capa de defensa.

**Corregido:** 17 canales sensibles solo responden ahora si quien llama es la
interfaz de Naviris cargada desde el disco. Cualquier otra procedencia se
rechaza y se registra.

### 4. Cuenta Naviris: fuerza bruta y fuga de correos — **corregido**

- No había límite de intentos: se podían probar contraseñas sin freno.
- Los mensajes de error distinguían «no existe esa cuenta» de «contraseña
  incorrecta», lo que permitía averiguar **qué correos tienen cuenta**.
- Los tokens de sesión se guardaban tal cual en la base de datos.

**Corregido:** máximo de 10 intentos fallidos por IP cada 15 minutos (los
aciertos no cuentan); un único mensaje «Correo o contraseña incorrectos» con el
mismo coste de cómputo en ambos casos; y los tokens se guardan hasheados con
SHA-256. Todo verificado con una base de datos limpia.

### 5. Revisado y correcto, sin cambios necesarios

- **Enlaces externos:** solo se abren `http://` y `https://` fuera del
  navegador; no se pueden lanzar programas ni abrir archivos locales.
- **Permisos de sitios:** denegar por defecto, preguntar lo sensible.
- **Descargas:** el historial es propio de Naviris, no lee tu carpeta entera.
- **Ventana privada:** no guarda contraseñas ni tarjetas, ni sincroniza.
- **Origen de los addons:** solo se instalan desde `https://naviris.site/addons/`;
  cualquier otra procedencia se rechaza en el proceso principal.

---

## Lo que debes saber antes de confiar del todo

Estas no son vulnerabilidades, son **decisiones de diseño con contrapartidas**.
Nos parece más honesto contarlas que callarlas.

### Los addons son código con privilegios

Un addon de tipo herramienta corre **dentro de la interfaz** y, por tanto,
puede usar el mismo puente que Naviris: consultar qué contraseñas y tarjetas
tienes guardadas (no sus valores; leerlos sigue exigiendo Windows Hello) y
llegar a tu token de sesión. Los addons solo pueden instalarse desde el
catálogo oficial y los escribimos nosotros, pero **instalar un addon es un acto
de confianza**, igual que instalar una extensión en Chrome. Si algún día se
abre el catálogo a terceros, hará falta un sistema de permisos antes.

### El Modo agente abre una puerta, a propósito

Con el Modo agente activo, Naviris escucha en `127.0.0.1:9223` y **cualquier
programa de tu ordenador** puede controlar el navegador con tus sesiones
abiertas. Está apagado por defecto, avisa con un distintivo permanente en la
barra y se desactiva solo al actualizar. Aun así: **enciéndelo solo mientras lo
uses**.

### Windows Hello es la última línea, no la primera

Ver o autorrellenar una contraseña o una tarjeta pide siempre Windows Hello.
Eso protege frente a alguien que se siente en tu ordenador desbloqueado, pero
no frente a un programa que ya esté ejecutándose con tu usuario: el cifrado es
DPAPI, atado a tu cuenta de Windows, así que un virus con tus privilegios podría
descifrarlo. Esto es exactamente igual en Chrome, Edge, Brave y Opera. La
defensa real ahí es no tener el equipo comprometido.

### Lo que aún no está verificado

- El **autorrelleno de tarjetas funciona en formularios de pago que viven en la
  propia página** (verificado el 2026-07-29 contra el markup exacto del checkout
  alojado de Stripe y contra una pasarela clásica de campos name/id con
  selectores de mes y año: detección, barra de aviso y relleno correctos, CVC
  intacto). Su límite conocido: las pasarelas que incrustan el campo del número
  en un **iframe** (Stripe Elements y similares) no se detectan — ahí la barra
  simplemente no aparece. No puede filtrar en ningún caso: el número solo sale
  tras Windows Hello y solo va al formulario de la página que estás viendo.
- El servidor de cuentas **no tiene auditoría externa**. Es código propio,
  pequeño y publicado en el repositorio para que cualquiera lo revise.

---

## Si encuentras un fallo

Escribe a **hatr_ed@outlook.com** o abre un issue en
[github.com/DosaAKA2A/Naviris](https://github.com/DosaAKA2A/Naviris). Si es algo
que pueda afectar a datos de otras personas, cuéntalo en privado primero y danos
margen para publicar el arreglo.
