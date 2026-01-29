import React, { useEffect, useState } from 'react'
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, Input, TextField, Button as MuiButton } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { GripVertical } from 'lucide-react';
import { atom, useAtom } from 'jotai';
import { getGoogleSheetIssue, getGoogleSheetTask, setGoogleSheetIssue } from '@/apis/account'
import useSnackbarStore from "@/store/snackbar";
import useAlertStore from "@/store/alert";

const COLUMN_TITLES = {
  backlog: 'Backlog',
  inProgress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

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
  const getGoogleSheetIssueApi = useQuery({ queryKey: ["getGoogleSheetIssue"], queryFn: () => getGoogleSheetIssue() });
  const getGoogleSheetTaskApi = useQuery({ queryKey: ["getGoogleSheetTask"], queryFn: () => getGoogleSheetTask() });

  const issues = changeIssue(getGoogleSheetIssueApi?.data?.values || []);
  const tasks = getGoogleSheetTaskApi?.data?.values || [];

  return (
    <div
      style={{ paddingTop: "80px" }}
      className="p-4 grid h-screen grid-rows-[var(--header-height)_1fr_6rem] overflow-x-hidden sm:grid-rows-[var(--header-height)_1fr_var(--header-height)]">
      <WHLKanban tasks={tasks} issues={issues} />
    </div>
  )
}

export default Home;

function TaskCard({ task, asHandle, ...props }) {
  const [, setDialog] = useAtom(dialogAtom);

  const cardContent = (
    <div
      className="rounded-md border bg-card p-3 shadow-xs"
      onClick={() => setDialog({ open: true, task })}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-1 font-medium text-sm">
            {task.title}
          </span>
          <Badge
            variant={
              task.priority === 'high'
                ? 'destructive'
                : task.priority === 'medium'
                  ? 'primary'
                  : 'warning'
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
            <span className="line-clamp-1">
              {task.jiraId}
            </span>
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
    <KanbanItem value={task.id} {...props}>
      {asHandle ? (
        <KanbanItemHandle>{cardContent}</KanbanItemHandle>
      ) : (
        cardContent
      )}
    </KanbanItem>
  );
}

function TaskColumn({ value, tasks, isOverlay, ...props }) {
  return (
    <KanbanColumn
      value={value}
      {...props}
      className="rounded-md border bg-card p-2.5 shadow-xs"
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
        className="flex flex-col gap-2.5 p-0.5"
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            asHandle={!isOverlay}
          />
        ))}
      </KanbanColumnContent>
    </KanbanColumn>
  );
};

const dragAtom = atom(false)
export { dragAtom }

function WHLKanban({ tasks, issues }) {
  const [columns, setColumns] = React.useState({});
  const [isChange, setIsChange] = React.useState(false);
  const [isDragging] = useAtom(dragAtom);
  const [dialogProps, setDialog] = useAtom(dialogAtom);
  const { setSnackMsg } = useSnackbarStore(state => state);

  const setGoogleSheetIssueApi = useMutation({ mutationFn: setGoogleSheetIssue, onSuccess: () => setSnackMsg({ message: "success" }) })

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

  // handle change google sheet
  useEffect(() => {
    if (!!isChange) {
      console.log('handle change google sheet');
      setIsChange(false);

      let newIssues = [];

      Object.keys(columns)?.map(key => {
        let newList = columns[key].map(m => {
          return [m.id, m.title, m.jiraId, m.des, key, m.priority, m.assignee];
        });

        newIssues = newIssues.concat(newList);
      });
      setGoogleSheetIssueApi.mutate({ list: newIssues }, { onSuccess: (d) => console.log(d) });
    }
  }, [isDragging]);

  const handleChangeIssues = (columns) => {
    setIsChange(true);
    setColumns(columns)
  }

  const handleEditTask = (newTask, callback) => {
    if (newTask?.id) {
      // 編輯
      let newColumns = JSON.parse(JSON.stringify(columns));
      Object.keys(columns)?.map(key => {
        newColumns[key] = newColumns[key].map(f => f?.id == newTask?.id ? { ...f, ...newTask } : f);
      });

      let newIssues = [];
      Object.keys(newColumns)?.map(key => {
        let newList = newColumns[key].map(m => {
          return [m.id, m.title, m.jiraId, m.des, key, m.priority, m.assignee];
        });

        newIssues = newIssues.concat(newList);
      });
      setGoogleSheetIssueApi.mutate(
        { list: newIssues },
        { onSuccess: () => (setColumns(newColumns), callback?.(true)), onError: () => callback?.(false) }
      );

    } else {
      // 新增
      let newColumns = JSON.parse(JSON.stringify(columns));
      const newId = crypto.randomUUID().split('-')[0];
      const firstColumn = tasks?.[0]?.[0];
      newColumns[firstColumn] = newColumns[firstColumn].concat([{ ...newTask, id: newId }]);

      let newIssues = [];
      Object.keys(newColumns)?.map(key => {
        let newList = newColumns[key].map(m => {
          return [m.id, m.title, m.jiraId, m.des, key, m.priority, m.assignee];
        });

        newIssues = newIssues.concat(newList);
      });
      setGoogleSheetIssueApi.mutate(
        { list: newIssues },
        { onSuccess: () => (setColumns(newColumns), callback?.(true)), onError: () => callback?.(false) }
      );
    }
  }

  const handleDelete = (taskId, callback) => {
    let newColumns = JSON.parse(JSON.stringify(columns));
    Object.keys(columns)?.map(key => {
      newColumns[key] = newColumns[key].filter(f => f?.id != taskId);
    })

    let newIssues = [];
    Object.keys(newColumns)?.map(key => {
      let newList = newColumns[key].map(m => {
        return [m.id, m.title, m.jiraId, m.des, key, m.priority, m.assignee];
      });

      newIssues = newIssues.concat(newList);
    });
    setGoogleSheetIssueApi.mutate(
      { list: newIssues },
      { onSuccess: () => (setColumns(newColumns), callback?.(true)), onError: () => callback?.(false) }
    );
  }

  return (
    <>
      <Kanban
        value={columns}
        onValueChange={handleChangeIssues}
        getItemValue={(item) => item.id}
      >
        <KanbanBoard className="grid auto-rows-fr grid-cols-4">
          {Object.entries(columns).map(([columnValue, tasks]) => (
            <TaskColumn
              key={columnValue}
              value={columnValue}
              tasks={tasks}
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