import React from 'react'
import { Box, Button, IconButton, TextField, Typography } from '@mui/material'
import { Add as AddIcon, ArrowDownward as DownIcon, ArrowUpward as UpIcon, DeleteOutline as RemoveIcon } from '@mui/icons-material'
import { useT } from '@/i18n'

let nextKey = 0

// Rows for a list of names. `original` is the name a row had when the list was
// loaded (undefined for a new row), so a rename can be told from a new name.
export const toRows = (names = []) => names.map((name) => ({ key: nextKey++, name, original: name }))

// The names as they should be saved: trimmed, without empty rows.
export const rowNames = (rows) => rows.map((row) => row.name.trim()).filter(Boolean)

// { old name: new name } for the rows whose name was changed.
export const rowRenames = (rows) => Object.fromEntries(
  rows
    .filter((row) => row.original !== undefined && row.name.trim() && row.name.trim() !== row.original)
    .map((row) => [row.original, row.name.trim()])
)

// A list of names that can be edited, reordered, added to and removed from.
export default function ListEditor({ label, hint, rows, onChange, addLabel, disabled }) {
  const t = useT()
  const [focusKey, setFocusKey] = React.useState(null)

  const move = (index, by) => {
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(index + by, 0, row)
    onChange(next)
  }
  const add = () => {
    const row = { key: nextKey++, name: "" }
    setFocusKey(row.key)
    onChange([...rows, row])
  }

  return (
    <Box data-slot="list-editor" sx={{ mb: 3 }}>
      <Typography variant="subtitle2">{label}</Typography>
      {hint && <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{hint}</Typography>}
      {rows.map((row, index) => (
        <Box key={row.key} className="flex items-center gap-1" sx={{ '& .MuiTextField-root': { mb: 0 } }}>
          <TextField
            variant="standard"
            size="small"
            fullWidth
            value={row.name}
            autoFocus={row.key === focusKey}
            disabled={disabled}
            onChange={(e) => onChange(rows.map((each) => (each.key === row.key ? { ...each, name: e.target.value } : each)))}
            // Enter in the last row starts the next one instead of saving the dialog.
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              e.preventDefault()
              if (index === rows.length - 1 && row.name.trim()) add()
            }}
            inputProps={{ "aria-label": `${label} ${index + 1}` }}
          />
          <IconButton size="small" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label={t("list.moveUp")} title={t("list.moveUp")}>
            <UpIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" disabled={disabled || index === rows.length - 1} onClick={() => move(index, 1)} aria-label={t("list.moveDown")} title={t("list.moveDown")}>
            <DownIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" disabled={disabled} onClick={() => onChange(rows.filter((each) => each.key !== row.key))} aria-label={t("list.remove")} title={t("list.remove")}>
            <RemoveIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={add} disabled={disabled} sx={{ textTransform: 'none', mt: 0.5, ml: -0.5 }}>
        {addLabel}
      </Button>
    </Box>
  )
}
