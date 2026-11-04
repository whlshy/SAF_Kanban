/**
 * SAF Kanban Apps Script
 * https://github.com/whlshy/SAF_Kanban
 *
 * 設定與部署步驟請見 README。
 */

// 新版 Script 會在回應中帶上版本號，前端可據此判斷能使用哪些功能。
const SCRIPT_VERSION = 2;

// 通常留空：會使用這個 Apps Script 所屬的 Google Sheet。
// 只有 Script 不是從 Sheet 的「擴充功能 → Apps Script」建立時，才需要填入 Sheet ID。
const SPREADSHEET_ID = "";

const KANBAN_SHEET_NAME = "kanban";
const HISTORY_SHEET_NAME = "history";
const COLUMN_COUNT = 7;

function doGet(e) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var params = e && e.parameter ? e.parameter : {};
    var action = params.action || "";
    var spreadsheet = getSpreadsheet();

    if (action === "info") {
      return createJsonResponse({
        status: "success",
        action: "info",
        version: SCRIPT_VERSION,
        id: spreadsheet.getId(),
        name: spreadsheet.getName()
      });
    }

    // SAF Kanban 會帶上看板設定的 Sheet ID；不一致時拒絕寫入，避免寫到別份 Sheet。
    if (params.sheetId && String(params.sheetId).trim() !== spreadsheet.getId()) {
      fail("SHEET_MISMATCH", { name: spreadsheet.getName() });
    }

    var sheet = spreadsheet.getSheetByName(KANBAN_SHEET_NAME);

    if (!sheet) {
      fail("SHEET_NOT_FOUND", { name: KANBAN_SHEET_NAME });
    }

    switch (action) {
      case "upsert":
        return handleUpsert(sheet, params);
      case "move":
        return handleMove(sheet, params);
      case "delete":
        return handleDelete(spreadsheet, sheet, params);
      default:
        fail("UNKNOWN_ACTION", { action: action });
    }
  } catch (error) {
    // 只回傳錯誤代碼，由 SAF Kanban 翻譯成目前的介面語言。
    // message 給舊版網頁顯示：自訂錯誤就是代碼本身，Google 丟出的例外則保留原文。
    return createJsonResponse({
      status: "error",
      code: error.code || "UNKNOWN",
      params: error.params || {},
      message: error.message || String(error),
      version: SCRIPT_VERSION
    });
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

// 有填 SPREADSHEET_ID 就用它，否則使用 Script 所屬的 Sheet。
function getSpreadsheet() {
  var spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    fail("SPREADSHEET_NOT_FOUND");
  }

  return spreadsheet;
}

function handleUpsert(sheet, params) {
  if (!params.task) {
    fail("MISSING_TASK");
  }

  var task;

  try {
    task = JSON.parse(params.task);
  } catch (error) {
    fail("INVALID_TASK_JSON");
  }

  if (!task || !task.id) {
    fail("MISSING_TASK_ID");
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
    row: rowNumber,
    version: SCRIPT_VERSION
  });
}

function handleMove(sheet, params) {
  var taskId = params.id;
  var newStatus = params.status;
  var beforeId = params.beforeId || "";
  var afterId = params.afterId || "";

  if (!taskId) {
    fail("MISSING_TASK_ID");
  }

  if (!newStatus) {
    fail("MISSING_STATUS");
  }

  var sourceRow = findTaskRow(sheet, taskId);

  if (!sourceRow) {
    fail("TASK_NOT_FOUND", { id: taskId });
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
        targetId: beforeId,
        version: SCRIPT_VERSION
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
        targetId: afterId,
        version: SCRIPT_VERSION
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
    position: "only-item",
    version: SCRIPT_VERSION
  });
}

function handleDelete(spreadsheet, sheet, params) {
  var taskId = params.id;

  if (!taskId) {
    fail("MISSING_TASK_ID");
  }

  var rowNumber = findTaskRow(sheet, taskId);

  if (!rowNumber) {
    fail("TASK_NOT_FOUND", { id: taskId });
  }

  // 刪除前把最後的狀態存到 history，H 欄是刪除時間。
  var lastState = sheet.getRange(rowNumber, 1, 1, COLUMN_COUNT).getValues()[0];
  getOrCreateSheet(spreadsheet, HISTORY_SHEET_NAME).appendRow(lastState.concat([formatNow(spreadsheet)]));

  sheet.deleteRow(rowNumber);
  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    action: "delete",
    id: taskId,
    version: SCRIPT_VERSION
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
  moveRowTo(sheet, sourceRow, targetRow);
}

function moveRowAfter(sheet, sourceRow, targetRow) {
  moveRowTo(sheet, sourceRow, targetRow + 1);
}

function moveRowTo(sheet, sourceRow, destinationIndex) {
  // 已經在目標位置時，moveRows 會丟出「目的地索引不得位於遭到移動的維度範圍中」
  if (destinationIndex === sourceRow || destinationIndex === sourceRow + 1) {
    return;
  }

  sheet.moveRows(
    sheet.getRange(sourceRow, 1, 1, COLUMN_COUNT),
    destinationIndex
  );
}

function getOrCreateSheet(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function formatNow(spreadsheet) {
  return Utilities.formatDate(new Date(), spreadsheet.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function normalizeValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return value.toString();
}

function fail(code, params) {
  var error = new Error(code);
  error.code = code;
  error.params = params || {};
  throw error;
}

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
