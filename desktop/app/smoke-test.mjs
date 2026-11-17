// Starts the built desktop app and checks that it works the way an installed
// copy is used: the window's page and the API are served, and an AI app can
// start `mcp` as a program and reach the boards through it.
//
//   node desktop/app/smoke-test.mjs <path to saf-kanban(.exe)>

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exe = process.argv[2]
if (!exe) {
  console.error('Usage: node smoke-test.mjs <path to saf-kanban>')
  process.exit(2)
}

const port = 41977
const base = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'saf-kanban-smoke-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}

// Sends MCP messages to `saf-kanban mcp` the way an AI app does: one JSON
// message per line on its standard input, answers on its standard output.
function mcp(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['mcp', '--data-dir', dataDir], { stdio: ['pipe', 'pipe', 'inherit'] })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`no answer from mcp; got: ${output}`))
    }, 30000)
    child.stdout.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    child.on('close', () => {
      clearTimeout(timer)
      try {
        resolve(output.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line)))
      } catch (error) {
        reject(new Error(`mcp printed something that isn't JSON: ${output}`))
      }
    })
    child.stdin.end(messages.map((message) => JSON.stringify(message)).join('\n') + '\n')
  })
}

const app = spawn(exe, ['--hidden', '--data-dir', dataDir, '--port', String(port)], { stdio: 'inherit' })
let exited = false
app.on('exit', () => { exited = true })
app.on('error', (error) => { exited = true; console.error(error.message) })

try {
  // The server is up within a moment; a slow machine gets a minute.
  let page = ''
  for (let tries = 0; tries < 60 && !page && !exited; tries++) {
    page = await fetch(base).then((answer) => answer.text(), () => '')
    if (!page) await sleep(1000)
  }
  check('the app serves its page', page.includes('id="root"'), page.slice(0, 200))
  check('the page is given the API token', page.includes('__SAF_KANBAN_LOCAL__'))

  const script = page.match(/src="([^"]+\.js)"/)?.[1]
  const scriptAnswer = script && await fetch(new URL(script, base))
  check('the page\'s script is built into the app', Boolean(scriptAnswer?.ok)
    && scriptAnswer.headers.get('content-type').includes('javascript'), String(script))

  const token = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8')).token
  const api = (path) => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } })
  check('the API answers with the token', (await api('/api/info')).ok)
  check('the API refuses without it', (await fetch(base + '/api/info')).status === 401)

  const connection = await (await api('/api/connection')).json()
  check('the app tells AI apps which program to start', typeof connection.executable === 'string'
    && connection.executable.toLowerCase().includes('saf-kanban'), connection.executable)

  const answers = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_board', arguments: { title: 'Smoke test' } } },
  ])
  const answer = (id) => answers.find((each) => each.id === id)?.result
  check('mcp: starts as a program and answers', answer(1)?.serverInfo?.name === 'saf-kanban', JSON.stringify(answers))
  check('mcp: lists its tools', answer(2)?.tools?.length >= 10)
  check('mcp: a tool call reaches the running app', answer(3)?.isError === false, JSON.stringify(answer(3)))

  const boards = await (await api('/api/boards')).json()
  check('the board made through mcp is in the app', boards.some((board) => board.title === 'Smoke test'), JSON.stringify(boards))

  // The window is made after the server starts; if it couldn't be, the app
  // has stopped by now.
  await sleep(3000)
  check('the app is still running', !exited)
} catch (error) {
  check('no errors', false, error.stack)
} finally {
  app.kill()
  await sleep(500)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log(failed ? `${failed} check(s) failed` : 'All checks passed')
process.exit(failed ? 1 : 0)
