# SAF Kanban 桌面版

讓 SAF Kanban 完全在自己的電腦上執行：看板存成電腦上的檔案，不需要 Google Sheet 和網路，並提供 API 讓其他程式（例如 AI agent）讀寫看板。

目前進度：

- [x] 本機伺服器（[`server/`](server/)，Rust）：看板檔案、HTTP API、提供看板畫面
- [x] MCP 介面，讓 AI agent 直接操作看板；畫面右上角的「AI / API 連線」
- [x] Windows 安裝檔（[`app/`](app/)，Tauri）
- [x] 把 Google Sheet 看板複製成本機看板、匯出與匯入看板

## 安裝（Windows）

到 [Releases](https://github.com/whlshy/SAF_Kanban/releases) 下載 `SAF-Kanban_<版本>_x64-setup.exe` 後執行。

- 安裝檔沒有簽章，Windows 會顯示「Windows 已保護您的電腦」：按「其他資訊」→「仍要執行」。
- 只安裝給目前的使用者，不需要系統管理員權限。
- 畫面用 Windows 內建的 WebView2 顯示（Windows 11 和更新過的 Windows 10 都有）。電腦上沒有的話，安裝時會自動下載，只有那一次需要網路。

使用上和網頁版一樣，另外：

- **關閉視窗不會結束程式**，它會留在右下角的通知區域，AI agent 和其他程式才能繼續使用看板。點圖示可以叫回視窗；在圖示上按右鍵選「結束」才會真的關掉。
- 右鍵選單的「開機時自動啟動」打勾後，登入 Windows 時會在背景啟動，不會跳出視窗。
- 再開一次程式只會叫回原本的視窗，不會開出第二個。
- 看板裡連到其他網站的連結會用電腦預設的瀏覽器開啟。
- 預設使用連接埠 41952。被其他程式佔用時會改用別的連接埠，「AI / API 連線」裡顯示的位址會跟著變；用位址連線的 AI 工具要改設定，用「啟動程式」方式的不用。

Google Sheet 看板在桌面版裡也能用，但需要網路；另外讀取用的 API 金鑰必須允許 `http://127.0.0.1:41952/*` 這個來源（由專案維護者在 Google Cloud Console 設定）。

## 從原始碼執行

需要 Node.js 22 和 Rust。在專案根目錄：

```bash
npm install
npm run local      # 只有伺服器，用瀏覽器開啟
npm run build:app  # 桌面版程式和安裝檔（在 Windows 上）
```

`npm run local` 啟動後會印出網址和 API 權杖：

```text
SAF Kanban local server
  Address:   http://127.0.0.1:41952
  MCP:       http://127.0.0.1:41952/mcp
  API token: <權杖>
  Data:      <資料夾>
```

用瀏覽器開啟那個網址就是看板畫面。伺服器可以加參數：`--port`、`--data-dir`（資料夾）、`--ui-dir`（畫面檔案的資料夾；不給就只提供 API）。

桌面版程式（`saf-kanban`）的畫面檔案已經包在程式裡，可以加的參數是 `--port`、`--data-dir` 和 `--hidden`（啟動時不顯示視窗）。

安裝檔由 GitHub Actions 建置（[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)）：每次改到 `desktop/` 都會建出安裝檔、實際安裝並檢查，安裝檔放在該次執行的 Artifacts。發布新版本時改 [`Cargo.toml`](Cargo.toml) 的版本，再推一個 `desktop-v<版本>` 的標籤，就會建立附上安裝檔的 Release。

## 資料

資料夾預設在 Windows 的 `%APPDATA%\SAF Kanban`，其他系統在 `~/.local/share/saf-kanban`。

| 路徑 | 內容 |
| --- | --- |
| `boards/<看板 ID>.json` | 一個看板一個檔案：欄位、負責人、任務、已刪除的任務 |
| `trash/` | 刪除的看板檔案會移到這裡，不會直接消失 |
| `config.json` | API 權杖 |
| `server.json` | 伺服器目前使用的連接埠，給 `mcp` 橋接模式找到它 |

- 備份全部看板就是複製整個資料夾。
- 單一看板可以在「設定」按「匯出看板」存成一個檔案（設定、任務和已刪除的任務），之後在看板選單選「匯入設定或看板」還原成一個新的看板；也可以拿到另一台電腦匯入。檔案沒有加密，裡面不含 API 權杖。
- Google Sheet 看板的「設定」裡有「複製成本機看板」：把 Sheet 目前的欄位、任務和負責人複製成一個本機看板。Sheet 只會被讀取，不會被更動；已刪除的任務紀錄不會複製。
- 伺服器每次都重新讀檔，所以還原備份、或其他程式改了檔案，不用重新啟動。
- 寫入時先寫到暫存檔再取代原檔，中途當機不會留下寫到一半的看板。

## 安全

- 只接受這台電腦的連線（`127.0.0.1`）。
- 每個 API 請求都要帶權杖：`Authorization: Bearer <權杖>`。
- 請求的 Host 必須是 `127.0.0.1` 或 `localhost`，擋掉其他網站把自己的網域指到本機的手法（DNS rebinding）。
- 瀏覽器從其他網站的頁面發出的請求（帶有別人的 Origin）一律拒絕。
- 權杖等同看板的讀寫權限，不要貼到公開的地方。外洩時可以在「AI / API 連線」按「重新產生權杖」，舊的會立刻失效。

## 讓 AI agent 使用（MCP）

伺服器內建 [MCP](https://modelcontextprotocol.io) 介面，AI agent 接上後可以直接查看和操作看板。畫面右上角的機器人圖示（AI / API 連線）會顯示位址、權杖和可以直接複製的設定。

連線方式有兩種：

| 方式 | 適用 | 設定 |
| --- | --- | --- |
| 網址（HTTP） | Claude Code、Cursor 等可以填 MCP 網址的工具 | 位址 `http://127.0.0.1:41952/mcp`，標頭 `Authorization: Bearer <權杖>` |
| 啟動程式（stdio） | Claude Desktop 等由工具自己啟動程式的 | 指令 `saf-kanban mcp`（安裝版；只有伺服器時是 `saf-kanban-server mcp`），不用填權杖 |

Claude Code：

```bash
claude mcp add --transport http saf-kanban http://127.0.0.1:41952/mcp --header "Authorization: Bearer <權杖>"
```

Claude Desktop 的設定檔：

```json
{
  "mcpServers": {
    "saf-kanban": { "command": "<saf-kanban 的完整路徑>", "args": ["mcp"] }
  }
}
```

- `mcp` 模式本身不讀寫看板檔案，而是把工具呼叫轉給正在執行的伺服器，所以 SAF Kanban 要保持開啟。沒開的時候 AI 還是連得上，只是呼叫工具會得到「SAF Kanban 沒有在執行」的說明。
- 它自己從資料夾讀權杖和連接埠；資料夾不是預設位置時加上 `--data-dir <資料夾>`。

AI 可以用的工具：

| 工具 | 功能 |
| --- | --- |
| `list_boards` | 列出看板 |
| `get_board` | 一個看板的欄位（依序）和每個欄位裡的任務 |
| `list_tasks` | 列出任務，可依欄位、負責人、優先順序、關鍵字篩選 |
| `get_task` | 一個任務的完整內容 |
| `create_task` | 新增任務 |
| `update_task` | 修改任務的標題、描述、優先順序、負責人、Issue ID |
| `move_task` | 把任務移到某個欄位，可指定放在哪個任務前面或後面 |
| `delete_task` | 刪除任務（會留在已刪除的任務裡） |
| `list_deleted_tasks` | 已刪除的任務 |
| `create_board` | 建立看板 |
| `update_board` | 改看板名稱、欄位、負責人 |

- 沒有刪除看板的工具，刪除看板只能在畫面上做。
- 工具裡任務的描述叫 `description`（HTTP API 裡是 `des`）。
- AI 做的變更會即時出現在看板畫面上。

## API

網址開頭是 `http://127.0.0.1:41952/api`，內容都是 JSON。

| 方法與路徑 | 功能 |
| --- | --- |
| `GET /info` | 伺服器名稱與版本 |
| `GET /boards` | 列出看板 |
| `POST /boards` | 建立看板；可以附上 `tasks`、`history`，也就是直接送 `export` 的內容來複製看板 |
| `GET /boards/{看板}` | 看板的名稱、欄位、負責人 |
| `PATCH /boards/{看板}` | 改名稱、欄位、負責人 |
| `DELETE /boards/{看板}` | 刪除看板（檔案移到 `trash/`） |
| `GET /boards/{看板}/export` | 整個看板：設定、任務和已刪除的任務 |
| `GET /boards/{看板}/tasks` | 列出任務，可以篩選 |
| `POST /boards/{看板}/tasks` | 新增任務 |
| `GET /boards/{看板}/tasks/{任務}` | 一個任務 |
| `PUT /boards/{看板}/tasks/{任務}` | 整個取代；不存在就用這個 ID 建立 |
| `PATCH /boards/{看板}/tasks/{任務}` | 只改有給的欄位 |
| `POST /boards/{看板}/tasks/{任務}/move` | 移到某個欄位和位置 |
| `DELETE /boards/{看板}/tasks/{任務}` | 刪除（會留在已刪除的任務裡） |
| `GET /boards/{看板}/history` | 已刪除的任務，由新到舊 |
| `GET /events` | 有變更時通知（Server-Sent Events） |
| `GET /connection` | 連線資訊：API 與 MCP 位址、資料夾、執行檔路徑 |
| `POST /token` | 重新產生權杖，回傳新的權杖 |

### 任務

```json
{
  "id": "e0062d42",
  "title": "買牛奶",
  "issueId": "",
  "des": "全脂\n兩瓶",
  "column": "待辦",
  "priority": "high",
  "assignee": "Amy",
  "createdAt": "2026-11-16T17:10:44.708Z",
  "updatedAt": "2026-11-16T17:10:44.708Z"
}
```

- `column` 是欄位名稱，必須是看板現有的欄位。
- `priority` 畫面上用 `high`、`medium`、`low`；新增時沒給就是 `medium`。
- 任務在看板裡有一個整體順序，每個欄位依這個順序顯示自己的任務。新增的任務排在最後。

### 例子

```bash
TOKEN=<權杖>
API=http://127.0.0.1:41952/api

# 列出看板，取得看板 ID
curl -H "Authorization: Bearer $TOKEN" $API/boards

# 新增任務（沒給 column 就放在第一個欄位）
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "買牛奶", "priority": "high"}' $API/boards/<看板>/tasks

# 找出指派給 Amy、內容有「登入」的任務
curl -H "Authorization: Bearer $TOKEN" "$API/boards/<看板>/tasks?assignee=Amy&q=登入"

# 移到「完成」欄，放在某個任務前面
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"column": "完成", "beforeId": "<另一個任務>"}' $API/boards/<看板>/tasks/<任務>/move
```

- 篩選參數：`column`、`assignee`（給空字串是找未指派的）、`priority`、`q`（用空白隔開的詞要全部出現在標題、描述、Issue ID 或負責人裡）。
- 移動：`beforeId` 是放在那個任務前面，`afterId` 是放在後面，兩個都給時用 `beforeId`；都不給就只換欄位，整體順序不變。
- 改欄位：`PATCH /boards/{看板}` 的 `columns` 是新的欄位清單（依序），`renames` 是 `{"舊名稱": "新名稱"}`，欄位裡的任務會跟著改名。還有任務的欄位不能從清單拿掉。

### 錯誤

失敗時回傳對應的 HTTP 狀態碼和：

```json
{ "error": { "code": "UNKNOWN_COLUMN", "message": "This board has no column named `Nope`. Its columns are: Todo, Doing, Done.", "params": { "column": "Nope" } } }
```

`message` 是給人和 AI 看的英文說明；看板畫面依 `code` 顯示成目前的介面語言。

### 變更通知

`GET /events` 每次有變更就送一筆 `change` 事件，看板畫面靠它即時更新。瀏覽器的 EventSource 不能設定標頭，所以這個路徑也接受 `?token=<權杖>`。

```text
event: change
data: {"kind":"board","boardId":"1a2b3c4d"}
```

`kind` 是 `board`（某個看板的內容變了）或 `boards`（看板清單變了）。

## 測試

```bash
npm run test:server
```
