import { useCallback } from 'react'
import { atom, useAtom } from 'jotai'

// Every option a dialog can be opened with: setDialog starts from these, so
// one dialog's width or flags don't carry over to the next one opened.
const initialState = {
  open: false,
  title: "",
  content: null,
  actions: null,
  body: null,
  fullWidth: false,
  maxWidth: undefined,
  fullScreen: false,
  compact: false,
  persistent: false,
  contentProps: undefined,
}

export const dialogStateAtom = atom(initialState)

export default function useDialogStore() {
  const [state, setState] = useAtom(dialogStateAtom)
  const setDialog = useCallback(
    (data) => setState({ ...initialState, ...data, open: true }),
    [setState]
  )
  const closeDialog = useCallback(
    () => setState((prev) => ({ ...prev, open: false })),
    [setState]
  )
  return { ...state, setDialog, closeDialog }
}