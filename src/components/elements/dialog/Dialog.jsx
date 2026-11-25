import React, { cloneElement, createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Box } from '@mui/material'
import { styled } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import usePhone from '@/lib/usePhone'
import { useTheme } from '@/store/theme'

const BootstrapDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiDialogContent-root': {
    padding: theme.spacing(2),
  },
  // Lines up with the content inside it (content components bring their own
  // DialogContent, so their text sits 32px in).
  '& .MuiDialogActions-root': {
    padding: theme.spacing(1.5, 4),
  },
}))

// The footer is a slot under the scrolling content. Content components put
// their buttons in <DialogFooter>, which renders them there through a portal,
// so the buttons share the content's state but stay at the bottom.
const FooterSlot = createContext(null)

export function DialogFooter({ children }) {
  const slot = useContext(FooterSlot)
  return slot ? createPortal(children, slot) : null
}

export default function AppDialog({
  open,
  title,
  content,
  actions,
  body,
  closeDialog,
  disableScrollLock,
  fullWidth,
  maxWidth,
  fullScreen,
  compact,
  persistent,
  contentProps = {},
}) {
  // On phones dialogs fill the screen, except small pickers opened with compact.
  const fill = usePhone() && !compact
  const { isDark } = useTheme()
  const [footerSlot, setFooterSlot] = useState(null)

  return (
    <BootstrapDialog
      // Mirror `.dark` on the portaled dialog root so Tailwind tokens inside
      // dialog content (outside `#root`) match the active theme.
      className={isDark ? 'dark' : undefined}
      // persistent: a click outside doesn't close it (forms with a confirm button).
      onClose={(event, reason) => (persistent && reason === 'backdropClick' ? undefined : closeDialog())}
      open={open}
      disableScrollLock={!!disableScrollLock}
      // Content components bring their own DialogContent; on a full-screen phone
      // dialog drop its side padding so the two paddings don't add up.
      sx={fill ? {
        '& .MuiDialogContent-root .MuiDialogContent-root': { px: 0 },
        '& .MuiDialogActions-root': { px: 2 },
      } : undefined}
      fullWidth={fullWidth}
      maxWidth={maxWidth}
      fullScreen={fullScreen || fill}
    >
      {/* A long title wraps instead of pushing the close button out of the
          dialog (DialogTitle is flex: 0 0 auto by default, so it never shrank). */}
      <Box className="flex" sx={{ p: 1, alignItems: 'flex-start', gap: 1 }}>
        <DialogTitle sx={{ m: 0, p: 0, pl: 1, pt: 0.5, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {title}
        </DialogTitle>
        <IconButton
          onClick={closeDialog}
          sx={{
            flexShrink: 0,
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      {
        body ? cloneElement(body, { closeDialog }) :
          <>
            <FooterSlot.Provider value={footerSlot}>
              <DialogContent dividers sx={{ ...contentProps }}>
                {content && cloneElement(content, { closeDialog })}
              </DialogContent>
            </FooterSlot.Provider>
            {/* Footer slot: hidden until a DialogFooter fills it. Left items
                take margin-right: auto; the rest line up on the right. */}
            <DialogActions
              ref={setFooterSlot}
              disableSpacing
              sx={{ flexWrap: 'wrap', gap: 1, '&:empty': { display: 'none' } }}
            />
            {actions &&
              <DialogActions>
                {cloneElement(actions, { closeDialog })}
              </DialogActions>
            }
          </>
      }
    </BootstrapDialog>
  )
}