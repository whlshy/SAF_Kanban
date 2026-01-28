import React from 'react'
import { AppBar, Box, Toolbar, Typography, Button, IconButton } from '@mui/material'
import { Add as AddIcon } from '@mui/icons-material'
import { Link, useLocation } from 'react-router-dom'

import LoginStateAvator from './LoginStateAvator'

import useAppStore from '../../store/app'

function index(props) {
  const { title, name, logout } = props
  const { setSidebarOpen } = useAppStore()
  const location = useLocation()

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, background: "#1f1f1f" }}>
        <Toolbar>
          <Typography variant="h6" component="div">
            {title}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <IconButton style={{color: "white"}}>
            <AddIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
    </Box>
  )
}

export default index