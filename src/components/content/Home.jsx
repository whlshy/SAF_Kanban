import React, { useEffect, useState } from 'react'
import { DialogContent, TextField, Button as MuiButton, Tooltip, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { message } from 'antd';
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanColumnHandle,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
} from '@/components/ui/kanban';
import { atom, useAtom } from 'jotai';
import { TEMPLATE_COPY_URL, useBoards } from '@/store/boards';
import { t as translate, useT } from '@/i18n';
import { Add as AddIcon, Settings as SettingsIcon, FileUploadOutlined as ImportIcon, Refresh as RefreshIcon, CloudOffOutlined as OfflineIcon } from '@mui/icons-material';
import { useOpenSettings } from '@/components/header/SettingDialog';
import { useOpenNewBoard } from '@/components/header/NewBoardDialog';
import { localAvailable } from '@/data/localApi';
import { useStartImport } from '@/components/header/BoardTransfer';
import { useBoardData, useBoardWrite } from '@/data/useBoardData';
import { EMPTY_FILTER, PRIORITIES, isFilterActive, taskMatcher } from '@/lib/filter';
import { createdAtParts } from '@/lib/createdAt';
import useOnline from '@/lib/useOnline';
import { filterAtom } from '@/store/filter';
import FilterBar from './FilterBar';
import { useDialogStore, useAlertStore } from '@/store';
import { Checkbox } from 'antd';
import AppDialog, { DialogFooter } from '@/components/elements/dialog/Dialog';

const dialogAtom = atom({ open: false })
export { dialogAtom }

function Home() {
  const { currentBoard, loading } = useBoards();
  const { open } = useDialogStore();
  const t = useT();
  const connected = useOnline();
  const [filter, setFilter] = useAtom(filterAtom);
  // Typing in the search box stays smooth on a board with many tasks.
  const shownFilter = React.useDeferredValue(filter);

  // While a dialog is open nothing is fetched (typing a Sheet ID in Settings
  // shouldn't load every partial ID), and closing it refreshes the board.
  const { source, columns, tasks, users, columnsLoaded, tasksLoading, reloadTasks } =
    useBoardData(currentBoard, { paused: open });

  // Each board starts unfiltered.
  const boardId = currentBoard?.id;
  useEffect(() => {
    setFilter({ open: false, ...EMPTY_FILTER });
  }, [boardId, setFilter]);

  // A board on this computer works without a connection.
  const online = connected || source?.needsNetwork === false;

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
  ) : null;

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
          shown={tasks.filter(taskMatcher(shownFilter)).length}
        />
      )}
      <div className="min-h-0 flex-1">
        {loading ? null : !currentBoard ? (
          <EmptyBoards />
        ) : (
          <WHLKanban
            notice={notice}
            source={source}
            columnNames={columns}
            tasks={tasks}
            users={users}
            filter={shownFilter}
            reloadTasks={reloadTasks}
            disabled={tasksLoading}
            locked={!online}
          />
        )}
      </div>
    </div>
  )
}

export default Home;

// Shown instead of the board when it cannot be displayed (no Sheet ID, or no
// columns could be read), so the page is not just blank.
function BoardNotice({ title, description, action }) {
  const openSettings = useOpenSettings();
  const t = useT();
  // Most notices are fixed in Settings.
  const { label, icon, onClick } = action || { label: t("board.empty.settings"), icon: <SettingsIcon />, onClick: openSettings };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex max-w-xl flex-col gap-2">
        <h2 className="text-xl font-medium text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <MuiButton variant="contained" startIcon={icon} onClick={onClick} sx={{ textTransform: 'none' }}>
        {label}
      </MuiButton>
    </div>
  );
}

