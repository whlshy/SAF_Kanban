# Changelog

[繁體中文](CHANGELOG.md) | English

Website changes take effect as soon as they're released. The Apps Script has to be updated by you, as described in [Update the Apps Script](README.en.md#update-the-apps-script); features marked "needs the current Apps Script" only work after that update.

## Apps Script versions

| Version | Released with | Changes |
| --- | --- | --- |
| v7 | 1.22.1 | Adds `action=saveLabels` to edit the `labels` tab (colors, order, and rename propagation across tasks) from Web Settings or CLI while blocking removal of labels still in use; `upsert`/`restore` auto-sync new task labels into the `labels` tab and auto-expand trimmed columns |
| v6 | 1.22.0 | Adds task labels: column J of `kanban` (comma-separated), column K of `history` on delete, optional `labels` sheet (`A:B`) for preset labels and colors, and atomic `addLabels`/`removeLabels` in `upsert`; fully backwards-compatible with older Sheets |
| v5 | 1.21.0 | Adds `doPost` JSON endpoint, `action=read` (fetches columns, tasks, users, and history in one call), `action=restore`, and atomic description appending (`appendDes`) in `upsert` for CLI access to Google Sheet boards |
| v4 | 1.19.0 | Records when each task last moved into its current column in column I of `kanban` (on creation and cross-column moves); deleting a task keeps it in column J of `history` |
| v3 | 1.18.0 | Records when each new task was created in column H of `kanban`; deleting a task keeps that time in column I of `history` |
| v2 | 1.5.0 | Keeps deleted tasks in the `history` sheet; checks it's connected to the board's Sheet before writing; returns error codes and its version; adds `action=info` |
| v1 | 1.0.0 | The script embedded in the README before 1.5.0 |

## 1.24.0 and desktop app / CLI 0.9.0 — 2026-11-28

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases); the standalone CLI can be upgraded with the one-line install script. Data format is 100% backwards-compatible — **no Apps Script update needed**.

### Added

- **Local board image attachments on desktop (paste, drag-and-drop, upload)**:
  - **Three effortless ways to attach images**: while editing a task on a local board, paste screenshots directly from the clipboard (`Ctrl+V`), drag and drop image files into the description editor, or click **Insert image** to pick one or more files (local boards only; Google Sheet boards continue using external image URLs).
  - **Content-addressed storage & strict validation**: verifies **PNG / JPEG / WebP / GIF** by magic bytes (10 MB max per image; blocks SVG and path traversal), deduplicates by SHA-256 16-hex prefix under `<data dir>/attachments/<board-id>/`, and writes portable `![name](attachment:<16hex>.<ext>)` Markdown syntax without hardcoding ports, board IDs, or tokens.
  - **Safe retention on delete**: individual images are kept so restoring deleted tasks never breaks attachments; deleting an entire local board moves its attachment folder into `trash/attachments/`.
  - **Self-contained JSON export/import**: exporting a single local board (via UI or CLI) embeds all attachments referenced by active or deleted tasks as Base64 in `attachments`, and importing validates and restores them to disk while staying backwards-compatible with older exports.
  - **CLI, HTTP API & AI Skill support**: adds `saf-kanban-cli attach <board> <image-file>`, `POST /api/boards/{board}/attachments`, and `GET /api/boards/{board}/attachments/{filename}`, with matching updates to embedded `SKILL.md` and desktop docs.
- **Full-screen image Lightbox (Web & Desktop)**: clicking any loaded image in task descriptions or edit previews (local `attachment:` or external `http`/`https`) opens a full-screen zoom Lightbox with caption and close button; pressing `Esc` closes only the Lightbox without dismissing the underlying task modal.

## 1.23.0 and desktop app / CLI 0.8.0 — 2026-11-28

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases); the standalone CLI can be upgraded with the one-line install script. Data format is 100% backwards-compatible — **no Apps Script update needed**.

### Added

