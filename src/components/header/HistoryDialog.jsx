import React from 'react'
import { Box, Button, CircularProgress, DialogContent, InputAdornment, Link, TextField, Typography } from '@mui/material'
import { Search as SearchIcon } from '@mui/icons-material'

import { getGoogleSheetHistory } from '@/apis/sheet'
import { PriorityBadge } from '@/components/content/Home'
import { langAtom, useT } from '@/i18n'
import { filterHistory, parseHistory } from '@/lib/history'
import { useBoards } from '@/store/boards'
import { useAtomValue } from 'jotai'

const PAGE_SIZE = 50

const UPDATE_SCRIPT_URL = {
  "zh-TW": "https://github.com/whlshy/SAF_Kanban/blob/main/README.md#更新-apps-script",
  en: "https://github.com/whlshy/SAF_Kanban/blob/main/README.en.md#update-the-apps-script",
}

// Loads the history sheet when opened. A missing sheet (older Apps Script, or
// nothing deleted yet) is an expected state, not an error toast.
const loadHistory = async (sheetId) => {
  const response = await getGoogleSheetHistory(sheetId).catch(() => null)
  if (response?.ok && !response.body?.error) {
    return { status: "ready", records: parseHistory(response.body?.values) }
  }
  const message = String(response?.body?.error?.message || "")
  if (response?.status === 400 && /parse range/i.test(message)) {
    return { status: "missing", records: [] }
  }
  return { status: "error", records: [] }
}

export default function HistoryDialog() {
  const { currentBoard } = useBoards()
  const lang = useAtomValue(langAtom)
  const t = useT()
  const [state, setState] = React.useState({ status: "loading", records: [] })
  const [query, setQuery] = React.useState("")
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const deferredQuery = React.useDeferredValue(query)

  const sheetId = currentBoard?.sheetId
  const jiraLink = currentBoard?.jiraLink || ""

  const load = React.useCallback(() => {
    setState({ status: "loading", records: [] })
    loadHistory(sheetId).then(setState)
  }, [sheetId])

  React.useEffect(() => { load() }, [load])
  React.useEffect(() => { setLimit(PAGE_SIZE) }, [deferredQuery])

  const matches = React.useMemo(() => filterHistory(state.records, deferredQuery), [state.records, deferredQuery])
  const shown = matches.slice(0, limit)
  const searching = !!deferredQuery.trim()

  return (
    <DialogContent sx={{ minHeight: 320 }}>
      <TextField
        size="small"
        fullWidth
        autoFocus
        placeholder={t("history.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={state.status !== "ready" || !state.records.length}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
      />

      {state.status === "loading" && (
        <Box className="flex items-center justify-center gap-2" sx={{ py: 6, color: 'text.secondary' }}>
          <CircularProgress size={18} /> {t("history.loading")}
        </Box>
      )}

      {state.status === "error" && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="error" sx={{ mb: 1 }}>{t("history.error")}</Typography>
          <Button onClick={load} sx={{ textTransform: 'none' }}>{t("history.retry")}</Button>
        </Box>
      )}

      {state.status === "missing" && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary" sx={{ mb: 1 }}>{t("history.missing")}</Typography>
          <Link href={UPDATE_SCRIPT_URL[lang] || UPDATE_SCRIPT_URL.en} target="_blank" rel="noopener noreferrer">
            {t("history.missingLink")}
          </Link>
        </Box>
      )}

      {state.status === "ready" && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, mb: 0.5 }}>
            {searching
              ? t("history.found", { count: matches.length })
              : t("history.total", { count: state.records.length })}
          </Typography>

          {!matches.length && (
            <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
              {searching ? t("history.noMatch") : t("history.empty")}
            </Typography>
          )}

          {shown.map((record) => (
            <Box
              key={`${record.row}-${record.id}`}
              data-testid="history-row"
              sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}
            >
              <Box className="flex items-center gap-2">
                <Typography sx={{ fontWeight: 500, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                  {record.title}
                </Typography>
                {record.priority && <PriorityBadge priority={record.priority} />}
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {record.deletedAt || t("history.noTime")}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
                {[
                  record.issueId && (jiraLink
                    ? <Link key="issue" href={`${jiraLink}${record.issueId}`} target="_blank" rel="noopener noreferrer">{record.issueId}</Link>
                    : <span key="issue">{record.issueId}</span>),
                  record.column && <span key="column">{t("history.column", { name: record.column })}</span>,
                  record.assignee && <span key="assignee">{record.assignee}</span>,
                ].filter(Boolean).map((part, i) => <React.Fragment key={i}>{i > 0 && " · "}{part}</React.Fragment>)}
              </Typography>
              {record.des && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {record.des}
                </Typography>
              )}
            </Box>
          ))}

          {matches.length > limit && (
            <Box sx={{ textAlign: 'center', pt: 1.5 }}>
              <Button onClick={() => setLimit((n) => n + PAGE_SIZE)} sx={{ textTransform: 'none' }}>
                {t("history.more", { count: matches.length - limit })}
              </Button>
            </Box>
          )}
        </>
      )}
    </DialogContent>
  )
}
