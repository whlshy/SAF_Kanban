/**
 * SAF Kanban Apps Script
 * https://github.com/whlshy/SAF_Kanban
 *
 * 設定與部署步驟請見 README。
 */

// 新版 Script 會在回應中帶上版本號，前端與 CLI 可據此判斷能使用哪些功能。
const SCRIPT_VERSION = 7;

// 通常留空：會使用這個 Apps Script 所屬的 Google Sheet。
// 只有 Script 不是從 Sheet 的「擴充功能 → Apps Script」建立時，才需要填入 Sheet ID。
const SPREADSHEET_ID = "";

const KANBAN_SHEET_NAME = "kanban";
const COLUMNS_SHEET_NAME = "columns";
const USERS_SHEET_NAME = "users";
const LABELS_SHEET_NAME = "labels";
const HISTORY_SHEET_NAME = "history";
// kanban 的 A～G 欄是 Task 的內容；H 欄是建立時間（只在新增時寫入），
// I 欄是最後一次移進目前欄位的時間（新增與跨欄移動時寫入），
// J 欄是逗號分隔的標籤（v6+）。
const COLUMN_COUNT = 7;
const CREATED_AT_COLUMN = 8;
const MOVED_AT_COLUMN = 9;
const LABELS_COLUMN = 10;
const HISTORY_COLUMN_COUNT = 11;
const HASH_COLOR_KEYS = ["red", "orange", "amber", "green", "teal", "blue", "indigo", "purple", "pink"];
const VALID_COLOR_SET = {
  red: true, orange: true, amber: true, green: true, teal: true,
  blue: true, indigo: true, purple: true, pink: true, gray: true
};

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  return handleRequest(params);
}

// v5+：支援以 POST 傳送 JSON body，解除長描述的 URL 長度限制。
function doPost(e) {
  var params = {};
  if (e && e.parameter) {
    for (var key in e.parameter) {
      if (Object.prototype.hasOwnProperty.call(e.parameter, key)) {
        params[key] = e.parameter[key];
      }
    }
  }
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (var prop in body) {
          if (Object.prototype.hasOwnProperty.call(body, prop)) {
            params[prop] = body[prop];
          }
        }
      }
    } catch (error) {
      return createJsonResponse({
        status: "error",
        code: "INVALID_BODY_JSON",
        params: {},
        message: "INVALID_BODY_JSON",
        version: SCRIPT_VERSION
      });
    }
  }
  return handleRequest(params);
}

function handleRequest(params) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

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
      case "read":
        return handleRead(spreadsheet, sheet);
      case "upsert":
        return handleUpsert(spreadsheet, sheet, params);
      case "saveLabels":
        return handleSaveLabels(spreadsheet, sheet, params);
      case "move":
        return handleMove(sheet, params);
      case "delete":
        return handleDelete(spreadsheet, sheet, params);
      case "restore":
        return handleRestore(spreadsheet, sheet, params);
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

function readDisplayRows(sheet, maxColumns) {
  if (!sheet) {
    return [];
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    return [];
  }
  var lastCol = Math.min(Math.max(sheet.getLastColumn(), 1), maxColumns);
  return sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
}

