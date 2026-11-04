import { t } from '@/i18n'

// Apps Script error codes the UI can translate. Newer scripts send `code` and
// `params`; older ones only send a Chinese `message`, matched by LEGACY_MESSAGES.
const KNOWN_CODES = [
  "SHEET_NOT_FOUND",
  "SHEET_MISMATCH",
  "SPREADSHEET_NOT_FOUND",
  "UNKNOWN_ACTION",
  "MISSING_TASK",
  "INVALID_TASK_JSON",
  "MISSING_TASK_ID",
  "MISSING_STATUS",
  "TASK_NOT_FOUND",
]

const LEGACY_MESSAGES = [
  [/^找不到工作表：(.*)$/, "SHEET_NOT_FOUND", "name"],
  [/^找不到 Google Sheet/, "SPREADSHEET_NOT_FOUND"],
  [/^不支援或缺少 action：(.*)$/, "UNKNOWN_ACTION", "action"],
  [/^缺少 task 參數$/, "MISSING_TASK"],
  [/^task JSON 格式錯誤$/, "INVALID_TASK_JSON"],
  [/^(Task 缺少 id|缺少 Task ID)$/, "MISSING_TASK_ID"],
  [/^缺少目標 Status$/, "MISSING_STATUS"],
  [/^找不到 Task：(.*)$/, "TASK_NOT_FOUND", "id"],
]

// Turns an Apps Script error response into a message in the current language,
// falling back to the script's own (Chinese) message when it isn't recognised.
export const translateScriptError = (body = {}) => {
  if (KNOWN_CODES.includes(body.code)) {
    return t(`scriptError.${body.code}`, body.params || {})
  }

  const message = String(body.message || "").replace(/^(Error|Exception):\s*/, "")
  for (const [pattern, code, param] of LEGACY_MESSAGES) {
    const match = message.match(pattern)
    if (match) return t(`scriptError.${code}`, param ? { [param]: match[1] } : {})
  }
  return message
}
