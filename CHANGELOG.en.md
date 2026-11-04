# Changelog

[繁體中文](CHANGELOG.md) | English

Website changes take effect as soon as they're released. The Apps Script has to be updated by you, as described in [Update the Apps Script](README.en.md#update-the-apps-script); features marked "needs the current Apps Script" only work after that update.

## Apps Script versions

| Version | Released with | Changes |
| --- | --- | --- |
| v2 | 1.5.0 | Keeps deleted tasks in the `history` sheet; checks it's connected to the board's Sheet before writing; returns error codes and its version; adds `action=info` |
| v1 | 1.0.0 | The script embedded in the README before 1.5.0 |

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
