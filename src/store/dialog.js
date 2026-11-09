import { create } from 'zustand'
import log from '../lib/log'

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

const useDialogStore = create(
  log((set, get) => ({
    ...initialState,
    setDialog: (data) => set({ ...initialState, ...data, open: true }),
    closeDialog: () => set({ open: false })
  }))
)

export default useDialogStore