import React from 'react'
import { Box, Button, Checkbox, Chip, DialogContent, TextField, Typography } from '@mui/material'
import { message } from 'antd'

import { useDialogStore } from '@/store';
import { BOARD_FIELDS, boardTitle, UNTITLED_TITLE, useBoards } from '@/store/boards';

// Export file format. Bump the version if the shape changes.
const FILE_APP = "saf-kanban"
const FILE_VERSION = 1

export const exportBoards = (boards) => {
  const data = {
    app: FILE_APP,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    // Write the displayed name so an untitled board keeps the name people know it by.
    boards: boards.map((b) => ({
      ...Object.fromEntries(BOARD_FIELDS.map((f) => [f, b[f] || ""])),
      title: boardTitle(b),
    })),
  }

  const date = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = `saf-kanban-settings-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const parseImportFile = (text) => {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("檔案不是有效的 JSON")
  }
  if (data?.app !== FILE_APP || !Array.isArray(data.boards)) {
    throw new Error("這不是 SAF Kanban 的設定檔")
  }
  if (data.version > FILE_VERSION) {
    throw new Error("設定檔版本較新，請重新整理網頁後再匯入")
  }
  const boards = data.boards
    .filter((b) => b && typeof b === "object")
    .map((b) => Object.fromEntries(BOARD_FIELDS.map((f) => [f, typeof b[f] === "string" ? b[f] : ""])))
  if (!boards.length) {
    throw new Error("設定檔裡沒有看板")
  }
  return boards
}

const pickFile = () => new Promise((resolve) => {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = "application/json,.json"
  input.onchange = () => input.files?.[0] && resolve(input.files[0])
  input.click()
})

// Returns a function that asks for a file and opens the import dialog.
export function useStartImport() {
  const { setDialog } = useDialogStore()

  return React.useCallback(async () => {
    const file = await pickFile()
    let incoming
    try {
      incoming = parseImportFile(await file.text())
    } catch (err) {
      message.error(err.message)
      return
    }
    setDialog({
      title: "匯入設定",
      open: true,
      fullWidth: true,
      maxWidth: "md",
      content: <ImportDialog incoming={incoming} />,
    })
  }, [setDialog])
}

const ImportDialog = ({ incoming, closeDialog }) => {
  const { boards, importBoards } = useBoards()
  const [rows, setRows] = React.useState(() => incoming.map((b, i) => ({
    key: i,
    selected: true,
    name: b.title.trim() || UNTITLED_TITLE,
    board: b,
  })))

  const existingByName = React.useMemo(
    () => new Map(boards.map((b) => [boardTitle(b), b])),
    [boards]
  )
  const existingBySheet = React.useMemo(
    () => new Map(boards.filter((b) => b.sheetId).map((b) => [b.sheetId, b])),
    [boards]
  )

  const checked = rows.map((row) => {
    if (!row.selected) return { ...row, status: "skip" }
    const name = row.name.trim()
    let error = ""
    if (!name) error = "請輸入名稱"
    else if (existingByName.has(name)) error = "已有同名的看板，請改名"
    else if (rows.some((r) => r.selected && r.key !== row.key && r.name.trim() === name)) error = "與其他要匯入的看板同名，請改名"
    const sameSheet = existingBySheet.get(row.board.sheetId)
    const note = sameSheet ? `這份 Sheet 已在看板「${boardTitle(sameSheet)}」使用` : ""
    return { ...row, status: error ? "conflict" : "new", error, note }
  })

  const selectedCount = checked.filter((r) => r.selected).length
  const conflictCount = checked.filter((r) => r.status === "conflict").length

  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleImport = () => {
    importBoards(checked.filter((r) => r.selected).map((r) => ({ ...r.board, title: r.name.trim() })))
    message.success(`已匯入 ${selectedCount} 個看板`)
    closeDialog?.()
  }

  return (
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        檔案裡有 {incoming.length} 個看板。用名稱和目前的看板比對，名稱重複的請改名，不想匯入的取消勾選。
      </Typography>

      <Box className="flex flex-col gap-1">
        {checked.map((row) => (
          <Box
            key={row.key}
            data-testid="import-row"
            className="flex items-start gap-2"
            sx={{ py: 1, borderBottom: 1, borderColor: 'divider', opacity: row.selected ? 1 : 0.5 }}
          >
            <Checkbox
              checked={row.selected}
              onChange={(e) => update(row.key, { selected: e.target.checked })}
              inputProps={{ 'aria-label': `匯入 ${row.name}` }}
              sx={{ mt: 0.5 }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <TextField
                variant="standard"
                label="看板名稱"
                value={row.name}
                disabled={!row.selected}
                onChange={(e) => update(row.key, { name: e.target.value })}
                error={row.status === "conflict"}
                helperText={row.error || row.note || " "}
                fullWidth
              />
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                Sheet ID：{row.board.sheetId || "（未設定）"}
              </Typography>
            </Box>
            <Box sx={{ width: 88, textAlign: 'right', mt: 2 }}>
              {row.status === "new" && <Chip size="small" color="success" variant="outlined" label="新增" />}
              {row.status === "conflict" && <Chip size="small" color="error" variant="outlined" label="名稱衝突" />}
              {row.status === "skip" && <Chip size="small" variant="outlined" label="不匯入" />}
            </Box>
          </Box>
        ))}
      </Box>

      <Box className="flex items-center justify-between gap-2" sx={{ mt: 2 }}>
        <Typography variant="body2" color={conflictCount ? "error" : "text.secondary"}>
          {conflictCount ? `還有 ${conflictCount} 個名稱衝突` : `將匯入 ${selectedCount} 個看板`}
        </Typography>
        <Box className="flex gap-2">
          <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={handleImport}
            disabled={!selectedCount || conflictCount > 0}
            sx={{ textTransform: 'none' }}
          >
            匯入
          </Button>
        </Box>
      </Box>
    </DialogContent>
  )
}
