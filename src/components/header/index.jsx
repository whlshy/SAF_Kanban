import React from 'react'
import { AppBar, Badge, Box, Toolbar, Typography, Button, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Divider, List, ListItemButton } from '@mui/material'
import { Add as AddIcon, Settings as SettingsIcon, ArrowDropDown as ArrowDropDownIcon, Check as CheckIcon, FileDownloadOutlined as ExportIcon, FileUploadOutlined as ImportIcon, LightModeOutlined as LightModeIcon, DarkModeOutlined as DarkModeIcon, HistoryOutlined as HistoryIcon, Search as SearchIcon, InstallMobileOutlined as InstallIcon, SmartToyOutlined as ConnectionIcon, SystemUpdateAltOutlined as UpdateIcon } from '@mui/icons-material'
import { useAtom } from 'jotai';
import { EMPTY_FILTER, isFilterActive } from '@/lib/filter';
import { filterAtom } from '@/store/filter';
import { useInstallPrompt } from '@/pwa';
import { LANGUAGES, langAtom, useT } from '@/i18n';
import { dialogAtom } from '../content/Home'

import { useDialogStore } from '@/store';
import { boardTitle, useBoards } from '@/store/boards';
import { useTheme } from '@/store/theme';
import HistoryDialog from './HistoryDialog';
import { useStartExport, useStartImport } from './BoardTransfer';
import Logo from './Logo';
import { PHONE_QUERY } from '@/lib/usePhone';
import { useOpenSettings } from './SettingDialog'
import { useOpenNewBoard } from './NewBoardDialog'
import { useOpenConnection } from './ConnectionDialog'
import { localAvailable, localCanUpdate } from '@/data/localApi';
import { checkForDesktopUpdate } from '@/desktopUpdate';

