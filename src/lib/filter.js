import { matchesTerms, searchTerms } from './search.js'
import { parseLabels } from './labels.js'

// The board filter: a keyword search plus assignee, priority and label.
// `assignee` is "" (anyone), UNASSIGNED, or a name;
// `priority` is "" (any) or a value;
// `label` is "" (any), UNLABELED, or a label name (matched case-insensitively).

// Priority values the app knows; a Sheet may hold others, which are shown as they are.
export const PRIORITIES = ["high", "medium", "low"]

export const UNASSIGNED = "\u0000unassigned"
export const UNLABELED = "\u0000unlabeled"
export const EMPTY_FILTER = { query: "", assignee: "", priority: "", label: "" }

export const isFilterActive = (filter) =>
  !!(filter?.query?.trim() || filter?.assignee || filter?.priority || filter?.label)

// Returns a function that tells whether a task passes the filter.
export const taskMatcher = (filter = EMPTY_FILTER) => {
  const terms = searchTerms(filter.query)
  const { assignee, priority, label } = filter
  const wantedLabel = label && label !== UNLABELED ? label.trim().toLowerCase() : ""
  return (task) => {
    if (assignee === UNASSIGNED ? !!task.assignee : assignee && task.assignee !== assignee) return false
    if (priority && task.priority !== priority) return false
    const labels = parseLabels(task.labels)
    if (label === UNLABELED) {
      if (labels.length > 0) return false
    } else if (wantedLabel) {
      if (!labels.some((item) => item.toLowerCase() === wantedLabel)) return false
    }
    return matchesTerms([task.title, task.des, task.issueId, task.assignee, ...labels], terms)
  }
}

// Names to offer in the assignee filter: the users list, then anyone else who
// has a task (e.g. removed from the users list since).
export const assigneeOptions = (users = [], tasks = []) => [
  ...new Set([...users, ...tasks.map((task) => task.assignee)].filter(Boolean)),
]