- **GitHub Flavored Markdown (GFM) task descriptions**:
  - **Full description rendering**: supports headings, bold/italic/strikethrough, ordered & unordered lists, crisp read-only task checklists (`- [ ]` / `- [x]`), horizontally scrollable tables, blockquotes, inline code, fenced code blocks with a hover copy button, safe links (`http`/`https`/`mailto`, opening in a new tab or the desktop default browser), and `http`/`https` images; preserves single line breaks for backwards compatibility with existing plain-text descriptions and adapts cleanly to light & dark themes.
  - **Mermaid diagrams**: ```` ```mermaid ```` blocks render flowcharts, sequence diagrams, state diagrams, ER diagrams, etc., in strict security mode (`securityLevel: 'strict'`), automatically matching light/dark theme with source/diagram toggle, copy button, and graceful syntax-error fallback.
  - **Write / Preview tabs in Edit Task**: taller multiline description editor (4–12 rows) with live Write / Preview tab switching.
  - **Clean plain-text 2-line previews**: task cards and deleted-task history rows strip Markdown syntax and collapse Mermaid blocks to `[Mermaid]`, while search and CLI `task` keep full raw text.
  - **On-demand lazy loading & lean PWA caching**: Markdown (`~51 KB` gzip single chunk) and Mermaid diagram engines load strictly on demand (`+0 KB` on initial board load); Mermaid chunks are excluded from upfront PWA precache and cached on first use via Workbox `CacheFirst` for offline viewing.
  - **AI Skill & MCP docs**: updated embedded `SKILL.md` and MCP instructions to note GFM Markdown and ```` ```mermaid ```` support in descriptions.

## 1.22.1 and desktop app / CLI 0.7.1 — 2026-11-27

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases); the standalone CLI can be upgraded with the one-line install script. Google Sheet boards need **Apps Script v7** to edit preset labels & colors in Settings/CLI and auto-sync new task labels.

### Added & Improved

- **Edit Google Sheet preset labels & colors in Settings and CLI (Apps Script v7)**: Google Sheet boards now show the Labels editor in Settings (10-color palette, drag reorder, and rename propagation across tasks), and `saf-kanban-cli edit-board --labels` / `--rename-label` now works on Google Sheet boards as well.
- **Auto-sync new task labels to global board labels**: saving a task with a brand-new label automatically registers it in the board's preset labels (local `board.labels` and Google Sheet `labels` tab on v7+) using the same deterministic palette color across Web, Rust, and Apps Script.
- **Prevent removing global labels still in use by tasks**: the Settings editor disables the remove button with an in-use count tooltip, and both the local Rust server (`409 LABEL_IN_USE`) and Apps Script v7 reject removing any label still attached to a task.
- **Complete AI Skill & MCP label docs and schemas**: updated embedded `SKILL.md`, MCP tool instructions/schemas (all 10 valid palette names, `__unlabeled__` filter, v6/v7 requirements), and desktop READMEs.

### Fixed

- **Fixed phantom labels and false "Success" toast on outdated Apps Script (< v6)**: saving task labels against Apps Script v1–v5 now reverts unsaved labels in the UI (fixing React Query structural sharing hiding the resync) and shows a clear warning to upgrade to v6+; Apps Script also auto-expands trimmed columns before writing column J.

## 1.22.0 and desktop app / CLI 0.7.0 — 2026-11-27

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases); the standalone CLI can be upgraded with the one-line install script. Google Sheet boards need **Apps Script v6** to save task labels.

### Added

