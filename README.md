# SAF Kanban

繁體中文 | [English](README.en.md)

SAF Kanban 是一個使用 Google Sheet 儲存資料的個人看板。你不需要安裝程式或自行架設網站，只要建立自己的 Google Sheet 與 Apps Script，就能直接使用線上版本。

## 開啟 Kanban

[開啟 SAF Kanban](https://whlshy.github.io/SAF_Kanban/)

每次更新的內容請見[版本紀錄](CHANGELOG.md)。

## 功能

- 建立、編輯與刪除 Task
- 自訂看板欄位，欄位數量不限
- 同時使用多個看板，各自連到不同的 Google Sheet
- 匯出、匯入看板設定，方便換電腦或備份
- 介面支援繁體中文與 English，點右上角的語言按鈕切換
- 淺色與深色主題，點右上角的太陽或月亮圖示切換
- 設定 Priority 與 Assignee
- 同欄及跨欄拖曳排序；手機上長按 Task 再拖曳
- 每個欄位獨立捲動；手機直式時每個欄位佔滿寬度，左右滑動切換
- 連結 Jira、GitHub 等 Issue
- 刪除的 Task 會保留在 `history` 工作表，並可在網站上由新到舊查看、搜尋
- 所有資料儲存在你自己的 Google Sheet

## 快速建立（推薦）

用範本建立，不需要自己建工作表，也不用修改程式：

1. 開啟 [SAF Kanban 範本](https://docs.google.com/spreadsheets/d/1-gsXi8JZQrIwAiK6q2koaPp0resipV-G_0YFYOja7yc/copy)，按「建立副本」，存到自己的 Google 雲端硬碟。範本已包含工作表與 Apps Script。
2. 在副本點右上角「共用」，「一般存取權」改成「知道連結的任何人」，角色選「檢視者」。
3. 選「擴充功能 → Apps Script」，依照[第 4 步](#4-部署-apps-script)部署成網頁應用程式，並複製部署後的網址。
4. 開啟 [SAF Kanban](https://whlshy.github.io/SAF_Kanban/)，新增看板（還沒有看板時點畫面中間的「設定」）。在 Sheet ID 貼上副本的網址，在 Apps Script 部署 ID 貼上部署網址，按「建立」。

網址會自動轉成 ID，不需要自己擷取。如果複製出來的副本沒有 Apps Script，或想自己從頭建立，請依照以下第 1～5 步。

## 1. 建立 Google Sheet

建立一份新的 Google Sheet，並將四個工作表命名為：

```text
kanban
columns
users
history
```

名稱必須完全相同，包含英文大小寫。`history` 如果沒有建立，第一次刪除 Task 時 Apps Script 也會自動建立。

目前程式不會略過標題列，因此工作表都不要加入欄位標題，資料直接從第一列開始。

### `kanban` 工作表

這張表用來儲存 Task，每一列代表一個 Task，欄位順序固定為 A:G：

| 欄位 | 內容 | 範例 |
| --- | --- | --- |
| A | Task ID | `4836540b` |
| B | Title | `Implement login page` |
| C | Issue ID | `PROJECT-101` |
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

欄位數量不限，畫面會依欄位數平均分配寬度；欄位太多放不下時，看板可以左右捲動。卡片在 `kanban` 工作表 E 欄的值必須與這裡的名稱完全相同。

### `users` 工作表

將可指派的使用者名稱放在 A 欄，會顯示在負責人的下拉選單中：

| A |
| --- |
| 王小明 |
| 陳小華 |

舊格式（A 欄 User ID、B 欄名稱）仍然可以使用：有填 B 欄時會使用 B 欄的名稱。

### `history` 工作表

這張表用來保存刪除的 Task，可以先保持空白。刪除 Task 時，Apps Script 會先把它最後的狀態複製到這裡，再從 `kanban` 移除：

| 欄位 | 內容 | 範例 |
| --- | --- | --- |
| A～G | 與 `kanban` 工作表相同：Task ID、Title、Issue ID、Description、Kanban Column、Priority、Assignee | |
| H | 刪除時間（依 Sheet 設定的時區） | `2026-11-04 15:30:00` |

需要使用[新版 Apps Script](#更新-apps-script)，舊版 Script 刪除時不會保存到這裡。

在 SAF Kanban 點右上角語言標籤右邊的時鐘圖示，就能查看目前看板已刪除的 Task。最新刪除的排在最前面，可以用標題、描述、Issue ID、欄位或負責人搜尋。按右側的重新建立圖示，會打開新增任務的視窗並填好原本的內容，修改後按「確定」，就會在看板的第一個欄位建立一個新的 Task；`history` 裡的紀錄會保留。

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

刪除預設程式，貼上 [`apps-script/Code.gs`](apps-script/Code.gs) 的完整內容並儲存。在 GitHub 打開這個檔案後，可以用右上角的「Copy raw file」按鈕一次複製全部程式。

程式最上方的 `SPREADSHEET_ID` 保持空白即可，會自動使用這份 Sheet。只有 Script 不是從 Sheet 的「擴充功能 → Apps Script」建立時，才需要填入 Sheet ID；如果有填，必須是**同一份** Sheet 的 ID。

### 找到 Sheet ID

Google Sheet 網址格式如下：

```text
https://docs.google.com/spreadsheets/d/SHEET_ID/edit
```

`/d/` 與 `/edit` 中間的字串就是 Sheet ID。第 5 步可以直接貼上整個網址，SAF Kanban 會自動取出 Sheet ID。

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

`/s/` 與 `/exec` 中間的字串就是部署 ID。第 5 步可以直接貼上整個網址，SAF Kanban 會自動取出部署 ID。

如果日後修改 Apps Script，只有按儲存不會更新線上版本。請進入：

```text
部署 → 管理部署 → 編輯 → 版本：新版本 → 部署
```

## 5. 連接 SAF Kanban

開啟 [SAF Kanban](https://whlshy.github.io/SAF_Kanban/)，點選右上角齒輪並填入：

| 設定 | 填入內容 |
| --- | --- |
| 看板名稱 | 顯示在左上角，可留空 |
| Sheet ID | Google Sheet 的網址，或其中的 `SHEET_ID` |
| Apps Script 部署 ID | 部署後的網頁應用程式網址，或其中的 `DEPLOYMENT_ID` |
| User Name | 你的名稱，目前未使用，可留空 |
| Issue Link | Issue 的基底網址，任務的 Issue ID 會接在後面，可留空 |

「Apps Script 部署 ID」是你自己部署的 Apps Script 網址中的 ID，不需要申請 Google Cloud API Key。舊版介面把這個欄位叫做「Sheet API Key」。

Issue Link 範例：

| 系統 | Issue Link |
| --- | --- |
| Jira | `https://your-company.atlassian.net/browse/` |
| GitHub Issues | `https://github.com/OWNER/REPO/issues/` |

舊版介面把 Issue Link 叫做「Jira Link」，任務的 Issue ID 叫做「Jira ID」，設定和資料都不受改名影響。

設定會儲存在目前瀏覽器的 Local Storage。更換瀏覽器或清除網站資料後，需要重新輸入。

### 使用多個看板

每個看板各自連到一份 Google Sheet 與一個 Apps Script。要新增看板時，先依照[快速建立](#快速建立推薦)或第 1～4 步再建立一份 Sheet 與 Apps Script，然後：

1. 點左上角看板名稱，開啟下拉選單。
2. 選「新增看板」，填入看板名稱，貼上 Sheet 網址與部署網址，按「建立」。名稱和其他看板重複時，會自動加上編號，例如 `Kanban (1)`、`Kanban (2)`。
3. 之後從同一個下拉選單切換看板。

- 網址會帶上 `?board=<看板 ID>`，可以加入書籤，或開多個分頁各看一個看板。
- 要修改或刪除看板，先切換到該看板，再點右上角齒輪。刪除看板只會移除瀏覽器裡的設定，不會刪除 Google Sheet 的資料。
- 從單一看板版本升級時，原本的設定會自動成為第一個看板，不需要重新設定。

### 匯出與匯入設定

設定只存在目前的瀏覽器。要換電腦、換瀏覽器或備份時，可以把設定匯出成檔案再匯入：

1. 點左上角看板名稱，選「匯出設定」，會下載一個包含所有看板設定的 JSON 檔。
2. 在另一個瀏覽器點看板名稱選「匯入設定」，選擇剛剛的檔案。還沒有任何看板時，直接點畫面中間的「匯入」。
3. 匯入前會用看板名稱和目前的看板比對：名稱重複的需要先改名，不想匯入的取消勾選，再按「匯入」。

匯出的檔案包含 Apps Script 部署 ID，拿到檔案的人就能寫入你的 Sheet，請妥善保管，不要公開分享。

### 更新 Apps Script

[`apps-script/Code.gs`](apps-script/Code.gs) 更新後，舊的 Script 仍可繼續使用，但不會有新功能。各版 Script 的差異請見[版本紀錄](CHANGELOG.md#apps-script-版本)。目前新版 Script 提供：

- 刪除 Task 時保存到 `history` 工作表。
- 確認 Script 連到的就是看板設定的 Sheet，不一致時拒絕寫入，避免寫到別份 Sheet。
- 錯誤訊息會依照介面語言顯示。

更新方式：

1. 打開 Sheet 的「擴充功能 → Apps Script」，用 `apps-script/Code.gs` 的內容取代全部程式。原本 `SPREADSHEET_ID` 有填的話，可以保留，也可以清空。
2. 儲存後進入「部署 → 管理部署 → 編輯（鉛筆）→ 版本：新版本 → 部署」。

照這個方式更新，部署 ID 不會改變，SAF Kanban 的設定不用修改。

## 6. 測試 Kanban

完成設定後，建議依序測試：

1. 點右上角 `＋` 新增 Task。
2. 編輯標題、描述、優先順序與負責人。
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

### 新增或移動 Task 時出現 CORS 錯誤、寫入失敗

F12 Console 出現 `has been blocked by CORS policy`，通常不是跨網域設定的問題，而是 Apps Script 沒有回傳正常的 JSON。請依序確認：

1. Apps Script 的 `SPREADSHEET_ID` 是這份 Sheet 的 ID，或留空。
2. 部署的存取權限是「所有人」，不是「僅限自己」或「擁有 Google 帳戶的任何人」。
3. SAF Kanban 設定裡的 Apps Script 部署 ID 是這份 Script 的部署 ID。
4. 修改 Script 或部署設定後，有到「管理部署 → 編輯 → 版本：新版本 → 部署」。

確認方式：用**無痕視窗**直接開啟部署網址 `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`。

- 看到 `{"status":"error","code":"UNKNOWN_ACTION", ...}`（舊版 Script 是 `...缺少 action...`）這類 JSON，表示部署正常。
- 看到「需要存取權」或 Google 登入頁，表示存取權限不是「所有人」。
- 如果是公司的 Google Workspace 帳號，存取權限可能沒有「所有人」可選，需要改用個人 Google 帳號建立 Sheet 與 Apps Script。

### Apps Script 回傳 `undefined is not valid JSON`

通常表示線上部署仍是舊版本。請到「管理部署」建立新版本，而不是只儲存程式碼。

### 修改 Apps Script 後沒有生效

重新執行：

```text
部署 → 管理部署 → 編輯 → 版本：新版本 → 部署
```

### Issue 連結無法開啟

點任務上的 Issue ID 時，會開啟「Issue Link + Issue ID」。確認 Issue Link 的結尾正確，例如 Jira 要包含 `/browse/`，GitHub 要包含 `/issues/`：

```text
https://your-company.atlassian.net/browse/
https://github.com/OWNER/REPO/issues/
```

## 資料與隱私

- Task 資料會保存在你自己的 Google Sheet。
- Sheet 必須開放知道連結者檢視，請勿存放密碼、Token 或其他敏感資料。
- Apps Script 會以建立者的 Google 帳號權限寫入指定 Sheet。
- Apps Script Deployment ID 應視為敏感資訊，不要任意公開分享。
- 使用新版 Apps Script 時，刪除的 Task 會保存在 `history` 工作表；舊版 Script 會直接刪除，不會保留。
