import React, { useEffect, useState } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, TextField, Button as MuiButton, Tooltip, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { useBoards } from '@/store/boards';
import { t as translate, useT } from '@/i18n';
import { Settings as SettingsIcon, FileUploadOutlined as ImportIcon } from '@mui/icons-material';
import { useOpenSettings } from '@/components/header/SettingDialog';
import { useStartImport } from '@/components/header/BoardTransfer';
import { getGoogleSheetIssue, getGoogleSheetTask, setGoogleSheetIssue, getGoogleSheetUsers } from '@/apis/account';
import { useDialogStore, useAlertStore } from '@/store';
import { Checkbox } from 'antd';

const changeIssue = (rows) => {
  return rows.map(row => ({
    id: row[0],
    title: row[1],
    jiraId: row[2],
    des: row[3],
    task: row[4],
    priority: row[5],
    assignee: row[6],
  }));
}

const dialogAtom = atom({ open: false })
export { dialogAtom }

function Home() {
  const { currentBoard } = useBoards();
  const boardId = currentBoard?.id;
  const sheetId = currentBoard?.sheetId;
  const { open } = useDialogStore();

  const getGoogleSheetIssueApi = useQuery({ queryKey: ["getGoogleSheetIssue", boardId, sheetId, open], queryFn: () => getGoogleSheetIssue(sheetId), enabled: !!sheetId && !open, refetchOnWindowFocus: true });
  const getGoogleSheetTaskApi = useQuery({ queryKey: ["getGoogleSheetTask", boardId, sheetId, open], enabled: !!sheetId && !open, queryFn: () => getGoogleSheetTask(sheetId) });
  const getGoogleSheetUsersApi = useQuery({ queryKey: ["getGoogleSheetUsers", boardId, sheetId, open], enabled: !!sheetId && !open, queryFn: () => getGoogleSheetUsers(sheetId) });

  const issues = React.useMemo(
    () => changeIssue(getGoogleSheetIssueApi?.data?.values || []),
    [getGoogleSheetIssueApi?.data?.values]
  );
  const tasks = React.useMemo(
    () => getGoogleSheetTaskApi?.data?.values || [],
    [getGoogleSheetTaskApi?.data?.values]
  );
  const users = React.useMemo(
    () => getGoogleSheetUsersApi?.data?.values || [],
    [getGoogleSheetUsersApi?.data?.values]
  );

  return (
    <div
      style={{ paddingTop: "80px" }}
      className="h-screen min-h-0 overflow-hidden p-4">
      {currentBoard ? (
        <WHLKanban
          tasks={tasks}
          issues={issues}
          users={users}
          reLoadIssue={getGoogleSheetIssueApi.refetch}
          isLoading={getGoogleSheetIssueApi.isFetching}
        />
      ) : (
        <EmptyBoards />
      )}
    </div>
  )
}

export default Home;

// Shown when there are no boards yet: set one up, or bring settings over from a file.
function EmptyBoards() {
  const openSettings = useOpenSettings();
  const startImport = useStartImport();
  const t = useT();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-medium text-foreground">{t("board.empty.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("board.empty.description")}
        </p>
      </div>
      <div className="flex gap-3">
        <MuiButton variant="contained" startIcon={<SettingsIcon />} onClick={openSettings} sx={{ textTransform: 'none' }}>
          {t("board.empty.settings")}
        </MuiButton>
        <MuiButton variant="outlined" startIcon={<ImportIcon />} onClick={startImport} sx={{ textTransform: 'none' }}>
          {t("board.empty.import")}
        </MuiButton>
      </div>
    </div>
  );
}

const PRIORITIES = ["high", "medium", "low"];

