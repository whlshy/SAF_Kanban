// Builds the command line (saf-kanban-cli) and puts it where the Tauri build
// takes it from (bundle.externalBin in tauri.conf.json): binaries/, with the
// target triple in its name. The installer puts it next to saf-kanban.exe.
//
//   node desktop/app/prepare-cli.mjs   (part of `npm run build:app`)

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = join(here, '..')
const triple = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (\S+)$/m)[1]
const exe = process.platform === 'win32' ? '.exe' : ''

execFileSync('cargo', ['build', '--release', '--manifest-path', join(workspace, 'Cargo.toml'), '-p', 'saf-kanban-server', '--bin', 'saf-kanban-cli'], { stdio: 'inherit' })
mkdirSync(join(here, 'binaries'), { recursive: true })
const target = join(here, 'binaries', `saf-kanban-cli-${triple}${exe}`)
copyFileSync(join(workspace, 'target', 'release', `saf-kanban-cli${exe}`), target)
console.log(`Command line ready for the installer: ${target}`)
