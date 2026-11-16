import { matchesTerms, searchTerms } from './search.js'

// The board filter: a keyword search plus an assignee and a priority.
// `assignee` is "" (anyone), UNASSIGNED, or a name; `priority` is "" (any) or a value.

// Priority values the app knows; a Sheet may hold others, which are shown as they are.
export const PRIORITIES = ["high", "medium", "low"]

export const UNASSIGNED = "\u0000unassigned"
export const EMPTY_FILTER = { query: "", assignee: "", priority: "" }

export const isFilterActive = (filter) =>
  !!(filter?.query?.trim() || filter?.assignee || filter?.priority)

// Returns a function that tells whether a task passes the filter.
export const taskMatcher = (filter = EMPTY_FILTER) => {
  const terms = searchTerms(filter.query)
  const { assignee, priority } = filter
  return (task) => {
    if (assignee === UNASSIGNED ? !!task.assignee : assignee && task.assignee !== assignee) return false
    if (priority && task.priority !== priority) return false
    return matchesTerms([task.title, task.des, task.issueId, task.assignee], terms)
  }
}

// Names to offer in the assignee filter: the users list, then anyone else who
// has a task (e.g. removed from the users list since).
export const assigneeOptions = (users = [], tasks = []) => [
  ...new Set([...users, ...tasks.map((task) => task.assignee)].filter(Boolean)),
]