function handleRead(spreadsheet, kanbanSheet) {
  var columnRows = readDisplayRows(spreadsheet.getSheetByName(COLUMNS_SHEET_NAME), 2);
  var columns = [];
  for (var i = 0; i < columnRows.length; i++) {
    var colName = normalizeValue(columnRows[i][0]).trim();
    if (colName) {
      columns.push(colName);
    }
  }

  var userRows = readDisplayRows(spreadsheet.getSheetByName(USERS_SHEET_NAME), 2);
  var users = [];
  var seenUsers = {};
  for (var u = 0; u < userRows.length; u++) {
    var userName = normalizeValue(userRows[u][1] || userRows[u][0]).trim();
    if (userName && !seenUsers[userName]) {
      seenUsers[userName] = true;
      users.push(userName);
    }
  }

  var labelRows = readDisplayRows(spreadsheet.getSheetByName(LABELS_SHEET_NAME), 2);
  var labels = [];
  var seenLabels = {};
  for (var l = 0; l < labelRows.length; l++) {
    var labelName = normalizeValue(labelRows[l][0]).replace(/,/g, " ").trim();
    if (!labelName) {
      continue;
    }
    var labelKey = labelName.toLowerCase();
    if (seenLabels[labelKey]) {
      continue;
    }
    seenLabels[labelKey] = true;
    var labelColor = labelRows[l].length >= 2 ? normalizeValue(labelRows[l][1]).trim() : "";
    var def = { name: labelName };
    if (labelColor) {
      def.color = labelColor;
    }
    labels.push(def);
  }

  var taskRows = readDisplayRows(kanbanSheet, LABELS_COLUMN);
  var tasks = [];
  for (var t = 0; t < taskRows.length; t++) {
    var r = taskRows[t];
    var id = normalizeValue(r[0]);
    var title = normalizeValue(r[1]);
    if (!id && !title) {
      continue;
    }
    var item = {
      id: id,
      title: title,
      issueId: normalizeValue(r[2]),
      des: normalizeValue(r[3]),
      column: normalizeValue(r[4]),
      priority: normalizeValue(r[5]),
      assignee: normalizeValue(r[6])
    };
    if (r.length >= CREATED_AT_COLUMN && normalizeValue(r[7])) {
      item.createdAt = normalizeValue(r[7]);
    }
    if (r.length >= MOVED_AT_COLUMN && normalizeValue(r[8])) {
      item.movedAt = normalizeValue(r[8]);
    }
    if (r.length >= LABELS_COLUMN) {
      var taskLabels = parseLabelsValue(r[9]);
      if (taskLabels.length) {
        item.labels = taskLabels;
      }
    }
    tasks.push(item);
  }

  var historyRows = readDisplayRows(spreadsheet.getSheetByName(HISTORY_SHEET_NAME), HISTORY_COLUMN_COUNT);
  var history = [];
  for (var h = 0; h < historyRows.length; h++) {
    var hr = historyRows[h];
    var hid = normalizeValue(hr[0]);
    var htitle = normalizeValue(hr[1]);
    if (!hid && !htitle) {
      continue;
    }
    var hitem = {
      id: hid,
      title: htitle,
      issueId: normalizeValue(hr[2]),
      des: normalizeValue(hr[3]),
      column: normalizeValue(hr[4]),
      priority: normalizeValue(hr[5]),
      assignee: normalizeValue(hr[6]),
      deletedAt: hr.length >= 8 ? normalizeValue(hr[7]) : ""
    };
    if (hr.length >= 9 && normalizeValue(hr[8])) {
      hitem.createdAt = normalizeValue(hr[8]);
    }
    if (hr.length >= 10 && normalizeValue(hr[9])) {
      hitem.movedAt = normalizeValue(hr[9]);
    }
    if (hr.length >= 11) {
      var historyLabels = parseLabelsValue(hr[10]);
      if (historyLabels.length) {
        hitem.labels = historyLabels;
      }
    }
    history.push(hitem);
  }

  return createJsonResponse({
    status: "success",
    action: "read",
    version: SCRIPT_VERSION,
    id: spreadsheet.getId(),
    name: spreadsheet.getName(),
    columns: columns,
    users: users,
    labels: labels,
    tasks: tasks,
    history: history
  });
}

function ensureColumns(sheet, minColumns) {
  var maxCols = sheet.getMaxColumns();
  if (maxCols < minColumns) {
    sheet.insertColumnsAfter(maxCols, minColumns - maxCols);
  }
}

