# SAF Kanban Desktop App & Standalone CLI

[繁體中文](README.md) | English

Run SAF Kanban directly on your computer: local boards are stored as JSON files with full offline read/write, and Google Sheet board settings are shared in the same data folder (via Apps Script v5+). Choose either the Windows desktop app (GUI + CLI + MCP + HTTP API) or the cross-platform standalone CLI (Windows / macOS / Linux).

**[Download Desktop App & CLI](https://github.com/whlshy/SAF_Kanban/releases)** ｜ **[Back to Main README](../README.en.md)** ｜ **[Changelog](../CHANGELOG.en.md)**

## Table of Contents

- [Install and Everyday Use](#install-and-everyday-use)
  - [Windows Desktop App (GUI + CLI)](#windows-desktop-app-gui--cli)
  - [Standalone CLI (Windows / macOS / Linux)](#standalone-cli-windows--macos--linux)
- [Using with AI Agents](#using-with-ai-agents)
  - [Skill and Command Line (Recommended)](#skill-and-command-line-recommended)
  - [MCP](#mcp)
- [Data Location, Export and Backup](#data-location-export-and-backup)
- [Security](#security)
- [API](#api)
- [Build from Source, Tests and Releases](#build-from-source-tests-and-releases)

---

## Install and Everyday Use

### Windows Desktop App (GUI + CLI)

Download the latest `SAF-Kanban_<version>_x64-setup.exe` from [Releases](https://github.com/whlshy/SAF_Kanban/releases) and run it:

- The installer isn't code-signed yet, so when Windows shows "Windows protected your PC", click **More info → Run anyway**.
- Installs for the current user only — no administrator privileges required — and bundles `saf-kanban-cli.exe` alongside `saf-kanban.exe`. The welcome page offers an optional **Add `saf-kanban-cli` to user PATH** checkbox (automatically removed on uninstall).
- Uses Windows' built-in WebView2 runtime (included in Windows 11 and updated Windows 10; downloaded automatically once during install if missing).

Everything works like the web app, plus desktop-specific features:

- **System tray background mode**: closing the window hides it to the notification area so AI agents and scripts can keep using your boards. Left-click the tray icon to bring the window back; right-click → **Quit** to exit completely.
- **Start when I sign in**: enable it from the tray menu to launch hidden at Windows sign-in. Launching the app again simply focuses the existing window.
- **In-app update check & install (`0.5.0+`)**: automatically checks GitHub Releases 5 seconds after startup and every 6 hours (silently skipped when offline). When a new version is found, click **Update now** on the banner to download, verify the minisign signature, and install via Windows NSIS `passive` mode with automatic restart — your boards remain untouched. You can also trigger **Check for updates** from the tray menu or the top-left board menu.
- **Automatic AI skill refresh**: on startup after an update, any previously installed AI skill is refreshed automatically (no files are created where you haven't installed it).
- **External links & port**: external links open in your default browser. The local server listens on port `41952` by default and picks a free port if taken (check the active address in **AI / API** at the top right).
- **Google Sheet boards synced with CLI**: the desktop app stores its Google Sheet board list in `<data dir>/sheets.json` (in the same folder as local boards), shared directly with the CLI so changes on either side appear within a second.

### Standalone CLI (Windows / macOS / Linux)

If you don't need the desktop GUI, install the standalone `saf-kanban-cli` binary with one command (supports Windows x64, macOS Apple Silicon / Intel, and Linux x64; verifies `SHA256SUMS.txt` and adds the install folder to user `PATH`):

- **Windows (PowerShell)**:
  ```powershell
  irm https://whlshy.github.io/SAF_Kanban/install.ps1 | iex
  ```
- **macOS / Linux**:
  ```bash
  curl -fsSL https://whlshy.github.io/SAF_Kanban/install.sh | sh
  ```

- **Upgrade**: re-run the exact same install command to upgrade in place.
- **Uninstall**:
  - Windows: `$env:SAF_KANBAN_UNINSTALL=1; irm https://whlshy.github.io/SAF_Kanban/install.ps1 | iex`
  - macOS / Linux: `curl -fsSL https://whlshy.github.io/SAF_Kanban/install.sh | sh -s -- --uninstall`
- **Skip PATH edits**: set `$env:SAF_KANBAN_NO_PATH=1` on Windows, or pass `-s -- --no-path` on macOS/Linux. Platform archives are also available directly on [Releases](https://github.com/whlshy/SAF_Kanban/releases).
- **Coexistence with the desktop app**: both share the exact same data folder (`%APPDATA%\SAF Kanban` / `~/.local/share/saf-kanban`), so boards created or imported via the CLI appear automatically if you install the desktop app later.

---

## Using with AI Agents

Click the robot icon (**AI / API**) at the top right to see exact paths, addresses, and copyable snippets for each integration method (standalone CLI users can run `saf-kanban-cli skill --install` directly).

| Method | Best for | Needs app open? | Needs token? |
| --- | --- | --- | --- |
| **Skill + CLI (Recommended)** | Claude Code, Codex, Cursor, Antigravity, Gemini CLI, GitHub Copilot, and any agent that supports Agent Skills or shell commands | No | No |
| **MCP (stdio program)** | Claude Desktop and clients that spawn an MCP binary | No | No |
| **MCP (HTTP URL)** | Claude Code, Cursor, and tools accepting an HTTP MCP endpoint | Yes | Yes |
| **HTTP API** | Custom scripts and programs | Yes | Yes |

> Methods that don't require the app to be open read and write the board files directly using `boards.lock` to prevent concurrent write conflicts. When SAF Kanban is open, external edits appear in the UI within a second.

### Skill and Command Line (Recommended)

The desktop installer places `saf-kanban-cli.exe` right next to `saf-kanban.exe` (default: `%LOCALAPPDATA%\SAF Kanban\`); the standalone CLI installer puts `saf-kanban-cli` on your user `PATH`. The generated `SKILL.md` embeds the full binary path so AI agents can run it immediately.

Install the skill (either way):

- Open **AI / API → Skill (recommended) → Install the skill** in the desktop app
- Or run `saf-kanban-cli skill --install` (pass `--target agents|claude|antigravity` to install just one target)

Supports three standard global locations (install individually or all at once in the UI):

| Path | AI tools that read it |
| --- | --- |
| `~/.agents/skills/saf-kanban/SKILL.md` | Codex, Cursor, Gemini CLI, GitHub Copilot, etc. |
| `~/.claude/skills/saf-kanban/SKILL.md` | Claude Code (or `$CLAUDE_CONFIG_DIR/skills/saf-kanban/SKILL.md` when set) |
| `~/.gemini/config/skills/saf-kanban/SKILL.md` | Google Antigravity (App, IDE, and CLI global skills folder) |

- For other agents, run `saf-kanban-cli skill --into <skills folder>` or save the output of `saf-kanban-cli skill`.
- Updating the desktop app refreshes installed skills automatically on startup; if you move the app binary to another path, reinstall once (**AI / API** will show "Update needed").

The CLI works on both **local boards** and **Google Sheet boards (requires Apps Script v5+)**:

```text
saf-kanban-cli --version                  Print the CLI version
saf-kanban-cli boards                     List local and Google Sheet boards
saf-kanban-cli board <board> [--column C] [--limit N]
                                          Columns, tasks, and assignees
saf-kanban-cli tasks <board> [--column C] [--assignee A] [--priority P] [--label L] [--search WORDS]
                     [--since TIME] [--until TIME] [--limit N]
saf-kanban-cli task <board> <task>        Full details of one task
saf-kanban-cli add <board> <title> [--column C] [--priority P] [--assignee A] [--issue ID]
                   [--labels A,B] [--description TEXT | --description-file FILE]
saf-kanban-cli edit <board> <task> [--title T] [--priority P] [--assignee A] [--issue ID]
                    [--labels A,B] [--add-label L] [--remove-label L]
                    [--description TEXT | --description-file FILE |
                     --append-description TEXT | --append-description-file FILE]
saf-kanban-cli move <board> <task>... <column> [--before TASK | --after TASK]
saf-kanban-cli delete <board> <task>      Delete a task (kept in deleted tasks)
saf-kanban-cli deleted <board>            List deleted tasks (newest first)
saf-kanban-cli restore <board> <task> [--column C] [--before TASK | --after TASK]
                                          Restore a deleted task in place
saf-kanban-cli new-board <name> [--columns A,B,C] [--users A,B] [--labels NAME:COLOR,...] [--issue-link URL]
                         [--sheet URL|ID] [--script URL|ID] [--user NAME]
                                          Create a local board, or add a Google Sheet board (--script)
saf-kanban-cli edit-board <board> [--name N] [--columns A,B,C] [--rename OLD=NEW] [--users A,B]
                          [--labels NAME:COLOR,...] [--rename-label OLD=NEW]
                          [--issue-link URL] [--sheet URL|ID] [--script URL|ID] [--user NAME]
saf-kanban-cli delete-board <board>       Delete a local board (to trash/), or remove a Google Sheet board from the list
saf-kanban-cli import <file> [--password PWD]
                                          Import exported Google Sheet settings (plain or encrypted) or a local board JSON
saf-kanban-cli export [board...] [--sheets] [--out FILE] [--password PWD]
                                          Export a local board or Google Sheet settings (--out - for stdout)
saf-kanban-cli skill [--install [--target agents|claude|antigravity] | --into DIR]
                                          Print or install the AI skill
```

- `<board>` accepts a board ID or exact name; `<task>` is the task ID shown in brackets. `move` accepts multiple task IDs.
- Every command supports `--json` and `--data-dir <DIR>`; `boards` never prints `scriptId` (plain or `--json`) so deployment URLs aren't leaked into AI transcripts.
- `--description -` / `--append-description -` reads from stdin (handling UTF-8 BOM and UTF-16 automatically); in PowerShell, prefer `--description-file` / `--append-description-file`.
- `--append-description` appends after a blank line safely under the lock (both local boards and Apps Script v5).
- `--since` and `--until` (`YYYY-MM-DD` or ISO timestamp) filter by `movedAt`; `--limit N` returns the `N` tasks most recently moved into their column.
- Errors print to stderr with exit code `1` (`2` for usage mistakes).

### MCP

[MCP](https://modelcontextprotocol.io) exposes board operations as structured tools for AI agents.

- **Claude Code (HTTP URL, app must be running)**:
  ```bash
  claude mcp add --transport http saf-kanban http://127.0.0.1:41952/mcp --header "Authorization: Bearer <TOKEN>"
  ```
- **Claude Desktop (stdio binary, app does not need to be open)**:
  ```json
  {
    "mcpServers": {
      "saf-kanban": { "command": "<full path to saf-kanban>", "args": ["mcp"] }
    }
  }
  ```
  > Use `saf-kanban mcp` for the installed app, or `saf-kanban-server mcp` for the standalone server. Add `--data-dir <DIR>` for a custom folder.

Available MCP tools:

| Tool | Description |
| --- | --- |
| `list_boards` / `get_board` | List boards / get columns and tasks of one board |
| `list_tasks` / `get_task` | Filter tasks (supports `since`, `until`, `limit`) / get one task |
| `create_task` / `update_task` | Create a task / update fields (supports `appendDescription`) |
| `move_task` | Move a task to a column and position (`beforeTask` / `afterTask`) |
| `delete_task` / `list_deleted_tasks` / `restore_task` | Delete a task / view history / restore in place with original ID |
| `create_board` / `update_board` | Create a board / edit title, columns, and assignees (board deletion is UI-only) |

> Note: MCP tools use `description`, while the HTTP API uses `des`.

---

## Data Location, Export and Backup

Default data folder: `%APPDATA%\SAF Kanban` on Windows (`~/.local/share/saf-kanban` on Linux/macOS).

| Path | Contents |
| --- | --- |
| `boards/<board-id>.json` | One JSON file per local board (columns, users, tasks, deleted history) |
| `sheets.json` | Google Sheet board list shared between the desktop app and CLI (`0600` on Unix) |
| `trash/` | Deleted local board files are moved here instead of permanently erased |
| `config.json` | API token |
| `boards.lock` | Cross-process file lock for safe concurrent writes |
| `server.json` | Active server port for `mcp` bridge discovery |

- **Full backup**: copy the entire data folder.
- **Single-board export/import**: click **Export board** in board Settings to save a JSON file (no API token included), then import it from the board menu.
- **Copy from Google Sheets**: open Settings on a Google Sheet board and choose **Copy to local board** to copy columns, tasks (including creation and move times), and assignees without modifying the Sheet.
- **Crash-safe storage**: every request reads from disk (restoring a backup needs no restart), and writes atomically replace the file via a temporary file.

---

## Security

- Binds only to loopback (`127.0.0.1`), never exposed to your LAN or the internet.
- Every HTTP API and HTTP MCP request requires `Authorization: Bearer <TOKEN>`.
- Validates `Host` is `127.0.0.1` or `localhost` (preventing DNS rebinding) and rejects cross-origin browser requests.
- CLI and `mcp` stdio access local files directly without a network token.
- If a token leaks, click **Generate new token** in **AI / API** to revoke the old one immediately.

---

## API

Base URL: `http://127.0.0.1:41952/api` (JSON request/response, requires `Authorization: Bearer <TOKEN>`).

| Method & Path | Description |
| --- | --- |
| `GET /info` | Server name, version, and in-app updater flag (`canUpdate`) |
| `GET /sheets` / `PUT /sheets` | Read / sync the shared Google Sheet board list (`sheets.json`) |
| `GET /boards` / `POST /boards` | List local boards / create a board (accepts `tasks` & `history` for imports) |
| `GET /boards/{board}` / `PATCH` / `DELETE` | Read / update title, columns (with `renames`), users / move to `trash/` |
| `GET /boards/{board}/export` | Full board export (settings, tasks, history) |
| `GET /boards/{board}/tasks` / `POST` | Filter tasks / create a task |
| `GET /boards/{board}/tasks/{task}` / `PUT` / `PATCH` / `DELETE` | Read / replace or create / partial update (supports `appendDes`) / delete to history |
| `POST /boards/{board}/tasks/{task}/move` | Move column and position (`column`, `beforeId`, `afterId`) |
| `GET /boards/{board}/history` | Deleted tasks, newest first |
| `POST /boards/{board}/history/{task}/restore` | Restore in place (optional `column`, `beforeId`, `afterId`) |
| `GET /events` | Real-time change stream (SSE; also accepts `?token=<TOKEN>`) |
| `GET /connection` | API/MCP URLs, data directory, and executable paths |
| `GET /skill` / `POST /skill` | Get `SKILL.md` & install status / install or update skill (optional `{"agents": "antigravity"|"claude"|"agents"}`) |
| `POST /token` | Rotate and return a new API token |
| `GET /update` / `POST /update/check` / `POST /update/install` | Query / check / install desktop updates (installed app only) |

### Task Shape

```json
{
  "id": "e0062d42",
  "title": "Buy milk",
  "issueId": "",
  "des": "Whole milk\nTwo bottles",
  "column": "Todo",
  "priority": "high",
  "assignee": "Amy",
  "createdAt": "2026-11-16T17:10:44.708Z",
  "updatedAt": "2026-11-16T17:10:44.708Z",
  "movedAt": "2026-11-16T17:10:44.708Z"
}
```

- `GET /boards/{board}/tasks` query params: `column`, `assignee` (empty string for unassigned), `priority`, `q` (space-separated terms), `since`, `until` (by `movedAt`), `limit` (most recently moved `N` tasks).
- Errors return the matching HTTP status and `{ "error": { "code": "...", "message": "...", "params": { ... } } }`.
- `GET /events` emits `event: change` with `{"kind":"board"|"boards"|"update","boardId":"..."}`.

<details>
<summary><strong>curl examples</strong></summary>

```bash
TOKEN=<TOKEN>
API=http://127.0.0.1:41952/api

# List boards
curl -H "Authorization: Bearer $TOKEN" $API/boards

# Create a task (defaults to the first column)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Buy milk", "priority": "high"}' $API/boards/<board>/tasks

# Filter by assignee and keyword
curl -H "Authorization: Bearer $TOKEN" "$API/boards/<board>/tasks?assignee=Amy&q=login"

# Move to Done right before another task
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"column": "Done", "beforeId": "<other-task>"}' $API/boards/<board>/tasks/<task>/move
```

</details>

---

## Build from Source, Tests and Releases

Requires Node.js 22 and Rust. From the repository root:

```bash
npm install
npm run local        # build desktop UI and start standalone local server
npm run build:app    # build Windows desktop app and NSIS installer
npm run test:server  # run Rust server and CLI integration tests
cargo clippy --manifest-path desktop/Cargo.toml --all-targets -p saf-kanban-server -- -D warnings
```

- Standalone server (`saf-kanban-server`) flags: `--port`, `--data-dir`, `--ui-dir`.
- Desktop app (`saf-kanban`) bundles the UI and accepts `--port`, `--data-dir`, `--hidden`.
- **CI & publishing** ([`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)):
  - Every change under `desktop/` builds the Windows installer, installs it silently, and runs `node desktop/app/smoke-test.mjs`.
  - To publish a release, bump the version in [`Cargo.toml`](Cargo.toml), merge into `main`, then run **Actions → Desktop app → Run workflow** on `main` with **Publish a release** checked (or push a `desktop-v<version>` tag). CI signs the installer with `TAURI_SIGNING_PRIVATE_KEY`, generates `latest.json`, and publishes the GitHub Release.