- **Task Labels (hybrid preset + freeform)**:
  - **Dynamic single-row card badges**: labels render between the task title and description and dynamically fit the card's width, collapsing overflow into a `+N` badge (hover to see hidden labels); clicking a label pill on any card opens the filter bar and toggles that label. The full description modal shows all labels unwrapped.
  - **Board presets & freeform input**: local boards include a drag-reorderable Labels manager in Settings with a 10-color palette and live rename propagation to existing tasks; editing a task lets you pick preset chips or type any freeform label (`Enter` or `,` to add, `Backspace` to remove, deterministic hash colors with light/dark theme contrast).
  - **Filter & search integration**: single-select Label filter dropdown (`All labels` / `Unlabeled` / board & task labels) in the filter bar; keyword search in both the board and deleted-task history matches labels, and labels are preserved when restoring or recreating deleted tasks.
  - **Google Sheets & Apps Script v6**: stores comma-separated labels in `kanban` column J and `history` column K, with an optional `labels` sheet (`A:B` for name and semantic color or `#RRGGBB` hex); copying a Google Sheet board to a local board preserves both preset definitions and task labels.
  - **Full CLI, MCP, HTTP API, Skill & import/export parity**: adds `--label` (including `__unlabeled__`) to `tasks`, `--labels`/`--add-label`/`--remove-label` to `add`/`edit`, and `--labels`/`--rename-label` to `new-board`/`edit-board`, with matching MCP tool schemas, HTTP API fields, AI Skill docs, and local board export/import preservation.

## Desktop app 0.6.3 — 2026-11-27

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases). The website is unchanged.

### Added

- **Remember window size, position, and maximized state**: the desktop app now saves the main window's bounds in `<data dir>/window.json` and restores them across full restarts and updates, using physical pixels for Windows HiDPI accuracy, preserving normal bounds while maximized, falling back to centered placement when a previously used external monitor is disconnected, and respecting `--hidden` startup.

## 1.21.2 and desktop app 0.6.2 — 2026-11-26

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases).

### Improved

- **Toast enter and exit animations**: added a smooth slide-and-fade entrance (`220ms`) and exit with animated height collapse (`180ms`) so stacked notifications glide smoothly into place; in-place updates for the same `key` do not replay the entrance animation, and `prefers-reduced-motion` is respected.

## 1.21.1 and desktop app 0.6.1 — 2026-11-25

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases).

### Improved

- **Pause toast auto-dismiss on hover**: hovering over a toast pauses its auto-dismiss timer, with at least a 1-second grace period after the pointer leaves so longer messages and action buttons are easy to read and click.
- **Moved "Check for updates" into the board menu**: moved the desktop app's manual update trigger from the footer to the bottom of the top-left board switcher menu (matching the web app's "Install app" slot), keeping the footer clean.
- **Full dark mode for MUI components**: synced MUI `ThemeProvider` with the app theme so all dialogs (edit task, task description view, board settings, AI / API connection, confirm dialogs), dropdown menus, selects, and alerts render consistently in dark mode.

## 1.21.0 and desktop app / CLI 0.6.0 — 2026-11-25

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases); the standalone CLI can be installed or upgraded with the one-line install script.

### Added

- **Standalone cross-platform CLI & one-line installer**: releases now include standalone `saf-kanban-cli` archives for Windows x64, macOS (Apple Silicon / Intel), and Linux x64 with `SHA256SUMS.txt` verification, installable without the desktop GUI (`irm https://whlshy.github.io/SAF_Kanban/install.ps1 | iex` on Windows; `curl -fsSL https://whlshy.github.io/SAF_Kanban/install.sh | sh` on macOS/Linux).
- **Google Sheet board support in CLI (needs Apps Script v5)**:
  - `boards`, `board`, `tasks`, `task`, `add`, `edit` (with atomic `--append-description`), `move`, `delete`, `deleted`, and `restore` all work transparently on Google Sheet boards.
  - `new-board <name> --script <URL|ID> [--sheet <URL|ID>]`, `edit-board`, `delete-board`, `import`, and `export` mirror desktop & web UI behavior, including full compatibility with plain and PBKDF2-SHA256 + AES-GCM encrypted export files.
  - Added `--version` / `-V` and `skill --install --target <agents|claude|antigravity>`.
