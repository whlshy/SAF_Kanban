import React from 'react'
import { Search as SearchIcon, Close as CloseIcon } from '@mui/icons-material'
import { useT } from '@/i18n'
import { PRIORITIES, UNASSIGNED, assigneeOptions, isFilterActive } from '@/lib/filter'

// Plain inputs styled with the board's own colours, so they follow its theme.
const fieldClass = "h-8 rounded-md border bg-background text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-card dark:[color-scheme:dark]"

// Search box plus assignee and priority filters, shown above the columns.
export default function FilterBar({ filter, onChange, tasks, users, shown }) {
  const t = useT()
  const active = isFilterActive(filter)
  const names = React.useMemo(() => assigneeOptions(users, tasks), [users, tasks])
  // The usual three, then any other value found in the Sheet.
  const priorities = React.useMemo(
    () => [...new Set([...PRIORITIES, ...tasks.map((task) => task.priority).filter(Boolean)])],
    [tasks]
  )

  return (
    <div data-slot="filter-bar" className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
      <div className="relative min-w-0 basis-full sm:max-w-md sm:flex-1 sm:basis-64">
        <SearchIcon sx={{ fontSize: 16 }} className="pointer-events-none absolute left-2.5 top-2 text-muted-foreground" />
        <input
          type="search"
          autoFocus
          value={filter.query}
          onChange={(e) => onChange({ query: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && filter.query && (e.stopPropagation(), onChange({ query: "" }))}
          placeholder={t("filter.search")}
          aria-label={t("filter.search")}
          className={`${fieldClass} w-full pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden`}
        />
        {filter.query && (
          <button
            type="button"
            onClick={() => onChange({ query: "" })}
            aria-label={t("filter.clearSearch")}
            title={t("filter.clearSearch")}
            className="absolute right-1 top-1 flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </button>
        )}
      </div>
      <select
        value={filter.assignee}
        onChange={(e) => onChange({ assignee: e.target.value })}
        aria-label={t("task.assignee")}
        className={`${fieldClass} min-w-0 flex-1 px-2 sm:w-40 sm:flex-none`}
      >
        <option value="">{t("filter.anyAssignee")}</option>
        <option value={UNASSIGNED}>{t("task.unassigned")}</option>
        {names.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <select
        value={filter.priority}
        onChange={(e) => onChange({ priority: e.target.value })}
        aria-label={t("task.priority")}
        className={`${fieldClass} min-w-0 flex-1 px-2 sm:w-36 sm:flex-none`}
      >
        <option value="">{t("filter.anyPriority")}</option>
        {priorities.map((priority) => (
          <option key={priority} value={priority}>
            {PRIORITIES.includes(priority) ? t(`priority.${priority}`) : priority}
          </option>
        ))}
      </select>
      {active && (
        <div className="flex basis-full items-center gap-2 text-xs text-muted-foreground sm:basis-auto">
          <span data-slot="filter-count" className="whitespace-nowrap tabular-nums">
            {t("filter.count", { shown, total: tasks.length })}
          </span>
          <button
            type="button"
            onClick={() => onChange({ query: "", assignee: "", priority: "" })}
            className="rounded px-1.5 py-1 text-foreground underline-offset-2 hover:underline"
          >
            {t("filter.clear")}
          </button>
        </div>
      )}
    </div>
  )
}
