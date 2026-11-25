import test from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultStore } from 'jotai'
import { message, toastsAtom } from './notify.js'

const current = () => getDefaultStore().get(toastsAtom)

test.afterEach(() => {
  message.destroy()
})

test('pushes and stacks multiple messages', () => {
  message.success('Saved', 0)
  message.error('Failed', 0)
  const items = current()
  assert.equal(items.length, 2)
  assert.equal(items[0].type, 'success')
  assert.equal(items[0].content, 'Saved')
  assert.equal(items[1].type, 'error')
  assert.equal(items[1].content, 'Failed')
})

test('updates an existing message in place when given the same key', () => {
  message.open({ key: 'update', type: 'loading', content: 'Downloading 10%', duration: 0 })
  message.info('Other notice', 0)
  message.open({ key: 'update', type: 'loading', content: 'Downloading 80%', duration: 0 })

  const items = current()
  assert.equal(items.length, 2)
  assert.equal(items[0].key, 'update')
  assert.equal(items[0].content, 'Downloading 80%')
  assert.equal(items[1].content, 'Other notice')
})

test('destroys a single message by key or all messages', () => {
  message.open({ key: 'a', type: 'info', content: 'A', duration: 0 })
  message.open({ key: 'b', type: 'info', content: 'B', duration: 0 })

  message.destroy('a')
  assert.deepEqual(current().map((item) => item.key), ['b'])

  message.destroy()
  assert.deepEqual(current(), [])
})

test('auto-dismisses after duration seconds', async () => {
  message.open({ key: 'short', type: 'info', content: 'Bye', duration: 0.03 })
  assert.equal(current().length, 1)

  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(current().length, 0)
})
