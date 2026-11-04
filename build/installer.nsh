; Naviris como navegador de Windows (electron-builder incluye este archivo en el instalador).
;
; Windows 10 y 11 no dejan que un programa se ponga solo como predeterminado:
; aquí Naviris solo se REGISTRA como navegador, para que salga en
; Configuración > Aplicaciones > Aplicaciones predeterminadas y en «Abrir con».
; La persona lo elige allí (el botón del menú de Naviris abre esa página).
; Es lo mismo que hacen Chrome, Edge y Opera instalados por usuario:
;   Software\Clients\StartMenuInternet\Naviris   el navegador y sus capacidades
;   Software\RegisteredApplications              para que Configuración lo encuentre
;   Software\Classes\NavirisHTML y NavirisPDF    cómo se abre un enlace o un archivo
;   Software\Classes\.ext\OpenWithProgids        para que salga en «Abrir con»
; No se toca la asociación que haya elegido el usuario (UserChoice) ni las
; claves http/https/.html de otros programas.
;
; El comando lleva --single-argument (como Chrome): Chromium toma todo lo que
; viene detrás como un único argumento, así un enlace no puede colar opciones
; en la línea de comandos (ver src/abrir-desde-fuera.js).
;
; La instalación es por usuario (perMachine: false), así que SHELL_CONTEXT es
; HKCU; main.js abre ms-settings:defaultapps?registeredAppUser=Naviris por eso.

!define NAV_CLIENTE "Software\Clients\StartMenuInternet\Naviris"

!macro navirisTipo ID NOMBRE
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}" "" "${NOMBRE}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}" "FriendlyTypeName" "${NOMBRE}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}\shell\open\command" "" '"$appExe" --single-argument %1'
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}\Application" "ApplicationName" "Naviris"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}\Application" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}\Application" "ApplicationCompany" "IRIS Studio"
!macroend

!macro navirisArchivo EXT ID
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\Capabilities\FileAssociations" "${EXT}" "${ID}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${ID}" ""
!macroend

; Solo el valor de Naviris. La clave no se borra aunque quede vacía: DeleteRegKey
; /ifempty mira solo las subclaves y se llevaría los valores de otros programas.
!macro navirisQuitaArchivo EXT ID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${ID}"
!macroend

!macro customInstall
  !insertmacro navirisTipo "NavirisHTML" "Documento de Naviris"
  !insertmacro navirisTipo "NavirisPDF" "Documento PDF de Naviris"

  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}" "" "Naviris"
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\shell\open\command" "" '"$appExe"'
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\Capabilities" "ApplicationName" "Naviris"
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\Capabilities" "ApplicationDescription" "Navegador de IRIS Studio"
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\Capabilities" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\Capabilities\Startmenu" "StartMenuInternet" "Naviris"
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\Capabilities\URLAssociations" "http" "NavirisHTML"
  WriteRegStr SHELL_CONTEXT "${NAV_CLIENTE}\Capabilities\URLAssociations" "https" "NavirisHTML"
  !insertmacro navirisArchivo ".htm" "NavirisHTML"
  !insertmacro navirisArchivo ".html" "NavirisHTML"
  !insertmacro navirisArchivo ".svg" "NavirisHTML"
  !insertmacro navirisArchivo ".webp" "NavirisHTML"
  !insertmacro navirisArchivo ".pdf" "NavirisPDF"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Naviris" "${NAV_CLIENTE}\Capabilities"

  ; Que el Explorador y Configuración vean el cambio sin reiniciar (SHCNE_ASSOCCHANGED)
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; En una actualización el instalador nuevo ejecuta este desinstalador con
  ; --updated y vuelve a escribir todo justo después: no se quita nada, para
  ; que Windows no vea ni un momento la elección del usuario sin programa.
  ${ifNot} ${isUpdated}
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Naviris"
    DeleteRegKey SHELL_CONTEXT "${NAV_CLIENTE}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\NavirisHTML"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\NavirisPDF"
    !insertmacro navirisQuitaArchivo ".htm" "NavirisHTML"
    !insertmacro navirisQuitaArchivo ".html" "NavirisHTML"
    !insertmacro navirisQuitaArchivo ".svg" "NavirisHTML"
    !insertmacro navirisQuitaArchivo ".webp" "NavirisHTML"
    !insertmacro navirisQuitaArchivo ".pdf" "NavirisPDF"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endIf}
!macroend