function TaskCard({ task, asHandle, disabled, ...props }) {
  const [, setDialog] = useAtom(dialogAtom);
  const t = useT();
  const jiraLink = useBoards().currentBoard?.jiraLink || "";



  const cardContent = (
    <div
      className="rounded-md border bg-card p-3 shadow-xs"
      onClick={() => setDialog({ open: true, task })}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <Tooltip title={task.title} placement='top'>
            <span className="line-clamp-2 font-medium text-sm">
              {task.title}
            </span>
          </Tooltip>
          <Badge
            variant={
              task.priority === 'high'
                ? 'destructive'
                : task.priority === 'medium'
                  ? 'secondary'
                  : 'primary'
            }
            appearance="outline"
            className="pointer-events-none h-5 rounded-sm px-1.5 text-[11px] capitalize shrink-0"
          >
            {PRIORITIES.includes(task.priority) ? t(`priority.${task.priority}`) : task.priority}
          </Badge>
        </div>

        <div className="flex items-center text-muted-foreground text-xs">
          {task?.des || ""}
        </div>

        <div className="flex items-center justify-between text-muted-foreground text-xs">
          <div className="flex items-center gap-1">
            {/* <Avatar className="size-4">
                <AvatarImage src={task.assigneeAvatar} />
                <AvatarFallback>
                  {task.assignee.charAt(0)}
                </AvatarFallback>
              </Avatar> */}
            <a target='_blank' href={`${jiraLink}${task.jiraId}`} onClick={(e) => e.stopPropagation()}>
              <span className="line-clamp-1">
                {task.jiraId}
              </span>
            </a>
          </div>

          {task.assignee && (
            <time className="text-[10px] tabular-nums whitespace-nowrap">
              {task.assignee}
            </time>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <KanbanItem value={task.id} disabled={disabled} {...props}>
      {asHandle ? (
        <KanbanItemHandle>{cardContent}</KanbanItemHandle>
      ) : (
        cardContent
      )}
    </KanbanItem>
  );
}

function TaskColumn({ value, tasks, isOverlay, disabled, ...props }) {
  return (
    <KanbanColumn
      value={value}
      {...props}
      className="h-full min-h-0 overflow-hidden rounded-md border bg-card p-2.5 shadow-xs"
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-sm">
            {value}
          </span>
          <Badge variant="secondary">{tasks.length}</Badge>
        </div>

        {/* <KanbanColumnHandle asChild>
          <Button variant="dim" size="sm" mode="icon">
            <GripVertical />
          </Button>
        </KanbanColumnHandle> */}
      </div>

      <KanbanColumnContent
        value={value}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-0.5 pr-1"
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            asHandle={!isOverlay}
            disabled={disabled}
          />
        ))}
      </KanbanColumnContent>
    </KanbanColumn>
  );
};

