import React from 'react'
import { Box } from '@mui/material'
import Content from './content'
import Footer from './footer'

function Main() {
  return (
    <Box sx={{ display: 'flex', height: "100%", width: "100%" }}>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0, // let a wide board scroll inside itself instead of widening the page
          p: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Content />
        <Footer />
      </Box>
    </Box>
  )
}

export default Main
