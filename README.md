# SAF Kanban

SAF Kanban 是一個使用 Google Sheet 儲存資料的個人看板。你不需要安裝程式或自行架設網站，只要建立自己的 Google Sheet 與 Apps Script，就能直接使用線上版本。

## 開啟 Kanban

[開啟 SAF Kanban](https://whlshy.github.io/SAF_Kanban/)

## 功能

- 建立、編輯與刪除 Task
- 自訂看板欄位
- 設定 Priority 與 Assignee
- 同欄及跨欄拖曳排序
- 每個欄位獨立捲動
- 連結 Jira Issue
- 所有資料儲存在你自己的 Google Sheet

## 1. 建立 Google Sheet

建立一份新的 Google Sheet，並將三個工作表命名為：

```text
kanban
columns
users
```

名稱必須完全相同，包含英文大小寫。

目前程式不會略過標題列，因此三張工作表都不要加入欄位標題，資料直接從第一列開始。

### `kanban` 工作表

這張表用來儲存 Task，每一列代表一個 Task，欄位順序固定為 A:G：

| 欄位 | 內容 | 範例 |
| --- | --- | --- |
| A | Task ID | `4836540b` |
| B | Title | `Implement login page` |
| C | Jira ID | `PROJECT-101` |
| D | Description | `Create login form` |
| E | Kanban Column | `Todo` |
| F | Priority | `high`、`medium`、`low` |
| G | Assignee | `王小明` |

`kanban` 工作表可以先保持空白。新增 Task 時，網站會自動產生 Task ID。

### `columns` 工作表

將看板欄位名稱依序放在 A 欄：

| A |
| --- |
| Todo |
| In Progress |
| Testing |
| Done |

目前畫面使用四欄，建議建立四筆資料。卡片在 `kanban` 工作表 E 欄的值必須與這裡的名稱完全相同。

### `users` 工作表

將可指派的使用者放在 A:B：

| A | B |
| --- | --- |
| `user-001` | 王小明 |
| `user-002` | 陳小華 |

A 欄是自訂 User ID，B 欄是 Assignee 下拉選單顯示及儲存的名稱。

## 2. 開放 Sheet 讀取權限

SAF Kanban 會從瀏覽器讀取你的 Google Sheet，因此需要設定：

```text
共用 → 一般存取權 → 知道連結的任何人 → 檢視者
```

只需提供檢視權限。資料寫入會由下一步建立的 Apps Script 執行，不需要開放其他人編輯 Sheet。

## 3. 建立 Apps Script

在 Google Sheet 上方選單開啟：

```text
擴充功能 → Apps Script
```

刪除預設程式，貼上以下完整內容：

```javascript
const SPREADSHEET_ID = "換成你的 Sheet ID";
const KANBAN_SHEET_NAME = "kanban";
const COLUMN_COUNT = 7;

function doGet(e) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var params = e && e.parameter ? e.parameter : {};
    var action = params.action || "";
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = spreadsheet.getSheetByName(KANBAN_SHEET_NAME);

    if (!sheet) {
      throw new Error("找不到工作表：" + KANBAN_SHEET_NAME);
    }

    switch (action) {
      case "upsert":
        return handleUpsert(sheet, params);
      case "move":
        return handleMove(sheet, params);
      case "delete":
        return handleDelete(sheet, params);
      default:
        throw new Error("不支援或缺少 action：" + action);
    }
  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: error.toString()
    });
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

function handleUpsert(sheet, params) {
  if (!params.task) {
    throw new Error("缺少 task 參數");
  }

  var task;

  try {
    task = JSON.parse(params.task);
  } catch (error) {
    throw new Error("task JSON 格式錯誤");
  }

  if (!task || !task.id) {
    throw new Error("Task 缺少 id");
  }

  var rowData = taskToRow(task);
  var rowNumber = findTaskRow(sheet, task.id);

  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, COLUMN_COUNT).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    rowNumber = sheet.getLastRow();
  }

  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    action: "upsert",
    id: task.id,
    row: rowNumber
  });
}

function handleMove(sheet, params) {
  var taskId = params.id;
  var newStatus = params.status;
  var beforeId = params.beforeId || "";
  var afterId = params.afterId || "";

  if (!taskId) {
    throw new Error("缺少 Task ID");
  }

  if (!newStatus) {
    throw new Error("缺少目標 Status");
  }

  var sourceRow = findTaskRow(sheet, taskId);

  if (!sourceRow) {
    throw new Error("找不到 Task：" + taskId);
  }

  sheet.getRange(sourceRow, 5).setValue(newStatus);

  if (beforeId && beforeId !== taskId) {
    var beforeRow = findTaskRow(sheet, beforeId);

    if (beforeRow) {
      moveRowBefore(sheet, sourceRow, beforeRow);
      SpreadsheetApp.flush();

      return createJsonResponse({
        status: "success",
        action: "move",
        id: taskId,
        statusValue: newStatus,
        position: "before",
        targetId: beforeId
      });
    }
  }

  if (afterId && afterId !== taskId) {
    var afterRow = findTaskRow(sheet, afterId);

    if (afterRow) {
      moveRowAfter(sheet, sourceRow, afterRow);
      SpreadsheetApp.flush();

      return createJsonResponse({
        status: "success",
        action: "move",
        id: taskId,
        statusValue: newStatus,
        position: "after",
        targetId: afterId
      });
    }
  }

  // 目標欄位原本沒有其他 Task，只需要更新 Status。
  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    action: "move",
    id: taskId,
    statusValue: newStatus,
    position: "only-item"
  });
}

function handleDelete(sheet, params) {
  var taskId = params.id;

  if (!taskId) {
    throw new Error("缺少 Task ID");
  }

  var rowNumber = findTaskRow(sheet, taskId);

  if (!rowNumber) {
    throw new Error("找不到 Task：" + taskId);
  }

  sheet.deleteRow(rowNumber);
  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    action: "delete",
    id: taskId
  });
}

function taskToRow(task) {
  return [
    normalizeValue(task.id),
    normalizeValue(task.title),
    normalizeValue(task.jiraId),
    normalizeValue(task.des),
    normalizeValue(task.task),
    normalizeValue(task.priority),
    normalizeValue(task.assignee)
  ];
}

function findTaskRow(sheet, taskId) {
  var lastRow = sheet.getLastRow();

  if (lastRow < 1) {
    return null;
  }

  var result = sheet
    .getRange(1, 1, lastRow, 1)
    .createTextFinder(taskId.toString())
    .matchEntireCell(true)
    .useRegularExpression(false)
    .findNext();

  return result ? result.getRow() : null;
}

function moveRowBefore(sheet, sourceRow, targetRow) {
  if (sourceRow === targetRow) {
    return;
  }

  sheet.moveRows(
    sheet.getRange(sourceRow, 1, 1, COLUMN_COUNT),
    targetRow
  );
}

function moveRowAfter(sheet, sourceRow, targetRow) {
  if (sourceRow === targetRow) {
    return;
  }

  sheet.moveRows(
    sheet.getRange(sourceRow, 1, 1, COLUMN_COUNT),
    targetRow + 1
  );
}

function normalizeValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return value.toString();
}

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### 找到 Sheet ID

Google Sheet 網址格式如下：

```text
https://docs.google.com/spreadsheets/d/SHEET_ID/edit
```

將 `/d/` 與 `/edit` 中間的字串填入 Apps Script 的 `SPREADSHEET_ID`。

## 4. 部署 Apps Script

1. 點選「部署」→「新增部署作業」。
2. 類型選擇「網頁應用程式」。
3. 執行身分選擇「我」。
4. 存取權限選擇「所有人」。
5. 按下部署並完成 Google 權限授權。
6. 複製產生的網頁應用程式 URL。

部署 URL 格式如下：

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

請記下 `DEPLOYMENT_ID`，也就是 `/s/` 與 `/exec` 中間的字串。

如果日後修改 Apps Script，只有按儲存不會更新線上版本。請進入：

```text
部署 → 管理部署 → 編輯 → 版本：新版本 → 部署
```

## 5. 連接 SAF Kanban

開啟 [SAF Kanban](https://whlshy.github.io/SAF_Kanban/)，點選右上角齒輪並填入：

| 設定 | 填入內容 |
| --- | --- |
| Sheet ID | Google Sheet URL 中的 `SHEET_ID` |
| Sheet API Key | Apps Script URL 中的 `DEPLOYMENT_ID` |
| User Key | 目前未使用，可留空 |
| Jira Link | Jira Issue 基底網址，可留空 |

請注意：這裡的 `Sheet API Key` 是 Apps Script 的 Deployment ID，不是 Google Cloud API Key。

Jira Link 範例：

```text
https://your-company.atlassian.net/browse/
```

設定會儲存在目前瀏覽器的 Local Storage。更換瀏覽器或清除網站資料後，需要重新輸入。

## 6. 測試 Kanban

完成設定後，建議依序測試：

1. 點右上角 `＋` 新增 Task。
2. 編輯 Title、Description、Priority 與 Assignee。
3. 在同一個欄位內拖曳調整順序。
4. 將 Task 拖曳到其他欄位。
5. 重新整理頁面，確認欄位及順序仍然正確。
6. 刪除 Task，確認 `kanban` 工作表中的對應列已移除。

## 常見問題

### 畫面沒有顯示欄位

確認工作表名稱是小寫 `columns`，而且資料從 A1 開始，中間沒有標題列。

### 畫面沒有顯示 Task

確認 `kanban` E 欄的值與 `columns` A 欄完全相同。

### 顯示 403 或無法讀取資料

確認 Google Sheet 已設成「知道連結的任何人皆可檢視」。

### Apps Script 回傳 `undefined is not valid JSON`

通常表示線上部署仍是舊版本。請到「管理部署」建立新版本，而不是只儲存程式碼。

### 修改 Apps Script 後沒有生效

重新執行：

```text
部署 → 管理部署 → 編輯 → 版本：新版本 → 部署
```

### Jira 連結無法開啟

確認 Jira Link 結尾包含 `/browse/`，例如：

```text
https://your-company.atlassian.net/browse/
```

## 資料與隱私

- Task 資料會保存在你自己的 Google Sheet。
- Sheet 必須開放知道連結者檢視，請勿存放密碼、Token 或其他敏感資料。
- Apps Script 會以建立者的 Google 帳號權限寫入指定 Sheet。
- Apps Script Deployment ID 應視為敏感資訊，不要任意公開分享。
- 目前刪除 Task 會直接刪除 Sheet 資料，不會保留歷史記錄。
