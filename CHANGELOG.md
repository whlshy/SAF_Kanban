# 版本紀錄

繁體中文 | [English](CHANGELOG.en.md)

網站更新後會直接生效。Apps Script 需要自己更新，方法請見 README 的[更新 Apps Script](README.md#更新-apps-script)；標示「需要新版 Apps Script」的功能，更新 Script 後才會有作用。

## Apps Script 版本

| 版本 | 隨網站版本推出 | 內容 |
| --- | --- | --- |
| v2 | 1.5.0 | 刪除的 Task 保存到 `history` 工作表；寫入前確認連到的是看板設定的 Sheet；回傳錯誤代碼與版本號；新增 `action=info` |
| v1 | 1.0.0 | 1.5.0 以前寫在 README 裡的版本 |

## 1.9.1 — 2026-11-05

### 修正

- 手機上在 Task 卡片上左右滑動時，看板無法捲動；也無法拖曳 Task。現在快速滑動會捲動看板，長按 Task 約 0.25 秒後即可拖曳到其他欄位，拖到畫面邊緣會自動捲動。電腦版的拖曳方式不變。

## 1.9.0 — 2026-11-05

### 新增

- 手機直式畫面每個欄位佔滿寬度，左右滑動會對齊到整欄，不會再只看到半個欄位。
- 負責人可以選「未指派」清空，例如任務回到 Todo、還在等人接手時。編輯任務時，沒有負責人會顯示「未指派」。
- 已刪除的任務可以重新建立：按右側的重新建立圖示，會打開新增任務的視窗並填好原本的內容，修改後按「確定」，會在看板的第一個欄位建立新的 Task。`history` 的紀錄保留不動，不需要更新 Apps Script。

### 變更

- 標題列的設定與新增按鈕改為與其他圖示相同的小尺寸。
- 淺色主題改回白色背景與淺灰欄位，標題列改用柔和陰影與內容區隔，頁尾改為跟深色一樣有層次的淡灰漸層。

### 修正

- 窄螢幕的手機上，標題列會換行、被撐高。現在看板名稱固定一行，放不下時顯示「…」，按鈕與語言標籤不再被擠壓。

## 1.8.0 — 2026-11-05

### 新增

- 查看已刪除的任務：點語言標籤右邊的時鐘圖示，依刪除時間由新到舊列出 `history` 工作表的紀錄，可以搜尋標題、描述、Issue ID、欄位與負責人，一次顯示 50 筆。只讀取 Sheet，不需要更新 Apps Script。

### 變更

- 淺色主題加強層次：標題列白色、看板背景淺灰、欄位灰色、卡片白色，不再整片純白。

## 1.7.0 — 2026-11-05

### 新增

- 淺色與深色主題切換，按鈕在語言切換的左邊。已有設定的使用者維持深色；新使用者依作業系統的設定，之後會記住選擇。

### 變更

- 設定裡的「User Key」改名為「User Name」。只改名稱，已填的值不受影響。

## 1.6.0 — 2026-11-05

### 新增

- 英文版 README（`README.en.md`）與版本紀錄。

### 變更

- 「Jira Link」、「Jira ID」改名為「Issue Link」、「Issue ID」，也適用於 GitHub 等其他 Issue 系統。只改名稱，設定與資料不受影響。
- README 的工作表清單加入 `history`，並補上欄位說明。

### 移除

- 移除專案範本留下、與看板無關的程式與套件，例如 P2P 檔案傳輸、登入、側邊欄。網站檔案從 996 KB 減為 848 KB。

## 1.5.0 — 2026-11-05

[#9](https://github.com/whlshy/SAF_Kanban/pull/9)

### 新增

- 範本 Sheet：建立副本、開放共用、部署、貼上網址，4 步完成設定。
- 刪除的 Task 保存到 `history` 工作表，並記錄刪除時間。需要新版 Apps Script。
- 寫入前確認 Apps Script 連到的就是看板設定的 Sheet，避免寫到別份 Sheet。需要新版 Apps Script。
- Sheet ID 與 Apps Script 部署 ID 欄位可以直接貼上網址，會自動取出 ID。
- 新增看板時，如果這份 Sheet 已被其他看板使用，會顯示提示。
- 沒有看板時，畫面上有用範本建立 Google Sheet 的連結。

### 變更

- Apps Script 程式移到 `apps-script/Code.gs`，`SPREADSHEET_ID` 可以留空。
- 「Sheet API Key」改名為「Apps Script 部署 ID」。只改名稱，設定不受影響。
- `users` 工作表可以只填名稱；舊的 ID、名稱兩欄格式仍然可以使用。
- Apps Script 的錯誤訊息會依介面語言顯示。

## 1.4.0 — 2026-11-04

[#7](https://github.com/whlshy/SAF_Kanban/pull/7)、[#8](https://github.com/whlshy/SAF_Kanban/pull/8)

### 新增

- footer 的「SAF Kanban」連到 GitHub 專案。
- 寫入失敗時說明原因：沒設定部署 ID、連不到 Apps Script，或 Apps Script 回傳錯誤。

### 修正

- 看板讀不到欄位時，新增 Task 按確定沒有反應。現在看板上會顯示可能的原因。
- `columns` 工作表的空白列不再變成沒有名稱的欄位。

## 1.3.0 — 2026-11-03

[#5](https://github.com/whlshy/SAF_Kanban/pull/5)、[#6](https://github.com/whlshy/SAF_Kanban/pull/6)

### 新增

- 匯出、匯入看板設定。匯入前會用看板名稱比對，名稱重複的要先改名，也可以取消不想匯入的看板。
- 沒有看板時，畫面中間顯示「設定」與「匯入」按鈕。
- 介面語言切換：繁體中文、English。

### 變更

- 優先順序在兩種語言都顯示 High / Medium / Low。

## 1.2.0 — 2026-11-02

[#3](https://github.com/whlshy/SAF_Kanban/pull/3)、[#4](https://github.com/whlshy/SAF_Kanban/pull/4)

### 新增

- 多個看板：從標題的下拉選單切換與新增。網址帶有 `?board=`，可以開多個分頁各看一個看板。原本的設定會自動成為第一個看板。
- 欄位數依 `columns` 工作表自動調整，欄位太多時看板可以左右捲動。

### 修正

- 在 Edge 這類捲軸會佔空間的瀏覽器中，頁面出現多餘的左右捲軸。

## 1.1.0 — 2026-10-30

[#2](https://github.com/whlshy/SAF_Kanban/pull/2)

### 新增

- 自訂看板標題。

### 修正

- 移動 Task 時偶爾出現「目的地索引不得位於遭到移動的維度範圍中」錯誤。

## 1.0.1 — 2026-10-07

[#1](https://github.com/whlshy/SAF_Kanban/pull/1)

### 修正

- 跨欄拖曳到最下方時，Task 會落在倒數第二個位置。

## 1.0.0 — 2026-01-26

- 首次發布：使用 Google Sheet 儲存的看板，可以新增、編輯、刪除 Task，拖曳排序，並連結 Jira Issue。