- **Shared Google Sheet board list between Desktop app and CLI**: the desktop app now stores its Google Sheet board list in `<data dir>/sheets.json` (automatically migrating existing `localStorage` entries on first launch), keeping changes made in either the UI or CLI synchronized within a second.
- **Optional PATH checkbox in the Windows desktop installer**: interactive installs offer a checkbox to add `saf-kanban-cli` to user `PATH` (cleaned up on uninstall; skipped during silent installs and passive in-app updates).
- **Apps Script v5**: adds `doPost`, `action=read`, `action=restore`, and `appendDes` while staying fully backwards-compatible with `doGet` web clients.

## Desktop app 0.5.2 — 2026-11-25

Desktop app 0.5.0+ can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases). The website is unchanged.

### Added

- Added **Google Antigravity** global skill support (`~/.gemini/config/skills/saf-kanban/SKILL.md` for Antigravity App, IDE, and CLI, also auto-refreshed on desktop startup).
- Updated **AI / API → Skill (recommended)** with per-target install/update buttons (`Codex, Cursor, Gemini CLI, GitHub Copilot and others`, `Claude Code`, `Antigravity`) alongside an **Install all / Update all** button; `POST /api/skill` now accepts an optional `{"agents": "..."}` target.

## 1.20.1 and desktop app 0.5.1 — 2026-11-25

