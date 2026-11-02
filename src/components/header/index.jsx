import React from 'react'
import { AppBar, Box, Toolbar, Typography, Button, IconButton, DialogContent, TextField, Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material'
import { Add as AddIcon, Settings as SettingsIcon, ArrowDropDown as ArrowDropDownIcon, Check as CheckIcon } from '@mui/icons-material'
import { useAtom } from 'jotai';
import { dialogAtom } from '../content/Home'

import { useAlertStore, useDialogStore } from '@/store';
import { boardTitle, useBoards } from '@/store/boards';

function index() {
  const { boards, currentBoard, switchBoard, addBoard } = useBoards();
  const { setDialog: setDefaultDialog } = useDialogStore()
  const [, setDialog] = useAtom(dialogAtom);
  const [menuAnchor, setMenuAnchor] = React.useState(null);

  const displayTitle = boardTitle(currentBoard);

  React.useEffect(() => {
    document.title = displayTitle;
  }, [displayTitle]);

  const openSettings = () => setDefaultDialog({
    title: "Settings",
    open: true, content: <SettingDialog />
  });

  const handleAddBoard = () => {
    setMenuAnchor(null);
    addBoard();
    openSettings();
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, background: "#1f1f1f" }}>
        <Toolbar>
          {boards.length > 1 ? (
            <Button
              color="inherit"
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

const SETTING_FIELDS = [
  { field: "title", label: "Title", placeholder: "SAF Kanban" },
  { field: "sheetId", label: "Sheet ID", autoFocus: true },
  { field: "scriptId", label: "Sheet API Key" },
  { field: "userKey", label: "User Key" },
  { field: "jiraLink", label: "Jira Link" },
]

const SettingDialog = ({ closeDialog }) => {
  const { currentBoard, addBoard, updateCurrentBoard, deleteBoard } = useBoards();
  const { setAlert } = useAlertStore();

  const handleDelete = () => setAlert({
    title: "刪除看板",
    content: `確定要刪除「${boardTitle(currentBoard)}」？只會移除這個瀏覽器裡的設定，不會刪除 Google Sheet 的資料。`,
    handleAgree: (callback) => (callback?.(), deleteBoard(currentBoard.id), closeDialog?.()),
  });

  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      {/* Remount the fields when switching boards so defaultValue refreshes */}
      <div key={currentBoard?.id || "new"}>
        {SETTING_FIELDS.map(({ field, label, placeholder, autoFocus }) => (
          <TextField
            key={field}
            label={label}
            variant="standard"
            placeholder={placeholder}
            defaultValue={currentBoard?.[field] || ""}
            onChange={(e) => updateCurrentBoard({ [field]: e.target.value })}
            fullWidth
            autoFocus={autoFocus}
          />
        ))}
      </div>
      <Box className="flex items-center justify-between" sx={{ mt: 1 }}>
        {currentBoard ? (
          <Button color="error" onClick={handleDelete} sx={{ textTransform: 'none' }}>
            刪除看板
          </Button>
        ) : <span />}
        <Button variant="outlined" startIcon={<AddIcon />} onClick={addBoard} sx={{ textTransform: 'none' }}>
          新增看板
        </Button>
      </Box>
    </DialogContent>
  )
}