function Header() {
  const { boards, currentBoard, switchBoard } = useBoards();
  const { setDialog: setDefaultDialog } = useDialogStore()
  const [, setDialog] = useAtom(dialogAtom);
  const [menuAnchor, setMenuAnchor] = React.useState(null);
  const startExport = useStartExport();
  const startImport = useStartImport();
  const openSettings = useOpenSettings();
  const openNewBoard = useOpenNewBoard();
  const openConnection = useOpenConnection();
  const [lang] = useAtom(langAtom);
  const t = useT();
  const { isDark, toggleTheme } = useTheme();
  const [filter, setFilter] = useAtom(filterAtom);
  const install = useInstallPrompt();
  const canUpdate = localCanUpdate();
  const filtering = isFilterActive(filter);

  const displayTitle = boardTitle(currentBoard);

  React.useEffect(() => {
    document.title = displayTitle;
  }, [displayTitle]);

  React.useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const openHistory = () => setDefaultDialog({
    title: t("history.title", { name: displayTitle }),
    open: true, fullWidth: true, maxWidth: "md",
    content: <HistoryDialog />
  });

  const openLanguage = () => setDefaultDialog({
    title: t("language.title"),
    open: true, compact: true, content: <LanguageDialog />
  });

  const handleAddBoard = () => {
    setMenuAnchor(null);
    openNewBoard();
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar
        position="fixed"
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          background: isDark ? "#1f1f1f" : "#ffffff",
          color: isDark ? "#ffffff" : "rgba(0, 0, 0, 0.87)",
          boxShadow: isDark ? undefined : "0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.06)",
        }}
      >
        {/* On narrow screens the title shrinks to one line with an ellipsis and the
            buttons keep their size, so nothing wraps. */}
        <Toolbar sx={{ px: { xs: 1.5, sm: 3 } }}>
          <Logo sx={{ mr: 1 }} />
          {(boards.length > 0 || canUpdate) ? (
            <Button
              color="inherit"
              disableFocusRipple
              endIcon={<ArrowDropDownIcon />}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{ textTransform: 'none', px: 1, minWidth: 0, justifyContent: 'flex-start', ...titleAfterLogoSx }}
            >
              <Typography variant="h6" component="div" noWrap title={displayTitle} sx={titleSx}>
                {displayTitle}
              </Typography>
            </Button>
          ) : (
            <Typography variant="h6" component="div" noWrap title={displayTitle} sx={{ ...titleSx, px: 1, ...titleAfterLogoSx }}>
              {displayTitle}
            </Typography>
          )}
          <Menu
            anchorEl={menuAnchor}
            open={!!menuAnchor}
            onClose={() => setMenuAnchor(null)}
          >
            {boards.map((board) => (
              <MenuItem
                key={board.id}
                selected={board.id === currentBoard?.id}
                onClick={() => (setMenuAnchor(null), switchBoard(board.id))}
              >
                <ListItemIcon>
                  {board.id === currentBoard?.id && <CheckIcon fontSize="small" sx={isDark ? { color: '#58a6ff' } : undefined} />}
                </ListItemIcon>
                <ListItemText>{boardTitle(board)}</ListItemText>
              </MenuItem>
            ))}
            {boards.length > 0 && <Divider />}
            <MenuItem onClick={handleAddBoard}>
              <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t("board.new")}</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => (setMenuAnchor(null), startExport())}>
              <ListItemIcon><ExportIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t("transfer.export")}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => (setMenuAnchor(null), startImport())}>
              <ListItemIcon><ImportIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t(localAvailable() ? "transfer.import.desktop" : "transfer.import")}</ListItemText>
            </MenuItem>
            {/* Only when the browser offers to install the site as an app. */}
            {install && <Divider />}
            {install && (
              <MenuItem onClick={() => (setMenuAnchor(null), install())}>
                <ListItemIcon><InstallIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t("pwa.install")}</ListItemText>
              </MenuItem>
            )}
            {/* Installed desktop app only: manually check for updates. */}
            {canUpdate && <Divider />}
            {canUpdate && (
              <MenuItem onClick={() => (setMenuAnchor(null), checkForDesktopUpdate())}>
                <ListItemIcon><UpdateIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t("desktopUpdate.check")}</ListItemText>
              </MenuItem>
            )}
          </Menu>
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            color="inherit"
            size="small"
            onClick={toggleTheme}
            aria-label={isDark ? t("theme.toLight") : t("theme.toDark")}
            title={isDark ? t("theme.toLight") : t("theme.toDark")}
            sx={iconSx}
          >
            {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
          <Button
            color="inherit"
            variant="outlined"
            size="small"
            onClick={openLanguage}
            aria-label={`${t("language.title")}: ${LANGUAGES.find((l) => l.code === lang)?.name}`}
            sx={{
              textTransform: 'none',
              borderRadius: 9999,
              minWidth: 0,
              px: 0.75,
              py: '1px',
              mr: { xs: 0.5, sm: 1 },
              flexShrink: 0,
              whiteSpace: 'nowrap',
              fontSize: '0.6875rem',
              lineHeight: '16px',
              // A small tag, but as easy to tap as the 30px icon buttons beside it.
              '&::before': { content: '""', position: 'absolute', inset: '-5px -2px' },
              borderColor: isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.3)',
              '&:hover': { borderColor: isDark ? 'white' : 'rgba(0, 0, 0, 0.6)' },
            }}
          >
            {LANGUAGES.find((l) => l.code === lang)?.short}
          </Button>
          {currentBoard && (
            // Opens the search and filter bar; closing it also clears the filter,
            // so tasks are never hidden without the bar showing why.
            <IconButton
              color={filter.open ? "primary" : "inherit"}
              size="small"
              onClick={() => setFilter((f) => (f.open ? { open: false, ...EMPTY_FILTER } : { ...f, open: true }))}
              aria-label={filter.open ? t("filter.close") : t("filter.open")}
              aria-pressed={filter.open}
              title={filter.open ? t("filter.close") : t("filter.open")}
              sx={{ ...iconSx, ...(isDark && filter.open ? { color: '#58a6ff' } : {}) }}
            >
              <Badge color="primary" variant="dot" invisible={!filtering} overlap="circular">
                <SearchIcon fontSize="small" />
              </Badge>
            </IconButton>
          )}
          {currentBoard && (
            <IconButton
              color="inherit"
              size="small"
              onClick={openHistory}
              aria-label={t("history.open")}
              title={t("history.open")}
              sx={iconSx}
            >
              <HistoryIcon fontSize="small" />
            </IconButton>
          )}
          {/* Desktop app only: how AI agents and other programs connect. */}
          {localAvailable() && (
            <IconButton color="inherit" size="small" onClick={openConnection} aria-label={t("connection.title")} title={t("connection.title")} sx={iconSx}>
              <ConnectionIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton color="inherit" size="small" onClick={openSettings} aria-label={t("settings.title")} title={t("settings.title")} sx={iconSx}>
            <SettingsIcon fontSize="small" />
          </IconButton>
          <IconButton color="inherit" size="small" onClick={() => setDialog({ open: true })} aria-label={t("task.create")} title={t("task.create")} sx={{ flexShrink: 0 }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Toolbar>
      </AppBar>
    </Box>
  )
}

export default Header;

const titleSx = { minWidth: 0, fontSize: { xs: '1.1rem', sm: '1.25rem' } };
// Without the logo (phones) the title starts at the toolbar's edge again.
const titleAfterLogoSx = { [`@media ${PHONE_QUERY}`]: { ml: -1 } };
const iconSx = { mr: { xs: 0.5, sm: 1 }, flexShrink: 0 };

const LanguageDialog = ({ closeDialog }) => {
  const [lang, setLang] = useAtom(langAtom);

  return (
    <List sx={{ minWidth: 280, py: 0 }}>
      {LANGUAGES.map(({ code, short, name }) => (
        <ListItemButton
          key={code}
          selected={code === lang}
          onClick={() => (setLang(code), closeDialog?.())}
        >
          <ListItemIcon>{code === lang && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>{name} ({short})</ListItemText>
        </ListItemButton>
      ))}
    </List>
  )
}
