import React from 'react'
import { Box, Button, DialogContent, IconButton, Link, Tab, Tabs, Typography } from '@mui/material'
import { ContentCopy as CopyIcon, VisibilityOffOutlined as HideIcon, VisibilityOutlined as ShowIcon } from '@mui/icons-material'
import { message } from 'antd'

import { DialogFooter } from '@/components/elements/dialog/Dialog'
import { localRequest, localToken, setLocalToken } from '@/data/localApi'
import { t as translate, useT } from '@/i18n'
import { useAlertStore, useDialogStore } from '@/store'

const API_DOCS_URL = "https://github.com/whlshy/SAF_Kanban/blob/main/desktop/README.md#api"
const MASK = "••••••••••••••••"

// How to connect each kind of AI app. `token` is the real token or the mask.
const SETUPS = [
  {
    key: "claudeCode",
    text: ({ mcpUrl }, token) => `claude mcp add --transport http saf-kanban ${mcpUrl} --header "Authorization: Bearer ${token}"`,
  },
  {
    key: "http",
    text: ({ mcpUrl }, token) => JSON.stringify({
      mcpServers: { "saf-kanban": { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } },
    }, null, 2),
  },
  {
    // Started as a program; it finds the running app and the token by itself.
    key: "stdio",
    text: ({ executable, dataDir }) => JSON.stringify({
      mcpServers: { "saf-kanban": { command: executable, args: ["mcp", "--data-dir", dataDir] } },
    }, null, 2),
  },
]

const copy = (text) => navigator.clipboard.writeText(text).then(
  () => message.success(translate("connection.copied")),
  () => message.error(translate("connection.copyFailed")),
)

function CopyButton({ text, label }) {
  return (
    <IconButton size="small" onClick={() => copy(text)} aria-label={label} title={label}>
      <CopyIcon sx={{ fontSize: 16 }} />
    </IconButton>
  )
}

function Row({ label, value, shown = value, children }) {
  const t = useT()
  return (
    <Box className="flex items-center gap-2" sx={{ py: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: '6.5em', flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" component="code" data-slot="connection-value" sx={{ flex: 1, minWidth: 0, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
        {shown}
      </Typography>
      {children}
      <CopyButton text={value} label={t("connection.copy", { name: label })} />
    </Box>
  )
}

// Shows how another program (an AI agent, a script) connects to the boards on
// this computer, and lets the user replace the token it needs.
const ConnectionDialog = () => {
  const t = useT()
  const { setAlert } = useAlertStore()
  const [details, setDetails] = React.useState(null)
  const [token, setToken] = React.useState(localToken)
  const [showToken, setShowToken] = React.useState(false)
  const [tab, setTab] = React.useState(SETUPS[0].key)

  React.useEffect(() => {
    localRequest("GET", "/connection").then(setDetails, (error) => message.error(error?.userMessage || t("common.apiError"), 8))
  }, [])

  const replaceToken = () => setAlert({
    title: t("connection.newToken"),
    content: t("connection.newToken.confirm"),
    handleAgree: async (callback) => {
      callback?.()
      try {
        const answer = await localRequest("POST", "/token")
        setLocalToken(answer.token)
        setToken(answer.token)
        message.success(t("connection.newToken.done"))
      } catch (error) {
        message.error(error?.userMessage || t("common.apiError"), 8)
      }
    },
  })

  const setup = SETUPS.find((each) => each.key === tab)

  return (
    <DialogContent>
      <Typography variant="body2" sx={{ mb: 2 }}>{t("connection.intro")}</Typography>
      {details && (
        <>
          <Row label={t("connection.mcpUrl")} value={details.mcpUrl} />
          <Row label={t("connection.apiUrl")} value={details.apiUrl} />
          <Row label={t("connection.token")} value={token} shown={showToken ? token : MASK}>
            <IconButton size="small" onClick={() => setShowToken((shown) => !shown)} aria-label={t(showToken ? "connection.hideToken" : "connection.showToken")} title={t(showToken ? "connection.hideToken" : "connection.showToken")}>
              {showToken ? <HideIcon sx={{ fontSize: 16 }} /> : <ShowIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </Row>
          <Row label={t("connection.dataDir")} value={details.dataDir} />

          <Typography variant="subtitle2" sx={{ mt: 3 }}>{t("connection.setup")}</Typography>
          <Tabs value={tab} onChange={(e, value) => setTab(value)} variant="scrollable" sx={{ minHeight: 36, '& .MuiTab-root': { textTransform: 'none', minHeight: 36, py: 0.5 } }}>
            {SETUPS.map(({ key }) => <Tab key={key} value={key} label={t(`connection.setup.${key}`)} />)}
          </Tabs>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, mb: 0.5 }}>
            {t(`connection.setup.${tab}.hint`)}
          </Typography>
          <Box sx={{ position: 'relative', bgcolor: 'grey.100', borderRadius: 1, p: 1.5, pr: 5 }}>
            <Box component="pre" data-slot="connection-setup" sx={{ m: 0, fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {setup.text(details, showToken ? token : MASK)}
            </Box>
            <Box sx={{ position: 'absolute', top: 4, right: 4 }}>
              <CopyButton text={setup.text(details, token)} label={t("connection.copySetup")} />
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
            {t("connection.note")}{" "}
            <Link href={API_DOCS_URL} target="_blank" rel="noopener noreferrer">{t("connection.docs")}</Link>
          </Typography>
        </>
      )}
      <DialogFooter>
        <Button color="error" onClick={replaceToken} disabled={!details} sx={{ textTransform: 'none', ml: -1, mr: 'auto', minWidth: 0 }}>
          {t("connection.newToken")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function useOpenConnection() {
  const { setDialog } = useDialogStore()

  return React.useCallback(() => setDialog({
    title: translate("connection.title"),
    open: true, fullWidth: true, maxWidth: "md", content: <ConnectionDialog />
  }), [setDialog])
}
