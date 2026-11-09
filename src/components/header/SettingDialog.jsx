import React from 'react'
import { Button, DialogContent, TextField } from '@mui/material'
import { message } from 'antd'

import { useAlertStore, useDialogStore } from '@/store';
import { boardPlaceholderTitle, boardTitle, normalizeBoardField, useBoards } from '@/store/boards';
import { t, useT } from '@/i18n';
import { DialogFooter } from '@/components/elements/dialog/Dialog';

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
  const formId = React.useId();
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
      <form id={formId} onSubmit={handleConfirm}>
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
      </form>
      <DialogFooter>
        {currentBoard && (
          <Button color="error" onClick={handleDelete} sx={{ textTransform: 'none', ml: -1, minWidth: 0 }}>
            {t("board.delete")}
          </Button>
        )}
        {/* Outside the form in the page (footer), so it names the form to submit. */}
        <Button type="submit" form={formId} variant="contained" sx={{ textTransform: 'none', ml: 'auto' }}>
          {t("common.confirm")}
        </Button>
      </DialogFooter>
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
