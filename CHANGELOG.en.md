# Changelog

[繁體中文](CHANGELOG.md) | English

Website changes take effect as soon as they're released. The Apps Script has to be updated by you, as described in [Update the Apps Script](README.en.md#update-the-apps-script); features marked "needs the current Apps Script" only work after that update.

## Apps Script versions

| Version | Released with | Changes |
| --- | --- | --- |
| v2 | 1.5.0 | Keeps deleted tasks in the `history` sheet; checks it's connected to the board's Sheet before writing; returns error codes and its version; adds `action=info` |
| v1 | 1.0.0 | The script embedded in the README before 1.5.0 |

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
