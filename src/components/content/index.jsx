import React from 'react'
import { Box } from '@mui/material'
import { Routes, Route } from 'react-router-dom'
import Home from './Home'
import CreateRoom from './CreateRoom'
import JoinRoom from './JoinRoom'
import TransferPage from './Transfer'
import { useSearchParams } from 'react-router-dom';
import Peer from '../elements/Peer'

function index() {
  const [searchParams, setSearchParams] = useSearchParams();
  const roomId = searchParams.get("roomId")
  const isHost = searchParams.get("isHost")

  return (
    <Box sx={{ flex: "1 1 auto",  }}>
      <Peer roomId={roomId} isHost={isHost} />
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </Box>
  )
}

export default index