function handleUpsert(spreadsheet, sheet, params) {
  if (!params.task) {
    fail("MISSING_TASK");
  }

  var task;
  if (typeof params.task === "string") {
    try {
      task = JSON.parse(params.task);
    } catch (error) {
      fail("INVALID_TASK_JSON");
    }
  } else if (typeof params.task === "object") {
    task = params.task;
  } else {
    fail("INVALID_TASK_JSON");
  }

  if (!task || !task.id) {
    fail("MISSING_TASK_ID");
  }

  ensureColumns(sheet, LABELS_COLUMN);
  var rowNumber = findTaskRow(sheet, task.id);
  var hasLabelsPatch = task.labels !== undefined || task.addLabels !== undefined || task.removeLabels !== undefined;

  if (rowNumber) {
    if (task.appendDes !== undefined && task.appendDes !== null && String(task.appendDes) !== "") {
      var existingDes = normalizeValue(sheet.getRange(rowNumber, 4).getValue());
      var addition = String(task.appendDes);
      task.des = existingDes ? (existingDes + "\n\n" + addition) : addition;
    }
    var rowData = taskToRow(task);
    var oldStatus = normalizeValue(sheet.getRange(rowNumber, 5).getValue());
    sheet.getRange(rowNumber, 1, 1, COLUMN_COUNT).setValues([rowData]);
    if (oldStatus !== rowData[4]) {
      sheet.getRange(rowNumber, MOVED_AT_COLUMN)
        .setNumberFormat("@")
        .setValue(formatNow(sheet.getParent()));
    }
    if (hasLabelsPatch) {
      var baseLabels = task.labels !== undefined
        ? parseLabelsValue(task.labels)
        : parseLabelsValue(sheet.getRange(rowNumber, LABELS_COLUMN).getDisplayValue());
      var finalLabels = applyLabelMutations(baseLabels, task.addLabels, task.removeLabels);
      sheet.getRange(rowNumber, LABELS_COLUMN)
        .setNumberFormat("@")
        .setValue(finalLabels.join(", "));
      if (finalLabels.length) {
        syncBoardLabels(spreadsheet, finalLabels);
      }
    }
  } else {
    if ((task.des === undefined || task.des === null || task.des === "") && task.appendDes) {
      task.des = String(task.appendDes);
    }
    var newRowData = taskToRow(task);
    sheet.appendRow(newRowData);
    rowNumber = sheet.getLastRow();
    var now = formatNow(sheet.getParent());
    var initialLabels = applyLabelMutations(parseLabelsValue(task.labels), task.addLabels, task.removeLabels);
    // 設成純文字，Sheet 才不會把時間改成依地區顯示的日期格式。
    sheet.getRange(rowNumber, CREATED_AT_COLUMN, 1, 3)
      .setNumberFormat("@")
      .setValues([[now, now, initialLabels.join(", ")]]);
    if (initialLabels.length) {
      syncBoardLabels(spreadsheet, initialLabels);
    }
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

function hashLabelColor(name) {
  var text = normalizeValue(name).trim().toLowerCase();
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return HASH_COLOR_KEYS[Math.abs(hash) % HASH_COLOR_KEYS.length];
}

function normalizeLabelColor(color) {
  var clean = normalizeValue(color).trim().toLowerCase();
  if (!clean) {
    return "";
  }
  if (VALID_COLOR_SET[clean]) {
    return clean;
  }
  if (/^#[0-9a-f]{6}$/.test(clean)) {
    return clean;
  }
  return "";
}

// 任務上新增尚未存在於全域清單的標籤時，自動補入 labels 工作表並附上對應雜湊色。
function syncBoardLabels(spreadsheet, taskLabels) {
  if (!taskLabels || !taskLabels.length) {
    return;
  }
  var labelsSheet = spreadsheet.getSheetByName(LABELS_SHEET_NAME);
  var existingRows = readDisplayRows(labelsSheet, 2);
  var existingSet = {};
  for (var i = 0; i < existingRows.length; i++) {
    var existingName = normalizeValue(existingRows[i][0]).replace(/,/g, " ").trim();
    if (existingName) {
      existingSet[existingName.toLowerCase()] = true;
    }
  }
  var toAppend = [];
  for (var j = 0; j < taskLabels.length; j++) {
    var name = normalizeValue(taskLabels[j]).replace(/,/g, " ").trim();
    if (!name) {
      continue;
    }
    var key = name.toLowerCase();
    if (existingSet[key]) {
      continue;
    }
    existingSet[key] = true;
    toAppend.push([name, hashLabelColor(name)]);
  }
  if (!toAppend.length) {
    return;
  }
  var targetSheet = labelsSheet || getOrCreateSheet(spreadsheet, LABELS_SHEET_NAME);
  ensureColumns(targetSheet, 2);
  var startRow = targetSheet.getLastRow() + 1;
  targetSheet.getRange(startRow, 1, toAppend.length, 2)
    .setNumberFormat("@")
    .setValues(toAppend);
}

// v7+：更新 labels 工作表（支援改名同步更新 kanban J 欄，並禁止刪除仍被任務使用的標籤）。
function handleSaveLabels(spreadsheet, kanbanSheet, params) {
  var rawLabels = params.labels;
  if (typeof rawLabels === "string") {
    try {
      rawLabels = JSON.parse(rawLabels);
    } catch (error) {
      fail("INVALID_LABELS_JSON");
    }
  }
  if (!Array.isArray(rawLabels)) {
    fail("INVALID_LABELS_JSON");
  }

  var rawRenames = params.renames || {};
  if (typeof rawRenames === "string") {
    try {
      rawRenames = JSON.parse(rawRenames);
    } catch (error) {
      fail("INVALID_LABELS_JSON");
    }
  }
  if (!rawRenames || typeof rawRenames !== "object" || Array.isArray(rawRenames)) {
    rawRenames = {};
  }

  var normalized = [];
  var allowedSet = {};
  for (var i = 0; i < rawLabels.length; i++) {
    var entry = rawLabels[i];
    var rawName = typeof entry === "string" ? entry : (entry && entry.name);
    var name = normalizeValue(rawName).replace(/,/g, " ").trim();
    if (!name) {
      continue;
    }
    var key = name.toLowerCase();
    if (allowedSet[key]) {
      fail("DUPLICATE_LABEL", { label: name });
    }
    allowedSet[key] = true;
    var color = typeof entry === "string" ? "" : normalizeLabelColor(entry && entry.color);
    normalized.push(color ? { name: name, color: color } : { name: name });
  }

  var renameMap = {};
  for (var fromKey in rawRenames) {
    if (!Object.prototype.hasOwnProperty.call(rawRenames, fromKey)) {
      continue;
    }
    var fromClean = normalizeValue(fromKey).replace(/,/g, " ").trim().toLowerCase();
    var toClean = normalizeValue(rawRenames[fromKey]).replace(/,/g, " ").trim();
    if (fromClean && toClean) {
      renameMap[fromClean] = toClean;
    }
  }

  // 檢查所有任務套用改名後的標籤：只要有任何任務仍使用不在新清單內的標籤就拒絕刪除。
  var taskRows = readDisplayRows(kanbanSheet, LABELS_COLUMN);
  var rewrittenColumn = [];
  var hasRewrites = false;
  var missingCounts = {};
  var missingDisplay = {};

  for (var r = 0; r < taskRows.length; r++) {
    var row = taskRows[r];
    var currentLabels = row.length >= LABELS_COLUMN ? parseLabelsValue(row[9]) : [];
    var mapped = [];
    var seenInTask = {};
    var changed = false;
    for (var k = 0; k < currentLabels.length; k++) {
      var orig = currentLabels[k];
      var renamed = renameMap[orig.toLowerCase()] || orig;
      if (renamed !== orig) {
        changed = true;
      }
      var rKey = renamed.toLowerCase();
      if (!seenInTask[rKey]) {
        seenInTask[rKey] = true;
        mapped.push(renamed);
      } else {
        changed = true;
      }
      if (!allowedSet[rKey]) {
        missingCounts[rKey] = (missingCounts[rKey] || 0) + 1;
        if (!missingDisplay[rKey]) {
          missingDisplay[rKey] = renamed;
        }
      }
    }
    if (changed) {
      hasRewrites = true;
    }
    rewrittenColumn.push([mapped.join(", ")]);
  }

  for (var missingKey in missingCounts) {
    if (Object.prototype.hasOwnProperty.call(missingCounts, missingKey)) {
      fail("LABEL_IN_USE", { label: missingDisplay[missingKey], count: missingCounts[missingKey] });
    }
  }

  if (hasRewrites && taskRows.length > 0) {
    ensureColumns(kanbanSheet, LABELS_COLUMN);
    kanbanSheet.getRange(1, LABELS_COLUMN, taskRows.length, 1)
      .setNumberFormat("@")
      .setValues(rewrittenColumn);
  }

  var labelsSheet = getOrCreateSheet(spreadsheet, LABELS_SHEET_NAME);
  ensureColumns(labelsSheet, 2);
  labelsSheet.clearContents();
  if (normalized.length > 0) {
    var rowsToWrite = [];
    for (var n = 0; n < normalized.length; n++) {
      rowsToWrite.push([normalized[n].name, normalized[n].color || ""]);
    }
    labelsSheet.getRange(1, 1, rowsToWrite.length, 2)
      .setNumberFormat("@")
      .setValues(rowsToWrite);
  }

  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    action: "saveLabels",
    labels: normalized,
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

  var oldStatus = normalizeValue(sheet.getRange(sourceRow, 5).getValue());
  sheet.getRange(sourceRow, 5).setValue(newStatus);
  if (oldStatus !== normalizeValue(newStatus)) {
    sheet.getRange(sourceRow, MOVED_AT_COLUMN)
      .setNumberFormat("@")
      .setValue(formatNow(sheet.getParent()));
  }

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

  // 刪除前把最後的狀態存到 history：A～G 同 kanban，H 欄是刪除時間，I 欄是建立時間，J 欄是移入目前欄位的時間，K 欄是標籤（v6+）。
  ensureColumns(sheet, LABELS_COLUMN);
  var lastState = sheet.getRange(rowNumber, 1, 1, LABELS_COLUMN).getDisplayValues()[0];
  var labels = lastState.pop();
  var movedAt = lastState.pop();
  var createdAt = lastState.pop();
  var historySheet = getOrCreateSheet(spreadsheet, HISTORY_SHEET_NAME);
  ensureColumns(historySheet, HISTORY_COLUMN_COUNT);
  var newHistoryRow = historySheet.getLastRow() + 1;
  historySheet.getRange(newHistoryRow, 1, 1, HISTORY_COLUMN_COUNT)
    .setNumberFormat("@")
    .setValues([lastState.concat([formatNow(spreadsheet), createdAt, movedAt, labels])]);

  sheet.deleteRow(rowNumber);
  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    action: "delete",
    id: taskId,
    version: SCRIPT_VERSION
  });
}

