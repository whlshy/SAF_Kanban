// Starts the built desktop app and checks that it works the way an installed
// copy is used: the window's page and the API are served, an AI app can start
// `mcp` as a program, and the command line next to the app works on the same
// boards, with the app showing its changes. Then, with the app closed, the
// command line and `mcp` still work.
//
//   node desktop/app/smoke-test.mjs <path to saf-kanban(.exe)>

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const exe = process.argv[2] && resolve(process.argv[2])
if (!exe) {
  console.error('Usage: node smoke-test.mjs <path to saf-kanban>')
  process.exit(2)
}

const cli = join(dirname(exe), `saf-kanban-cli${process.platform === 'win32' ? '.exe' : ''}`)
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

// Runs the command line; resolves with { code, stdout, stderr }.
const run = (args, env = {}) => new Promise((resolve) => {
  execFile(cli, [...args, '--data-dir', dataDir], { encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
    resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr })
  })
})

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
  const infoRes = await api('/api/info')
  check('the API answers with the token', infoRes.ok)
  const info = infoRes.ok ? await infoRes.json() : null
  check('the installed app exposes the in-app updater', info?.canUpdate === true, JSON.stringify(info))
  const updateRes = await api('/api/update')
  const updateState = updateRes.ok ? await updateRes.json() : null
  check('the updater status endpoint responds', updateRes.ok && typeof updateState?.currentVersion === 'string', JSON.stringify(updateState))
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
  check('mcp: a tool call works', answer(3)?.isError === false, JSON.stringify(answer(3)))

  const boards = await (await api('/api/boards')).json()
  check('the app sees the board made through mcp', boards.some((board) => board.title === 'Smoke test'), JSON.stringify(boards))

  // ---- the command line, while the app runs ----
  check('the command line is installed next to the app', existsSync(cli), cli)
  check('the app shows where the command line is', connection.cli?.toLowerCase() === cli.toLowerCase(), connection.cli)
  const listed = await run(['boards'])
  check('command line: sees the board made through mcp', listed.code === 0 && listed.stdout.includes('Smoke test'), JSON.stringify(listed))

  // The app tells its window about changes other programs make.
  const events = await fetch(`${base}/api/events?token=${token}`)
  const reader = events.body.getReader()
  const heard = (async () => {
    let text = ''
    const until = Date.now() + 10000
    while (Date.now() < until && !text.includes('"kind":"board"')) {
      const { value, done } = await Promise.race([reader.read(), sleep(10000).then(() => ({ done: true }))])
      if (done) break
      text += new TextDecoder().decode(value)
    }
    return text
  })()
  await sleep(300)
  const added = await run(['add', 'Smoke test', 'Added from the command line', '--priority', 'high'])
  check('command line: adds a task', added.code === 0 && added.stdout.startsWith('Added ['), JSON.stringify(added))
  check('the app notices the change and tells its window', (await heard).includes('"kind":"board"'))
  reader.cancel().catch(() => {})
  const smoke = (await (await api('/api/boards')).json()).find((board) => board.title === 'Smoke test')
  const tasks = await (await api(`/api/boards/${smoke.id}/tasks`)).json()
  check('the app reads the task the command line added', tasks.some((task) => task.title === 'Added from the command line'), JSON.stringify(tasks))

  const skill = await run(['skill'])
  check('command line: prints the skill with its own path', skill.code === 0 && skill.stdout.includes(cli.replaceAll('\\', '/')), skill.stdout.slice(0, 600))
  // A home folder of its own, so the build machine's isn't touched.
  const home = join(dataDir, 'home')
  const installed = await run(['skill', '--install'], { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '' })
  const skillFiles = [
    join(home, '.agents', 'skills', 'saf-kanban', 'SKILL.md'),
    join(home, '.claude', 'skills', 'saf-kanban', 'SKILL.md'),
    join(home, '.gemini', 'config', 'skills', 'saf-kanban', 'SKILL.md'),
  ]
  check('command line: installs the skill for AI agents, Claude Code and Antigravity', installed.code === 0
    && skillFiles.every((file) => existsSync(file) && readFileSync(file, 'utf8').includes(cli.replaceAll('\\', '/'))), JSON.stringify(installed))
  const wrong = await run(['move', 'Smoke test', 'no-such-task', 'Todo'])
  check('command line: a mistake fails with a reason', wrong.code === 1 && wrong.stderr.includes('TASK_NOT_FOUND'), JSON.stringify(wrong))

  // The window is made after the server starts; if it couldn't be, the app
  // has stopped by now.
  await sleep(3000)
  check('the app is still running', !exited)

  // ---- with the app closed ----
  app.kill()
  await sleep(1500)
  const offline = await run(['add', 'Smoke test', 'Added with the app closed'])
  check('command line: works with the app closed', offline.code === 0, JSON.stringify(offline))
  const offlineId = offline.stdout.match(/\[([^\]]+)\]/)?.[1]
  const removed = await run(['delete', 'Smoke test', offlineId])
  const back = await run(['restore', 'Smoke test', offlineId])
  check('command line: a deleted task can be restored as it was', removed.code === 0 && back.code === 0
    && back.stdout.startsWith(`Restored [${offlineId}] Added with the app closed`), JSON.stringify([removed, back]))
  const later = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-test', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_tasks', arguments: { board: smoke.id } } },
  ])
  const found = later.find((each) => each.id === 2)?.result
  check('mcp: works with the app closed', found?.isError === false && found.content[0].text.includes('Added with the app closed'), JSON.stringify(found))
} catch (error) {
  check('no errors', false, error.stack)
} finally {
  app.kill()
  await sleep(500)
  rmSync(dataDir, { recursive: true, force: true })
}

console.log(failed ? `${failed} check(s) failed` : 'All checks passed')
process.exit(failed ? 1 : 0)
