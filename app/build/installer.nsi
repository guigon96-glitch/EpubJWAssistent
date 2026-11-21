; Instalador do Criador de EPUB (NSIS)
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "FileFunc.nsh"

Var IsUpdate

!define APPNAME "Criador de EPUB"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define SRCDIR "..\dist\Criador de EPUB-win32-x64"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CriadorDeEPUB"

Name "${APPNAME}"
OutFile "..\dist\Instalar-Criador-de-EPUB-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\CriadorDeEPUB" "InstallDir"
RequestExecutionLevel user
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1046 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do ${APPNAME}"
VIAddVersionKey /LANG=1046 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "LegalCopyright" ""

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPNAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ${APPNAME} agora"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function .onInit
  StrCpy $IsUpdate "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  IfErrors +2
    StrCpy $IsUpdate "1"
FunctionEnd

Section "Instalar"
  ; espera o app fechar (até ~30 s), para conseguir substituir os arquivos
  StrCpy $R2 0
  espera:
    IfFileExists "$INSTDIR\${APPNAME}.exe" 0 livre
    ClearErrors
    FileOpen $R3 "$INSTDIR\${APPNAME}.exe" a
    IfErrors 0 abriu
    IntOp $R2 $R2 + 1
    IntCmp $R2 60 livre
    Sleep 500
    Goto espera
  abriu:
    FileClose $R3
  livre:
  SetOutPath "$INSTDIR"
  ; remove arquivos de versões anteriores, preservando a configuração do Google
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRCDIR}\*.*"
  ; se houver um google-oauth.json ao lado do instalador, copia junto
  IfFileExists "$EXEDIR\google-oauth.json" 0 +2
    CopyFiles /SILENT "$EXEDIR\google-oauth.json" "$INSTDIR\google-oauth.json"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"

  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "Software\CriadorDeEPUB" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${APPNAME}.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  ; atualização automática: abre o app de novo
  StrCmp $IsUpdate "1" 0 +2
    Exec '"$INSTDIR\${APPNAME}.exe"'
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  Delete "$INSTDIR\Criador de EPUB.exe"
  Delete "$INSTDIR\GUIA-GOOGLE.txt"
  Delete "$INSTDIR\LEIA-ME.txt"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\version"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"
  Delete "$INSTDIR\google-oauth.json"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"  ; só remove a pasta se estiver vazia
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\CriadorDeEPUB"
SectionEnd
