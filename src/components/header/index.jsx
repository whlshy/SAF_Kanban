import React from 'react'
import { AppBar, Box, Toolbar, Typography, Button, IconButton, DialogContent, TextField } from '@mui/material'
import { Add as AddIcon, Settings as SettingsIcon } from '@mui/icons-material'
import { Link, useLocation } from 'react-router-dom'
import { atom, useAtom } from 'jotai';
import { dialogAtom } from '../content/Home'

import LoginStateAvator from './LoginStateAvator'

import useAppStore from '../../store/app'
import { useDialogStore } from '@/store';

function index(props) {
  const { title, name, logout } = props
  const { setSidebarOpen } = useAppStore()
  const { setDialog: setDefaultDialog } = useDialogStore()
  const location = useLocation()

  const [, setDialog] = useAtom(dialogAtom);

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, background: "#1f1f1f" }}>
        <Toolbar>
          <Typography variant="h6" component="div">
            {title}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            style={{ color: "white" }}
            onClick={() => setDefaultDialog({
              title: "Settings",
              open: true, content: <SettingDialog />
            })}
          >
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

const SettingDialog = () => {
  return (
    <DialogContent sx={{ '& .MuiTextField-root': { mb: 2 } }}>
      <TextField
        label="Sheet API"
        variant="standard"
        defaultValue={localStorage.getItem("sheet") || ""}
        onChange={(e) => localStorage.setItem("sheet", e.target.value)}
        fullWidth
        autoFocus
      />
      <TextField
        label="User Key"
        variant="standard"
        defaultValue={localStorage.getItem("user") || ""}
        onChange={(e) => localStorage.setItem("user", e.target.value)}
        fullWidth
      />
      <TextField
        label="Jira Link"
        variant="standard"
        defaultValue={localStorage.getItem("jiraLink") || ""}
        onChange={(e) => localStorage.setItem("jiraLink", e.target.value)}
        fullWidth
      />
    </DialogContent>
  )
}