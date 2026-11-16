import test from 'node:test'
import assert from 'node:assert/strict'
import { rowsToColumns, rowsToTasks, rowsToUsers, taskToScript } from './sheetFormat.js'

test('kanban rows become tasks, in row order', () => {
  const tasks = rowsToTasks([
    ['a1', 'Write docs', 'SAF-1', 'First line\nSecond line', 'Todo', 'high', 'Amy'],
    ['b2', 'Short row', '', '', 'Done'],
  ])
  assert.deepEqual(tasks[0], {
    id: 'a1', title: 'Write docs', issueId: 'SAF-1', des: 'First line\nSecond line', column: 'Todo', priority: 'high', assignee: 'Amy',
  })
  // The Sheets API leaves out trailing empty cells.
  assert.equal(tasks[1].column, 'Done')
  assert.equal(tasks[1].assignee, undefined)
  assert.deepEqual(rowsToTasks(), [])
})

test('blank rows in the columns sheet are skipped', () => {
  assert.deepEqual(rowsToColumns([['Todo'], [], [''], ['Doing', 'note'], ['Done']]), ['Todo', 'Doing', 'Done'])
})

test('users rows may be [name] or the older [id, name]', () => {
  assert.deepEqual(rowsToUsers([['Amy'], ['u2', 'Ben'], [' Amy '], [], ['']]), ['Amy', 'Ben'])
})

test('a task is sent to the Apps Script under the field names it reads', () => {
  const task = { id: 'a1', title: 'T', issueId: 'SAF-1', des: 'D', column: 'Todo', priority: 'low', assignee: 'Amy' }
  assert.deepEqual(taskToScript(task), {
    id: 'a1', title: 'T', jiraId: 'SAF-1', des: 'D', task: 'Todo', priority: 'low', assignee: 'Amy',
  })
  // What is read back from the Sheet is the same task.
  const row = ['id', 'title', 'jiraId', 'des', 'task', 'priority', 'assignee'].map((field) => taskToScript(task)[field])
  assert.deepEqual(rowsToTasks([row])[0], task)
})
