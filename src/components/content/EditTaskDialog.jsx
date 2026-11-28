import React, { useState } from 'react'
import { Box, CircularProgress, DialogContent, IconButton, TextField, Tooltip, Button as MuiButton, Select, MenuItem, FormControl, InputLabel, Typography } from '@mui/material'
import { AddPhotoAlternateOutlined as UploadImageIcon } from '@mui/icons-material'
import { useAlertStore } from '@/store'
import { useT } from '@/i18n'
import { parseLabels } from '@/lib/labels'
import { message } from '@/lib/notify'
import { localAvailable, uploadLocalAttachment } from '@/data/localApi'
import { DialogFooter } from '@/components/elements/dialog/Dialog'
import MarkdownContent from '@/components/elements/MarkdownContent'
import { LabelBadge } from './LabelBadge'
import { taskTimes } from './taskDialog'

let nextUploadToken = 1

function extractImageFiles(fileList) {
  return Array.from(fileList || []).filter((file) => (
    file && (
      String(file.type || "").startsWith("image/")
      || /\.(png|jpe?g|webp|gif)$/i.test(file.name || "")
    )
  ))
}

function extractClipboardImages(clipboardData) {
  if (!clipboardData) return []
  const fromItems = Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file" && String(item.type || "").startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (fromItems.length) return fromItems
  return extractImageFiles(clipboardData.files)
}

