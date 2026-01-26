import React, { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import { useNavigate } from 'react-router-dom';
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
import { getGoogleSheetIssue, getGoogleSheetTask, setGoogleSheetIssue } from '@/apis/account'

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


function Home() {
  const getGoogleSheetIssueApi = useQuery({ queryKey: ["getGoogleSheetIssue"], queryFn: () => getGoogleSheetIssue() });
  const getGoogleSheetTaskApi = useQuery({ queryKey: ["getGoogleSheetTask"], queryFn: () => getGoogleSheetTask() });

  const issues = changeIssue(getGoogleSheetIssueApi?.data?.values || []);
  const tasks = getGoogleSheetTaskApi?.data?.values || [];

  return (
    <div className="p-4 grid h-screen grid-rows-[var(--header-height)_1fr_6rem] overflow-x-hidden sm:grid-rows-[var(--header-height)_1fr_var(--header-height)]">
      <WHLKanban tasks={tasks} issues={issues} />
    </div>
  )
}

export default Home;

function TaskCard({ task, asHandle, ...props }) {

  const cardContent = (
    <div className="rounded-md border bg-card p-3 shadow-xs">
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

        <div className="flex items-center justify-between text-muted-foreground text-xs">
          {task.jiraId && (
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
          )}

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

        <KanbanColumnHandle asChild>
          <Button variant="dim" size="sm" mode="icon">
            <GripVertical />
          </Button>
        </KanbanColumnHandle>
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
}

function WHLKanban({ tasks, issues }) {
  const [columns, setColumns] = React.useState({});

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

  const handleChangeIssues = (columns) => {

    let newIssues = [];

    Object.keys(columns)?.map(key => {
      let newList = columns[key].map(m => {
        return [m.id, m.title, m.jiraId, m.des, m.task, m.priority, m.assignee];
      });

      newIssues = newIssues.concat(newList);
    });


    setGoogleSheetIssueApi.mutate({ list: newIssues }, { onSuccess: (d) => console.log(d) });
    setColumns(columns)
  }

  return (
    <Kanban
      value={columns}
      onValueChange={handleChangeIssues}
      getItemValue={(item) => item.id}
    >
      <KanbanBoard className="grid auto-rows-fr grid-cols-3">
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
  );
}