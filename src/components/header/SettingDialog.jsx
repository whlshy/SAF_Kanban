import React from 'react'
import { Box, Button, DialogContent, TextField, Typography } from '@mui/material'
import { FileDownloadOutlined as ExportIcon, ContentCopy as CopyIcon } from '@mui/icons-material'
import { message } from '@/lib/notify'

import { useAlertStore, useDialogStore } from '@/store';
import { boardPlaceholderTitle, boardTitle, normalizeBoardField, useBoards } from '@/store/boards';
import { t, useT } from '@/i18n';
import { DialogFooter } from '@/components/elements/dialog/Dialog';
import ListEditor, { rowNames, rowRenames, toRows } from '@/components/elements/ListEditor';
import LabelListEditor, { labelRowDefs, labelRowRenames, toLabelRows } from '@/components/elements/LabelListEditor';
import { createBoardSource } from '@/data';
import { localAvailable } from '@/data/localApi';
import { exportLocalBoard } from './BoardTransfer';
import { sheetTimeToIso } from '@/lib/createdAt';
import { normalizeLabelDefs } from '@/lib/labels';

export const SETTING_FIELDS = [
  { field: "title", labelKey: "field.title" },
  { field: "sheetId", labelKey: "field.sheetId", hintKey: "field.sheetId.hint", autoFocus: true },
  { field: "scriptId", labelKey: "field.scriptId", hintKey: "field.scriptId.hint" },
  { field: "userKey", labelKey: "field.userKey" },
  { field: "jiraLink", labelKey: "field.jiraLink", hintKey: "field.jiraLink.hint" },
]

// A local board has no Sheet or Script to point at; its columns, assignees
// and preset labels are edited here instead of in a Sheet.
const LOCAL_FIELDS = ["title", "jiraLink"]

const SettingDialog = ({ closeDialog }) => {
  const { currentBoard, updateCurrentBoard, deleteBoard, addBoard } = useBoards();
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
  const [labels, setLabels] = React.useState(() => toLabelRows(currentBoard?.labels));
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

  // Desktop app: a Google Sheet board can be copied into a board kept on this
  // computer. The Sheet is only read, and the two go their own ways afterwards.
  const canCopy = localAvailable() && !isLocal && !!currentBoard?.sheetId;

  const handleExport = async () => {
    setSaving(true);
    try {
      await exportLocalBoard(currentBoard);
    } catch (error) {
      showError(error);
    }
    setSaving(false);
  };

  const handleCopy = async () => {
    setSaving(true);
    let content;
    try {
      const source = createBoardSource(currentBoard);
      const [columns, tasks, users, sheetLabels] = await Promise.all([
        source.loadColumns(),
        source.loadTasks(),
        source.loadUsers(),
        source.loadLabels ? source.loadLabels().catch(() => []) : Promise.resolve([]),
      ]);
      content = {
        columns: [...new Set(columns.map((name) => String(name).trim()).filter(Boolean))],
        users,
        labels: normalizeLabelDefs(sheetLabels),
        // Blank rows of the Sheet aren't tasks. Creation and column-move times
        // the Sheet has are kept; without a creation time the copy's time is used.
        tasks: tasks
          .filter((task) => task.id || task.title)
          .map((task) => ({
            ...task,
            createdAt: sheetTimeToIso(task.createdAt),
            movedAt: sheetTimeToIso(task.movedAt),
          })),
      };
    } catch {
      message.error(t("copyLocal.unreadable"), 8);
      return setSaving(false);
    }
    try {
      const board = await addBoard({ type: "local", title: boardTitle(currentBoard), jiraLink: currentBoard.jiraLink, ...content });
      message.success(t("copyLocal.done", { name: boardTitle(board), count: content.tasks.length }));
      closeDialog?.();
    } catch (error) {
      showError(error);
      setSaving(false);
    }
  };

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
      const nextLabels = labelRowDefs(labels);
      const savedLabels = normalizeLabelDefs(currentBoard.labels);
      if (JSON.stringify(nextLabels) !== JSON.stringify(savedLabels)) {
        patch.labels = nextLabels;
        const renamedLabels = labelRowRenames(labels);
        if (Object.keys(renamedLabels).length) patch.labelRenames = renamedLabels;
      }
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
            <LabelListEditor
              label={t("settings.labels")}
              hint={t("settings.labels.hint")}
              rows={labels}
              onChange={setLabels}
              addLabel={t("settings.labels.add")}
              disabled={saving}
            />
          </>
        )}
      </form>
      {(isLocal || canCopy) && (
        <Box data-slot="board-copy" sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={isLocal ? <ExportIcon /> : <CopyIcon />}
            onClick={isLocal ? handleExport : handleCopy}
            disabled={saving}
            sx={{ textTransform: 'none' }}
          >
            {t(isLocal ? "exportLocal.button" : "copyLocal.button")}
          </Button>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {t(isLocal ? "exportLocal.hint" : "copyLocal.hint")}
          </Typography>
        </Box>
      )}
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
