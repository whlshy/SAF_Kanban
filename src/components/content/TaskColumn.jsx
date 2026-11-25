import React from 'react'
import { Badge } from '@/components/ui/badge'
import { KanbanColumn, KanbanColumnContent } from '@/components/ui/kanban'
import TaskCard from './TaskCard'

// `total` is given while a filter hides some of the column's tasks.
export default function TaskColumn({ value, tasks, total, isOverlay, disabled, locked, ...props }) {
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
  )
}
