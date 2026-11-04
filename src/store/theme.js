import { useEffect } from 'react'
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

// index.html picks the initial theme and saves it before React starts, so the
// saved value is normally already there; fall back to what the page shows.
const initialTheme = () => (document.getElementById('root')?.classList.contains('dark') ? 'dark' : 'light')

const themeAtom = atomWithStorage('theme', initialTheme(), undefined, { getOnInit: true })

export function useTheme() {
  const [theme, setTheme] = useAtom(themeAtom)
  const isDark = theme === 'dark'

  useEffect(() => {
    document.getElementById('root')?.classList.toggle('dark', isDark)
  }, [isDark])

  return { theme, isDark, toggleTheme: () => setTheme(isDark ? 'light' : 'dark') }
}
