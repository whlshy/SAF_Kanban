import { useCallback } from 'react'
import { atom, useAtom } from 'jotai'

const initialState = {
  open: false,
  title: "",
  content: "",
  handleAgree: () => {},
  handleDisagree: () => {},
}

export const alertStateAtom = atom(initialState)

export default function useAlertStore() {
  const [state, setState] = useAtom(alertStateAtom)
  const setAlert = useCallback(
    (data) => setState({ ...initialState, ...data, open: true }),
    [setState]
  )
  const closeAlert = useCallback(
    () => setState((prev) => ({ ...prev, open: false })),
    [setState]
  )
  return { ...state, setAlert, closeAlert }
}