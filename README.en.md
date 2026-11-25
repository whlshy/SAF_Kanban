# <picture><source media="(prefers-color-scheme: dark)" srcset="design/icons/kanban-drag-frame-soft-dark.svg"><img src="design/icons/kanban-drag-frame-soft-light.svg" alt="" width="36" height="36" align="absmiddle"></picture> SAF Kanban

[繁體中文](README.md) | English

**A personal kanban board with no backend to host — your data stays completely in your hands.**
Use it right in the browser (stored in your own Google Sheet), or install the Windows desktop app (stored as local files on your computer, with built-in AI agent support via Skill, CLI, and MCP).

👉 **[Open SAF Kanban](https://whlshy.github.io/SAF_Kanban/)** ｜ **[Download Windows Desktop App](https://github.com/whlshy/SAF_Kanban/releases)** ｜ **[Changelog](CHANGELOG.en.md)**

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/preview-dark.png">
    <img src="docs/preview-light.png" alt="SAF Kanban board preview" width="900">
  </picture>
</p>

## Table of Contents

- [Web vs. Desktop App](#web-vs-desktop-app)
- [Key Features](#key-features)
- [Quick Setup (Google Sheet Web Version)](#quick-setup-google-sheet-web-version)
- [Desktop App (Windows)](#desktop-app-windows)
- [More Ways to Use It](#more-ways-to-use-it)
- [Update the Apps Script](#update-the-apps-script)
- [FAQ](#faq)
- [Data and Privacy](#data-and-privacy)
- [Development](#development)

---

## Web vs. Desktop App

| | Web Version (Google Sheets) | Windows Desktop App |
| --- | --- | --- |
| Where data lives | Your own Google Sheet | Local JSON files on your computer (Google Sheet boards also work) |
| Installation | None — open in browser (optional PWA install) | Single installer, no administrator rights needed |
| Offline use | Read-only view of last loaded boards | **Full offline read & write** for local boards |
| AI agent integration | — | Works with Claude Code, Codex, Gemini CLI, Cursor, etc. (Skill / CLI / MCP / HTTP API) |
| Deleted task recovery | Recreate from history | Local boards can **restore in place** with original ID & column |
| Updates | Reload prompt when the site updates | **In-app update check, verification, and install** (v0.5.0+) |

---

## Key Features

- **Boards & Tasks**
  - Create, edit, and delete tasks with priority, assignee, and issue tracker links (Jira, GitHub Issues, etc.)
  - Unlimited custom columns with within-column and cross-column drag-and-drop (long-press to drag on phones; swipe column-by-column on portrait screens)
  - Automatically tracks creation time (`createdAt`) and last column entry time (`movedAt`), visible in hover tooltips, task details, and the edit dialog
  - Live search and filters (keyword, assignee, priority) — dragging still works while filtering
- **Multiple Boards, Backups & History**
  - Switch between multiple boards with `?board=<ID>` URLs for bookmarking or side-by-side tabs
  - Export and import board settings as JSON, with optional in-browser **AES-GCM password encryption** (PBKDF2-SHA256)
  - Deleted tasks are kept in history with search and one-click recreate (or in-place restore on desktop local boards)
- **Cross-Device & Desktop Experience**
  - Traditional Chinese and English UI; light and dark themes
  - Installable as a PWA with offline viewing of last loaded data
  - Windows desktop app with system tray mode, autostart on sign-in, in-app updates, and AI agent tooling

---

## Quick Setup (Google Sheet Web Version)

Starting from the template is the fastest way — no sheets to create and no code to edit:

1. Open the [SAF Kanban template](https://docs.google.com/spreadsheets/d/1-gsXi8JZQrIwAiK6q2koaPp0resipV-G_0YFYOja7yc/copy) and click **Make a copy** to save it to your Google Drive (the sheets and Apps Script are already included).
2. In your copy, click **Share** at the top right and set **General access** to **Anyone with the link → Viewer**.
3. Open **Extensions → Apps Script** and deploy it as a web app:
   - Click **Deploy → New deployment** → select type **Web app**
   - Set **Execute as** to **Me** and **Who has access** to **Anyone** → click **Deploy** and authorize
   - Copy the generated URL (`https://script.google.com/macros/s/.../exec`)
4. Open [SAF Kanban](https://whlshy.github.io/SAF_Kanban/), click **Settings** (or **New board** in the top-left menu), paste your **Sheet URL** and **deployment URL**, and click **Create**.

> Full URLs are automatically parsed into IDs — no manual extraction needed. Settings live in your browser's Local Storage. After connecting, try adding, dragging, and deleting a test task to verify read/write access.

<details>
<summary><strong>Manual setup from scratch (and Google Sheet column specifications)</strong></summary>

### 1. Create four sheets

Create a new Google Sheet with four sheets named exactly as below (case-sensitive, **no header rows — data starts on row 1**):

- `kanban`: stores tasks in columns `A:I` (can start empty)

| Column | Content | Example |
| --- | --- | --- |
| A | Task ID (generated automatically) | `4836540b` |
| B | Title | `Implement login page` |
| C | Issue ID | `PROJECT-101` |
| D | Description | `Create login form` |
| E | Kanban Column (must match `columns` column A exactly) | `Todo` |
| F | Priority | `high`, `medium`, `low` |
| G | Assignee | `Alice` |
| H | Creation time (filled by Apps Script v3+) | `2026-11-21 10:30:00` |
| I | Last moved into current column (Apps Script v4+, updated on cross-column moves) | `2026-11-24 14:20:00` |

- `columns`: list column names in order in column A (e.g. `Todo`, `In Progress`, `Testing`, `Done`).
- `users`: list assignee names in column A (legacy format with user ID in A and name in B still works).
- `history`: keeps deleted tasks (created automatically on first deletion if absent). Columns A–G match `kanban`; H is deletion time, I is creation time, J is column move time (v4+).

### 2. Share and paste Apps Script

1. Set **Share → General access → Anyone with the link → Viewer** (nobody needs edit access; writes go through Apps Script).
2. Open **Extensions → Apps Script**, replace the default code with [`apps-script/Code.gs`](apps-script/Code.gs), and save (leave `SPREADSHEET_ID` empty).
3. Follow steps 3–4 of Quick Setup above to deploy and connect.

### 3. Board settings reference

| Setting | Value |
| --- | --- |
| Title | Shown at the top left (optional) |
| Sheet ID | Full Google Sheet URL or `SHEET_ID` |
| Apps Script Deployment ID | Full deployed web app URL or `DEPLOYMENT_ID` (no Google Cloud API key needed) |
| Issue Link | Base URL prepended to a task's Issue ID (e.g. Jira `https://your-company.atlassian.net/browse/`, GitHub `https://github.com/OWNER/REPO/issues/`) |

> Note: `User Name` is currently unused and can be left empty. Older versions named these fields "Sheet API Key", "Jira Link", and "Jira ID" — renaming does not affect existing settings or data.

</details>

---

## Desktop App (Windows)

If you'd rather keep boards offline on your own computer or let AI agents manage your tasks, install the Windows desktop app:

1. Download the latest `SAF-Kanban_<version>_x64-setup.exe` from [Releases](https://github.com/whlshy/SAF_Kanban/releases) and run it.
2. The installer isn't code-signed yet, so when Windows shows "Windows protected your PC", choose **More info → Run anyway**.
3. Starting from `0.5.0`, future updates are detected automatically and can be **installed from inside the app**; any previously installed AI skill refreshes automatically on startup.

See the **[Desktop App Guide (desktop/README.en.md)](desktop/README.en.md)** for tray behavior, AI agent setup (Skill / CLI / MCP), backups, and the HTTP API reference.

---

## More Ways to Use It

### Multiple boards
Click the board name at the top left → **New board** to manage separate boards (on desktop, local boards and Google Sheet boards work side by side). URLs include `?board=<ID>` for bookmarking or opening boards in separate tabs. Deleting a Google Sheet board only removes its browser settings — your Sheet data is untouched.

### Export, import & password encryption
Click the board name → **Export settings** to save selected boards as a JSON file, and **Import settings** in another browser (duplicate names are flagged before importing).
- Exported files contain your Apps Script Deployment IDs — keep them private.
- Check **Protect with a password** (at least 8 characters) to encrypt in your browser with Web Crypto (`PBKDF2-SHA256` 600,000 iterations + `AES-GCM`). Passwords never leave your device and cannot be recovered; requires HTTPS or `localhost`.

### Search & filter
Click the magnifier at the top right to filter by keyword (matches title, description, Issue ID, and assignee; space-separated words must all match, case-insensitive), assignee (including Unassigned), and priority. Column counts switch to `matching / total`, and drag-and-drop continues to work.

### Deleted tasks
Click the clock icon at the top right to browse and search deleted tasks (newest first). Web boards let you **Recreate** a task in the first column with its old content; desktop local boards also offer **Restore** to bring the task back with its original ID, creation time, column, and position.

### Install as an app (PWA) & offline viewing
- Install via **Install app** in the top-left board menu on Chrome/Edge (desktop & Android), or **Share → Add to Home Screen** on iOS Safari.
- Offline, the app still opens and displays the last loaded data (read-only until back online). When a new site version ships, click **Reload** on the top banner or reopen all tabs.

---

## Update the Apps Script

When [`apps-script/Code.gs`](apps-script/Code.gs) is updated, older scripts keep working without new features (see [Apps Script versions](CHANGELOG.en.md#apps-script-versions)). The current version (v4) adds `history` archiving on deletion, Sheet ID verification before writing, localized error messages, and automatic creation (column H) and column-move (column I) timestamps.

How to update (your deployment ID stays the same, so SAF Kanban settings need no changes):

1. Open your Sheet's **Extensions → Apps Script**, replace all code with [`apps-script/Code.gs`](apps-script/Code.gs), and save.
2. Go to **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**.

---

## FAQ

- **Columns or tasks don't show up**: Check that sheets are named lowercase `columns` and `kanban`, data starts on row 1 (no header row), and `kanban` column E matches `columns` column A exactly.
- **403 errors or can't read data**: Verify the Sheet is shared as **Anyone with the link → Viewer**.
- **CORS error or write failures when adding/moving tasks**: Usually means the Apps Script didn't return JSON. Open `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` in an **incognito window**:
  - Seeing `{"status":"error","code":"UNKNOWN_ACTION", ...}` means the deployment works — double-check the Deployment ID in settings and `SPREADSHEET_ID` in the script (leave empty or match the same Sheet).
  - Seeing a Google sign-in or "You need access" page means access isn't set to **Anyone** (some corporate Google Workspace accounts block "Anyone"; use a personal Google account instead).
- **Script changes don't take effect, or `undefined is not valid JSON`**: Saving alone doesn't update the live web app — publish a new version via **Deploy → Manage deployments → Edit → Version: New version → Deploy**.
- **Issue links don't open**: Make sure Issue Link includes the trailing path (e.g. `/browse/` for Jira, `/issues/` for GitHub).

---

## Data and Privacy

- **Web version (Google Sheets)**: All task data lives in your own Google Sheet. Because the browser reads it directly, the Sheet must be viewable by anyone with the link — avoid storing passwords or secrets. Treat your Apps Script Deployment ID as sensitive. Offline caches stay only in your browser and are cleared when site data is cleared.
- **Desktop app (local boards)**: Boards stay entirely on your computer and are never uploaded to external servers (see [Desktop security](desktop/README.en.md#security)).

---

## Development

Requires Node.js 22; building the desktop app also requires Rust.

```bash
npm install
npm start            # dev server at http://localhost:1001
npm run lint         # ESLint check on src/
npm test             # frontend unit tests (Node's built-in test runner)
npm run build        # production web build into dist/
```

The desktop app lives in [`desktop/`](desktop/README.en.md) (Rust + Tauri):

```bash
npm run local        # build desktop UI and run local server
npm run test:server  # Rust server and CLI tests
cargo clippy --manifest-path desktop/Cargo.toml --all-targets -p saf-kanban-server -- -D warnings
npm run build:app    # build desktop app and installer (Windows release builds run on GitHub Actions)
```

Pushing to `main` triggers [GitHub Actions](.github/workflows/deploy.yml) to run lint, tests, clippy, build, and deploy to GitHub Pages (set repository **Settings → Pages → Source** to **GitHub Actions**).
