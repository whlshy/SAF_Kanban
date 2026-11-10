import React from 'react'
import { Box, Button, Checkbox, Chip, DialogContent, FormControlLabel, TextField, Typography } from '@mui/material'
import { message } from 'antd'

import { useDialogStore } from '@/store';
import { BOARD_FIELDS, boardTitle, useBoards } from '@/store/boards';
import { t, useT } from '@/i18n';
import { DialogFooter } from '@/components/elements/dialog/Dialog';
import { cryptoAvailable, decryptText, encryptText, MIN_PASSWORD_LENGTH, UnsupportedFileError, WrongPasswordError } from '@/lib/crypto';

// Export file format. Bump the version if the shape changes.
const FILE_APP = "saf-kanban"
const FILE_VERSION = 1

// With a password, the settings JSON is encrypted and the file keeps only what
// import needs to recognize it: { app, version, encryption, data }.
const exportBoards = async (boards, password) => {
  const settings = {
    app: FILE_APP,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    // Write the displayed name so an untitled board keeps the name people know it by.
    boards: boards.map((b) => ({
      ...Object.fromEntries(BOARD_FIELDS.map((f) => [f, b[f] || ""])),
      title: boardTitle(b),
    })),
  }
  const file = password
    ? { app: FILE_APP, version: FILE_VERSION, ...(await encryptText(JSON.stringify(settings), password)) }
    : settings

  const date = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = `saf-kanban-settings-${date}${password ? "-encrypted" : ""}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// Returns a function that opens the export dialog, where boards can be unchecked.
export function useStartExport() {
  const { setDialog } = useDialogStore()

  return React.useCallback(() => setDialog({
    title: t("transfer.export"),
    open: true,
    fullWidth: true,
    maxWidth: "sm",
    content: <ExportDialog />,
  }), [setDialog])
}

const ExportDialog = ({ closeDialog }) => {
  const { boards } = useBoards()
  const t = useT()
  // Every board starts checked, so exporting everything stays one click.
  const [selected, setSelected] = React.useState(() => new Set(boards.map((b) => b.id)))

  const chosen = boards.filter((b) => selected.has(b.id))
  const allChecked = chosen.length === boards.length
  const toggle = (id, on) => setSelected((s) => {
    const next = new Set(s)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })

  // Optional password; off by default, so a plain export stays one click.
  const canEncrypt = cryptoAvailable()
  const [encrypt, setEncrypt] = React.useState(false)
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const tooShort = password.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm !== password
  const ready = chosen.length && (!encrypt || (!tooShort && !mismatch)) && !busy

  const handleExport = async () => {
    setBusy(true)
    try {
      await exportBoards(chosen, encrypt ? password : undefined)
      message.success(t("transfer.exported", { count: chosen.length }))
      closeDialog?.()
    } catch {
      message.error(t("transfer.error.encrypt"))
      setBusy(false)
    }
  }

  return (
    <DialogContent>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t("transfer.exportIntro")}
      </Typography>

      <FormControlLabel
        label={t("transfer.selectAll")}
        control={
          <Checkbox
            checked={allChecked}
            indeterminate={!!chosen.length && !allChecked}
            onChange={(e) => setSelected(new Set(e.target.checked ? boards.map((b) => b.id) : []))}
          />
        }
        sx={{ mx: 0, py: 0.5, width: '100%', borderBottom: 1, borderColor: 'divider' }}
      />
      {boards.map((board) => (
        <FormControlLabel
          key={board.id}
          data-testid="export-row"
          disableTypography
          control={
            <Checkbox
              checked={selected.has(board.id)}
              onChange={(e) => toggle(board.id, e.target.checked)}
              inputProps={{ 'aria-label': t("transfer.exportOne", { name: boardTitle(board) }) }}
            />
          }
          label={
            <Box sx={{ flex: 1, minWidth: 0, py: 0.5 }}>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{boardTitle(board)}</Typography>
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {t("transfer.sheetId", { id: board.sheetId || t("transfer.notSet") })}
              </Typography>
            </Box>
          }
          sx={{ mx: 0, py: 0.5, width: '100%', borderBottom: 1, borderColor: 'divider', opacity: selected.has(board.id) ? 1 : 0.5 }}
        />
      ))}

      <Box sx={{ mt: 2 }}>
        <FormControlLabel
          label={t("transfer.encrypt")}
          control={<Checkbox checked={encrypt} disabled={!canEncrypt || busy} onChange={(e) => setEncrypt(e.target.checked)} />}
          sx={{ mx: 0 }}
        />
        <Typography variant="caption" color="text.secondary" component="div" sx={{ ml: 4.25 }}>
          {canEncrypt ? t("transfer.encryptHint") : t("transfer.cryptoUnavailable")}
        </Typography>
        {encrypt && (
          <Box sx={{ ml: 4.25, mt: 1 }}>
            <TextField
              type="password"
              variant="standard"
              label={t("transfer.password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={!!password && tooShort}
              helperText={t("transfer.passwordTooShort", { min: MIN_PASSWORD_LENGTH })}
              autoComplete="new-password"
              disabled={busy}
              autoFocus
              fullWidth
            />
            <TextField
              type="password"
              variant="standard"
              label={t("transfer.passwordConfirm")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={!!confirm && mismatch}
              helperText={confirm && mismatch ? t("transfer.passwordMismatch") : " "}
              autoComplete="new-password"
              disabled={busy}
              fullWidth
              sx={{ mt: 1 }}
            />
            <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
              {t("transfer.passwordWarning")}
            </Typography>
          </Box>
        )}
      </Box>

      <DialogFooter>
        <Typography variant="body2" color="text.secondary">
          {t(encrypt ? "transfer.willExportEncrypted" : "transfer.willExport", { count: chosen.length })}
        </Typography>
        <Button
          variant="contained"
          onClick={handleExport}
          disabled={!ready}
          sx={{ textTransform: 'none', ml: 'auto' }}
        >
          {busy ? t("transfer.encrypting") : t("transfer.exportButton")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// Returns { boards } for a plain file, or { locked } for a password-protected
// one, whose decrypted contents go through here again.
const readImportFile = (text) => {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(t("transfer.error.json"))
  }
  if (data?.app !== FILE_APP) {
    throw new Error(t("transfer.error.format"))
  }
  if (data.version > FILE_VERSION) {
    throw new Error(t("transfer.error.version"))
  }
  if (data.encryption) {
    if (typeof data.data !== "string") throw new Error(t("transfer.error.format"))
    return { locked: data }
  }
  if (!Array.isArray(data.boards)) {
    throw new Error(t("transfer.error.format"))
  }
  const boards = data.boards
    .filter((b) => b && typeof b === "object")
    .map((b) => Object.fromEntries(BOARD_FIELDS.map((f) => [f, typeof b[f] === "string" ? b[f] : ""])))
  if (!boards.length) {
    throw new Error(t("transfer.error.empty"))
  }
  return { boards }
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
    let result
    try {
      result = readImportFile(await file.text())
    } catch (err) {
      message.error(err.message)
      return
    }
    const showBoards = (incoming) => setDialog({
      title: t("transfer.import"),
      open: true,
      fullWidth: true,
      maxWidth: "md",
      content: <ImportDialog incoming={incoming} />,
    })
    if (!result.locked) return showBoards(result.boards)
    // A password-protected file asks for its password first, then continues as usual.
    setDialog({
      title: t("transfer.import"),
      open: true,
      fullWidth: true,
      maxWidth: "sm",
      persistent: true,
      content: <UnlockDialog locked={result.locked} onUnlocked={showBoards} />,
    })
  }, [setDialog])
}

const UnlockDialog = ({ locked, onUnlocked }) => {
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

const ImportDialog = ({ incoming, closeDialog }) => {
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
