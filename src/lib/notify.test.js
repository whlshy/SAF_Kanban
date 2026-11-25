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

test('pauses auto-dismiss while hovered and keeps at least the resume grace period on leave', async () => {
  message.open({ key: 'hover', type: 'info', content: 'Stay', duration: 0.04 })
  message.pause('hover')

  await new Promise((resolve) => setTimeout(resolve, 70))
  assert.equal(current().length, 1, 'toast must stay open while paused')

  // Resume with a 50ms minimum grace period (default is 1000ms in UI).
  message.resume('hover', 50)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(current().length, 1, 'toast must remain during grace period')

  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(current().length, 0, 'toast dismisses after grace period elapses')
})

test('keeps a hovered toast paused when updated in place with a finite duration', async () => {
  message.open({ key: 'upd', type: 'loading', content: 'Checking...', duration: 0 })
  message.pause('upd')
  message.open({ key: 'upd', type: 'success', content: 'Up to date', duration: 0.03 })

  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(current().length, 1, 'updated toast stays open while pointer is still hovering')

  message.resume('upd', 30)
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(current().length, 0)
})
