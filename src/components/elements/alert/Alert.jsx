import React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import useAlertStore from '../../../store/alert'
import { useT } from '@/i18n'

function Alert() {
  const { open, closeAlert, title, content, handleAgree, handleDisagree } = useAlertStore(state => state)
  const t = useT()

  return (
    <Dialog
      open={open}
      onClose={closeAlert}
    >
      <DialogTitle>
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ whiteSpace: "pre-line" }}>
          {content}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={(handleDisagree, closeAlert)}>{t("common.cancel")}</Button>
        <Button onClick={() => handleAgree(closeAlert)} autoFocus>
          {t("common.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default Alert