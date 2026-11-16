import React from 'react'
import { Button, DialogContent, TextField } from '@mui/material'
import { message } from 'antd'

import { useAlertStore, useDialogStore } from '@/store';
import { boardPlaceholderTitle, boardTitle, normalizeBoardField, useBoards } from '@/store/boards';
import { t, useT } from '@/i18n';
import { DialogFooter } from '@/components/elements/dialog/Dialog';
import ListEditor, { rowNames, rowRenames, toRows } from '@/components/elements/ListEditor';

export const SETTING_FIELDS = [
  { field: "title", labelKey: "field.title" },
  { field: "sheetId", labelKey: "field.sheetId", hintKey: "field.sheetId.hint", autoFocus: true },
  { field: "scriptId", labelKey: "field.scriptId", hintKey: "field.scriptId.hint" },
  { field: "userKey", labelKey: "field.userKey" },
  { field: "jiraLink", labelKey: "field.jiraLink", hintKey: "field.jiraLink.hint" },
]

// A local board has no Sheet or Script to point at; its columns and assignees
// are edited here instead of in a Sheet.
const LOCAL_FIELDS = ["title", "jiraLink"]

const SettingDialog = ({ closeDialog }) => {
  const { currentBoard, updateCurrentBoard, deleteBoard } = useBoards();
  const { setAlert } = useAlertStore();
  const t = useT();
  const formId = React.useId();
  const isLocal = currentBoard?.type === "local";
  const shownFields = SETTING_FIELDS.filter(({ field }) => !isLocal || LOCAL_FIELDS.includes(field));
  // Edits stay in the dialog until Confirm; Cancel, ✕ and Esc discard them.
  const [fields, setFields] = React.useState(() =>
    Object.fromEntries(SETTING_FIELDS.map(({ field }) => [field, currentBoard?.[field] || ""])));
  const [columns, setColumns] = React.useState(() => toRows(currentBoard?.columns));
  const [users, setUsers] = React.useState(() => toRows(currentBoard?.users));
  const [saving, setSaving] = React.useState(false);

  const showError = (error) => message.error(error?.userMessage || t("common.apiError"), 8);

  const handleDelete = () => setAlert({
    title: t("board.delete"),
    content: t(isLocal ? "board.deleteConfirm.local" : "board.deleteConfirm", { name: boardTitle(currentBoard) }),
    handleAgree: async (callback) => {
      callback?.();
      try {
        await deleteBoard(currentBoard.id);
        closeDialog?.();
      } catch (error) {
        showError(error);
      }
    },
  });

  const handleConfirm = async (e) => {
    e.preventDefault();
    // Only changed fields are saved, so confirming untouched settings with no
    // board yet doesn't create an empty one.
    const patch = Object.fromEntries(
      shownFields
        .map(({ field }) => [field, fields[field]])
        .filter(([field, value]) => value !== (currentBoard?.[field] || "")));

    if (isLocal) {
      const same = (rows, saved = []) => JSON.stringify(rowNames(rows)) === JSON.stringify(saved);
      if (!same(columns, currentBoard.columns)) Object.assign(patch, { columns: rowNames(columns), renames: rowRenames(columns) });
      if (!same(users, currentBoard.users)) patch.users = rowNames(users);
    }
    if (!Object.keys(patch).length) return closeDialog?.();

    setSaving(true);
    try {
      await updateCurrentBoard(patch);
      message.success(t("settings.saved"));
      closeDialog?.();
    } catch (error) {
      // E.g. removing a column that still has tasks: keep the dialog and its edits.
      showError(error);
      setSaving(false);
    }
  };

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      <form id={formId} onSubmit={handleConfirm}>
        {shownFields.map(({ field, labelKey, hintKey, autoFocus }) => (
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
            disabled={saving}
            fullWidth
            autoFocus={autoFocus}
          />
        ))}
        {isLocal && (
          <>
            <ListEditor
              label={t("settings.columns")}
              hint={t("settings.columns.hint")}
              rows={columns}
              onChange={setColumns}
              addLabel={t("settings.columns.add")}
              disabled={saving}
            />
            <ListEditor
              label={t("settings.users")}
              hint={t("settings.users.hint")}
              rows={users}
              onChange={setUsers}
              addLabel={t("settings.users.add")}
              disabled={saving}
            />
          </>
        )}
      </form>
      <DialogFooter>
        {currentBoard && (
          <Button color="error" onClick={handleDelete} disabled={saving} sx={{ textTransform: 'none', ml: -1, minWidth: 0 }}>
            {t("board.delete")}
          </Button>
        )}
        {/* Outside the form in the page (footer), so it names the form to submit. */}
        <Button type="submit" form={formId} variant="contained" disabled={saving} sx={{ textTransform: 'none', ml: 'auto' }}>
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
