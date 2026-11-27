import React from 'react'
import { Box, Button, DialogContent, TextField, Typography } from '@mui/material'
import { FileDownloadOutlined as ExportIcon, ContentCopy as CopyIcon } from '@mui/icons-material'
import { useQueryClient } from '@tanstack/react-query'
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
import { hashLabelColor, normalizeLabelDefs, parseLabels } from '@/lib/labels';

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

function countLabelUsage(tasks = []) {
  const counts = {}
  for (const task of tasks || []) {
    for (const label of parseLabels(task?.labels)) {
      const key = label.toLowerCase()
      counts[key] = (counts[key] || 0) + 1
    }
  }
  return counts
}

// Include any label currently present on tasks even if it wasn't yet listed in
// the board's preset definitions (e.g. a Google Sheet upgraded from v6).
function mergeTaskLabels(defs = [], tasks = []) {
  const merged = normalizeLabelDefs(defs)
  const seen = new Set(merged.map((def) => def.name.toLowerCase()))
  for (const task of tasks || []) {
    for (const label of parseLabels(task?.labels)) {
      const key = label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({ name: label, color: hashLabelColor(label) })
    }
  }
  return merged
}

const SettingDialog = ({ closeDialog }) => {
  const { currentBoard, updateCurrentBoard, deleteBoard, addBoard } = useBoards();
  const { setAlert } = useAlertStore();
  const queryClient = useQueryClient();
  const t = useT();
  const formId = React.useId();
  const isLocal = currentBoard?.type === "local";
  const shownFields = SETTING_FIELDS.filter(({ field }) => !isLocal || LOCAL_FIELDS.includes(field));
  // Edits stay in the dialog until Confirm; Cancel, ✕ and Esc discard them.
  const [fields, setFields] = React.useState(() =>
    Object.fromEntries(SETTING_FIELDS.map(({ field }) => [field, currentBoard?.[field] || ""])));
  const [columns, setColumns] = React.useState(() => toRows(currentBoard?.columns));
  const [users, setUsers] = React.useState(() => toRows(currentBoard?.users));

  const sourceKey = isLocal ? currentBoard?.id : (currentBoard?.sheetId || "");
  const sourceType = isLocal ? "local" : "sheet";
  const cachedTasks = currentBoard
    ? (queryClient.getQueryData(["board", currentBoard.id, sourceType, sourceKey, "tasks"]) || [])
    : [];
  const cachedLabels = isLocal
    ? (currentBoard?.labels || [])
    : (currentBoard ? (queryClient.getQueryData(["board", currentBoard.id, sourceType, sourceKey, "labels"]) || []) : []);

  const initialMergedLabels = React.useMemo(
    () => mergeTaskLabels(cachedLabels, cachedTasks),
    // Computed once when the dialog mounts for this board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [labels, setLabels] = React.useState(() => toLabelRows(initialMergedLabels));
  const [savedLabels, setSavedLabels] = React.useState(() => normalizeLabelDefs(cachedLabels));
  const [usedCounts, setUsedCounts] = React.useState(() => countLabelUsage(cachedTasks));
  const labelsTouchedRef = React.useRef(false);
  const [saving, setSaving] = React.useState(false);

  const canEditSheetLabels = !isLocal && Boolean(fields.sheetId && fields.scriptId);
  const showLabelsEditor = isLocal || canEditSheetLabels;

  // Refresh latest labels & task usage counts on open when cache might be cold.
  React.useEffect(() => {
    if (!currentBoard) return;
    const source = createBoardSource(currentBoard);
    if (!source?.ready) return;
    let cancelled = false;
    Promise.all([
      source.loadLabels ? source.loadLabels().catch(() => null) : Promise.resolve(null),
      source.loadTasks ? source.loadTasks().catch(() => null) : Promise.resolve(null),
    ]).then(([freshLabels, freshTasks]) => {
      if (cancelled) return;
      if (freshTasks) setUsedCounts(countLabelUsage(freshTasks));
      if (freshLabels && !labelsTouchedRef.current) {
        const normalized = normalizeLabelDefs(freshLabels);
        setSavedLabels(normalized);
        setLabels(toLabelRows(mergeTaskLabels(normalized, freshTasks || cachedTasks)));
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBoard?.id]);

  const handleLabelsChange = (nextRows) => {
    labelsTouchedRef.current = true;
    setLabels(nextRows);
  };

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

    const nextLabels = labelRowDefs(labels);
    const renamedLabels = labelRowRenames(labels);
    const labelsChanged = labelsTouchedRef.current
      && (JSON.stringify(nextLabels) !== JSON.stringify(savedLabels) || Object.keys(renamedLabels).length > 0);

    if (isLocal) {
      const same = (rows, saved = []) => JSON.stringify(rowNames(rows)) === JSON.stringify(saved);
      if (!same(columns, currentBoard.columns)) Object.assign(patch, { columns: rowNames(columns), renames: rowRenames(columns) });
      if (!same(users, currentBoard.users)) patch.users = rowNames(users);
      if (labelsChanged) {
        patch.labels = nextLabels;
        if (Object.keys(renamedLabels).length) patch.labelRenames = renamedLabels;
      }
    }

    const saveSheetLabels = !isLocal && canEditSheetLabels && labelsChanged;
    if (!Object.keys(patch).length && !saveSheetLabels) return closeDialog?.();

    setSaving(true);
    try {
      if (Object.keys(patch).length) {
        await updateCurrentBoard(patch);
      }
      if (saveSheetLabels) {
        const sheetSource = createBoardSource({ ...currentBoard, ...fields });
        await sheetSource.saveLabels(nextLabels, renamedLabels);
        queryClient.invalidateQueries({ queryKey: ["board", currentBoard?.id] });
      }
      message.success(t("settings.saved"));
      closeDialog?.();
    } catch (error) {
      // E.g. removing a column/label that still has tasks: keep the dialog and its edits.
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
        {showLabelsEditor && (
          <LabelListEditor
            label={t("settings.labels")}
            hint={t(isLocal ? "settings.labels.hint" : "settings.labels.hint.sheet")}
            rows={labels}
            onChange={handleLabelsChange}
            addLabel={t("settings.labels.add")}
            disabled={saving}
            usedCounts={usedCounts}
          />
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
