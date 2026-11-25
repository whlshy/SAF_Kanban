import React from 'react'
import { Button as MuiButton } from '@mui/material'
import { Add as AddIcon, Settings as SettingsIcon, FileUploadOutlined as ImportIcon } from '@mui/icons-material'
import { TEMPLATE_COPY_URL } from '@/store/boards'
import { useT } from '@/i18n'
import { useOpenSettings } from '@/components/header/SettingDialog'
import { useOpenNewBoard } from '@/components/header/NewBoardDialog'
import { useStartImport } from '@/components/header/BoardTransfer'
import { localAvailable } from '@/data/localApi'

// Shown instead of the board when it cannot be displayed (no Sheet ID, or no
// columns could be read), so the page is not just blank.
export function BoardNotice({ title, description, action }) {
  const openSettings = useOpenSettings()
  const t = useT()
  // Most notices are fixed in Settings.
  const { label, icon, onClick } = action || { label: t("board.empty.settings"), icon: <SettingsIcon />, onClick: openSettings }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex max-w-xl flex-col gap-2">
        <h2 className="text-xl font-medium text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <MuiButton variant="contained" startIcon={icon} onClick={onClick} sx={{ textTransform: 'none' }}>
        {label}
      </MuiButton>
    </div>
  )
}

// Shown when there are no boards yet: set one up, or bring settings over from a file.
export function EmptyBoards() {
  const openSettings = useOpenSettings()
  const openNewBoard = useOpenNewBoard()
  const startImport = useStartImport()
  const t = useT()
  // In the desktop app the first board is normally one kept on this computer.
  const local = localAvailable()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-medium text-foreground">{t("board.empty.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(local ? "board.empty.description.local" : "board.empty.description")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {local && (
          <MuiButton variant="contained" startIcon={<AddIcon />} onClick={openNewBoard} sx={{ textTransform: 'none' }}>
            {t("board.new")}
          </MuiButton>
        )}
        <MuiButton variant={local ? "outlined" : "contained"} startIcon={<SettingsIcon />} onClick={openSettings} sx={{ textTransform: 'none' }}>
          {t(local ? "board.empty.settings.sheet" : "board.empty.settings")}
        </MuiButton>
        <MuiButton variant="outlined" startIcon={<ImportIcon />} onClick={startImport} sx={{ textTransform: 'none' }}>
          {t("board.empty.import")}
        </MuiButton>
      </div>
      <a
        href={TEMPLATE_COPY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {t("board.empty.template")}
      </a>
    </div>
  )
}
