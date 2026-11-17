import React from 'react'
import { Box, Button, IconButton, TextField, Typography } from '@mui/material'
import { Add as AddIcon, DeleteOutline as RemoveIcon, DragIndicator as DragIcon } from '@mui/icons-material'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useT } from '@/i18n'

let nextKey = 1
const newKey = () => `row-${nextKey++}`

// Rows for a list of names. `original` is the name a row had when the list was
// loaded (undefined for a new row), so a rename can be told from a new name.
export const toRows = (names = []) => names.map((name) => ({ key: newKey(), name, original: name }))

// The names as they should be saved: trimmed, without empty rows.
export const rowNames = (rows) => rows.map((row) => row.name.trim()).filter(Boolean)

// { old name: new name } for the rows whose name was changed.
export const rowRenames = (rows) => Object.fromEntries(
  rows
    .filter((row) => row.original !== undefined && row.name.trim() && row.name.trim() !== row.original)
    .map((row) => [row.original, row.name.trim()])
)

// Rows only move up and down.
const vertical = ({ transform }) => ({ ...transform, x: 0 })

function Row({ row, label, autoFocus, disabled, onRename, onRemove, onEnter }) {
  const t = useT()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.key, disabled })

  return (
    <Box
      ref={setNodeRef}
      data-slot="list-editor-row"
      className="flex items-center gap-1"
      sx={{
        '& .MuiTextField-root': { mb: 0 },
        transform: CSS.Translate.toString(transform),
        transition,
        // The row being dragged stays above its neighbours.
        ...(isDragging ? { position: 'relative', zIndex: 1, bgcolor: 'background.paper', boxShadow: 3, borderRadius: 1 } : {}),
      }}
    >
      {/* Dragged with the mouse or a finger; with the keyboard: Space, arrow keys, Space. */}
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
      <TextField
        variant="standard"
        size="small"
        fullWidth
        value={row.name}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => onRename(e.target.value)}
        // Enter starts the next row instead of saving the dialog.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          onEnter()
        }}
        inputProps={{ "aria-label": label }}
      />
      <IconButton size="small" disabled={disabled} onClick={onRemove} aria-label={t("list.remove")} title={t("list.remove")}>
        <RemoveIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

// A list of names that can be edited, added to, removed from, and reordered
// by dragging a row's handle.
export default function ListEditor({ label, hint, rows, onChange, addLabel, disabled }) {
  const [focusKey, setFocusKey] = React.useState(null)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const add = () => {
    const row = { key: newKey(), name: "" }
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
    <Box data-slot="list-editor" sx={{ mb: 3 }}>
      <Typography variant="subtitle2">{label}</Typography>
      {hint && <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{hint}</Typography>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[vertical]} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((row) => row.key)} strategy={verticalListSortingStrategy}>
          {rows.map((row, index) => (
            <Row
              key={row.key}
              row={row}
              label={`${label} ${index + 1}`}
              autoFocus={row.key === focusKey}
              disabled={disabled}
              onRename={(name) => onChange(rows.map((each) => (each.key === row.key ? { ...each, name } : each)))}
              onRemove={() => onChange(rows.filter((each) => each.key !== row.key))}
              onEnter={() => index === rows.length - 1 && row.name.trim() && add()}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button size="small" startIcon={<AddIcon />} onClick={add} disabled={disabled} sx={{ textTransform: 'none', mt: 0.5, ml: -0.5 }}>
        {addLabel}
      </Button>
    </Box>
  )
}
