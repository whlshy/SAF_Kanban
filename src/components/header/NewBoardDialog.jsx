import React from 'react'
import { Button, DialogContent, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { message } from 'antd'

import { DialogFooter } from '@/components/elements/dialog/Dialog'
import { localAvailable } from '@/data/localApi'
import { t as translate, useT } from '@/i18n'
import { useDialogStore } from '@/store'
import { boardTitle, normalizeBoardField, uniqueBoardTitle, useBoards } from '@/store/boards'
import { SETTING_FIELDS } from './SettingDialog'

// A local board starts with these columns, named in the current language.
const defaultColumns = () => ["todo", "doing", "done"].map((key) => translate(`local.column.${key}`))

const LOCAL_FIELDS = ["title", "jiraLink"]

const NewBoardDialog = ({ closeDialog }) => {
  const { boards, addBoard } = useBoards();
  const [fields, setFields] = React.useState({});
  // In the desktop app a board is kept on this computer unless the user picks Google Sheet.
  const [type, setType] = React.useState(localAvailable() ? "local" : "sheet");
  const [saving, setSaving] = React.useState(false);
  const t = useT();

  const isLocal = type === "local";
  const shownFields = SETTING_FIELDS.filter(({ field }) => !isLocal || LOCAL_FIELDS.includes(field));
  const sameSheet = !isLocal && fields.sheetId?.trim() && boards.find((b) => b.sheetId?.trim() === fields.sheetId.trim());
  // Tell the user up front when the name is taken and what it will become.
  const shownTitle = fields.title?.trim() || t("board.untitled");
  const finalTitle = uniqueBoardTitle(fields.title, boards, t("board.untitled")) || shownTitle;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!isLocal) {
      addBoard(fields);
      closeDialog?.();
      return;
    }
    setSaving(true);
    try {
      await addBoard({ type: "local", title: fields.title, jiraLink: fields.jiraLink, columns: defaultColumns() });
      closeDialog?.();
    } catch (error) {
      message.error(error?.userMessage || t("common.apiError"), 8);
      setSaving(false);
    }
  };

  const formId = React.useId();

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      <form id={formId} onSubmit={handleCreate}>
        {localAvailable() && (
          <>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              color="primary"
              value={type}
              onChange={(e, value) => value && setType(value)}
              sx={{ mb: 1, '& .MuiToggleButton-root': { textTransform: 'none' } }}
            >
              <ToggleButton value="local">{t("board.type.local")}</ToggleButton>
              <ToggleButton value="sheet">{t("board.type.sheet")}</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
              {t(isLocal ? "board.type.local.hint" : "board.type.sheet.hint")}
            </Typography>
          </>
        )}
        {shownFields.map(({ field, labelKey, hintKey }) => (
          <TextField
            key={field}
            label={t(labelKey)}
            variant="standard"
            placeholder={field === "title" ? t("board.untitled") : undefined}
            helperText={field === "title" && finalTitle !== shownTitle
              ? t("board.nameTaken", { name: finalTitle })
              : hintKey && t(hintKey)}
            value={fields[field] || ""}
            onChange={(e) => setFields((f) => ({ ...f, [field]: normalizeBoardField(field, e.target.value) }))}
            disabled={saving}
            fullWidth
            autoFocus={field === "title"}
          />
        ))}
      </form>
      {sameSheet && (
        <Typography variant="body2" color="warning.main">
          {t("board.sameSheet", { name: boardTitle(sameSheet) })}
        </Typography>
      )}
      <DialogFooter>
        <Button type="submit" form={formId} variant="contained" disabled={saving} sx={{ textTransform: 'none', ml: 'auto' }}>
          {t("board.create")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function useOpenNewBoard() {
  const { setDialog } = useDialogStore()

  return React.useCallback(() => setDialog({
    title: translate("board.new"),
    open: true, fullWidth: true, maxWidth: "sm", content: <NewBoardDialog />
  }), [setDialog])
}
