import React from 'react'
import { Box, Button, DialogContent, TextField } from '@mui/material'

import { useAlertStore, useDialogStore } from '@/store';
import { boardPlaceholderTitle, boardTitle, useBoards } from '@/store/boards';

export const SETTING_FIELDS = [
  { field: "title", label: "Title" },
  { field: "sheetId", label: "Sheet ID", autoFocus: true },
  { field: "scriptId", label: "Sheet API Key" },
  { field: "userKey", label: "User Key" },
  { field: "jiraLink", label: "Jira Link" },
]

const SettingDialog = ({ closeDialog }) => {
  const { currentBoard, updateCurrentBoard, deleteBoard } = useBoards();
  const { setAlert } = useAlertStore();

  const handleDelete = () => setAlert({
    title: "刪除看板",
    content: `確定要刪除「${boardTitle(currentBoard)}」？只會移除這個瀏覽器裡的設定，不會刪除 Google Sheet 的資料。`,
    handleAgree: (callback) => (callback?.(), deleteBoard(currentBoard.id), closeDialog?.()),
  });

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      {/* Remount the fields when switching boards so defaultValue refreshes */}
      <div key={currentBoard?.id || "new"}>
        {SETTING_FIELDS.map(({ field, label, autoFocus }) => (
          <TextField
            key={field}
            label={label}
            variant="standard"
            placeholder={field === "title" ? boardPlaceholderTitle(currentBoard) : undefined}
            defaultValue={currentBoard?.[field] || ""}
            onChange={(e) => updateCurrentBoard({ [field]: e.target.value })}
            fullWidth
            autoFocus={autoFocus}
          />
        ))}
      </div>
      {currentBoard && (
        <Box sx={{ mt: 1 }}>
          <Button color="error" onClick={handleDelete} sx={{ textTransform: 'none', ml: -1 }}>
            刪除看板
          </Button>
        </Box>
      )}
    </DialogContent>
  )
}

export function useOpenSettings() {
  const { setDialog } = useDialogStore()

  return React.useCallback(() => setDialog({
    title: "Settings",
    open: true, content: <SettingDialog />
  }), [setDialog])
}
