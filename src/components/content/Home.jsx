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
import { atomWithStorage } from "jotai/utils";
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

const sheetIdAtom = atomWithStorage("sheetId", false, undefined, { getOnInit: true });

const dialogAtom = atom({ open: false })
export { dialogAtom, sheetIdAtom }

function Home() {
  const [sheetId] = useAtom(sheetIdAtom);
  const { open } = useDialogStore();

  const getGoogleSheetIssueApi = useQuery({ queryKey: ["getGoogleSheetIssue", sheetId, open], queryFn: () => getGoogleSheetIssue(sheetId), enabled: !!sheetId && !open, refetchOnWindowFocus: true });
  const getGoogleSheetTaskApi = useQuery({ queryKey: ["getGoogleSheetTask", sheetId, open], enabled: !!sheetId && !open, queryFn: () => getGoogleSheetTask(sheetId) });
  const getGoogleSheetUsersApi = useQuery({ queryKey: ["getGoogleSheetUsers", sheetId, open], enabled: !!sheetId && !open, queryFn: () => getGoogleSheetUsers(sheetId) });

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
      <WHLKanban
        tasks={tasks}
        issues={issues}
        users={users}
        reLoadIssue={getGoogleSheetIssueApi.refetch}
        isLoading={getGoogleSheetIssueApi.isFetching}
      />
    </div>
  )
}

export default Home;

function TaskCard({ task, asHandle, disabled, ...props }) {
  const [, setDialog] = useAtom(dialogAtom);
  const jiraLink = localStorage.getItem('jiraLink');



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
            {task.priority}
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

  const setGoogleSheetIssueApi = useMutation({ mutationFn: setGoogleSheetIssue })

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
    const beforeId = targetTasks[newIndex + 1]?.id;
    const afterId = targetTasks[newIndex - 1]?.id;

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
        onSuccess: () => (reLoadIssue(), message.success("success")),
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
          onSuccess: () => (setColumns(newColumns), callback?.(true), reLoadIssue(), message.success("success")),
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
          onSuccess: () => (setColumns(newColumns), callback?.(true), reLoadIssue(), message.success("success")),
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
        onSuccess: () => (setColumns(newColumns), callback?.(true), reLoadIssue(), message.success("success")),
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
        <KanbanBoard className="h-full min-h-0 grid-cols-4 auto-rows-auto">
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

  const handleCallback = (tf) => {
    setLoading(false);
    if (!!tf)
      onClose?.();
  }

  return (
    <>
      <DialogTitle>{task?.id ? 'Edit Task' : 'Create Task'}</DialogTitle>
      <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
        <TextField
          label="Title"
          variant="standard"
          value={data?.title || ""}
          disabled={loading}
          onChange={(e) => setData(d => ({ ...d, title: e.target.value }))}
          fullWidth
          autoFocus
        />
        <TextField
          label="jiraId"
          variant="standard"
          defaultValue={data?.jiraId || ""}
          onChange={(e) => setData(d => ({ ...d, jiraId: e.target.value }))}
          disabled={loading}
          fullWidth
        />
        <TextField
          label="Des"
          variant="standard"
          defaultValue={data?.des || ""}
          onChange={(e) => setData(d => ({ ...d, des: e.target.value }))}
          disabled={loading}
          fullWidth
        />
        <FormControl variant="standard" fullWidth sx={{ mb: 2 }}>
          <InputLabel>Priority</InputLabel>
          <Select
            label="Priority"
            value={data?.priority || ""}
            onChange={(e) => setData(d => ({ ...d, priority: e.target.value }))}
            disabled={loading}
          >
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="low">Low</MenuItem>
          </Select>
        </FormControl>
        <FormControl variant="standard" fullWidth>
          <InputLabel>Assignee</InputLabel>
          <Select
            label="Assignee"
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
                    title: "刪除",
                    content: "確定要刪除？",
                    handleAgree: (callback) => (callback?.(), setLoading(true), onDel(task?.id, handleCallback))
                  })
                }
                variant="contained"
                color="error"
                sx={{ p: "8px 16px", fontWeight: "500", lineHeight: "1.25rem", fontSize: "0.875rem", textTransform: 'none' }}
                disabled={loading}
              >
                Delete
              </MuiButton>
            }
          </div>
          <div>
            <Button onClick={onClose} variant="outlined" disabled={loading}>
              Cancel
            </Button>
            <Button onClick={() => (setLoading(true), onOk(data, handleCallback))} disabled={loading}>
              OK
            </Button>
          </div>
        </div>
      </DialogActions>
    </>
  )
}
