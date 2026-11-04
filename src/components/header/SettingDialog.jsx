import React from 'react'
import { Box, Button, DialogContent, TextField } from '@mui/material'

import { useAlertStore, useDialogStore } from '@/store';
import { boardPlaceholderTitle, boardTitle, normalizeBoardField, useBoards } from '@/store/boards';
import { t, useT } from '@/i18n';

export const SETTING_FIELDS = [
  { field: "title", labelKey: "field.title" },
  { field: "sheetId", labelKey: "field.sheetId", hintKey: "field.sheetId.hint", autoFocus: true },
  { field: "scriptId", labelKey: "field.scriptId", hintKey: "field.scriptId.hint" },
  { field: "userKey", labelKey: "field.userKey" },
  { field: "jiraLink", labelKey: "field.jiraLink", hintKey: "field.jiraLink.hint" },
]

const SettingDialog = ({ closeDialog }) => {
  const { currentBoard, updateCurrentBoard, deleteBoard } = useBoards();
  const { setAlert } = useAlertStore();
  const t = useT();

  const handleDelete = () => setAlert({
    title: t("board.delete"),
    content: t("board.deleteConfirm", { name: boardTitle(currentBoard) }),
    handleAgree: (callback) => (callback?.(), deleteBoard(currentBoard.id), closeDialog?.()),
  });

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      {/* Remount the fields when switching boards so defaultValue refreshes */}
      <div key={currentBoard?.id || "new"}>
        {SETTING_FIELDS.map(({ field, labelKey, hintKey, autoFocus }) => (
          <TextField
            key={field}
            label={t(labelKey)}
            variant="standard"
            placeholder={field === "title" ? boardPlaceholderTitle(currentBoard) : undefined}
            helperText={hintKey && t(hintKey)}
            defaultValue={currentBoard?.[field] || ""}
            onChange={(e) => {
              // A pasted URL is reduced to its ID right away, so the field shows what is saved.
              const value = normalizeBoardField(field, e.target.value);
              if (value !== e.target.value) e.target.value = value;
              updateCurrentBoard({ [field]: value });
            }}
            fullWidth
            autoFocus={autoFocus}
          />
        ))}
      </div>
      {currentBoard && (
        <Box sx={{ mt: 1 }}>
          <Button color="error" onClick={handleDelete} sx={{ textTransform: 'none', ml: -1 }}>
            {t("board.delete")}
          </Button>
        </Box>
      )}
    </DialogContent>
  )
}

export function useOpenSettings() {
  const { setDialog } = useDialogStore()

  return React.useCallback(() => setDialog({
    title: t("settings.title"),
    open: true, content: <SettingDialog />
  }), [setDialog])
}