function handleRestore(spreadsheet, sheet, params) {
  var taskId = normalizeValue(params.id);
  if (!taskId) {
    fail("MISSING_TASK_ID");
  }
  if (findTaskRow(sheet, taskId)) {
    fail("DUPLICATE_TASK_ID", { id: taskId });
  }

  var historySheet = spreadsheet.getSheetByName(HISTORY_SHEET_NAME);
  if (!historySheet || historySheet.getLastRow() < 1) {
    fail("TASK_NOT_FOUND", { id: taskId });
  }

  var rows = readDisplayRows(historySheet, HISTORY_COLUMN_COUNT);
  var foundIndex = -1;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (normalizeValue(rows[i][0]) === taskId) {
      foundIndex = i;
      break;
    }
  }
  if (foundIndex < 0) {
    fail("TASK_NOT_FOUND", { id: taskId });
  }

  var row = rows[foundIndex];
  var targetColumn = normalizeValue(params.column) || normalizeValue(row[4]);
  var now = formatNow(spreadsheet);
  var createdAt = (row.length >= 9 && normalizeValue(row[8])) ? normalizeValue(row[8]) : now;
  var originalMovedAt = (row.length >= 10 && normalizeValue(row[9])) ? normalizeValue(row[9]) : createdAt;
  var movedAt = (targetColumn !== normalizeValue(row[4])) ? now : originalMovedAt;
  var labels = (row.length >= 11) ? parseLabelsValue(row[10]).join(", ") : "";

  var restoredRow = [
    normalizeValue(row[0]),
    normalizeValue(row[1]),
    normalizeValue(row[2]),
    normalizeValue(row[3]),
    targetColumn,
    normalizeValue(row[5]),
    normalizeValue(row[6])
  ];
  ensureColumns(sheet, LABELS_COLUMN);
  sheet.appendRow(restoredRow);
  var insertedRow = sheet.getLastRow();
  sheet.getRange(insertedRow, CREATED_AT_COLUMN, 1, 3)
    .setNumberFormat("@")
    .setValues([[createdAt, movedAt, labels]]);
  if (labels) {
    syncBoardLabels(spreadsheet, parseLabelsValue(labels));
  }

  var beforeId = normalizeValue(params.beforeId);
  var afterId = normalizeValue(params.afterId);
  if (beforeId && beforeId !== taskId) {
    var beforeRow = findTaskRow(sheet, beforeId);
    if (beforeRow) {
      moveRowBefore(sheet, insertedRow, beforeRow);
    }
  } else if (afterId && afterId !== taskId) {
    var afterRow = findTaskRow(sheet, afterId);
    if (afterRow) {
      moveRowAfter(sheet, insertedRow, afterRow);
    }
  }

  historySheet.deleteRow(foundIndex + 1);
  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    action: "restore",
    id: taskId,
    column: targetColumn,
    version: SCRIPT_VERSION
  });
}

