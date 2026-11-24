# SAF Kanban 桌面版

讓 SAF Kanban 完全在自己的電腦上執行：看板存成電腦上的檔案，不需要 Google Sheet 和網路，並提供 API 讓其他程式（例如 AI agent）讀寫看板。

目前進度：

- [x] 本機伺服器（[`server/`](server/)，Rust）：看板檔案、HTTP API、提供看板畫面
- [x] MCP 介面，讓 AI agent 直接操作看板；畫面右上角的「AI / API 連線」
- [x] Windows 安裝檔（[`app/`](app/)，Tauri）
- [x] 把 Google Sheet 看板複製成本機看板、匯出與匯入看板
- [x] 命令列工具和 AI agent 的 skill；不開 SAF Kanban 也能讓 AI 操作看板

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

安裝檔由 GitHub Actions 建置（[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)）：每次改到 `desktop/` 都會建出安裝檔、實際安裝並檢查，安裝檔放在該次執行的 Artifacts。發布新版本時，先改 [`Cargo.toml`](Cargo.toml) 的版本並合併到 `main`，再到 GitHub 的 Actions →「Desktop app」→「Run workflow」，選 `main` 並勾選「Publish a release」；也可以推一個 `desktop-v<版本>` 的標籤。兩種方式都會建立附上安裝檔的 Release（版本已經發布過的話會失敗，不會覆蓋）。

## 資料

資料夾預設在 Windows 的 `%APPDATA%\SAF Kanban`，其他系統在 `~/.local/share/saf-kanban`。

| 路徑 | 內容 |
| --- | --- |
| `boards/<看板 ID>.json` | 一個看板一個檔案：欄位、負責人、任務、已刪除的任務 |
| `trash/` | 刪除的看板檔案會移到這裡，不會直接消失 |
| `config.json` | API 權杖 |
| `boards.lock` | 讓同時使用資料夾的程式輪流寫入 |
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
- 命令列和 `mcp` 模式直接讀寫資料夾裡的檔案，不經過網路，所以不需要權杖：能執行它們的程式，本來就能讀寫你的檔案。
- 權杖等同看板的讀寫權限，不要貼到公開的地方。外洩時可以在「AI / API 連線」按「重新產生權杖」，舊的會立刻失效。

## 讓 AI agent 使用

畫面右上角的機器人圖示（AI / API 連線）會列出下面每種方式需要的路徑、位址和可以直接複製的設定。

| 方式 | 適用 | SAF Kanban 要開著嗎 | 權杖 |
| --- | --- | --- | --- |
| Skill + 命令列（建議） | Claude Code、Codex、Gemini CLI、GitHub Copilot、Cursor 等支援 Agent Skills 的 AI；不支援的 AI 只要能執行指令，也能直接用命令列 | 不用 | 不用 |
| MCP，啟動程式（stdio） | Claude Desktop 等由工具自己啟動程式的 | 不用 | 不用 |
| MCP，網址（HTTP） | Claude Code、Cursor 等可以填 MCP 網址的工具 | 要 | 要 |
| HTTP API | 自己寫的程式、腳本 | 要 | 要 |

不用開著的方式會直接讀寫資料夾裡的看板檔案。SAF Kanban 開著的時候也可以照常使用：同一時間只會有一個程式在寫檔案（`boards.lock`），不會互相蓋掉；畫面會在一秒內顯示其他程式做的修改。

### Skill + 命令列

安裝版在 `saf-kanban.exe` 旁邊附了命令列工具 `saf-kanban-cli.exe`（預設在 `%LOCALAPPDATA%\SAF Kanban\`）。Skill 是一份 `SKILL.md`，教 AI 怎麼用這個工具；裡面寫好了工具的完整路徑，所以不用改 PATH。

安裝 skill（擇一）：

- 「AI / API 連線」→「Skill（建議）」→「安裝 skill」。
- 執行 `saf-kanban-cli skill --install`。

兩種做法都會寫到兩個地方：

| 位置 | 會讀它的 AI |
| --- | --- |
| `~/.agents/skills/saf-kanban/SKILL.md` | Codex、Gemini CLI、GitHub Copilot、Cursor 等（Agent Skills 的共用位置） |
| `~/.claude/skills/saf-kanban/SKILL.md` | Claude Code（有設定 `CLAUDE_CONFIG_DIR` 時改寫到那個資料夾） |

- 其他 AI 工具：執行 `saf-kanban-cli skill --into <它的 skills 資料夾>`，或把 `saf-kanban-cli skill` 印出的內容存成那個資料夾裡的 `saf-kanban/SKILL.md`。
- 不支援 skill 的 AI，只要能執行指令，請它先執行 `saf-kanban-cli --help` 就能使用。
- 程式換了位置之後要重新安裝一次，「AI / API 連線」裡會顯示「需要更新」。

命令列也可以自己用：

```text
saf-kanban-cli boards                     列出看板
saf-kanban-cli board <看板> [--column C] [--limit N]
                                          欄位和每個欄位裡的任務、負責人
saf-kanban-cli tasks <看板> [--column C] [--assignee A] [--priority P] [--search 關鍵字]
                     [--since 時間] [--until 時間] [--limit N]
saf-kanban-cli task <看板> <任務>         一個任務的完整內容
saf-kanban-cli add <看板> <標題> [--column C] [--priority P] [--assignee A] [--issue ID]
                   [--description 描述 | --description-file 檔案]
saf-kanban-cli edit <看板> <任務> [--title T] [--priority P] [--assignee A] [--issue ID]
                    [--description 描述 | --description-file 檔案 |
                     --append-description 描述 | --append-description-file 檔案]
