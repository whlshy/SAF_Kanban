import React from 'react'
import { Box } from '@mui/material'
import { PHONE_QUERY } from '@/lib/usePhone'

// The site icon (design/icons/kanban-drag-frame-soft.svg) drawn inline for the
// header. Lines take the header's text color and the card follows the site
// theme (the `dark` class), not the browser's setting like favicon.svg.
// Hidden on phones, where the header has no room to spare.
export default function Logo({ sx }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 64 64"
      aria-hidden="true"
      sx={{ width: 28, height: 28, flexShrink: 0, [`@media ${PHONE_QUERY}`]: { display: 'none' }, ...sx }}
    >
      <g opacity=".75">
        <rect x="2.25" y="2.25" width="59.5" height="59.5" rx="14" fill="none" stroke="currentColor" strokeWidth="2.5" opacity=".5" />
        <g fill="none" stroke="currentColor" strokeWidth="3">
          <rect x="10.5" y="11.5" width="18.5" height="41" rx="4" />
          <rect x="35" y="11.5" width="18.5" height="41" rx="4" />
        </g>
        <g fill="currentColor">
          <rect x="14" y="15.5" width="11.5" height="7" rx="1.5" />
          <rect x="38.5" y="15.5" width="11.5" height="7" rx="1.5" />
        </g>
      </g>
      <g transform="rotate(-12 32 36)">
        <rect x="21.5" y="30.5" width="24" height="14" rx="3" fill="#000" opacity=".28" />
        <rect x="20" y="28" width="24" height="14" rx="3" className="fill-[#1976d2] dark:fill-[#58a6ff]" />
        <rect x="23.5" y="32" width="12" height="2.6" rx="1.3" fill="#fff" />
        <rect x="23.5" y="36.5" width="8" height="2.6" rx="1.3" fill="#fff" opacity=".8" />
      </g>
    </Box>
  )
}
