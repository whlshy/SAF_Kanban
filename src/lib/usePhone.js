import { useMediaQuery } from '@mui/material'

// Same width as the board's one-column phone layout (.kanban-columns in tailwind.css).
export const PHONE_QUERY = '(max-width:640px)'

export default function usePhone() {
  return useMediaQuery(PHONE_QUERY, { noSsr: true })
}
