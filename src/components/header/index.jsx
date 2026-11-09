import React from 'react'
import { AppBar, Box, Toolbar, Typography, Button, IconButton, DialogContent, TextField, Menu, MenuItem, ListItemIcon, ListItemText, Divider, List, ListItemButton } from '@mui/material'
import { Add as AddIcon, Settings as SettingsIcon, ArrowDropDown as ArrowDropDownIcon, Check as CheckIcon, FileDownloadOutlined as ExportIcon, FileUploadOutlined as ImportIcon, LightModeOutlined as LightModeIcon, DarkModeOutlined as DarkModeIcon, HistoryOutlined as HistoryIcon } from '@mui/icons-material'
import { useAtom } from 'jotai';
import { LANGUAGES, langAtom, useT } from '@/i18n';
import { dialogAtom } from '../content/Home'

import { useDialogStore } from '@/store';
import { boardTitle, normalizeBoardField, uniqueBoardTitle, useBoards } from '@/store/boards';
import { useTheme } from '@/store/theme';
import HistoryDialog from './HistoryDialog';
import { useStartExport, useStartImport } from './BoardTransfer';
import { DialogFooter } from '@/components/elements/dialog/Dialog';
import Logo from './Logo';
import { PHONE_QUERY } from '@/lib/usePhone';
import { SETTING_FIELDS, useOpenSettings } from './SettingDialog';

function index() {
  const { boards, currentBoard, switchBoard } = useBoards();
  const { setDialog: setDefaultDialog } = useDialogStore()
  const [, setDialog] = useAtom(dialogAtom);
  const [menuAnchor, setMenuAnchor] = React.useState(null);
  const startExport = useStartExport();
  const startImport = useStartImport();
  const openSettings = useOpenSettings();
  const [lang] = useAtom(langAtom);
  const t = useT();
  const { isDark, toggleTheme } = useTheme();

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
    setDefaultDialog({
      title: t("board.new"),
      open: true, fullWidth: true, maxWidth: "sm", content: <NewBoardDialog />
    });
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
          {boards.length > 0 ? (
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
                  {board.id === currentBoard?.id && <CheckIcon fontSize="small" />}
                </ListItemIcon>
                <ListItemText>{boardTitle(board)}</ListItemText>
              </MenuItem>
            ))}
            <Divider />
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
              <ListItemText>{t("transfer.import")}</ListItemText>
            </MenuItem>
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

export default index;

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

const NewBoardDialog = ({ closeDialog }) => {
  const { boards, addBoard } = useBoards();
  const [fields, setFields] = React.useState({});
  const t = useT();

  const sameSheet = fields.sheetId?.trim() && boards.find((b) => b.sheetId?.trim() === fields.sheetId.trim());
  // Tell the user up front when the name is taken and what it will become.
  const shownTitle = fields.title?.trim() || t("board.untitled");
  const finalTitle = uniqueBoardTitle(fields.title, boards, t("board.untitled")) || shownTitle;

  const handleCreate = () => {
    addBoard(fields);
    closeDialog?.();
  };

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      {SETTING_FIELDS.map(({ field, labelKey, hintKey }) => (
        <TextField
          key={field}
          label={t(labelKey)}
          variant="standard"
          placeholder={field === "title" ? t("board.untitled") : undefined}
          helperText={field === "title" && finalTitle !== shownTitle
            ? t("board.nameTaken", { name: finalTitle })
            : hintKey && t(hintKey)}
          value={fields[field] || ""}
          onChange={(e) => setFields((f) => ({ ...f, [field]: normalizeBoardField(field, e.target.value) }))}
          fullWidth
          autoFocus={field === "title"}
        />
      ))}
      {sameSheet && (
        <Typography variant="body2" color="warning.main">
          {t("board.sameSheet", { name: boardTitle(sameSheet) })}
        </Typography>
      )}
      <DialogFooter>
        <Button variant="contained" onClick={handleCreate} sx={{ textTransform: 'none', ml: 'auto' }}>
          {t("board.create")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
