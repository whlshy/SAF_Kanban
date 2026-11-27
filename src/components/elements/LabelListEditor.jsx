import React from 'react'
import { Box, Button, IconButton, Popover, TextField, Tooltip, Typography } from '@mui/material'
import { Add as AddIcon, Check as CheckIcon, DeleteOutline as RemoveIcon, DragIndicator as DragIcon } from '@mui/icons-material'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '@/i18n'
import { LABEL_COLOR_KEYS, LABEL_PALETTE, hashLabelColor, normalizeColorValue } from '@/lib/labels'

let nextKey = 1
const newKey = () => `label-row-${nextKey++}`

export const toLabelRows = (defs = []) => (defs || []).map((item) => {
  const name = typeof item === "string" ? item : String(item?.name ?? "")
  const color = typeof item === "string" ? "" : normalizeColorValue(item?.color)
  return { key: newKey(), name, color, original: name }
})

export const labelRowDefs = (rows = []) => {
  const out = []
  const seen = new Set()
  for (const row of rows) {
    const name = String(row.name ?? "").replaceAll(",", " ").trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const color = normalizeColorValue(row.color)
    out.push(color ? { name, color } : { name })
  }
  return out
}

export const labelRowRenames = (rows = []) => Object.fromEntries(
  rows
    .filter((row) => {
      const next = String(row.name ?? "").replaceAll(",", " ").trim()
      return row.original !== undefined && next && next !== row.original
    })
    .map((row) => [row.original, String(row.name ?? "").replaceAll(",", " ").trim()])
)

const vertical = ({ transform }) => ({ ...transform, x: 0 })

function resolveDot(row) {
  const specified = normalizeColorValue(row.color)
  if (specified && specified.startsWith("#")) return specified
  const key = (specified && LABEL_PALETTE[specified]) ? specified : (row.name.trim() ? hashLabelColor(row.name) : "blue")
  return LABEL_PALETTE[key].dot
}

function LabelRow({ row, label, autoFocus, disabled, inUseCount = 0, onChangeRow, onRemove, onEnter }) {
  const t = useT()
  const [anchorEl, setAnchorEl] = React.useState(null)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.key, disabled })
  const dot = resolveDot(row)
  const removeDisabled = disabled || inUseCount > 0
  const removeTitle = inUseCount > 0
    ? t("settings.labels.inUse", { count: inUseCount })
    : t("list.remove")

  return (
    <Box
      ref={setNodeRef}
      data-slot="label-editor-row"
      className="flex items-center gap-1.5"
      sx={{
        '& .MuiTextField-root': { mb: 0 },
        transform: CSS.Translate.toString(transform),
        transition,
        ...(isDragging ? { position: 'relative', zIndex: 1, bgcolor: 'background.paper', boxShadow: 3, borderRadius: 1 } : {}),
      }}
    >
      <IconButton
        ref={setActivatorNodeRef}
        size="small"
        disabled={disabled}
        aria-label={t("list.drag")}
        title={t("list.drag")}
        sx={{ ml: -1, cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', color: 'text.disabled' }}
        {...attributes}
        {...listeners}
      >
        <DragIcon fontSize="small" />
      </IconButton>

      <Tooltip title={t("settings.labels.color")}>
        <span>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("settings.labels.color")}
            onClick={(e) => setAnchorEl(e.currentTarget)}
            className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border transition-transform hover:scale-110 disabled:opacity-50 dark:border-white/20"
            style={{ backgroundColor: dot }}
          />
        </span>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 1.25, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1 }}>
          {LABEL_COLOR_KEYS.map((colorKey) => {
            const selected = (normalizeColorValue(row.color) || "") === colorKey
            return (
              <button
                key={colorKey}
                type="button"
                aria-label={colorKey}
                title={colorKey}
                onClick={() => {
                  onChangeRow({ ...row, color: colorKey })
                  setAnchorEl(null)
                }}
                className="flex size-6 items-center justify-center rounded-full border border-black/15 transition-transform hover:scale-110 dark:border-white/25"
                style={{ backgroundColor: LABEL_PALETTE[colorKey].dot }}
              >
                {selected && <CheckIcon sx={{ fontSize: 14, color: '#fff' }} />}
              </button>
            )
          })}
        </Box>
      </Popover>

      <TextField
        variant="standard"
        size="small"
        fullWidth
        value={row.name}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={t("settings.labels.placeholder")}
        onChange={(e) => onChangeRow({ ...row, name: e.target.value.replaceAll(",", "") })}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          onEnter()
        }}
        inputProps={{ "aria-label": label }}
      />

      <Tooltip title={removeTitle}>
        <span>
          <IconButton size="small" disabled={removeDisabled} onClick={onRemove} aria-label={removeTitle}>
            <RemoveIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  )
}

export default function LabelListEditor({ label, hint, rows, onChange, addLabel, disabled, usedCounts = {} }) {
  const [focusKey, setFocusKey] = React.useState(null)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const add = () => {
    const used = new Set(rows.map((r) => normalizeColorValue(r.color)).filter(Boolean))
    const nextColor = LABEL_COLOR_KEYS.find((k) => !used.has(k)) || LABEL_COLOR_KEYS[rows.length % LABEL_COLOR_KEYS.length]
    const row = { key: newKey(), name: "", color: nextColor }
    setFocusKey(row.key)
    onChange([...rows, row])
  }

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    const from = rows.findIndex((row) => row.key === active.id)
    const to = rows.findIndex((row) => row.key === over.id)
    if (from >= 0 && to >= 0) onChange(arrayMove(rows, from, to))
  }

  return (
    <Box data-slot="label-list-editor" sx={{ mb: 3 }}>
      <Typography variant="subtitle2">{label}</Typography>
      {hint && <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75 }}>{hint}</Typography>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[vertical]} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((row) => row.key)} strategy={verticalListSortingStrategy}>
          {rows.map((row, index) => {
            const lookupKey = String(row.original ?? row.name ?? "").trim().toLowerCase()
            const inUseCount = lookupKey ? (usedCounts[lookupKey] || 0) : 0
            return (
              <LabelRow
                key={row.key}
                row={row}
                label={`${label} ${index + 1}`}
                autoFocus={row.key === focusKey}
                disabled={disabled}
                inUseCount={inUseCount}
                onChangeRow={(updated) => onChange(rows.map((each) => (each.key === row.key ? updated : each)))}
                onRemove={() => onChange(rows.filter((each) => each.key !== row.key))}
                onEnter={() => index === rows.length - 1 && row.name.trim() && add()}
              />
            )
          })}
        </SortableContext>
      </DndContext>
      <Button size="small" startIcon={<AddIcon />} onClick={add} disabled={disabled} sx={{ textTransform: 'none', mt: 0.5, ml: -0.5 }}>
        {addLabel}
      </Button>
    </Box>
  )
}
