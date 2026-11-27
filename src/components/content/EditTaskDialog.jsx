import React, { useState } from 'react'
import { Box, DialogContent, TextField, Button as MuiButton, Select, MenuItem, FormControl, InputLabel, Typography } from '@mui/material'
import { useAlertStore } from '@/store'
import { useT } from '@/i18n'
import { parseLabels } from '@/lib/labels'
import { DialogFooter } from '@/components/elements/dialog/Dialog'
import { LabelBadge } from './LabelBadge'
import { taskTimes } from './taskDialog'

export default function EditTask({
  task = { id: null, title: "", issueId: "", des: "", column: "", priority: "high", assignee: "", labels: [] },
  users = [],
  boardLabels = [],
  allLabels = [],
  onClose, onOk, onDel,
}) {
  const [data, setData] = useState(() => ({ ...task, labels: parseLabels(task?.labels) }))
  const [labelInput, setLabelInput] = useState("")
  const [loading, setLoading] = useState(false)
  const { setAlert } = useAlertStore()
  const t = useT()
  const { created, moved } = taskTimes(task)
  const timeParts = [
    created && <span key="created" data-slot="task-created">{t("task.createdAt", { time: created.full })}</span>,
    moved && <span key="moved" data-slot="task-moved">{t("task.movedAt", { time: moved.full })}</span>,
  ].filter(Boolean)

  const selectedLabels = data?.labels || []
  const selectedKeys = React.useMemo(
    () => new Set(selectedLabels.map((l) => l.toLowerCase())),
    [selectedLabels]
  )
  // Match known casing when typing an existing preset or board label.
  const canonicalize = (raw) => {
    const clean = String(raw ?? "").trim()
    if (!clean) return ""
    const key = clean.toLowerCase()
    const match = allLabels.find((item) => item.toLowerCase() === key)
    return match || clean
  }
  const addLabelsFromText = (text) => {
    const incoming = parseLabels(text).map(canonicalize).filter(Boolean)
    if (!incoming.length) return
    setData((d) => ({ ...d, labels: parseLabels([...(d.labels || []), ...incoming]) }))
  }
  const removeLabel = (name) => {
    const key = name.toLowerCase()
    setData((d) => ({ ...d, labels: (d.labels || []).filter((item) => item.toLowerCase() !== key) }))
  }

  const query = labelInput.trim().toLowerCase()
  const suggestions = React.useMemo(
    () => allLabels.filter((name) => !selectedKeys.has(name.toLowerCase()) && (!query || name.toLowerCase().includes(query))),
    [allLabels, selectedKeys, query]
  )

  const handleCallback = (tf) => {
    setLoading(false)
    if (tf)
      onClose?.()
  }

  const handleSubmit = () => {
    const pending = parseLabels(labelInput).map(canonicalize).filter(Boolean)
    const nextData = pending.length
      ? { ...data, labels: parseLabels([...(data.labels || []), ...pending]) }
      : data
    if (pending.length) {
      setData(nextData)
      setLabelInput("")
    }
    setLoading(true)
    onOk(nextData, handleCallback)
  }

  return (
    <>
      <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
        <TextField
          label={t("task.title")}
          variant="standard"
          value={data?.title || ""}
          disabled={loading}
          onChange={(e) => setData(d => ({ ...d, title: e.target.value }))}
          fullWidth
          autoFocus
        />
        <TextField
          label={t("task.jiraId")}
          variant="standard"
          defaultValue={data?.issueId || ""}
          onChange={(e) => setData(d => ({ ...d, issueId: e.target.value }))}
          disabled={loading}
          fullWidth
        />
        <TextField
          label={t("task.description")}
          variant="standard"
          defaultValue={data?.des || ""}
          onChange={(e) => setData(d => ({ ...d, des: e.target.value }))}
          disabled={loading}
          fullWidth
          multiline
          maxRows={6}
        />
        <FormControl variant="standard" fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t("task.priority")}</InputLabel>
          <Select
            label={t("task.priority")}
            value={data?.priority || ""}
            onChange={(e) => setData(d => ({ ...d, priority: e.target.value }))}
            disabled={loading}
          >
            <MenuItem value="high">{t("priority.high")}</MenuItem>
            <MenuItem value="medium">{t("priority.medium")}</MenuItem>
            <MenuItem value="low">{t("priority.low")}</MenuItem>
          </Select>
        </FormControl>
        <FormControl variant="standard" fullWidth sx={{ mb: 2.5 }}>
          <InputLabel shrink>{t("task.assignee")}</InputLabel>
          <Select
            label={t("task.assignee")}
            value={data?.assignee || ""}
            onChange={(e) => setData(d => ({ ...d, assignee: e.target.value }))}
            disabled={loading}
            displayEmpty
            renderValue={(value) => value || <Box component="span" sx={{ color: 'text.disabled' }}>{t("task.unassigned")}</Box>}
          >
            {/* Lets a task go back to nobody, e.g. back in Todo waiting for someone to pick it up. */}
            <MenuItem value="">
              <em>{t("task.unassigned")}</em>
            </MenuItem>
            {/* Keep a current assignee who is no longer in the users sheet selectable. */}
            {(data?.assignee && !users.includes(data.assignee) ? [...users, data.assignee] : users).map(name => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box data-slot="task-labels-editor" sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary" component="label" htmlFor="task-labels-input" sx={{ display: 'block', mb: 0.75 }}>
            {t("task.labels")}
          </Typography>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring/40 dark:border-white/15 dark:bg-white/[0.03]">
            {selectedLabels.map((label) => (
              <LabelBadge
                key={label}
                name={label}
                boardLabels={boardLabels}
                size="md"
                onRemove={loading ? undefined : removeLabel}
              />
            ))}
            <input
              id="task-labels-input"
              type="text"
              value={labelInput}
              disabled={loading}
              onChange={(e) => {
                const value = e.target.value
                if (value.includes(",")) {
                  const parts = value.split(",")
                  const tail = parts.pop() ?? ""
                  addLabelsFromText(parts.join(","))
                  setLabelInput(tail)
                } else {
                  setLabelInput(value)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (labelInput.trim()) {
                    addLabelsFromText(labelInput)
                    setLabelInput("")
                  }
                } else if (e.key === "Backspace" && !labelInput && selectedLabels.length) {
                  removeLabel(selectedLabels[selectedLabels.length - 1])
                }
              }}
              placeholder={t("task.labelsPlaceholder")}
              className="min-w-[140px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {suggestions.map((name) => (
                <LabelBadge
                  key={name}
                  name={name}
                  boardLabels={boardLabels}
                  size="sm"
                  onClick={loading ? undefined : () => {
                    addLabelsFromText(name)
                    setLabelInput("")
                  }}
                />
              ))}
            </div>
          )}
        </Box>
        {task?.id && timeParts.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {timeParts.map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span aria-hidden="true">·</span>}
                {part}
              </React.Fragment>
            ))}
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        {task?.id &&
          <MuiButton
            color="error"
            onClick={() =>
              setAlert({
                title: t("task.delete"),
                content: t("task.deleteConfirm"),
                handleAgree: (callback) => (callback?.(), setLoading(true), onDel(task?.id, handleCallback))
              })
            }
            disabled={loading}
            sx={{ textTransform: 'none', ml: -1, minWidth: 0 }}
          >
            {t("task.delete")}
          </MuiButton>
        }
        <MuiButton
          variant="contained"
          onClick={handleSubmit}
          disabled={loading}
          sx={{ textTransform: 'none', ml: 'auto' }}
        >
          {t("task.ok")}
        </MuiButton>
      </DialogFooter>
    </>
  )
}