saf-kanban-cli move <看板> <任務>... <欄位> [--before 任務 | --after 任務]
saf-kanban-cli delete <看板> <任務>       刪除任務（會留在已刪除的任務裡）
saf-kanban-cli deleted <看板>             已刪除的任務
saf-kanban-cli restore <看板> <任務> [--column C] [--before 任務 | --after 任務]
                                          復原已刪除的任務（同一個 ID 和內容，放回原位）
saf-kanban-cli new-board <名稱> [--columns A,B,C] [--users A,B]
saf-kanban-cli edit-board <看板> [--name N] [--columns A,B,C] [--rename 舊=新] [--users A,B]
saf-kanban-cli skill [--install | --into 資料夾]   印出 skill，或安裝
```

- `<看板>` 可以是看板 ID 或名稱；`<任務>` 是任務 ID（輸出裡方括號中的那段）。`move` 可以一次指定多個任務 ID。
- 每個指令都可以加 `--json` 改成輸出 JSON，加 `--data-dir <資料夾>` 指定其他資料夾。
- `--description -` 與 `--append-description -` 從標準輸入讀內容（自動處理 UTF-8 BOM 與 UTF-16）；也可以用 `--description-file`、`--append-description-file` 直接讀檔（PowerShell 建議改用讀檔）。
- `--append-description` 會在檔案鎖內空一行接在原本的描述後面，不覆蓋原內容。
- `--since`、`--until`（`YYYY-MM-DD` 或 ISO 時間）依任務最後一次移進目前欄位的時間（`movedAt`）篩選；`--limit N` 依 `movedAt` 列出最近的 N 張任務。
- 失敗時錯誤訊息印在標準錯誤，結束碼是 1（打錯指令是 2）。

### MCP

[MCP](https://modelcontextprotocol.io) 介面讓 AI agent 把看板操作當成工具來呼叫。

Claude Code（用網址連線，SAF Kanban 要開著）：

```bash
claude mcp add --transport http saf-kanban http://127.0.0.1:41952/mcp --header "Authorization: Bearer <權杖>"
```

Claude Desktop 的設定檔（啟動程式，SAF Kanban 不用開著）：

```json
{
  "mcpServers": {
    "saf-kanban": { "command": "<saf-kanban 的完整路徑>", "args": ["mcp"] }
  }
}
```

- 安裝版的指令是 `saf-kanban mcp`；只有伺服器時是 `saf-kanban-server mcp`。資料夾不是預設位置時加上 `--data-dir <資料夾>`。

AI 可以用的工具：

| 工具 | 功能 |
| --- | --- |
| `list_boards` | 列出看板 |
| `get_board` | 一個看板的欄位（依序）和每個欄位裡的任務 |
| `list_tasks` | 列出任務，可依欄位、負責人、優先順序、關鍵字、移入時間（`since`／`until`）篩選，並可用 `limit` 取最近移入的 N 張 |
| `get_task` | 一個任務的完整內容 |
| `create_task` | 新增任務 |
| `update_task` | 修改任務的標題、描述（可用 `appendDescription` 追加）、優先順序、負責人、Issue ID |
| `move_task` | 把任務移到某個欄位，可指定放在哪個任務前面或後面 |
| `delete_task` | 刪除任務（會留在已刪除的任務裡） |
| `list_deleted_tasks` | 已刪除的任務 |
| `restore_task` | 把已刪除的任務復原：同一個 ID 和內容，放回原本的欄位和位置 |
| `create_board` | 建立看板 |
| `update_board` | 改看板名稱、欄位、負責人 |

- 沒有刪除看板的工具，刪除看板只能在畫面上做。
- AI 誤刪任務時，可以用 `restore_task`（命令列是 `restore`）把它原樣放回：ID、內容、建立時間都不變，回到刪除前的欄位和位置；如果那個欄位已經被移除，要指定放回哪個欄位。skill 會告訴 AI 誤刪時用復原，而不是重新新增一個。
- 工具裡任務的描述叫 `description`（HTTP API 裡是 `des`）。
- AI 做的變更會即時出現在看板畫面上（用網址連線時立刻，其他方式在一秒內）。

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
| `PATCH /boards/{看板}/tasks/{任務}` | 只改有給的欄位（支援 `appendDes` 追加描述） |
| `POST /boards/{看板}/tasks/{任務}/move` | 移到某個欄位和位置 |
| `DELETE /boards/{看板}/tasks/{任務}` | 刪除（會留在已刪除的任務裡） |
| `GET /boards/{看板}/history` | 已刪除的任務，由新到舊 |
| `POST /boards/{看板}/history/{任務}/restore` | 復原已刪除的任務；可以帶 `column`、`beforeId`、`afterId` 改放別的地方 |
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
  "updatedAt": "2026-11-16T17:10:44.708Z",
  "movedAt": "2026-11-16T17:10:44.708Z"
}
```

- `column` 是欄位名稱，必須是看板現有的欄位。
- `priority` 畫面上用 `high`、`medium`、`low`；新增時沒給就是 `medium`。
- `movedAt` 是任務最後一次移進目前欄位的 UTC 時間；舊版建立的任務在下次跨欄移動前不會有這個欄位。
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

- 篩選參數：`column`、`assignee`（給空字串是找未指派的）、`priority`、`q`（用空白隔開的詞要全部出現在標題、描述、Issue ID 或負責人裡）、`since`、`until`（依 `movedAt` 篩選）、`limit`（依 `movedAt` 取最近的 N 張）。
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
