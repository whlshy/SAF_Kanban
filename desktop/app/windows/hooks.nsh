; Custom NSIS hooks for SAF Kanban desktop installer:
; - Shows an optional "Add saf-kanban-cli to user PATH" checkbox on the Welcome page
;   (checked by default, skipped automatically during silent `/S` and passive updater runs).
; - Adds `$INSTDIR` to HKCU\Environment\Path when checked, and removes it on real uninstall.

!include "WordFunc.nsh"

Var AddCliToPathCheckbox
Var AddCliToPathState

!define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeAddPathShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE WelcomeAddPathLeave

Function WelcomeAddPathShow
  ${If} $LANGUAGE == 1028
    StrCpy $0 "將 saf-kanban-cli 加入使用者 PATH（可在終端機直接使用指令）"
  ${Else}
    StrCpy $0 "Add saf-kanban-cli to user PATH (use CLI directly in terminal)"
  ${EndIf}
  ${NSD_CreateCheckbox} 120u 152u 195u 28u $0
  Pop $AddCliToPathCheckbox
  SetCtlColors $AddCliToPathCheckbox "" "ffffff"
  ${NSD_Check} $AddCliToPathCheckbox
FunctionEnd

Function WelcomeAddPathLeave
  ${NSD_GetState} $AddCliToPathCheckbox $AddCliToPathState
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
  ${AndIf} $AddCliToPathState == ${BST_CHECKED}
    ReadRegStr $0 HKCU "Environment" "Path"
    ${If} $0 == ""
      StrCpy $1 "$INSTDIR"
    ${Else}
      ${WordAdd} "$0" ";" "+$INSTDIR" $1
    ${EndIf}
    ${If} $1 != $0
      WriteRegExpandStr HKCU "Environment" "Path" "$1"
      SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ReadRegStr $0 HKCU "Environment" "Path"
    ${If} $0 != ""
      ${un.WordAdd} "$0" ";" "-$INSTDIR" $1
      ${If} $1 != $0
        WriteRegExpandStr HKCU "Environment" "Path" "$1"
        SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
