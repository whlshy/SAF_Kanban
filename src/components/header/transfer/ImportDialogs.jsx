import React from 'react'
import { Box, Button, Checkbox, Chip, DialogContent, TextField, Typography } from '@mui/material'
import { message } from '@/lib/notify'
import { boardTitle, useBoards } from '@/store/boards'
import { useT } from '@/i18n'
import { DialogFooter } from '@/components/elements/dialog/Dialog'
import { cryptoAvailable, decryptText, UnsupportedFileError, WrongPasswordError } from '@/lib/crypto'
import { readImportFile } from './transferFile'

export function UnlockDialog({ locked, onUnlocked }) {
  const t = useT()
  const formId = React.useId()
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const canDecrypt = cryptoAvailable()

  const handleUnlock = async (e) => {
    e.preventDefault()
    if (!password || busy || !canDecrypt) return
    setBusy(true)
    setError("")
    try {
      const result = readImportFile(await decryptText(locked, password))
      if (result.locked) throw new UnsupportedFileError()
      onUnlocked(result.boards)
    } catch (err) {
      setError(
        err instanceof WrongPasswordError ? t("transfer.wrongPassword")
          : err instanceof UnsupportedFileError ? t("transfer.error.format")
            : err.message
      )
      setBusy(false)
    }
  }

  return (
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {canDecrypt ? t("transfer.unlockIntro") : t("transfer.cryptoUnavailable")}
      </Typography>
      <form id={formId} onSubmit={handleUnlock}>
        <TextField
          type="password"
          variant="standard"
          label={t("transfer.password")}
          value={password}
          onChange={(e) => (setPassword(e.target.value), setError(""))}
          error={!!error}
          helperText={error || " "}
          autoComplete="current-password"
          disabled={busy || !canDecrypt}
          autoFocus
          fullWidth
        />
      </form>
      <DialogFooter>
        <Button
          type="submit"
          form={formId}
          variant="contained"
          disabled={!password || busy || !canDecrypt}
          sx={{ textTransform: 'none', ml: 'auto' }}
        >
          {busy ? t("transfer.decrypting") : t("transfer.unlock")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function ImportDialog({ incoming, closeDialog }) {
  const { boards, importBoards } = useBoards()
  const t = useT()
  const [rows, setRows] = React.useState(() => incoming.map((b, i) => ({
    key: i,
    selected: true,
    name: b.title.trim() || t("board.untitled"),
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
    if (!name) error = t("transfer.nameRequired")
    else if (existingByName.has(name)) error = t("transfer.nameExists")
    else if (rows.some((r) => r.selected && r.key !== row.key && r.name.trim() === name)) error = t("transfer.nameDuplicate")
    const sameSheet = existingBySheet.get(row.board.sheetId)
    const note = sameSheet ? t("transfer.sameSheet", { name: boardTitle(sameSheet) }) : ""
    return { ...row, status: error ? "conflict" : "new", error, note }
  })

  const selectedCount = checked.filter((r) => r.selected).length
  const conflictCount = checked.filter((r) => r.status === "conflict").length

  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleImport = () => {
    importBoards(checked.filter((r) => r.selected).map((r) => ({ ...r.board, title: r.name.trim() })))
    message.success(t("transfer.imported", { count: selectedCount }))
    closeDialog?.()
  }

  return (
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("transfer.intro", { count: incoming.length })}
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
              inputProps={{ 'aria-label': t("transfer.importOne", { name: row.name }) }}
              sx={{ mt: 0.5 }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <TextField
                variant="standard"
                label={t("field.title")}
                value={row.name}
                disabled={!row.selected}
                onChange={(e) => update(row.key, { name: e.target.value })}
                error={row.status === "conflict"}
                helperText={row.error || row.note || " "}
                fullWidth
              />
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {t("transfer.sheetId", { id: row.board.sheetId || t("transfer.notSet") })}
              </Typography>
            </Box>
            <Box sx={{ width: 88, textAlign: 'right', mt: 2 }}>
              {row.status === "new" && <Chip size="small" color="success" variant="outlined" label={t("transfer.status.new")} />}
              {row.status === "conflict" && <Chip size="small" color="error" variant="outlined" label={t("transfer.status.conflict")} />}
              {row.status === "skip" && <Chip size="small" variant="outlined" label={t("transfer.status.skip")} />}
            </Box>
          </Box>
        ))}
      </Box>

      <DialogFooter>
        <Typography variant="body2" color={conflictCount ? "error" : "text.secondary"}>
          {conflictCount ? t("transfer.conflictsLeft", { count: conflictCount }) : t("transfer.willImport", { count: selectedCount })}
        </Typography>
        <Button
          variant="contained"
          onClick={handleImport}
          disabled={!selectedCount || conflictCount > 0}
          sx={{ textTransform: 'none', ml: 'auto' }}
        >
          {t("transfer.importButton")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
