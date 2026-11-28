import React, { useState } from 'react'
import { DialogContent, Tooltip } from '@mui/material'
import { useAtom } from 'jotai'
import { Badge } from '@/components/ui/badge'
import { KanbanItem, KanbanItemHandle } from '@/components/ui/kanban'
import { useBoards } from '@/store/boards'
import { useDialogStore } from '@/store'
import { useT } from '@/i18n'
import { PRIORITIES } from '@/lib/filter'
import { parseLabels } from '@/lib/labels'
import { markdownToPlainText } from '@/lib/markdown'
import MarkdownContent from '@/components/elements/MarkdownContent'
import { CardLabelsRow, LabelBadge } from './LabelBadge'
import { dialogAtom, taskTimes } from './taskDialog'

// Read-only view of a task: an article-style info line, labels, then the full description.
export function DescriptionView({ task, jiraLink, boardLabels = [], boardId }) {
  const t = useT()
  const { created, moved } = taskTimes(task)
  const labels = parseLabels(task?.labels)
  const parts = [
    task.column && <span key="column">{task.column}</span>,
    task.priority && <PriorityBadge key="priority" priority={task.priority} />,
    <span key="assignee">{task.assignee || t("task.unassigned")}</span>,
    task.issueId && (jiraLink
      ? <a key="issue" href={`${jiraLink}${task.issueId}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-[#58a6ff] underline-offset-2 hover:underline">{task.issueId}</a>
      : <span key="issue">{task.issueId}</span>),
    created && <span key="created" data-slot="task-created">{t("task.createdAt", { time: created.full })}</span>,
    moved && <span key="moved" data-slot="task-moved">{t("task.movedAt", { time: moved.full })}</span>,
  ].filter(Boolean)

  return (
    <DialogContent sx={{ pt: 0 }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span aria-hidden="true">·</span>}
            {part}
          </React.Fragment>
        ))}
      </div>
      {labels.length > 0 && (
        <div data-slot="description-labels" className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {labels.map((label) => (
            <LabelBadge key={label} name={label} boardLabels={boardLabels} size="md" />
          ))}
        </div>
      )}
      <hr className="my-4 border-border dark:border-white/15" />
      <MarkdownContent text={task.des} boardId={boardId} />
    </DialogContent>
  )
}

// Priority tag shared by the board cards and the deleted-tasks dialog.
export function PriorityBadge({ priority }) {
  const t = useT()

  return (
    <Badge
      variant={
        priority === 'high'
          ? 'destructive'
          : priority === 'medium'
            ? 'secondary'
            : 'primary'
      }
      appearance="outline"
      className="pointer-events-none h-5 rounded-sm px-1.5 text-[11px] capitalize shrink-0"
    >
      {PRIORITIES.includes(priority) ? t(`priority.${priority}`) : priority}
    </Badge>
  )
}

// `disabled` (a load or save is running) dims the card; `locked` (offline)
// only stops it from being dragged.
export default function TaskCard({
  task,
  asHandle,
  disabled,
  locked,
  boardLabels = [],
  activeLabel = "",
  onLabelClick,
  ...props
}) {
  const [, setDialog] = useAtom(dialogAtom)
  const { setDialog: setDefaultDialog } = useDialogStore()
  const t = useT()
  // Only tasks made since creation/move times were kept have them.
  const title = String(task.title ?? "").trim()
  const { created, moved } = taskTimes(task)
  const currentBoard = useBoards().currentBoard
  const jiraLink = currentBoard?.jiraLink || ""
  const localBoardId = currentBoard?.type === "local" ? currentBoard.id : undefined
  const taskLabels = React.useMemo(() => parseLabels(task?.labels), [task?.labels])
  const previewDes = React.useMemo(
    () => (task?.des ? (markdownToPlainText(task.des) || task.des) : ""),
    [task?.des]
  )

  // Resting the mouse on the card shows its whole title and, when known, when
  // it was created and moved into this column. Not on touch screens (a long
  // press drags the card), not on keyboard focus, not on the copy that follows
  // a drag, and not while the card is pressed, so it never trails a dragged card.
  const [hint, setHint] = useState(false)
  const pressed = React.useRef(false)
  const hasHint = Boolean(title || created || moved)
  const hintContent = hasHint ? (
    <div data-slot="task-hint">
      {title && <div>{task.title}</div>}
      {created && <div data-slot="task-created" style={{ opacity: 0.85 }}>{t("task.createdAt", { time: created.full })}</div>}
      {moved && <div data-slot="task-moved" style={{ opacity: 0.85 }}>{t("task.movedAt", { time: moved.full })}</div>}
    </div>
  ) : ""

  // Clicking the description shows all of it read-only, instead of editing the task.
  const openDescription = (e) => {
    e.stopPropagation()
    setDefaultDialog({
      title: task.title,
      open: true, fullWidth: true, maxWidth: "md",
      content: <DescriptionView task={task} jiraLink={jiraLink} boardLabels={boardLabels} boardId={localBoardId} />,
    })
  }

  const cardContent = (
    <Tooltip
      title={hintContent}
      placement="top"
      open={hint && hasHint && !!asHandle}
      onOpen={() => hasHint && !pressed.current && setHint(true)}
      onClose={() => setHint(false)}
      enterDelay={500}
      enterNextDelay={500}
      disableTouchListener
      disableFocusListener
    >
      <div
        className="rounded-md border bg-card p-3 shadow-xs"
        onClick={() => setDialog({ open: true, task })}
        onPointerDown={() => { pressed.current = true; setHint(false) }}
        onPointerUp={() => { pressed.current = false }}
        onPointerLeave={() => { pressed.current = false }}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="line-clamp-2 font-medium text-sm">
              {task.title}
            </span>
            <PriorityBadge priority={task.priority} />
          </div>

          {taskLabels.length > 0 && (
            <CardLabelsRow
              labels={taskLabels}
              boardLabels={boardLabels}
              activeLabel={activeLabel}
              onLabelClick={onLabelClick}
            />
          )}

          {/* At most two lines; only text that runs past them ends with an ellipsis. */}
          {previewDes ? (
            <div
              role="button"
              tabIndex={0}
              title={t("task.viewDescription")}
              onClick={openDescription}
              onKeyDown={(e) => e.key === "Enter" && openDescription(e)}
              className="line-clamp-2 break-words text-muted-foreground text-xs cursor-pointer underline-offset-2 hover:underline"
            >
              {previewDes}
            </div>
          ) : (
            <div className="line-clamp-2 break-words text-muted-foreground text-xs" />
          )}

          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <div className="flex items-center gap-1">
              <a target='_blank' rel="noopener noreferrer" href={`${jiraLink}${task.issueId}`} onClick={(e) => e.stopPropagation()}>
                <span className="line-clamp-1">
                  {task.issueId}
                </span>
              </a>
            </div>

            {task.assignee && (
              <span className="text-[10px] tabular-nums whitespace-nowrap">
                {task.assignee}
              </span>
            )}
          </div>
        </div>
      </div>
    </Tooltip>
  )

  return (
    <KanbanItem value={task.id} disabled={disabled || locked} className={locked && !disabled ? "opacity-100" : undefined} {...props}>
      {asHandle ? (
        <KanbanItemHandle>{cardContent}</KanbanItemHandle>
      ) : (
        cardContent
      )}
    </KanbanItem>
  )
}
