import React from 'react'
import { Box, Button, DialogContent, TextField } from '@mui/material'
import { message } from 'antd'

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
  // Edits stay in the dialog until Confirm; Cancel, ✕ and Esc discard them.
  const [fields, setFields] = React.useState(() =>
    Object.fromEntries(SETTING_FIELDS.map(({ field }) => [field, currentBoard?.[field] || ""])));

  const handleDelete = () => setAlert({
    title: t("board.delete"),
    content: t("board.deleteConfirm", { name: boardTitle(currentBoard) }),
    handleAgree: (callback) => (callback?.(), deleteBoard(currentBoard.id), closeDialog?.()),
  });

  const handleConfirm = (e) => {
    e.preventDefault();
    // Only changed fields are saved, so confirming untouched settings with no
    // board yet doesn't create an empty one.
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([field, value]) => value !== (currentBoard?.[field] || "")));
    if (Object.keys(patch).length) {
      updateCurrentBoard(patch);
      message.success(t("settings.saved"));
    }
    closeDialog?.();
  };

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      <form onSubmit={handleConfirm}>
        {SETTING_FIELDS.map(({ field, labelKey, hintKey, autoFocus }) => (
          <TextField
            key={field}
            label={t(labelKey)}
            variant="standard"
            placeholder={field === "title" ? boardPlaceholderTitle(currentBoard) : undefined}
            helperText={hintKey && t(hintKey)}
            value={fields[field]}
            // A pasted URL is reduced to its ID right away, so the field shows what is saved.
            onChange={(e) => {
              const value = normalizeBoardField(field, e.target.value);
              setFields((f) => ({ ...f, [field]: value }));
            }}
            fullWidth
            autoFocus={autoFocus}
          />
        ))}
        <Box className="flex flex-wrap items-center gap-2" sx={{ mt: 1 }}>
          {currentBoard && (
            <Button color="error" onClick={handleDelete} sx={{ textTransform: 'none', ml: -1 }}>
              {t("board.delete")}
            </Button>
          )}
          <Box className="flex gap-2" sx={{ ml: 'auto' }}>
            <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="contained" sx={{ textTransform: 'none' }}>
              {t("common.confirm")}
            </Button>
          </Box>
        </Box>
      </form>
    </DialogContent>
  )
}

export function useOpenSettings() {
  const { setDialog } = useDialogStore()

  return React.useCallback(() => setDialog({
    title: t("settings.title"),
    open: true, fullWidth: true, maxWidth: "sm", persistent: true, content: <SettingDialog />
  }), [setDialog])
}
