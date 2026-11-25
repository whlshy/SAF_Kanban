import React, { useState } from 'react'
import { DialogContent, TextField, Button as MuiButton, Select, MenuItem, FormControl, InputLabel } from '@mui/material'
import { useAlertStore } from '@/store'
import { useT } from '@/i18n'
import { DialogFooter } from '@/components/elements/dialog/Dialog'
import { taskTimes } from './taskDialog'

export default function EditTask({
  task = { id: null, title: "", issueId: "", des: "", column: "", priority: "high", assignee: "" },
  users = [],
  onClose, onOk, onDel,
}) {
  const [data, setData] = useState(task)
  const [loading, setLoading] = useState(false)
  const { setAlert } = useAlertStore()
  const t = useT()
  const { created, moved } = taskTimes(task)
  const timeParts = [
    created && <span key="created" data-slot="task-created">{t("task.createdAt", { time: created.full })}</span>,
    moved && <span key="moved" data-slot="task-moved">{t("task.movedAt", { time: moved.full })}</span>,
  ].filter(Boolean)

  const handleCallback = (tf) => {
    setLoading(false)
    if (tf)
      onClose?.()
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
        <FormControl variant="standard" fullWidth>
          <InputLabel shrink>{t("task.assignee")}</InputLabel>
          <Select
            label={t("task.assignee")}
            value={data?.assignee || ""}
            onChange={(e) => setData(d => ({ ...d, assignee: e.target.value }))}
            disabled={loading}
            displayEmpty
            renderValue={(value) => value || <span style={{ color: 'rgba(0, 0, 0, 0.38)' }}>{t("task.unassigned")}</span>}
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
          onClick={() => (setLoading(true), onOk(data, handleCallback))}
          disabled={loading}
          sx={{ textTransform: 'none', ml: 'auto' }}
        >
          {t("task.ok")}
        </MuiButton>
      </DialogFooter>
    </>
  )
}
