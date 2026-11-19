; RCode — Windows shell integration.
;
; Adds "Open with RCode" to the context menu of folders, of the empty area inside
; a folder, and of files. Everything is written under HKCU so installing never
; needs elevation, and the same keys are removed again on uninstall.
;
; The app itself decides what "open" means (switch to the project, add it first
; if it is unknown); this file only hands it a path.

!macro rcodeWriteMenuEntry ROOT_KEY
  ; --- Folder right-click -------------------------------------------------
  WriteRegStr HKCU "Software\Classes\Directory\shell\RCode" "" "Open with RCode"
  WriteRegStr HKCU "Software\Classes\Directory\shell\RCode" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\RCode\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; --- Right-click on empty space inside a folder (%V is that folder) ------
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\RCode" "" "Open with RCode"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\RCode" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\RCode\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'

  ; --- File right-click ---------------------------------------------------
  WriteRegStr HKCU "Software\Classes\*\shell\RCode" "" "Open with RCode"
  WriteRegStr HKCU "Software\Classes\*\shell\RCode" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\*\shell\RCode\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro rcodeRemoveMenuEntry
  DeleteRegKey HKCU "Software\Classes\Directory\shell\RCode"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\RCode"
  DeleteRegKey HKCU "Software\Classes\*\shell\RCode"
!macroend

!macro customInstall
  !insertmacro rcodeWriteMenuEntry
  ; Let the shell pick the new entries up without a sign-out.
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  !insertmacro rcodeRemoveMenuEntry
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