function WHLKanban({ tasks, issues, users, reLoadIssue, isLoading }) {
  const [columns, setColumns] = React.useState({});
  const [dialogProps, setDialog] = useAtom(dialogAtom);
  const t = useT();

  const { currentBoard } = useBoards();
  const setGoogleSheetIssueApi = useMutation({
    mutationFn: (params) => setGoogleSheetIssue({ ...params, scriptId: currentBoard?.scriptId }),
  })

  useEffect(() => {
    if (Array.isArray(issues) && Array.isArray(tasks)) {
      let newColumns = {};
      tasks?.map((task) => {
        let t = task[0];
        newColumns[t] = issues?.filter(i => i.task == t);
      });

      setColumns(newColumns);
    }
  }, [issues, tasks]);

  const handleMoveTask = ({ event, activeContainer, activeIndex, overContainer, overIndex, previousColumns, columns: nextColumns }) => {
    if (activeContainer === overContainer && activeIndex === overIndex) return;

    const targetTasks = [...nextColumns[overContainer]];
    const newIndex = targetTasks.findIndex(item => item.id === event.active.id);
    if (newIndex < 0) return;

    const movedTask = activeContainer === overContainer
      ? targetTasks[newIndex]
      : { ...targetTasks[newIndex], task: overContainer };

    targetTasks[newIndex] = movedTask;
    const committedColumns = activeContainer === overContainer
      ? nextColumns
      : { ...nextColumns, [overContainer]: targetTasks };
    let beforeId = targetTasks[newIndex + 1]?.id;
    let afterId = targetTasks[newIndex - 1]?.id;

    // `issues` is in sheet row order. If the row already sits right before
    // beforeId (or right after afterId), Apps Script's moveRows rejects the
    // no-op move, so only send the status change.
    const sheetIndex = (id) => issues.findIndex(item => item.id === id);
    const sourceIndex = sheetIndex(movedTask.id);
    const beforeIndex = beforeId ? sheetIndex(beforeId) : -1;
    const alreadyInPlace = sourceIndex >= 0 && (beforeIndex >= 0
      ? beforeIndex === sourceIndex + 1
      : !!afterId && sheetIndex(afterId) === sourceIndex - 1);
    if (alreadyInPlace) {
      beforeId = undefined;
      afterId = undefined;
    }

    setColumns(committedColumns);
    setGoogleSheetIssueApi.mutate(
      {
        action: "move",
        id: movedTask.id,
        status: overContainer,
        beforeId,
        afterId,
      },
      {
        onSuccess: () => (reLoadIssue(), message.success(translate("common.success"))),
        onError: () => setColumns(previousColumns),
      }
    );
  }

  const handleEditTask = (newTask, callback) => {
    if (newTask?.id) {
      // 編輯
      let newColumns = JSON.parse(JSON.stringify(columns));
      Object.keys(columns)?.map(key => {
        newColumns[key] = newColumns[key].map(f => f?.id == newTask?.id ? { ...f, ...newTask } : f);
      });

      setGoogleSheetIssueApi.mutate(
        { action: "upsert", task: newTask },
        {
          onSuccess: () => (setColumns(newColumns), callback?.(true), reLoadIssue(), message.success(translate("common.success"))),
          onError: () => callback?.(false)
        }
      );

    } else {
      // 新增
      let newColumns = JSON.parse(JSON.stringify(columns));
      const newId = crypto.randomUUID().split('-')[0];
      const firstColumn = tasks?.[0]?.[0];
      const task = { ...newTask, id: newId, task: firstColumn };
      newColumns[firstColumn] = newColumns[firstColumn].concat([task]);

      setGoogleSheetIssueApi.mutate(
        { action: "upsert", task },
        {
          onSuccess: () => (setColumns(newColumns), callback?.(true), reLoadIssue(), message.success(translate("common.success"))),
          onError: () => callback?.(false)
        }
      );
    }
  }

  const handleDelete = (taskId, callback) => {
    let newColumns = JSON.parse(JSON.stringify(columns));
    Object.keys(columns)?.map(key => {
      newColumns[key] = newColumns[key].filter(f => f?.id != taskId);
    })

    setGoogleSheetIssueApi.mutate(
      { action: "delete", id: taskId },
      {
        onSuccess: () => (setColumns(newColumns), callback?.(true), reLoadIssue(), message.success(translate("common.success"))),
        onError: () => callback?.(false)
      }
    );
  }

  return (
    <>
      <Kanban
        value={columns}
        onValueChange={setColumns}
        onMove={handleMoveTask}
        getItemValue={(item) => item.id}
        className="h-full min-h-0"
      >
        <KanbanBoard
          className="h-full min-h-0 auto-rows-auto overflow-x-auto"
          // One row with a column per status; scroll sideways once they no longer fit.
          style={{ gridTemplateColumns: `repeat(${Math.max(Object.keys(columns).length, 1)}, minmax(240px, 1fr))` }}
        >
          {Object.entries(columns).map(([columnValue, tasks]) => (
            <TaskColumn
              key={columnValue}
              value={columnValue}
              tasks={tasks}
              disabled={isLoading || setGoogleSheetIssueApi.isPending}
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
      </Kanban>
      {!!dialogProps.open &&
        <Dialog
          open={dialogProps.open}
          onClose={(event, reason) => {
            if (reason !== 'backdropClick') {
              // 只有不是點擊外部的關閉，才去關閉對話框
              // 可以使用 esc
              setDialog({ open: false });
            }
          }}
          fullWidth={true}
          maxWidth="lg"
        >
          <EditTask
            task={dialogProps.task}
            users={users}
            onClose={() => setDialog({ open: false })}
            onOk={handleEditTask}
            onDel={handleDelete}
          />
        </Dialog>
      }
    </>
  );
}

const EditTask = ({
  task = { id: null, title: "", jiraId: "", des: "", task: "", priority: "high", assignee: "" },
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
      <DialogTitle>{task?.id ? t("task.edit") : t("task.create")}</DialogTitle>
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
          defaultValue={data?.jiraId || ""}
          onChange={(e) => setData(d => ({ ...d, jiraId: e.target.value }))}
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
          <InputLabel>{t("task.assignee")}</InputLabel>
          <Select
            label={t("task.assignee")}
            value={data?.assignee || ""}
            onChange={(e) => setData(d => ({ ...d, assignee: e.target.value }))}
            disabled={loading}
          >
            {users.map(user => (
              <MenuItem key={user[0]} value={user[1]}>
                {user[1]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <div className='flex-1 flex items-center justify-between'>
          <div>
            {task?.id &&
              <MuiButton
                onClick={() =>
                  setAlert({
                    title: t("task.delete"),
                    content: t("task.deleteConfirm"),
                    handleAgree: (callback) => (callback?.(), setLoading(true), onDel(task?.id, handleCallback))
                  })
                }
                variant="contained"
                color="error"
                sx={{ p: "8px 16px", fontWeight: "500", lineHeight: "1.25rem", fontSize: "0.875rem", textTransform: 'none' }}
                disabled={loading}
              >
                {t("task.delete")}
              </MuiButton>
            }
          </div>
          <div>
            <Button onClick={onClose} variant="outlined" disabled={loading}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => (setLoading(true), onOk(data, handleCallback))} disabled={loading}>
              {t("task.ok")}
            </Button>
          </div>
        </div>
      </DialogActions>
    </>
  )
}
