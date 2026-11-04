# SAF Kanban

[繁體中文](README.md) | English

SAF Kanban is a personal kanban board that stores its data in Google Sheets. There is nothing to install and no server to host: create your own Google Sheet and Apps Script, then use the online version.

## Open the board

[Open SAF Kanban](https://whlshy.github.io/SAF_Kanban/)

See the [changelog](CHANGELOG.en.md) for what changed in each release.

## Features

- Create, edit and delete tasks
- Custom board columns, as many as you need
- Several boards at once, each connected to its own Google Sheet
- Export and import board settings to move to another computer or keep a backup
- Interface in Traditional Chinese and English: switch with the language button at the top right
- Priority and assignee per task
- Drag to reorder within a column and to move between columns
- Each column scrolls on its own
- Links to Jira, GitHub or other issue trackers
- Deleted tasks are kept in a `history` sheet
- All data stays in your own Google Sheet

## Quick setup (recommended)

Start from the template: no sheets to create and no code to edit.

1. Open the [SAF Kanban template](https://docs.google.com/spreadsheets/d/1-gsXi8JZQrIwAiK6q2koaPp0resipV-G_0YFYOja7yc/copy) and click **Make a copy** to save it to your Google Drive. The template already contains the sheets and the Apps Script.
2. In your copy, click **Share** at the top right and set **General access** to **Anyone with the link** as a **Viewer**.
3. Choose **Extensions → Apps Script**, deploy it as a web app as described in [step 4](#4-deploy-the-apps-script), and copy the deployment URL.
4. Open [SAF Kanban](https://whlshy.github.io/SAF_Kanban/) and add a board (with no boards yet, click **Settings** in the middle of the page). Paste your copy's URL into **Sheet ID** and the deployment URL into **Apps Script Deployment ID**, then click **Create**.

URLs are turned into IDs automatically, so you don't need to cut them out yourself. If your copy has no Apps Script, or you'd rather set everything up yourself, follow steps 1–5 below.

## 1. Create the Google Sheet

Create a new Google Sheet with four sheets named:

```text
kanban
columns
users
history
```

The names must match exactly, including case. If you don't create `history`, the Apps Script creates it the first time a task is deleted.

Header rows are not skipped, so don't add column headers to any sheet: data starts on the first row.

### `kanban` sheet

Stores the tasks, one task per row, with columns A:G in this order:

| Column | Content | Example |
| --- | --- | --- |
| A | Task ID | `4836540b` |
| B | Title | `Implement login page` |
| C | Issue ID | `PROJECT-101` |
| D | Description | `Create login form` |
| E | Kanban Column | `Todo` |
| F | Priority | `high`, `medium`, `low` |
| G | Assignee | `Alice` |

The `kanban` sheet can start empty. New tasks get a Task ID from the site automatically.

### `columns` sheet

List the board's column names in column A, in order:

| A |
| --- |
| Todo |
| In Progress |
| Testing |
| Done |

There is no limit on the number of columns: they share the page width evenly, and the board scrolls sideways once they no longer fit. A task's value in column E of `kanban` must match one of these names exactly.

### `users` sheet

Put the names of people tasks can be assigned to in column A. They appear in the assignee drop-down:

| A |
| --- |
| Alice |
| Bob |

The older format (user ID in column A, name in column B) still works: when column B is filled, its name is used.

### `history` sheet

Keeps deleted tasks and can start empty. When a task is deleted, the Apps Script first copies its last state here, then removes it from `kanban`:

| Column | Content | Example |
| --- | --- | --- |
| A–G | Same as the `kanban` sheet: Task ID, Title, Issue ID, Description, Kanban Column, Priority, Assignee | |
| H | When it was deleted (in the Sheet's time zone) | `2026-11-04 15:30:00` |

This needs the [current Apps Script](#update-the-apps-script). Older scripts delete tasks without saving them here.

## 2. Let SAF Kanban read the Sheet

SAF Kanban reads your Google Sheet from the browser, so set:

```text
Share → General access → Anyone with the link → Viewer
```

Viewer access is enough. Writes go through the Apps Script from the next step, so nobody else needs edit access to the Sheet.

## 3. Create the Apps Script

In the Google Sheet menu, open:

```text
Extensions → Apps Script
```

Delete the default code, paste the full contents of [`apps-script/Code.gs`](apps-script/Code.gs) and save. On GitHub, the **Copy raw file** button at the top right of that file copies all of it at once.

Leave `SPREADSHEET_ID` at the top of the script empty: the script then uses this Sheet. You only need to fill it in if the script wasn't created from the Sheet's **Extensions → Apps Script**; if you do, it must be the ID of **this same** Sheet.

### Find the Sheet ID

A Google Sheet URL looks like this:

```text
https://docs.google.com/spreadsheets/d/SHEET_ID/edit
```

The part between `/d/` and `/edit` is the Sheet ID. In step 5 you can paste the whole URL and SAF Kanban takes the Sheet ID from it.

## 4. Deploy the Apps Script

1. Click **Deploy → New deployment**.
2. Select the type **Web app**.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone**.
5. Click **Deploy** and authorize the script with your Google account.
6. Copy the web app URL.

The deployment URL looks like this:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

The part between `/s/` and `/exec` is the deployment ID. In step 5 you can paste the whole URL and SAF Kanban takes the deployment ID from it.

Saving changes to the Apps Script does not update the live version. To publish them, go to:

```text
Deploy → Manage deployments → Edit → Version: New version → Deploy
```

## 5. Connect SAF Kanban

Open [SAF Kanban](https://whlshy.github.io/SAF_Kanban/), click the gear icon at the top right and fill in:

| Setting | Value |
| --- | --- |
| Title | Shown at the top left; optional |
| Sheet ID | The Google Sheet's URL, or the `SHEET_ID` in it |
| Apps Script Deployment ID | The web app URL from your deployment, or the `DEPLOYMENT_ID` in it |
| User Key | Not used yet; leave empty |
| Issue Link | The base URL of your issues; a task's Issue ID is appended to it. Optional |

The Apps Script Deployment ID comes from the Apps Script you deployed yourself; you don't need a Google Cloud API key. Older versions of the site called this field "Sheet API Key".

Issue Link examples:

| Tracker | Issue Link |
| --- | --- |
| Jira | `https://your-company.atlassian.net/browse/` |
| GitHub Issues | `https://github.com/OWNER/REPO/issues/` |

Older versions called the Issue Link "Jira Link" and a task's Issue ID "Jira ID". The rename doesn't affect your settings or data.

Settings are stored in this browser's Local Storage. After switching browsers or clearing site data, enter them again (or [import](#export-and-import-settings) them).

### Use several boards

Each board is connected to its own Google Sheet and Apps Script. To add a board, first create another Sheet and Apps Script with the [quick setup](#quick-setup-recommended) or steps 1–4, then:

1. Click the board name at the top left to open the board menu.
2. Choose **New board**, enter a title, paste the Sheet URL and the deployment URL, and click **Create**.
3. Switch boards from the same menu.

- The address includes `?board=<board ID>`, so you can bookmark a board or open boards in separate tabs.
- To edit or delete a board, switch to it and click the gear icon. Deleting a board only removes its settings from this browser; the Google Sheet data is not deleted.
- When upgrading from the single-board version, your existing settings become the first board automatically.

### Export and import settings

Settings live only in the current browser. To move to another computer or browser, or to keep a backup, export them to a file and import it:

1. Click the board name at the top left and choose **Export settings**. This downloads a JSON file with every board's settings.
2. In the other browser, click the board name and choose **Import settings**, then pick the file. With no boards yet, click **Import** in the middle of the page.
3. Before importing, the boards are compared with your current ones by name: rename any duplicates, uncheck those you don't want, then click **Import**.

The exported file contains the Apps Script Deployment IDs, so anyone who has it can write to your Sheets. Keep it private and don't share it publicly.

### Update the Apps Script

When [`apps-script/Code.gs`](apps-script/Code.gs) is updated, older scripts keep working but don't get the new features. The [changelog](CHANGELOG.en.md#apps-script-versions) lists what each script version adds. The current script:

- Saves deleted tasks to the `history` sheet.
- Checks that it's connected to the Sheet set for the board, and refuses to write otherwise so data never lands in the wrong Sheet.
- Lets error messages follow the interface language.

To update:

1. Open the Sheet's **Extensions → Apps Script** and replace all the code with `apps-script/Code.gs`. If you had filled in `SPREADSHEET_ID`, you can keep it or clear it.
2. Save, then go to **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**.

Updated this way, the deployment ID stays the same and nothing changes in your SAF Kanban settings.

## 6. Try it out

Once set up, try these in order:

1. Click `＋` at the top right to add a task.
2. Edit its title, description, priority and assignee.
3. Drag it to reorder within a column.
4. Drag it to another column.
5. Reload the page and check that columns and order are still right.
6. Delete the task and check that its row is gone from the `kanban` sheet.

## FAQ

### The columns don't show up

Check that the sheet is named `columns` in lowercase and that the data starts at A1 with no header row.

### Tasks don't show up

Check that column E of `kanban` matches a name in column A of `columns` exactly.

### 403 errors, or the data can't be read

Check that the Google Sheet is shared with **Anyone with the link** as a viewer.

### A CORS error, or tasks can't be added or moved

`has been blocked by CORS policy` in the browser console (F12) usually isn't a cross-origin setting: it means the Apps Script didn't return normal JSON. Check in order:

1. The script's `SPREADSHEET_ID` is this Sheet's ID, or empty.
2. The deployment's access is **Anyone**, not **Only myself** or **Anyone with Google account**.
3. The Apps Script Deployment ID in SAF Kanban's settings belongs to this script.
4. After changing the script or the deployment, you published it with **Manage deployments → Edit → Version: New version → Deploy**.

To check, open the deployment URL `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` directly in an **incognito window**:

- JSON such as `{"status":"error","code":"UNKNOWN_ACTION", ...}` (older scripts reply with a Chinese message about a missing action) means the deployment works.
- A "You need access" page or a Google sign-in page means the access isn't set to **Anyone**.
- Company Google Workspace accounts may not offer **Anyone** at all. In that case, create the Sheet and Apps Script with a personal Google account.

### The Apps Script returns `undefined is not valid JSON`

Usually the live deployment is still an old version. Create a new version in **Manage deployments** instead of only saving the code.

### Changes to the Apps Script have no effect

Publish them again:

```text
Deploy → Manage deployments → Edit → Version: New version → Deploy
```

### Issue links don't open

Clicking a task's Issue ID opens the Issue Link followed by the Issue ID. Check that the Issue Link ends correctly, for example with `/browse/` for Jira or `/issues/` for GitHub:

```text
https://your-company.atlassian.net/browse/
https://github.com/OWNER/REPO/issues/
```

## Data and privacy

- Your tasks are stored in your own Google Sheet.
- The Sheet has to be viewable by anyone with the link, so don't store passwords, tokens or other sensitive data in it.
- The Apps Script writes to the Sheet with the permissions of the Google account that created it.
- Treat the Apps Script Deployment ID as sensitive and don't share it publicly.
- With the current Apps Script, deleted tasks are kept in the `history` sheet; older scripts delete them without keeping a copy.
