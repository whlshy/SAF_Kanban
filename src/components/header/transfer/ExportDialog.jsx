import React from 'react'
import { Box, Button, Checkbox, DialogContent, FormControlLabel, TextField, Typography } from '@mui/material'
import { message } from '@/lib/notify'
import { boardTitle, useBoards } from '@/store/boards'
import { useT } from '@/i18n'
import { DialogFooter } from '@/components/elements/dialog/Dialog'
import { cryptoAvailable, MIN_PASSWORD_LENGTH } from '@/lib/crypto'
import { exportBoards } from './transferFile'

export default function ExportDialog({ closeDialog }) {
  // Only Google Sheet boards are settings; a local board is a file of its own.
  const boards = useBoards().boards.filter((b) => b.type !== "local")
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