Desktop app 0.5.0 can update directly from inside the app, or download from [Releases](https://github.com/whlshy/SAF_Kanban/releases).

### Changed

- Frontend cleanup: replaced `antd` with a lightweight Jotai-backed toast host (theme-aware in light and dark modes, supporting stacking, in-place key updates, and rendering above dialogs), and removed `zustand`, `axios`, `stylus`, and unused legacy components, reducing bundle size by ~18%.
- Fixed confirm dialogs not invoking the cancel callback when dismissed via Cancel.
- Modularized large frontend and Rust server files (board view, import/export, desktop `store` and `cli`), and added ESLint, `cargo clippy`, and updated GitHub Actions in CI.

## 1.20.0 and desktop app 0.5.0 — 2026-11-25

Download the desktop app from [Releases](https://github.com/whlshy/SAF_Kanban/releases). Starting from 0.5.0, future desktop releases can be installed from inside the app.

### Added

- In-app updates for the installed Windows desktop app: automatically checks for new releases on startup and every 6 hours, showing a notice with "Update now" to download, verify the signature, install via Windows NSIS `passive` mode, and restart; manual "Check for updates" is also available in the footer and the system tray menu.
- Automatic AI skill refresh on desktop startup: if you previously installed the skill at `~/.agents/skills/saf-kanban/SKILL.md` or `~/.claude/skills/saf-kanban/SKILL.md`, the desktop app keeps it up to date automatically on startup without creating files where you haven't installed it.
- Read-only creation time and column move time shown inside the edit task dialog (matching the task details view).

### Fixed

- Guarded the task card hover tooltip against empty content: no empty tooltip opens if title, creation time, and move time are all missing, and missing timestamps never render blank lines.

## 1.19.0 and desktop app 0.4.0 — 2026-11-24

Download the desktop app from [Releases](https://github.com/whlshy/SAF_Kanban/releases).

### Added

- When each task moved into its current column (`movedAt`): recorded when a task is created or moved to a different column (reordering within the same column, editing fields, or renaming a column leaves it unchanged). Once a task has moved columns, its hover tooltip and details view show an extra "Moved here …" line.
  - Google Sheet boards: stored as plain text in column I of `kanban` (in the Sheet's time zone), and kept in column J of `history` on deletion. Needs the current Apps Script (v4); older scripts and existing tasks keep working without it until moved.
  - Boards kept on the computer in the desktop app: recorded on creation and cross-column moves, and preserved when copying a Google Sheet board to the computer.
- Restore button in the desktop app's "Deleted tasks" dialog: for boards kept on the computer, restores a deleted task as it was (same ID, creation time, original column and place); if its old column was removed, restores it to the first column with a notice.
- Command-line (`saf-kanban-cli`) and MCP improvements:
  - `edit` adds `--append-description` (text or `-` from stdin) and `--append-description-file`, appending after a blank line inside the file lock; MCP `update_task` adds `appendDescription`, and HTTP `PATCH` accepts `appendDes`.
  - `add` and `edit` add `--description-file`; stdin and file reads strip UTF-8 BOM and decode UTF-16 (fixing PowerShell BOM/encoding issues), and the skill advises using description files in PowerShell.
  - `move` accepts multiple task IDs in one atomic write: `move <board> <task>... <column>`. If any ID doesn't exist, nothing changes.
  - `board` adds `--column` and `--limit N` (showing "… and N more" when truncated; default output is unchanged).
  - `task` shows `moved`; `tasks` and MCP `list_tasks` add `--since`, `--until` (`YYYY-MM-DD` or ISO timestamp) and `--limit N` (returning the N tasks most recently moved into their column).

### Changed

- After updating the desktop app, open "AI / API" → "Skill (recommended)" and choose "Update the skill" so AI agents learn the new options and PowerShell file tip.

## 1.18.0 and desktop app 0.3.0 — 2026-11-24

Download the desktop app from [Releases](https://github.com/whlshy/SAF_Kanban/releases).

### Added

- When each task was created: resting the mouse on a task shows its whole title and "Created 2026-11-21 10:30"; the task's details and the deleted tasks list show it too. Cards don't show it.
  - Google Sheet boards: new tasks get their creation time in column H of the `kanban` sheet (in the Sheet's time zone), and deleting a task keeps it in column I of `history`. Needs the current Apps Script (v3). Tasks created before the update have no creation time and show none.
  - Boards kept on the computer in the desktop app: the creation time was already recorded and is now shown, for existing tasks too, in the computer's time zone.
- Copying a Google Sheet board to the computer in the desktop app keeps the tasks' creation times.

### Changed

- The tooltip of a task now shows its title and creation time instead of only the title. It appears after the mouse rests on the task for about half a second, not while the task is pressed or dragged, and not from a long press on a phone.

## Desktop app 0.2.0 — 2026-11-18

Download it from [Releases](https://github.com/whlshy/SAF_Kanban/releases). The website is unchanged.

### Added

- Restore deleted tasks: when an AI agent deletes a task by mistake, `restore` on the command line or the MCP tool `restore_task` brings it back as it was instead of creating it again. It keeps its id, contents and creation time and goes back to its column and place; if that column has been removed, you say which column to use. The HTTP API has `POST /api/boards/{board}/history/{task}/restore`.
- Deleting a task on the command line tells you how to restore it, and the skill and the MCP instructions tell AI agents to restore a task deleted by mistake rather than add it again.

### Changed

- Deleting a task now records its place in the column, for restoring. Tasks deleted before this version go back to the end of their column.
- After updating, open "AI / API" → "Skill (recommended)" and choose "Update the skill" so AI agents learn the new restore command.

## 1.17.0 — 2026-11-17

### Added

- Desktop app for Windows, version 0.1.0: download it from [Releases](https://github.com/whlshy/SAF_Kanban/releases). Boards are files on your own computer and need neither Google Sheets nor a network; Google Sheet boards still work too. See the [desktop app's guide](desktop/README.md) (Traditional Chinese).
  - For boards kept on the computer, columns and assignees are edited in Settings and reordered by dragging.
  - A whole board (with its tasks and deleted tasks) can be exported to a file and imported again; a Google Sheet board can be copied into a board on the computer.
  - Closing the window keeps it in the notification area, and it can start when you sign in.
- AI agents can work on the desktop app's boards:
  - A skill plus a command line, for Claude Code, Codex, Gemini CLI, GitHub Copilot, Cursor and other AI tools. SAF Kanban doesn't have to be open and no token is needed. The skill installs with one click in "AI / API".
  - MCP and an HTTP API, for tools that take an MCP server or for your own programs.
  - Changes made by AI show up in the window within a second.

### Changed

- Nothing changes in how the website is used. Importing a board file exported by the desktop app explains that such files can only be imported in the desktop app.

## 1.16.0 — 2026-11-16

### Added

- Search and filter: click the magnifier at the top right to filter the board's tasks by keyword (title, description, issue ID, assignee), assignee and priority. While filtering, each column shows "matching / total" and dragging still works; click the magnifier again to clear the filter.
- Install as an app: in Chrome on Android or a computer, choose "Install app" in the board-name menu at the top left; on an iPhone, use Safari's "Add to Home Screen". The installed app has its own icon and window.
- Works offline: the site opens without a connection and shows what each board loaded last time. A notice at the top says you're offline, and tasks can't be added, edited, moved or deleted until you're back online.
- When the site is updated, "A new version is available" appears at the top; click "Reload" to switch to it. Otherwise it updates once every tab has been closed and the site is opened again.
- The browser's bar color (Chrome's address bar on phones, the installed app's window) follows the light or dark theme.

### Changed

- The code that reads and writes data is now a layer of its own, with Google Sheets as one data source, in preparation for other kinds of storage. Nothing changes in use, and the Apps Script doesn't need updating.
- When reading the Google Sheet fails (for example, the connection drops), the board keeps what it was showing instead of going blank.
- Added automated tests, and GitHub Actions now tests, builds and publishes the site on every push to `main` (the repository's Pages source has to be set to "GitHub Actions" first; see "Development" in the README).

## 1.15.1 — 2026-11-15

### Changed

- On phones and tablets, swiping up or down on a column can now scroll the page too (for example, to see the footer), so you no longer have to find the space around the columns. A column that can scroll still scrolls first; once it is at its top or bottom, the next swipe scrolls the page. A single swipe never switches from the column to the page midway. Scrolling with a mouse wheel works as before.

### Fixed

- Dragging a task to the bottom of the screen scrolled the page toward the footer first. While dragging, only the columns and the board scroll now; the page stays put.

## 1.15.0 — 2026-11-15

### Added

- The footer shows the current version, such as `v1.15.0`; clicking it opens the changelog in the interface language.

## 1.14.0 — 2026-11-10

### Added

- Exported settings can be protected with a password: check **Protect with a password** and set one (at least 8 characters, entered twice), and the file's contents are encrypted. Importing an encrypted file asks for the same password first. Encryption and decryption happen in the browser, and the password is never uploaded or stored; if it's forgotten, the file can't be imported. Files aren't encrypted by default, and unencrypted files are the same as before.

## 1.13.0 — 2026-11-09

### Added

- A site icon: a card being dragged from one column to another. In browser tabs it has a transparent background and its colors follow the browser's light/dark setting; on the iPhone home screen it has a dark background. The design sources are in `design/icons/`.
- The same icon sits left of the board name in the header, following the site's light/dark theme. It's hidden at phone width (640px or less) to leave room for the name and buttons.
- The README title shows the icon too, switching colors with GitHub's light/dark theme.

### Changed

- The language button in the header is smaller, with 11px text; its tap area stays as tall as the icon buttons beside it, so it's still easy to tap on phones.

### Removed

- `blackwke.png`, an unused image left over from the project template.

## 1.12.0 — 2026-11-09

### Added

- Choose which boards to export: **Export settings** first lists every board (all checked), with **Select all** and a checkbox per board, and downloads the file when you click **Export**.

### Changed

- Settings are saved when you click **Confirm** (or press Enter in a field). The ✕ and Esc discard your changes, and clicking outside the dialog no longer closes it, so typed values aren't lost by accident.
- The read-only description view is wider, up to 900px.
- Every dialog's buttons sit in a fixed row at the bottom: delete or a count on the left, the main button (OK, Confirm, Create, Import, Export) on the right. They stay visible when the content scrolls (for example with many boards), and on phones they sit at the bottom of the screen.
- The task dialog looks like the other dialogs: a ✕ in its title row, **Delete** as a red text button and **OK** as a blue button.
- Dialogs no longer have a **Cancel** button; close them with the ✕ at the top right or Esc. Delete confirmations still have **Cancel**.

### Fixed

- Opening a dialog (such as a description, deleted tasks or Settings) made the board behind it disappear until the dialog closed. The board now stays. While a dialog is open the Sheet still isn't read; the board refreshes when it closes.
- A long dialog title didn't wrap: it ran out of the dialog and pushed the close button out with it. Titles now wrap and the close button stays at the top right.
- A dialog's width and other options carried over from the dialog opened before it: after opening a description, Settings opened as wide as the description view.

## 1.11.0 — 2026-11-05

### Added

- A new board whose name another board already has gets a number, such as `Kanban (1)` or `Kanban (2)`, using the lowest one not taken. The dialog shows the final name while you type. Untitled boards work the same way and become "Untitled board (1)".

## 1.10.1 — 2026-11-05

### Fixed

- Scrolling down to the footer showed an area outside the page's frame, without the theme's background (white in the dark theme). The frame now grows with the board and footer; the board still fills the screen and the footer is still below it.

## 1.10.0 — 2026-11-05

### Added

- Clicking a card's description opens a read-only view of all of it, line breaks included, with an article-style info line on top: column, priority, assignee and Issue ID. The description underlines on hover.
- Task descriptions can span several lines: the description field is now multi-line (Enter adds a line break) and grows up to 6 lines before scrolling.

### Changed

- Card descriptions show at most two lines and end with an ellipsis when longer (line breaks show as spaces on cards).
- On phone-width screens (640px or less) dialogs fill the screen, such as editing a task, deleted tasks and Settings. The language picker and confirmations stay small.

### Fixed

- In the dark theme on phones, a white band showed below the board when scrolled down.
- On phones, deleted tasks' titles were squeezed into a narrow column by the priority and deletion time. The title now gets its own line, with priority and time on the next.

## 1.9.2 — 2026-11-05

### Fixed

- On phones, swiping sideways inside a column didn't switch columns once the column had enough tasks to scroll vertically. Columns now only hold on to vertical scrolling and pass sideways swipes to the board.

## 1.9.1 — 2026-11-05

### Fixed

- On phones, swiping over a task card didn't scroll the board, and tasks couldn't be dragged. A quick swipe now scrolls the board, and long-pressing a task for about 0.25 seconds lets you drag it to another column, auto-scrolling at the screen edge. Dragging with a mouse is unchanged.

## 1.9.0 — 2026-11-05

### Added

- On portrait phones each column fills the screen, and swiping snaps to whole columns instead of showing half of one.
- The assignee can be cleared with "Unassigned", for example when a task goes back to Todo until someone picks it up. The task dialog shows "Unassigned" when there is no assignee.
- Deleted tasks can be recreated: the **Recreate** icon opens the new-task dialog filled with the old values, and **OK** creates a new task in the board's first column. The `history` record is kept, and the Apps Script doesn't need updating.

### Changed

- The header's settings and add buttons now use the same small size as the other icons.
- The light theme goes back to a white page with light gray columns, the header is set apart by a soft shadow, and the footer gets a layered light gray gradient like the dark one.

### Fixed

- On narrow phones the header wrapped onto several lines. The board name now stays on one line with an ellipsis, and the buttons and language tag are no longer squeezed.

## 1.8.0 — 2026-11-05

### Added

- View deleted tasks: the clock icon right of the language tag lists the `history` sheet, most recently deleted first. Search by title, description, Issue ID, column or assignee; 50 tasks are shown at a time. It only reads the Sheet, so the Apps Script doesn't need updating.

### Changed

- The light theme has more contrast: a white header, light gray page, gray columns and white cards instead of plain white throughout.

## 1.7.0 — 2026-11-05

### Added

- Switch between light and dark themes with the button left of the language switch. Existing users stay on the dark theme; new users start with their system setting, and the choice is remembered.

### Changed

- "User Key" in Settings is now "User Name". Only the name changed; any value you entered is kept.

## 1.6.0 — 2026-11-05

### Added

- An English README (`README.en.md`) and this changelog.

### Changed

- "Jira Link" and "Jira ID" are now "Issue Link" and "Issue ID", so they also fit GitHub and other issue trackers. Only the names changed; settings and data are unaffected.
- The README lists the `history` sheet with the others and describes its columns.

### Removed

- Code and packages left over from the project template that have nothing to do with the board, such as peer-to-peer file transfer, login and a sidebar. The site's files shrink from 996 KB to 848 KB.

## 1.5.0 — 2026-11-05

[#9](https://github.com/whlshy/SAF_Kanban/pull/9)

### Added

- A template Sheet: make a copy, share it, deploy, paste the URLs, and you're set up in 4 steps.
- Deleted tasks are kept in the `history` sheet with the time they were deleted. Needs the current Apps Script.
- Before writing, the Apps Script checks it's connected to the Sheet set for the board, so data never lands in another Sheet. Needs the current Apps Script.
- The Sheet ID and Apps Script Deployment ID fields accept pasted URLs and keep just the ID.
- Adding a board warns when its Sheet is already used by another board.
- With no boards yet, the page links to the template for creating a Google Sheet.

### Changed

- The Apps Script moved to `apps-script/Code.gs`, and `SPREADSHEET_ID` can be left empty.
- "Sheet API Key" is now "Apps Script Deployment ID". Only the name changed; settings are unaffected.
- The `users` sheet can list just names; the older ID-and-name format still works.
- Apps Script error messages follow the interface language.

## 1.4.0 — 2026-11-04

[#7](https://github.com/whlshy/SAF_Kanban/pull/7), [#8](https://github.com/whlshy/SAF_Kanban/pull/8)

### Added

- "SAF Kanban" in the footer links to the GitHub project.
- When a write fails, the message says why: no deployment ID set, the Apps Script can't be reached, or the script returned an error.

### Fixed

- Creating a task did nothing when the board's columns couldn't be read. The board now shows the likely cause.
- Blank rows in the `columns` sheet no longer become a column without a name.

## 1.3.0 — 2026-11-03

[#5](https://github.com/whlshy/SAF_Kanban/pull/5), [#6](https://github.com/whlshy/SAF_Kanban/pull/6)

### Added

- Export and import board settings. Before importing, boards are compared by name: duplicates must be renamed, and any board can be unchecked to skip it.
- With no boards yet, the page shows **Settings** and **Import** buttons.
- A language switch between Traditional Chinese and English.

### Changed

- Priorities read High / Medium / Low in both languages.

## 1.2.0 — 2026-11-02

[#3](https://github.com/whlshy/SAF_Kanban/pull/3), [#4](https://github.com/whlshy/SAF_Kanban/pull/4)

### Added

- Several boards: switch and add them from the menu on the board title. The address includes `?board=`, so each tab can show a different board. Existing settings become the first board automatically.
- The number of columns follows the `columns` sheet; when there are too many, the board scrolls sideways.

### Fixed

- In browsers whose scrollbars take up space, such as Edge, the page had an extra horizontal scrollbar.

## 1.1.0 — 2026-10-30

[#2](https://github.com/whlshy/SAF_Kanban/pull/2)

### Added

- A custom board title.

### Fixed

- Moving a task sometimes failed with an error saying the destination index can't be within the range being moved.

## 1.0.1 — 2026-10-07

[#1](https://github.com/whlshy/SAF_Kanban/pull/1)

### Fixed

- Dropping a task at the bottom of another column placed it second to last.

## 1.0.0 — 2026-01-26

- First release: a kanban board stored in Google Sheets, with adding, editing and deleting tasks, drag-and-drop ordering, and links to Jira issues.
