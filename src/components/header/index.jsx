import React from 'react'
import { AppBar, Box, Toolbar, Typography, Button, IconButton, DialogContent, TextField, Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material'
import { Add as AddIcon, Settings as SettingsIcon, ArrowDropDown as ArrowDropDownIcon, Check as CheckIcon, FileDownloadOutlined as ExportIcon, FileUploadOutlined as ImportIcon } from '@mui/icons-material'
import { useAtom } from 'jotai';
import { dialogAtom } from '../content/Home'

import { useDialogStore } from '@/store';
import { boardTitle, useBoards, UNTITLED_TITLE } from '@/store/boards';
import { exportBoards, useStartImport } from './BoardTransfer';
import { SETTING_FIELDS, useOpenSettings } from './SettingDialog';

function index() {
  const { boards, currentBoard, switchBoard, addBoard } = useBoards();
  const { setDialog: setDefaultDialog } = useDialogStore()
  const [, setDialog] = useAtom(dialogAtom);
  const [menuAnchor, setMenuAnchor] = React.useState(null);
  const startImport = useStartImport();
  const openSettings = useOpenSettings();

  const displayTitle = boardTitle(currentBoard);

  React.useEffect(() => {
    document.title = displayTitle;
  }, [displayTitle]);

  const handleAddBoard = () => {
    setMenuAnchor(null);
    setDefaultDialog({
      title: "新增看板",
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
              <ListItemText>新增看板</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => (setMenuAnchor(null), exportBoards(boards))}>
              <ListItemIcon><ExportIcon fontSize="small" /></ListItemIcon>
              <ListItemText>匯出設定</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => (setMenuAnchor(null), startImport())}>
              <ListItemIcon><ImportIcon fontSize="small" /></ListItemIcon>
              <ListItemText>匯入設定</ListItemText>
            </MenuItem>
          </Menu>
          <Box sx={{ flexGrow: 1 }} />
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

const NewBoardDialog = ({ onCreate, closeDialog }) => {
  const [fields, setFields] = React.useState({});

  const handleCreate = () => {
    onCreate(fields);
    closeDialog?.();
  };

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      {SETTING_FIELDS.map(({ field, label }) => (
        <TextField
          key={field}
          label={label}
          variant="standard"
          placeholder={field === "title" ? UNTITLED_TITLE : undefined}
          value={fields[field] || ""}
          onChange={(e) => setFields((f) => ({ ...f, [field]: e.target.value }))}
          fullWidth
          autoFocus={field === "title"}
        />
      ))}
      <Box className="flex items-center justify-end gap-2" sx={{ mt: 1 }}>
        <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>
          取消
        </Button>
        <Button variant="contained" onClick={handleCreate} sx={{ textTransform: 'none' }}>
          建立
        </Button>
      </Box>
    </DialogContent>
  )
}
