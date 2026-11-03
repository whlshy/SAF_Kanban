import React from 'react'
import { AppBar, Box, Toolbar, Typography, Button, IconButton, DialogContent, TextField, Menu, MenuItem, ListItemIcon, ListItemText, Divider, List, ListItemButton } from '@mui/material'
import { Add as AddIcon, Settings as SettingsIcon, ArrowDropDown as ArrowDropDownIcon, Check as CheckIcon, FileDownloadOutlined as ExportIcon, FileUploadOutlined as ImportIcon, Translate as TranslateIcon } from '@mui/icons-material'
import { useAtom } from 'jotai';
import { LANGUAGES, langAtom, useT } from '@/i18n';
import { dialogAtom } from '../content/Home'

import { useDialogStore } from '@/store';
import { boardTitle, useBoards } from '@/store/boards';
import { exportBoards, useStartImport } from './BoardTransfer';
import { SETTING_FIELDS, useOpenSettings } from './SettingDialog';

function index() {
  const { boards, currentBoard, switchBoard, addBoard } = useBoards();
  const { setDialog: setDefaultDialog } = useDialogStore()
  const [, setDialog] = useAtom(dialogAtom);
  const [menuAnchor, setMenuAnchor] = React.useState(null);
  const startImport = useStartImport();
  const openSettings = useOpenSettings();
  const [lang] = useAtom(langAtom);
  const t = useT();

  const displayTitle = boardTitle(currentBoard);

  React.useEffect(() => {
    document.title = displayTitle;
  }, [displayTitle]);

  React.useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const openLanguage = () => setDefaultDialog({
    title: t("language.title"),
    open: true, content: <LanguageDialog />
  });

  const handleAddBoard = () => {
    setMenuAnchor(null);
    setDefaultDialog({
      title: t("board.new"),
      open: true, content: <NewBoardDialog onCreate={addBoard} />
    });
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, background: "#1f1f1f" }}>
        <Toolbar>
          {boards.length > 0 ? (
            <Button
              color="inherit"
              disableFocusRipple
              endIcon={<ArrowDropDownIcon />}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{ textTransform: 'none', ml: -1, px: 1 }}
            >
              <Typography variant="h6" component="div">
                {displayTitle}
              </Typography>
            </Button>
          ) : (
            <Typography variant="h6" component="div">
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
          <Button
            color="inherit"
            startIcon={<TranslateIcon />}
            onClick={openLanguage}
            sx={{ textTransform: 'none', mr: 1 }}
          >
            {LANGUAGES.find((l) => l.code === lang)?.name}
          </Button>
          <IconButton style={{ color: "white" }} onClick={openSettings}>
            <SettingsIcon />
          </IconButton>
          <IconButton style={{ color: "white" }} onClick={() => setDialog({ open: true })}>
            <AddIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
    </Box>
  )
}

export default index;

const LanguageDialog = ({ closeDialog }) => {
  const [lang, setLang] = useAtom(langAtom);

  return (
    <List sx={{ minWidth: 280, py: 0 }}>
      {LANGUAGES.map(({ code, name }) => (
        <ListItemButton
          key={code}
          selected={code === lang}
          onClick={() => (setLang(code), closeDialog?.())}
        >
          <ListItemIcon>{code === lang && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>{name}</ListItemText>
        </ListItemButton>
      ))}
    </List>
  )
}

const NewBoardDialog = ({ onCreate, closeDialog }) => {
  const [fields, setFields] = React.useState({});
  const t = useT();

  const handleCreate = () => {
    onCreate(fields);
    closeDialog?.();
  };

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      {SETTING_FIELDS.map(({ field, labelKey }) => (
        <TextField
          key={field}
          label={t(labelKey)}
          variant="standard"
          placeholder={field === "title" ? t("board.untitled") : undefined}
          value={fields[field] || ""}
          onChange={(e) => setFields((f) => ({ ...f, [field]: e.target.value }))}
          fullWidth
          autoFocus={field === "title"}
        />
      ))}
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
