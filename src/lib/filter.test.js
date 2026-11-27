import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_FILTER, UNASSIGNED, UNLABELED, assigneeOptions, isFilterActive, taskMatcher } from './filter.js'

const tasks = [
  { id: '1', title: 'Fix login page', des: 'Safari only', issueId: 'SAF-12', column: 'Todo', priority: 'high', assignee: 'Amy', labels: ['bug', 'Frontend'] },
  { id: '2', title: '更新文件', des: '加上 ＡＰＩ 說明', issueId: '', column: 'Doing', priority: 'low', assignee: '', labels: ['docs'] },
  { id: '3', title: 'Login rate limit', des: '', issueId: 'SAF-20', column: 'Done', priority: 'urgent', assignee: 'Ben' },
]
const ids = (filter) => tasks.filter(taskMatcher({ ...EMPTY_FILTER, ...filter })).map((task) => task.id)

test('an empty filter shows everything', () => {
  assert.equal(isFilterActive(EMPTY_FILTER), false)
  assert.equal(isFilterActive({ ...EMPTY_FILTER, query: '   ' }), false)
  assert.deepEqual(ids({}), ['1', '2', '3'])
})

test('the search looks in title, description, issue ID, assignee and labels', () => {
  assert.deepEqual(ids({ query: 'login' }), ['1', '3'])
  assert.deepEqual(ids({ query: 'safari' }), ['1'])
  assert.deepEqual(ids({ query: 'saf-20' }), ['3'])
  assert.deepEqual(ids({ query: 'ben' }), ['3'])
  assert.deepEqual(ids({ query: 'frontend' }), ['1'])
  assert.deepEqual(ids({ query: 'docs' }), ['2'])
  // The column name is not searched: the columns are already on screen.
  assert.deepEqual(ids({ query: 'doing' }), [])
})

test('every word must match; case and full-width forms are ignored', () => {
  assert.deepEqual(ids({ query: 'LOGIN page' }), ['1'])
  assert.deepEqual(ids({ query: 'login nothing' }), [])
  assert.deepEqual(ids({ query: 'api' }), ['2'])
})

test('assignee, priority and label narrow the search', () => {
  assert.deepEqual(ids({ assignee: 'Amy' }), ['1'])
  assert.deepEqual(ids({ assignee: UNASSIGNED }), ['2'])
  assert.deepEqual(ids({ priority: 'urgent' }), ['3'])
  assert.deepEqual(ids({ label: 'frontend' }), ['1'])
  assert.deepEqual(ids({ label: UNLABELED }), ['3'])
  assert.deepEqual(ids({ query: 'login', assignee: 'Ben' }), ['3'])
  assert.deepEqual(ids({ query: 'login', priority: 'low' }), [])
  assert.equal(isFilterActive({ ...EMPTY_FILTER, assignee: UNASSIGNED }), true)
  assert.equal(isFilterActive({ ...EMPTY_FILTER, label: UNLABELED }), true)
})

test('the assignee choices are the users list plus anyone else with a task', () => {
  assert.deepEqual(assigneeOptions(['Ben', 'Cat'], tasks), ['Ben', 'Cat', 'Amy'])
})
