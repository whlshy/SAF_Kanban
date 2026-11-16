import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_FILTER, UNASSIGNED, assigneeOptions, isFilterActive, taskMatcher } from './filter.js'

const tasks = [
  { id: '1', title: 'Fix login page', des: 'Safari only', issueId: 'SAF-12', column: 'Todo', priority: 'high', assignee: 'Amy' },
  { id: '2', title: '更新文件', des: '加上 ＡＰＩ 說明', issueId: '', column: 'Doing', priority: 'low', assignee: '' },
  { id: '3', title: 'Login rate limit', des: '', issueId: 'SAF-20', column: 'Done', priority: 'urgent', assignee: 'Ben' },
]
const ids = (filter) => tasks.filter(taskMatcher({ ...EMPTY_FILTER, ...filter })).map((task) => task.id)

test('an empty filter shows everything', () => {
  assert.equal(isFilterActive(EMPTY_FILTER), false)
  assert.equal(isFilterActive({ ...EMPTY_FILTER, query: '   ' }), false)
  assert.deepEqual(ids({}), ['1', '2', '3'])
})

test('the search looks in title, description, issue ID and assignee', () => {
  assert.deepEqual(ids({ query: 'login' }), ['1', '3'])
  assert.deepEqual(ids({ query: 'safari' }), ['1'])
  assert.deepEqual(ids({ query: 'saf-20' }), ['3'])
  assert.deepEqual(ids({ query: 'ben' }), ['3'])
  // The column name is not searched: the columns are already on screen.
  assert.deepEqual(ids({ query: 'doing' }), [])
})

test('every word must match; case and full-width forms are ignored', () => {
  assert.deepEqual(ids({ query: 'LOGIN page' }), ['1'])
  assert.deepEqual(ids({ query: 'login nothing' }), [])
  assert.deepEqual(ids({ query: 'api' }), ['2'])
})

test('assignee and priority narrow the search', () => {
  assert.deepEqual(ids({ assignee: 'Amy' }), ['1'])
  assert.deepEqual(ids({ assignee: UNASSIGNED }), ['2'])
  assert.deepEqual(ids({ priority: 'urgent' }), ['3'])
  assert.deepEqual(ids({ query: 'login', assignee: 'Ben' }), ['3'])
  assert.deepEqual(ids({ query: 'login', priority: 'low' }), [])
  assert.equal(isFilterActive({ ...EMPTY_FILTER, assignee: UNASSIGNED }), true)
})

test('the assignee choices are the users list plus anyone else with a task', () => {
  assert.deepEqual(assigneeOptions(['Ben', 'Cat'], tasks), ['Ben', 'Cat', 'Amy'])
})
