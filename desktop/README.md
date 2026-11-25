# SAF Kanban 桌面版（Windows）

繁體中文 | [English](README.en.md)

讓 SAF Kanban 完全在自己的電腦上執行：看板存成本機 JSON 檔案、不需 Google Sheet 與網路即可完整讀寫，並內建 CLI、AI Agent Skill、MCP 與 HTTP API，讓 AI 工具與腳本都能直接操作看板。

**[下載 Windows 安裝檔](https://github.com/whlshy/SAF_Kanban/releases)** ｜ **[返回主文件](../README.md)** ｜ **[版本紀錄](../CHANGELOG.md)**

## 目錄

- [安裝與日常使用](#安裝與日常使用)
- [讓 AI Agent 使用](#讓-ai-agent-使用)
  - [Skill 與命令列（建議）](#skill-與命令列建議)
  - [MCP](#mcp)
- [資料位置、匯出入與備份](#資料位置匯出入與備份)
- [安全性](#安全性)
- [API](#api)
- [從原始碼建置、測試與發佈](#從原始碼建置測試與發佈)

---

## 安裝與日常使用

到 [Releases](https://github.com/whlshy/SAF_Kanban/releases) 下載最新的 `SAF-Kanban_<版本>_x64-setup.exe` 後執行：

- 安裝檔目前未加程式碼簽章，Windows 顯示「Windows 已保護您的電腦」時點「**其他資訊 → 仍要執行**」。
- 只安裝給目前的使用者，不需要系統管理員權限。
- 畫面使用 Windows 內建 WebView2（Windows 11 與已更新的 Windows 10 皆內建；若缺少會在安裝時自動下載一次）。

日常使用與網頁版一致，桌面版另提供以下行為：

- **系統匣常駐**：關閉視窗不會結束程式，會留在右下角通知區域，讓 AI Agent 與其他程式能繼續使用；左鍵點圖示可叫回視窗，右鍵選「結束」才會完全關閉。
- **開機自動啟動**：系統匣右鍵選單勾選「開機時自動啟動」後，登入 Windows 會在背景啟動（不跳出視窗）。重複執行程式只會叫回原視窗。
- **App 內檢查與自動更新（`0.5.0+`）**：啟動 5 秒後與每 6 小時自動檢查新版本（離線時靜默略過）；有新版時上方會出現通知，點「**立即更新**」會下載、驗證 minisign 簽章並以 Windows NSIS `passive` 模式自動覆寫安裝與重啟，資料不受影響。也可從系統匣右鍵選單或頁尾的「檢查更新」手動觸發。
- **自動同步 AI Skill**：更新桌面版並啟動時，會自動將先前已安裝過的 AI Skill 更新到最新版（未安裝過的位置不會自動建立）。
- **外部連結與連接埠**：看板中的外部連結會用系統預設瀏覽器開啟。本機伺服器預設監聽 `41952`；若被佔用會自動改用空埠，可在右上角「AI / API 連線」查看實際位址。
- **Google Sheet 看板**：在桌面版也能照常使用（需網路；讀取用 API 金鑰需允許 `http://127.0.0.1:41952/*` 來源）。

---

## 讓 AI Agent 使用

點畫面右上角的機器人圖示（「**AI / API 連線**」）可直接查看各種連線方式的路徑、位址與可複製的設定。

| 方式 | 適用工具 | SAF Kanban 要開著嗎 | 需要權杖嗎 |
| --- | --- | --- | --- |
| **Skill + 命令列（建議）** | Claude Code、Codex、Gemini CLI、GitHub Copilot、Cursor 等支援 Agent Skills 的工具；其餘只要能跑指令的 AI 也能直接用 CLI | 不用 | 不用 |
| **MCP（stdio 啟動程式）** | Claude Desktop 等由工具自行啟動程式的用戶端 | 不用 | 不用 |
| **MCP（HTTP 網址）** | Claude Code、Cursor 等可填 MCP 網址的工具 | 要 | 要 |
| **HTTP API** | 自寫腳本或其他程式整合 | 要 | 要 |

> 不需開著的方式會直接讀寫資料夾中的看板檔案，並透過 `boards.lock` 檔案鎖避免同時寫入衝突；SAF Kanban 開著時，畫面會在一秒內自動顯示外部工具做的變更。

### Skill 與命令列（建議）

安裝版會在 `saf-kanban.exe` 旁邊附帶命令列工具 `saf-kanban-cli.exe`（預設在 `%LOCALAPPDATA%\SAF Kanban\`）。`SKILL.md` 已寫好工具完整路徑，不需要手動改 `PATH`。

安裝 skill（擇一）：

- 在畫面點「**AI / API 連線 → Skill（建議）→ 安裝 skill**」
- 或在終端機執行 `saf-kanban-cli skill --install`

預設支援三個共用位置（畫面可個別安裝或全部安裝）：

| 路徑 | 對應 AI 工具 |
| --- | --- |
| `~/.agents/skills/saf-kanban/SKILL.md` | Codex、Gemini CLI、GitHub Copilot、Cursor 等 |
| `~/.claude/skills/saf-kanban/SKILL.md` | Claude Code（若設了 `CLAUDE_CONFIG_DIR` 則改寫至該目錄） |
| `~/.gemini/config/skills/saf-kanban/SKILL.md` | Google Antigravity（App、IDE、CLI 共用全域位置） |

- 其他工具可執行 `saf-kanban-cli skill --into <skills 資料夾>`，或手動儲存 `saf-kanban-cli skill` 印出的內容。
- 桌面版升級啟動時會自動更新已安裝的 skill；若你手動搬動了安裝位置，請再安裝一次（「AI / API 連線」會顯示「需要更新」）。

命令列也可以直接手動或給腳本使用：

```text
saf-kanban-cli boards                     列出看板
saf-kanban-cli board <看板> [--column C] [--limit N]
                                          欄位、任務與負責人
saf-kanban-cli tasks <看板> [--column C] [--assignee A] [--priority P] [--search 關鍵字]
                     [--since 時間] [--until 時間] [--limit N]
saf-kanban-cli task <看板> <任務>         查看單一任務完整內容
saf-kanban-cli add <看板> <標題> [--column C] [--priority P] [--assignee A] [--issue ID]
                   [--description 描述 | --description-file 檔案]
saf-kanban-cli edit <看板> <任務> [--title T] [--priority P] [--assignee A] [--issue ID]
                    [--description 描述 | --description-file 檔案 |
                     --append-description 描述 | --append-description-file 檔案]
saf-kanban-cli move <看板> <任務>... <欄位> [--before 任務 | --after 任務]
saf-kanban-cli delete <看板> <任務>       刪除任務（保留在歷史紀錄）
saf-kanban-cli deleted <看板>             列出已刪除的任務
saf-kanban-cli restore <看板> <任務> [--column C] [--before 任務 | --after 任務]
                                          原樣復原已刪除的任務
saf-kanban-cli new-board <名稱> [--columns A,B,C] [--users A,B]
saf-kanban-cli edit-board <看板> [--name N] [--columns A,B,C] [--rename 舊=新] [--users A,B]
saf-kanban-cli skill [--install | --into 資料夾]   印出或安裝 skill
```

- `<看板>` 可填 ID 或名稱；`<任務>` 為方括號內的任務 ID。`move` 可一次指定多個任務 ID（原子寫入）。
- 所有指令皆支援 `--json`（輸出 JSON）與 `--data-dir <資料夾>`。
- `--description -`／`--append-description -` 從標準輸入讀取（自動處理 UTF-8 BOM 與 UTF-16）；PowerShell 建議改用 `--description-file`／`--append-description-file`。
- `--append-description` 會在檔案鎖內空一行接在原本描述後面，不覆蓋原內容。
- `--since`、`--until`（`YYYY-MM-DD` 或 ISO 時間）依 `movedAt` 篩選；`--limit N` 依 `movedAt` 取最近移入的 N 張。
- 失敗時錯誤輸出到 stderr，結束碼為 `1`（語法錯誤為 `2`）。

### MCP

[MCP](https://modelcontextprotocol.io) 讓 AI Agent 以工具呼叫的方式讀寫看板。

- **Claude Code（HTTP 網址，需開啟 SAF Kanban）**：
  ```bash
  claude mcp add --transport http saf-kanban http://127.0.0.1:41952/mcp --header "Authorization: Bearer <權杖>"
  ```
- **Claude Desktop（stdio 啟動程式，不需開啟 SAF Kanban）**：
  ```json
  {
    "mcpServers": {
      "saf-kanban": { "command": "<saf-kanban 的完整路徑>", "args": ["mcp"] }
    }
  }
  ```
  > 安裝版執行 `saf-kanban mcp`；獨立伺服器執行 `saf-kanban-server mcp`。自訂資料夾時加上 `--data-dir <資料夾>`。

支援的 MCP 工具：

| 工具 | 功能 |
| --- | --- |
| `list_boards` / `get_board` | 列出看板／取得單一看板欄位與任務 |
| `list_tasks` / `get_task` | 篩選列出任務（支援 `since`／`until`／`limit`）／取得單一任務 |
| `create_task` / `update_task` | 新增任務／更新欄位（支援 `appendDescription` 追加描述） |
| `move_task` | 移動任務到指定欄位與位置（`beforeTask`／`afterTask`） |
| `delete_task` / `list_deleted_tasks` / `restore_task` | 刪除任務／查看歷史／原樣復原至原欄位與位置 |
| `create_board` / `update_board` | 建立看板／修改名稱、欄位與負責人（不提供刪除看板工具，請在畫面操作） |

> 註：MCP 工具使用 `description` 欄位，HTTP API 使用 `des` 欄位。

---

## 資料位置、匯出入與備份

預設資料夾位於 Windows 的 `%APPDATA%\SAF Kanban`（Linux / macOS 為 `~/.local/share/saf-kanban`）：

| 路徑 | 內容 |
| --- | --- |
| `boards/<看板 ID>.json` | 每個看板一個獨立 JSON 檔（欄位、負責人、任務、已刪除紀錄） |
| `trash/` | 刪除的看板會移到此處保留，不會直接消失 |
| `config.json` | API 權杖 |
| `boards.lock` | 多程式並發寫入用的檔案鎖 |
| `server.json` | 伺服器目前連接埠（供 `mcp` 模式自動偵測） |

- **全機備份**：直接複製整個資料夾即可。
- **單一看板匯出／匯入**：在看板「設定」按「匯出看板」存成 JSON（不含 API 權杖），在看板選單按「匯入設定或看板」即可還原成新看板。
- **從 Google Sheet 複製**：在 Google Sheet 看板的「設定」按「複製成本機看板」，會把欄位、任務（含建立與移入時間）與負責人複製成本機看板，不更動原 Sheet。
- **寫入安全**：每次請求皆直接讀檔（外部還原備份不需重啟），寫入先落暫存檔再原子覆蓋，中途當機不損毀原檔。

---

## 安全性

- 僅監聽本機回環介面（`127.0.0.1`），不對區域網路或網際網路開放。
- 所有 HTTP API 與 HTTP MCP 請求均須攜帶 `Authorization: Bearer <權杖>`。
- 檢查 `Host` 僅允許 `127.0.0.1`／`localhost`（防 DNS rebinding），並拒絕來自其他網站的 `Origin`。
- CLI 與 `mcp` stdio 模式不經網路、直接操作本機檔案，不需權杖。
- 權杖外洩時可於「AI / API 連線」按「**重新產生權杖**」，舊權杖立即失效。

---

## API

基底網址為 `http://127.0.0.1:41952/api`，請求與回應皆為 JSON（需帶 `Authorization: Bearer <權杖>`）。

| 方法與路徑 | 功能 |
| --- | --- |
| `GET /info` | 伺服器名稱、版本與是否支援 App 內更新（`canUpdate`） |
| `GET /boards` / `POST /boards` | 列出看板／建立看板（可帶 `tasks`、`history` 還原匯出檔） |
| `GET /boards/{看板}` / `PATCH` / `DELETE` | 讀取／修改名稱、欄位（含 `renames`）與負責人／刪除至 `trash/` |
| `GET /boards/{看板}/export` | 匯出整個看板（設定、任務、已刪除紀錄） |
| `GET /boards/{看板}/tasks` / `POST` | 篩選列出任務／新增任務 |
| `GET /boards/{看板}/tasks/{任務}` / `PUT` / `PATCH` / `DELETE` | 讀取／整筆取代或建立／局部更新（支援 `appendDes`）／刪除至歷史 |
| `POST /boards/{看板}/tasks/{任務}/move` | 移動欄位與位置（`column`、`beforeId`、`afterId`） |
| `GET /boards/{看板}/history` | 已刪除的任務（由新到舊） |
| `POST /boards/{看板}/history/{任務}/restore` | 原樣復原（可選帶 `column`、`beforeId`、`afterId`） |
| `GET /events` | 即時變更通知（SSE，亦接受 `?token=<權杖>`） |
| `GET /connection` | API／MCP 位址、資料夾與執行檔路徑 |
| `GET /skill` / `POST /skill` | 取得 `SKILL.md` 內容與安裝狀態／安裝或更新 skill（可選帶 `{"agents": "antigravity"|"claude"|"agents"}`） |
| `POST /token` | 重新產生並回傳新權杖 |
| `GET /update` / `POST /update/check` / `POST /update/install` | 查詢／檢查／安裝桌面版更新（僅安裝版啟用） |

### 任務物件格式

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

- `GET /boards/{看板}/tasks` 查詢參數：`column`、`assignee`（空字串找未指派）、`priority`、`q`（空白分隔多詞）、`since`、`until`（依 `movedAt`）、`limit`（依 `movedAt` 取最近 N 張）。
- 失敗時回傳對應 HTTP 狀態碼與 `{ "error": { "code": "...", "message": "...", "params": { ... } } }`。
- `GET /events` 會送出 `event: change` 與 `{"kind":"board"|"boards"|"update","boardId":"..."}`。

<details>
<summary><strong>curl 呼叫範例</strong></summary>

```bash
TOKEN=<權杖>
API=http://127.0.0.1:41952/api

# 列出看板
curl -H "Authorization: Bearer $TOKEN" $API/boards

# 新增任務（未給 column 則放第一個欄位）
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "買牛奶", "priority": "high"}' $API/boards/<看板>/tasks

# 依負責人與關鍵字篩選
curl -H "Authorization: Bearer $TOKEN" "$API/boards/<看板>/tasks?assignee=Amy&q=登入"

# 移動到「完成」欄並放在指定任務前
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"column": "完成", "beforeId": "<另一個任務>"}' $API/boards/<看板>/tasks/<任務>/move
```

</details>

---

## 從原始碼建置、測試與發佈

需要 Node.js 22 與 Rust。在專案根目錄執行：

```bash
npm install
npm run local        # 建置桌面版前端並啟動本機伺服器（瀏覽器開啟印出的網址）
npm run build:app    # 建置 Windows 桌面版程式與 NSIS 安裝檔
npm run test:server  # 執行 Rust 伺服器與 CLI 整合測試
cargo clippy --manifest-path desktop/Cargo.toml --all-targets -p saf-kanban-server -- -D warnings
```

- 獨立伺服器（`saf-kanban-server`）支援 `--port`、`--data-dir`、`--ui-dir`。
- 桌面版程式（`saf-kanban`）內嵌前端資源，支援 `--port`、`--data-dir`、`--hidden`。
- **CI 與發佈流程**（[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)）：
  - 每次異動 `desktop/` 會自動在 Windows 建置安裝檔、靜默安裝並執行 `node desktop/app/smoke-test.mjs` 驗證。
  - 發佈新版時，更新 [`Cargo.toml`](Cargo.toml) 版號並合併至 `main`，再於 GitHub Actions →「**Desktop app**」→「**Run workflow**」選擇 `main` 並勾選「**Publish a release**」（或推送 `desktop-v<版本>` tag）。CI 會使用 `TAURI_SIGNING_PRIVATE_KEY` Secret 簽署安裝檔，自動產生 `latest.json` 並建立 GitHub Release。
