import React from 'react'
import { message } from '@/lib/notify'
import { useDialogStore } from '@/store'
import { boardTitle, useBoards } from '@/store/boards'
import { t } from '@/i18n'
import { localAvailable } from '@/data/localApi'
import { exportLocalBoard, pickFile, readImportFile } from './transfer/transferFile'
import ExportDialog from './transfer/ExportDialog'
import { ImportDialog, UnlockDialog } from './transfer/ImportDialogs'

export { exportLocalBoard }

// Returns a function that opens the export dialog, where boards can be unchecked.
export function useStartExport() {
  const { setDialog } = useDialogStore()

  return React.useCallback(() => setDialog({
    title: t("transfer.export"),
    open: true,
    fullWidth: true,
    maxWidth: "sm",
    content: <ExportDialog />,
  }), [setDialog])
}

// Returns a function that asks for a file and opens the import dialog.
export function useStartImport() {
  const { setDialog } = useDialogStore()
  const { addBoard } = useBoards()

  return React.useCallback(async () => {
    const file = await pickFile()
    let result
    try {
      result = readImportFile(await file.text())
    } catch (err) {
      message.error(err.message)
      return
    }
    // A local board's file becomes a new local board right away; a name
    // already in use gets a number, like any new board.
    if (result.localBoard) {
      if (!localAvailable()) return message.error(t("transfer.error.desktopOnly"), 8)
      const { title, issueLink, columns, users, labels, tasks, history, attachments } = result.localBoard
      try {
        const board = await addBoard({ type: "local", title, jiraLink: issueLink, columns, users, labels, tasks, history, attachments })
        message.success(t("transfer.boardImported", { name: boardTitle(board) }))
      } catch (error) {
        message.error(error?.userMessage || t("common.apiError"), 8)
      }
      return
    }
    const showBoards = (incoming) => setDialog({
      title: t("transfer.import"),
      open: true,
      fullWidth: true,
      maxWidth: "md",
      content: <ImportDialog incoming={incoming} />,
    })
    if (!result.locked) return showBoards(result.boards)
    // A password-protected file asks for its password first, then continues as usual.
    setDialog({
      title: t("transfer.import"),
      open: true,
      fullWidth: true,
      maxWidth: "sm",
      persistent: true,
      content: <UnlockDialog locked={result.locked} onUnlocked={showBoards} />,
    })
  }, [setDialog, addBoard])
}
