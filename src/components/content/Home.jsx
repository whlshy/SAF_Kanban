import React, { useEffect } from 'react'
import { useAtom } from 'jotai'
import { Refresh as RefreshIcon, CloudOffOutlined as OfflineIcon } from '@mui/icons-material'
import { message } from '@/lib/notify'
import { Kanban, KanbanBoard, KanbanOverlay } from '@/components/ui/kanban'
import { useBoards } from '@/store/boards'
import { t as translate, useT } from '@/i18n'
import { useBoardData, useBoardWrite } from '@/data/useBoardData'
import { EMPTY_FILTER, PRIORITIES, isFilterActive, taskMatcher } from '@/lib/filter'
import { labelOptions, parseLabels } from '@/lib/labels'
import useOnline from '@/lib/useOnline'
import { filterAtom } from '@/store/filter'
import { useDialogStore } from '@/store'
import AppDialog from '@/components/elements/dialog/Dialog'
import FilterBar from './FilterBar'
import { BoardNotice, EmptyBoards } from './BoardStates'
import TaskCard, { PriorityBadge } from './TaskCard'
import TaskColumn from './TaskColumn'
import EditTask from './EditTaskDialog'
import { dialogAtom } from './taskDialog'

export { dialogAtom, PriorityBadge, PRIORITIES }

function Home() {
  const { currentBoard, loading } = useBoards()
  const { open } = useDialogStore()
  const t = useT()
  const connected = useOnline()
  const [filter, setFilter] = useAtom(filterAtom)
  // Typing in the search box stays smooth on a board with many tasks.
  const shownFilter = React.useDeferredValue(filter)

  // While a dialog is open nothing is fetched (typing a Sheet ID in Settings
  // shouldn't load every partial ID), and closing it refreshes the board.
  const { source, columns, tasks, users, labels: boardLabels, columnsLoaded, tasksLoading, tasksUpdatedAt, reloadTasks, reloadLabels } =
    useBoardData(currentBoard, { paused: open })

  // Each board starts unfiltered.
  const boardId = currentBoard?.id
  useEffect(() => {
    setFilter({ open: false, ...EMPTY_FILTER })
  }, [boardId, setFilter])

  // Clicking a label pill on a card opens the filter bar and toggles that label.
  const handleToggleLabel = React.useCallback((labelName) => {
    setFilter((f) => {
      const same = String(f.label ?? "").trim().toLowerCase() === String(labelName ?? "").trim().toLowerCase()
      return { ...f, open: true, label: same ? "" : labelName }
    })
  }, [setFilter])

  // A board on this computer works without a connection.
  const online = connected || source?.needsNetwork === false

  const notice = !source ? (
    <BoardNotice
      title={t("board.notice.unsupported.title")}
      description={t("board.notice.unsupported.description")}
      action={{ label: t("board.notice.unsupported.reload"), icon: <RefreshIcon />, onClick: () => window.location.reload() }}
    />
  ) : !source.ready ? (
    <BoardNotice title={t("board.notice.noSheet.title")} description={t("board.notice.noSheet.description")} />
  ) : columnsLoaded && !columns.length ? (
    <BoardNotice title={t("board.notice.noColumns.title")} description={t("board.notice.noColumns.description")} />
  ) : null

  return (
    <div
      style={{ paddingTop: "80px" }}
      className="flex h-screen min-h-0 flex-col overflow-hidden p-4">
      {!!currentBoard && !online && (
        <div role="status" data-slot="offline-notice" className="mb-3 flex shrink-0 items-center gap-2 rounded-md border bg-muted/60 px-3 py-2 text-xs text-muted-foreground dark:bg-card">
          <OfflineIcon sx={{ fontSize: 16 }} />
          <span>{t("offline.notice")}</span>
        </div>
      )}
      {!!currentBoard && filter.open && !notice && (
        <FilterBar
          filter={filter}
          onChange={(patch) => setFilter((f) => ({ ...f, ...patch }))}
          tasks={tasks}
          users={users}
          boardLabels={boardLabels}
          shown={tasks.filter(taskMatcher(shownFilter)).length}
        />
      )}
      <div className="min-h-0 flex-1">
        {loading ? null : !currentBoard ? (
          <EmptyBoards />
        ) : (
          <WHLKanban
            board={currentBoard}
            notice={notice}
            source={source}
            columnNames={columns}
            tasks={tasks}
            tasksUpdatedAt={tasksUpdatedAt}
            users={users}
            boardLabels={boardLabels}
            filter={shownFilter}
            onToggleLabel={handleToggleLabel}
            reloadTasks={reloadTasks}
            reloadLabels={reloadLabels}
            disabled={tasksLoading}
            locked={!online}
          />
        )}
      </div>
    </div>
  )
}

