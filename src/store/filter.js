import { atom } from 'jotai'
import { EMPTY_FILTER } from '@/lib/filter'

// The board's search and filter bar. Not saved: a board that opens with tasks
// hidden by a forgotten filter looks like data has gone missing.
export const filterAtom = atom({ open: false, ...EMPTY_FILTER })