export default function EditTask({
  task = { id: null, title: "", issueId: "", des: "", column: "", priority: "high", assignee: "", labels: [] },
  users = [],
  boardLabels = [],
  allLabels = [],
  boardId,
  canUploadImages = false,
  onClose, onOk, onDel,
}) {
  const [data, setData] = useState(() => ({ ...task, labels: parseLabels(task?.labels) }))
  const [desTab, setDesTab] = useState("write")
  const [labelInput, setLabelInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [uploadingCount, setUploadingCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const textareaRef = React.useRef(null)
  const selectionRef = React.useRef(null)
  const fileInputRef = React.useRef(null)
  const { setAlert } = useAlertStore()
  const t = useT()
  const uploadsEnabled = Boolean(canUploadImages && boardId && localAvailable())
  const { created, moved } = taskTimes(task)
  const timeParts = [
    created && <span key="created" data-slot="task-created">{t("task.createdAt", { time: created.full })}</span>,
    moved && <span key="moved" data-slot="task-moved">{t("task.movedAt", { time: moved.full })}</span>,
  ].filter(Boolean)

  const selectedLabels = React.useMemo(() => data?.labels || [], [data?.labels])
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

  const rememberSelection = (e) => {
    const el = e?.target
    if (typeof el?.selectionStart === "number" && typeof el?.selectionEnd === "number") {
      selectionRef.current = { start: el.selectionStart, end: el.selectionEnd }
    }
  }

  const handleUploadFiles = async (files) => {
    if (!uploadsEnabled || loading) return
    const images = extractImageFiles(files)
    if (!images.length) return

    const el = textareaRef.current
    const focused = Boolean(el && document.activeElement === el)
    const start = focused && typeof el.selectionStart === "number"
      ? el.selectionStart
      : (selectionRef.current?.start ?? null)
    const end = focused && typeof el.selectionEnd === "number"
      ? el.selectionEnd
      : (selectionRef.current?.end ?? null)

    const entries = images.map((file) => {
      const token = nextUploadToken++
      return {
        file,
        placeholder: `![${t("task.uploadingImage")}](uploading-${token})`,
      }
    })
    const block = entries.map((entry) => entry.placeholder).join("\n")

    setData((prev) => {
      const current = String(prev?.des || "")
      if (start !== null && end !== null && start <= current.length && end <= current.length) {
        const before = current.slice(0, start)
        const after = current.slice(end)
        const lead = before && !before.endsWith("\n") ? "\n" : ""
        const trail = after && !after.startsWith("\n") ? "\n" : ""
        return { ...prev, des: `${before}${lead}${block}${trail}${after}` }
      }
      const sep = current && !current.endsWith("\n") ? "\n" : ""
      return { ...prev, des: `${current}${sep}${block}` }
    })

    setUploadingCount((n) => n + entries.length)
    await Promise.all(entries.map(async ({ file, placeholder }) => {
      try {
        const saved = await uploadLocalAttachment(boardId, file)
        setData((prev) => ({
          ...prev,
          des: String(prev?.des || "").replace(placeholder, saved.markdown),
        }))
      } catch (error) {
        setData((prev) => ({
          ...prev,
          des: String(prev?.des || "")
            .replace(`${placeholder}\n`, "")
            .replace(`\n${placeholder}`, "")
            .replace(placeholder, ""),
        }))
        message.error(error?.userMessage || t("common.apiError"), 6)
      } finally {
        setUploadingCount((n) => Math.max(0, n - 1))
      }
    }))
  }

  const handlePaste = (e) => {
    if (!uploadsEnabled || loading) return
    const images = extractClipboardImages(e.clipboardData)
    if (!images.length) return
    e.preventDefault()
    handleUploadFiles(images)
  }

  const handleDragOver = (e) => {
    if (!uploadsEnabled || loading) return
    if (Array.from(e.dataTransfer?.types || []).includes("Files")) {
      e.preventDefault()
      setDragOver(true)
    }
  }

  const handleDrop = (e) => {
    if (!uploadsEnabled || loading) return
    setDragOver(false)
    const images = extractImageFiles(e.dataTransfer?.files)
    if (!images.length) return
    e.preventDefault()
    setDesTab("write")
    handleUploadFiles(images)
  }

  const handleCallback = (tf) => {
    setLoading(false)
    if (tf)
      onClose?.()
  }

  const handleSubmit = () => {
    if (uploadingCount > 0) return
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
        <Box
          data-slot="task-description-editor"
          sx={{ mb: 2.5 }}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Typography variant="caption" color="text.secondary" component="label" htmlFor="task-description-input">
                {t("task.description")}
              </Typography>
              {uploadingCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CircularProgress size={12} />
                  {t("task.uploadingImage")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {uploadsEnabled && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files
                      if (files?.length) {
                        setDesTab("write")
                        handleUploadFiles(files)
                      }
                      e.target.value = ""
                    }}
                  />
                  <Tooltip title={t("task.uploadImageHint")}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={loading}
                        aria-label={t("task.uploadImage")}
                        onClick={() => fileInputRef.current?.click()}
                        sx={{ p: 0.5 }}
                      >
                        <UploadImageIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </>
              )}
              <div
                role="tablist"
                aria-label={t("task.description")}
                className="inline-flex rounded-md border border-border bg-muted/60 p-0.5 text-xs dark:border-white/15 dark:bg-white/[0.04]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={desTab === "write"}
                  onClick={() => setDesTab("write")}
                  className={`rounded px-2.5 py-0.5 font-medium transition-colors ${
                    desTab === "write"
                      ? "bg-background text-foreground shadow-2xs dark:bg-white/12 dark:text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("task.descriptionWrite")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={desTab === "preview"}
                  onClick={() => setDesTab("preview")}
                  className={`rounded px-2.5 py-0.5 font-medium transition-colors ${
                    desTab === "preview"
                      ? "bg-background text-foreground shadow-2xs dark:bg-white/12 dark:text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("task.descriptionPreview")}
                </button>
              </div>
            </div>
          </div>

          {desTab === "write" ? (
            <div className={dragOver ? "rounded ring-2 ring-blue-500/60" : undefined}>
              <TextField
                id="task-description-input"
                inputRef={textareaRef}
                variant="outlined"
                size="small"
                value={data?.des || ""}
                onChange={(e) => { rememberSelection(e); setData(d => ({ ...d, des: e.target.value })) }}
                onPaste={handlePaste}
                inputProps={{
                  onSelect: rememberSelection,
                  onClick: rememberSelection,
                  onKeyUp: rememberSelection,
                }}
                placeholder={t(uploadsEnabled ? "task.descriptionPlaceholderLocal" : "task.descriptionPlaceholder")}
                disabled={loading}
                fullWidth
                multiline
                minRows={4}
                maxRows={12}
                sx={{
                  mb: '0 !important',
                  '& .MuiOutlinedInput-root': {
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                  },
                }}
              />
            </div>
          ) : (
            <div
              data-slot="task-description-preview"
              className={`min-h-[116px] max-h-[320px] overflow-y-auto rounded border border-border bg-background/60 px-3.5 py-2.5 dark:border-white/15 dark:bg-white/[0.02] ${
                dragOver ? "ring-2 ring-blue-500/60" : ""
              }`}
            >
              {String(data?.des ?? "").trim() ? (
                <MarkdownContent text={data.des} boardId={uploadsEnabled ? boardId : undefined} />
              ) : (
                <Typography variant="body2" color="text.disabled">
                  {t("task.descriptionEmptyPreview")}
                </Typography>
              )}
            </div>
          )}
        </Box>
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
          disabled={loading || uploadingCount > 0}
          sx={{ textTransform: 'none', ml: 'auto' }}
        >
          {t("task.ok")}
        </MuiButton>
      </DialogFooter>
    </>
  )
}