// Shown when there are no boards yet: set one up, or bring settings over from a file.
function EmptyBoards() {
  const openSettings = useOpenSettings();
  const openNewBoard = useOpenNewBoard();
  const startImport = useStartImport();
  const t = useT();
  // In the desktop app the first board is normally one kept on this computer.
  const local = localAvailable();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-medium text-foreground">{t("board.empty.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(local ? "board.empty.description.local" : "board.empty.description")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {local && (
          <MuiButton variant="contained" startIcon={<AddIcon />} onClick={openNewBoard} sx={{ textTransform: 'none' }}>
            {t("board.new")}
          </MuiButton>
        )}
        <MuiButton variant={local ? "outlined" : "contained"} startIcon={<SettingsIcon />} onClick={openSettings} sx={{ textTransform: 'none' }}>
          {t(local ? "board.empty.settings.sheet" : "board.empty.settings")}
        </MuiButton>
        <MuiButton variant="outlined" startIcon={<ImportIcon />} onClick={startImport} sx={{ textTransform: 'none' }}>
          {t("board.empty.import")}
        </MuiButton>
      </div>
      <a
        href={TEMPLATE_COPY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {t("board.empty.template")}
      </a>
    </div>
  );
}

export { PRIORITIES };

// Read-only view of a task: an article-style info line, then the full description.
function DescriptionView({ task, jiraLink }) {
  const t = useT();
  const created = createdAtParts(task.createdAt);
  const moved = task.movedAt && task.movedAt !== task.createdAt ? createdAtParts(task.movedAt) : null;
  const parts = [
    task.column && <span key="column">{task.column}</span>,
    task.priority && <PriorityBadge key="priority" priority={task.priority} />,
    <span key="assignee">{task.assignee || t("task.unassigned")}</span>,
    task.issueId && (jiraLink
      ? <a key="issue" href={`${jiraLink}${task.issueId}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline-offset-2 hover:underline">{task.issueId}</a>
      : <span key="issue">{task.issueId}</span>),
    created && <span key="created" data-slot="task-created">{t("task.createdAt", { time: created.full })}</span>,
    moved && <span key="moved" data-slot="task-moved">{t("task.movedAt", { time: moved.full })}</span>,
  ].filter(Boolean);

  return (
    <DialogContent sx={{ pt: 0 }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span aria-hidden="true">·</span>}
            {part}
          </React.Fragment>
        ))}
      </div>
      <hr className="my-4 border-gray-200" />
      <div className="whitespace-pre-wrap break-words text-sm">{task.des}</div>
    </DialogContent>
  );
}

// Priority tag shared by the board cards and the deleted-tasks dialog.
export function PriorityBadge({ priority }) {
  const t = useT();

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
  );
}

// `disabled` (a load or save is running) dims the card; `locked` (offline)
// only stops it from being dragged.
function TaskCard({ task, asHandle, disabled, locked, ...props }) {
  const [, setDialog] = useAtom(dialogAtom);
  const { setDialog: setDefaultDialog } = useDialogStore();
  const t = useT();
  // Only tasks made since creation/move times were kept have them.
  const created = createdAtParts(task.createdAt);
  const moved = task.movedAt && task.movedAt !== task.createdAt ? createdAtParts(task.movedAt) : null;
  const jiraLink = useBoards().currentBoard?.jiraLink || "";

  // Resting the mouse on the card shows its whole title and, when known, when
  // it was created and moved into this column. Not on touch screens (a long
  // press drags the card), not on keyboard focus, not on the copy that follows
  // a drag, and not while the card is pressed, so it never trails a dragged card.
  const [hint, setHint] = useState(false);
  const pressed = React.useRef(false);
  const hintContent = (
    <div data-slot="task-hint">
      <div>{task.title}</div>
      {created && <div data-slot="task-created" style={{ opacity: 0.85 }}>{t("task.createdAt", { time: created.full })}</div>}
      {moved && <div data-slot="task-moved" style={{ opacity: 0.85 }}>{t("task.movedAt", { time: moved.full })}</div>}
    </div>
  );

  // Clicking the description shows all of it read-only, instead of editing the task.
  const openDescription = (e) => {
    e.stopPropagation();
    setDefaultDialog({
      title: task.title,
      open: true, fullWidth: true, maxWidth: "md",
      content: <DescriptionView task={task} jiraLink={jiraLink} />,
    });
  };

  const cardContent = (
    <Tooltip
      title={hintContent}
      placement="top"
      open={hint && !!asHandle}
      onOpen={() => !pressed.current && setHint(true)}
      onClose={() => setHint(false)}
      enterDelay={500}
      enterNextDelay={500}
      disableTouchListener
      disableFocusListener
    >
    <div
      className="rounded-md border bg-card p-3 shadow-xs"
      onClick={() => setDialog({ open: true, task })}
      onPointerDown={() => { pressed.current = true; setHint(false); }}
      onPointerUp={() => { pressed.current = false; }}
      onPointerLeave={() => { pressed.current = false; }}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-2 font-medium text-sm">
            {task.title}
          </span>
          <PriorityBadge priority={task.priority} />
        </div>

        {/* At most two lines; only text that runs past them ends with an ellipsis. */}
        {task?.des ? (
          <div
            role="button"
            tabIndex={0}
            title={t("task.viewDescription")}
            onClick={openDescription}
            onKeyDown={(e) => e.key === "Enter" && openDescription(e)}
            className="line-clamp-2 break-words text-muted-foreground text-xs cursor-pointer underline-offset-2 hover:underline"
          >
            {task.des}
          </div>
        ) : (
          <div className="line-clamp-2 break-words text-muted-foreground text-xs" />
        )}

        <div className="flex items-center justify-between text-muted-foreground text-xs">
          <div className="flex items-center gap-1">
            {/* <Avatar className="size-4">
                <AvatarImage src={task.assigneeAvatar} />
                <AvatarFallback>
                  {task.assignee.charAt(0)}
                </AvatarFallback>
              </Avatar> */}
            <a target='_blank' href={`${jiraLink}${task.issueId}`} onClick={(e) => e.stopPropagation()}>
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
  );

  return (
    <KanbanItem value={task.id} disabled={disabled || locked} className={locked && !disabled ? "opacity-100" : undefined} {...props}>
      {asHandle ? (
        <KanbanItemHandle>{cardContent}</KanbanItemHandle>
      ) : (
        cardContent
      )}
    </KanbanItem>
  );
}

// `total` is given while a filter hides some of the column's tasks.
function TaskColumn({ value, tasks, total, isOverlay, disabled, locked, ...props }) {
  return (
    <KanbanColumn
      value={value}
      {...props}
      className="h-full min-h-0 overflow-hidden rounded-md border bg-muted/60 dark:bg-card p-2.5 shadow-xs"
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-sm">
            {value}
          </span>
          <Badge variant="secondary">{total === undefined ? tasks.length : `${tasks.length} / ${total}`}</Badge>
        </div>

        {/* <KanbanColumnHandle asChild>
          <Button variant="dim" size="sm" mode="icon">
            <GripVertical />
          </Button>
        </KanbanColumnHandle> */}
      </div>

      {/* With a mouse the column keeps its scrolling to itself (the gaps
          around it scroll the page). On touch screens the column covers most of
          the screen, so once it is at its top or bottom (or too short to
          scroll) a swipe on it moves the page. */}
      <KanbanColumnContent
        value={value}
        className="min-h-0 flex-1 overflow-y-auto [@media(pointer:fine)]:overscroll-y-contain p-0.5 pr-1"
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            asHandle={!isOverlay}
            disabled={disabled}
            locked={locked}
          />
        ))}
      </KanbanColumnContent>
    </KanbanColumn>
  );
};

function WHLKanban({ source, columnNames, tasks, users, filter, reloadTasks, disabled, locked, notice }) {
  // What the board shows: column name -> its tasks that pass the filter.
  // Dragging and saving update it right away; reloading then confirms it.
  const [columns, setColumns] = React.useState({});
  const [dialogProps, setDialog] = useAtom(dialogAtom);
  const t = useT();
  const write = useBoardWrite(source);

  const filtering = isFilterActive(filter);
  const matches = React.useMemo(() => taskMatcher(filter), [filter.query, filter.assignee, filter.priority]);

  useEffect(() => {
    const newColumns = {};
    columnNames.forEach((name) => {
      newColumns[name] = tasks.filter((task) => task.column == name && matches(task));
    });
    setColumns(newColumns);
  }, [tasks, columnNames, matches]);

  const totals = React.useMemo(
    () => Object.fromEntries(columnNames.map((name) => [name, tasks.filter((task) => task.column == name).length])),
    [tasks, columnNames]
  );

  // A saved task that the filter hides would seem to vanish, so say why.
  const onSaved = (task) => {
    reloadTasks();
    if (task && filtering && !matches(task)) message.info(translate("filter.savedHidden"), 5);
    else message.success(translate("common.success"));
  };

  const handleMoveTask = ({ event, activeContainer, activeIndex, overContainer, overIndex, previousColumns, columns: nextColumns }) => {
    if (activeContainer === overContainer && activeIndex === overIndex) return;

    const targetTasks = [...nextColumns[overContainer]];
    const newIndex = targetTasks.findIndex(item => item.id === event.active.id);
    if (newIndex < 0) return;

    const movedTask = activeContainer === overContainer
      ? targetTasks[newIndex]
      : { ...targetTasks[newIndex], column: overContainer };

    targetTasks[newIndex] = movedTask;
    const committedColumns = activeContainer === overContainer
      ? nextColumns
      : { ...nextColumns, [overContainer]: targetTasks };
    // The neighbours on screen. With a filter on, tasks it hides may sit
    // between them; the task lands next to the neighbour either way.
    let beforeId = targetTasks[newIndex + 1]?.id;
    let afterId = targetTasks[newIndex - 1]?.id;

    // `tasks` is in stored order. If the task already sits right before
    // beforeId (or right after afterId), Apps Script's moveRows rejects the
    // no-op move, so only send the column change.
    const storedIndex = (id) => tasks.findIndex(item => item.id === id);
    const sourceIndex = storedIndex(movedTask.id);
    const beforeIndex = beforeId ? storedIndex(beforeId) : -1;
    const alreadyInPlace = sourceIndex >= 0 && (beforeIndex >= 0
      ? beforeIndex === sourceIndex + 1
      : !!afterId && storedIndex(afterId) === sourceIndex - 1);
    if (alreadyInPlace) {
      beforeId = undefined;
      afterId = undefined;
    }

    setColumns(committedColumns);
    write.mutate(
      { op: "moveTask", payload: { id: movedTask.id, column: overContainer, beforeId, afterId } },
      {
        onSuccess: () => onSaved(),
        onError: () => setColumns(previousColumns),
      }
    );
  }

  const handleEditTask = (newTask, callback) => {
    let task = newTask;
    let newColumns;

    if (newTask?.id) {
      // 編輯
      newColumns = Object.fromEntries(Object.entries(columns).map(([name, items]) =>
        [name, items.map(f => f?.id == newTask.id ? { ...f, ...newTask } : f).filter(matches)]));
    } else {
      // 新增
      const firstColumn = columnNames[0];
      if (!columns[firstColumn]) {
        message.error(translate("task.noColumns"));
        callback?.(false);
        return;
      }
      task = { ...newTask, id: crypto.randomUUID().split('-')[0], column: firstColumn };
      newColumns = { ...columns, [firstColumn]: columns[firstColumn].concat([task]).filter(matches) };
    }

    write.mutate(
      { op: "saveTask", payload: task },
      {
        onSuccess: () => (setColumns(newColumns), callback?.(true), onSaved(task)),
        onError: () => callback?.(false)
      }
    );
  }

  const handleDelete = (taskId, callback) => {
    const newColumns = Object.fromEntries(Object.entries(columns).map(([name, items]) =>
      [name, items.filter(f => f?.id != taskId)]));

    write.mutate(
      { op: "deleteTask", payload: taskId },
      {
        onSuccess: () => (setColumns(newColumns), callback?.(true), onSaved()),
        onError: () => callback?.(false)
      }
    );
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
            />
          ))}
        </KanbanBoard>

        <KanbanOverlay>
          {({ value, variant }) => {
            if (variant === 'column') {
              const tasks = columns[value] || [];
              return (
                <TaskColumn
                  value={value}
                  tasks={tasks}
                  isOverlay
                />
              );
            }

            const task = Object.values(columns)
              .flat()
              .find((task) => task.id === value);

            if (!task) return null;

            return <TaskCard task={task} />;
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
              onClose={() => setDialog({ open: false })}
              onOk={handleEditTask}
              onDel={handleDelete}
            />
          }
        />
      }
    </>
  );
}

const EditTask = ({
  task = { id: null, title: "", issueId: "", des: "", column: "", priority: "high", assignee: "" },
  users = [],
  onClose, onOk, onDel,
}) => {
  const [data, setData] = useState(task);
  const [loading, setLoading] = useState(false);
  const { setAlert } = useAlertStore();
  const t = useT();

  const handleCallback = (tf) => {
    setLoading(false);
    if (!!tf)
      onClose?.();
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
