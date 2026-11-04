import React from 'react'
import { AppBar, Box, Toolbar, Typography, Button, IconButton, DialogContent, TextField, Menu, MenuItem, ListItemIcon, ListItemText, Divider, List, ListItemButton } from '@mui/material'
import { Add as AddIcon, Settings as SettingsIcon, ArrowDropDown as ArrowDropDownIcon, Check as CheckIcon, FileDownloadOutlined as ExportIcon, FileUploadOutlined as ImportIcon, LightModeOutlined as LightModeIcon, DarkModeOutlined as DarkModeIcon, HistoryOutlined as HistoryIcon } from '@mui/icons-material'
import { useAtom } from 'jotai';
import { LANGUAGES, langAtom, useT } from '@/i18n';
import { dialogAtom } from '../content/Home'

import { useDialogStore } from '@/store';
import { boardTitle, normalizeBoardField, useBoards } from '@/store/boards';
import { useTheme } from '@/store/theme';
import HistoryDialog from './HistoryDialog';
import { exportBoards, useStartImport } from './BoardTransfer';
import { SETTING_FIELDS, useOpenSettings } from './SettingDialog';

function index() {
  const { boards, currentBoard, switchBoard } = useBoards();
  const { setDialog: setDefaultDialog } = useDialogStore()
  const [, setDialog] = useAtom(dialogAtom);
  const [menuAnchor, setMenuAnchor] = React.useState(null);
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
    open: true, content: <LanguageDialog />
  });

  const handleAddBoard = () => {
    setMenuAnchor(null);
    setDefaultDialog({
      title: t("board.new"),
      open: true, content: <NewBoardDialog />
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
          boxShadow: isDark ? undefined : "0 1px 0 #d0d7de",
        }}
      >
        {/* On narrow screens the title shrinks to one line with an ellipsis and the
            buttons keep their size, so nothing wraps. */}
        <Toolbar sx={{ px: { xs: 1.5, sm: 3 } }}>
          {boards.length > 0 ? (
            <Button
              color="inherit"
              disableFocusRipple
              endIcon={<ArrowDropDownIcon />}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{ textTransform: 'none', ml: -1, px: 1, minWidth: 0, justifyContent: 'flex-start' }}
            >
              <Typography variant="h6" component="div" noWrap title={displayTitle} sx={titleSx}>
                {displayTitle}
              </Typography>
            </Button>
          ) : (
            <Typography variant="h6" component="div" noWrap title={displayTitle} sx={titleSx}>
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
            <MenuItem onClick={() => (setMenuAnchor(null), exportBoards(boards))}>
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
              px: { xs: 1, sm: 1.5 },
              py: 0.25,
              mr: { xs: 0.5, sm: 1 },
              flexShrink: 0,
              whiteSpace: 'nowrap',
              fontSize: '0.8125rem',
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
          <IconButton color="inherit" onClick={openSettings} sx={actionSx}>
            <SettingsIcon />
          </IconButton>
          <IconButton color="inherit" onClick={() => setDialog({ open: true })} sx={actionSx}>
            <AddIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
    </Box>
  )
}

export default index;

const titleSx = { minWidth: 0, fontSize: { xs: '1.1rem', sm: '1.25rem' } };
const iconSx = { mr: { xs: 0.5, sm: 1 }, flexShrink: 0 };
const actionSx = { flexShrink: 0, p: { xs: 0.75, sm: 1 } };

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
          helperText={hintKey && t(hintKey)}
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
      <Box className="flex items-center justify-end gap-2" sx={{ mt: 1 }}>
        <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>
          {t("common.cancel")}
        </Button>
        <Button variant="contained" onClick={handleCreate} sx={{ textTransform: 'none' }}>
          {t("board.create")}
        </Button>
      </Box>
    </DialogContent>
  )
}