function parseLabelsValue(value) {
  var raw = [];
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) {
      var parts = normalizeValue(value[i]).split(",");
      for (var p = 0; p < parts.length; p++) {
        raw.push(parts[p]);
      }
    }
  } else if (value !== null && value !== undefined) {
    raw = normalizeValue(value).split(",");
  }

  var result = [];
  var seen = {};
  for (var j = 0; j < raw.length; j++) {
    var clean = raw[j].trim();
    if (!clean) {
      continue;
    }
    var key = clean.toLowerCase();
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    result.push(clean);
  }
  return result;
}

function applyLabelMutations(baseLabels, addLabels, removeLabels) {
  var list = parseLabelsValue(baseLabels);
  var toAdd = parseLabelsValue(addLabels);
  var toRemove = parseLabelsValue(removeLabels);
  var removeSet = {};
  for (var r = 0; r < toRemove.length; r++) {
    removeSet[toRemove[r].toLowerCase()] = true;
  }

  var filtered = [];
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var key = list[i].toLowerCase();
    if (removeSet[key] || seen[key]) {
      continue;
    }
    seen[key] = true;
    filtered.push(list[i]);
  }
  for (var a = 0; a < toAdd.length; a++) {
    var addKey = toAdd[a].toLowerCase();
    if (removeSet[addKey] || seen[addKey]) {
      continue;
    }
    seen[addKey] = true;
    filtered.push(toAdd[a]);
  }
  return filtered;
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