export default Home

function WHLKanban({ board, source, columnNames, tasks, tasksUpdatedAt, users, boardLabels, filter, onToggleLabel, reloadTasks, reloadLabels, disabled, locked, notice }) {
  // What the board shows: column name -> its tasks that pass the filter.
  // Dragging and saving update it right away; reloading then confirms it.
  const [columns, setColumns] = React.useState({})
  const [dialogProps, setDialog] = useAtom(dialogAtom)
  const t = useT()
  const write = useBoardWrite(source)

  const filtering = isFilterActive(filter)
  const matches = React.useMemo(
    () => taskMatcher({ query: filter.query, assignee: filter.assignee, priority: filter.priority, label: filter.label }),
    [filter.query, filter.assignee, filter.priority, filter.label]
  )
  const allLabels = React.useMemo(() => labelOptions(boardLabels, tasks), [boardLabels, tasks])

  useEffect(() => {
    const newColumns = {}
    columnNames.forEach((name) => {
      newColumns[name] = tasks.filter((task) => task.column == name && matches(task))
    })
    setColumns(newColumns)
  }, [tasks, tasksUpdatedAt, columnNames, matches])

  const totals = React.useMemo(
    () => Object.fromEntries(columnNames.map((name) => [name, tasks.filter((task) => task.column == name).length])),
    [tasks, columnNames]
  )

  // A saved task that the filter hides would seem to vanish, so say why.
  const onSaved = (task) => {
    reloadTasks()
    if (task && parseLabels(task.labels).length) reloadLabels?.()
    if (task && filtering && !matches(task)) message.info(translate("filter.savedHidden"), 5)
    else message.success(translate("common.success"))
  }

  const handleMoveTask = ({ event, activeContainer, activeIndex, overContainer, overIndex, previousColumns, columns: nextColumns }) => {
    if (activeContainer === overContainer && activeIndex === overIndex) return

    const targetTasks = [...nextColumns[overContainer]]
    const newIndex = targetTasks.findIndex(item => item.id === event.active.id)
    if (newIndex < 0) return

    const movedTask = activeContainer === overContainer
      ? targetTasks[newIndex]
      : { ...targetTasks[newIndex], column: overContainer }

    targetTasks[newIndex] = movedTask
    const committedColumns = activeContainer === overContainer
      ? nextColumns
      : { ...nextColumns, [overContainer]: targetTasks }
    // The neighbours on screen. With a filter on, tasks it hides may sit
    // between them; the task lands next to the neighbour either way.
    let beforeId = targetTasks[newIndex + 1]?.id
    let afterId = targetTasks[newIndex - 1]?.id

    // `tasks` is in stored order. If the task already sits right before
    // beforeId (or right after afterId), Apps Script's moveRows rejects the
    // no-op move, so only send the column change.
    const storedIndex = (id) => tasks.findIndex(item => item.id === id)
    const sourceIndex = storedIndex(movedTask.id)
    const beforeIndex = beforeId ? storedIndex(beforeId) : -1
    const alreadyInPlace = sourceIndex >= 0 && (beforeIndex >= 0
      ? beforeIndex === sourceIndex + 1
      : !!afterId && storedIndex(afterId) === sourceIndex - 1)
    if (alreadyInPlace) {
      beforeId = undefined
      afterId = undefined
    }

    setColumns(committedColumns)
    write.mutate(
      { op: "moveTask", payload: { id: movedTask.id, column: overContainer, beforeId, afterId } },
      {
        onSuccess: () => onSaved(),
        onError: () => setColumns(previousColumns),
      }
    )
  }

  const handleEditTask = (newTask, callback) => {
    const existing = newTask?.id ? tasks.find((item) => item.id == newTask.id) : null
    const prevLabels = parseLabels(existing?.labels)
    const nextLabels = parseLabels(newTask?.labels)
    const labelsChanged = existing
      ? (prevLabels.length !== nextLabels.length || prevLabels.some((label, i) => label !== nextLabels[i]))
      : nextLabels.length > 0
    const otherFieldsChanged = !existing || ["title", "issueId", "des", "priority", "assignee"]
      .some((field) => String(existing[field] ?? "") !== String(newTask?.[field] ?? ""))

    const applyTask = (committedTask) => {
      if (newTask?.id) {
        return Object.fromEntries(Object.entries(columns).map(([name, items]) =>
          [name, items.map(f => f?.id == newTask.id ? { ...f, ...committedTask } : f).filter(matches)]))
      }
      const firstColumn = columnNames[0]
      return { ...columns, [firstColumn]: columns[firstColumn].concat([committedTask]).filter(matches) }
    }

    let task = newTask
    if (!newTask?.id) {
      const firstColumn = columnNames[0]
      if (!columns[firstColumn]) {
        message.error(translate("task.noColumns"))
        callback?.(false)
        return
      }
      task = { ...newTask, id: crypto.randomUUID().split('-')[0], column: firstColumn }
    }

    write.mutate(
      { op: "saveTask", payload: task },
      {
        onSuccess: (result) => {
          if (labelsChanged && result?.supportsLabels === false) {
            const persistedTask = { ...task, labels: prevLabels }
            setColumns(applyTask(persistedTask))
            reloadTasks()
            const versionText = result.scriptVersion > 0 ? `v${result.scriptVersion}` : "v1"
            const key = otherFieldsChanged ? "script.labelsPartialSave" : "script.labelsNeedV6"
            message.warning(translate(key, { version: versionText }), 8)
            callback?.(otherFieldsChanged)
            return
          }
          setColumns(applyTask(task))
          callback?.(true)
          onSaved(task)
        },
        onError: () => callback?.(false),
      }
    )
  }

  const handleDelete = (taskId, callback) => {
    const newColumns = Object.fromEntries(Object.entries(columns).map(([name, items]) =>
      [name, items.filter(f => f?.id != taskId)]))

    write.mutate(
      { op: "deleteTask", payload: taskId },
      {
        onSuccess: () => (setColumns(newColumns), callback?.(true), onSaved()),
        onError: () => callback?.(false),
      }
    )
  }

  return (
    <>
      {/* The notice replaces only the board, so the task dialog below still works. */}
      {notice || <Kanban
        value={columns}
        onValueChange={setColumns}
        onMove={handleMoveTask}
        getItemValue={(item) => item.id}
        className="h-full min-h-0"
      >
        <KanbanBoard
          className="kanban-columns h-full min-h-0 auto-rows-auto overflow-x-auto"
          // Column widths are set in tailwind.css (.kanban-columns), per screen size.
          style={{ '--kanban-columns': Math.max(Object.keys(columns).length, 1) }}
        >
          {Object.entries(columns).map(([columnValue, tasks]) => (
            <TaskColumn
              key={columnValue}
              value={columnValue}
              tasks={tasks}
              total={filtering ? totals[columnValue] : undefined}
              disabled={disabled || write.isPending}
              locked={locked}
              boardLabels={boardLabels}
              activeLabel={filter.label}
              onLabelClick={onToggleLabel}
            />
          ))}
        </KanbanBoard>

        <KanbanOverlay>
          {({ value, variant }) => {
            if (variant === 'column') {
              const columnTasks = columns[value] || []
              return (
                <TaskColumn
                  value={value}
                  tasks={columnTasks}
                  boardLabels={boardLabels}
                  isOverlay
                />
              )
            }

            const task = Object.values(columns)
              .flat()
              .find((item) => item.id === value)

            if (!task) return null

            return <TaskCard task={task} boardLabels={boardLabels} />
          }}
        </KanbanOverlay>
      </Kanban>}
      {/* Same dialog as the rest of the app: ✕ in the title row, buttons in the
          footer; a click outside doesn't close it, Esc does. */}
      {!!dialogProps.open &&
        <AppDialog
          open={dialogProps.open}
          title={dialogProps.task?.id ? t("task.edit") : t("task.create")}
          closeDialog={() => setDialog({ open: false })}
          persistent
          fullWidth
          maxWidth="lg"
          content={
            <EditTask
              task={dialogProps.task}
              users={users}
              boardLabels={boardLabels}
              allLabels={allLabels}
              boardId={board?.id}
              canUploadImages={board?.type === "local"}
              onClose={() => setDialog({ open: false })}
              onOk={handleEditTask}
              onDel={handleDelete}
            />
          }
        />
      }
    </>
  )
}
