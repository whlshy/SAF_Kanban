import { useCallback } from 'react'
import { getDefaultStore, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import zhTW from './zh-TW'
import en from './en'

export const LANGUAGES = [
  { code: "zh-TW", name: "繁體中文" },
  { code: "en", name: "English" },
]

const DICTIONARIES = { "zh-TW": zhTW, en }
const LANG_KEY = "lang"

// Existing users keep the Chinese UI they had; new users follow the browser.
// The choice is saved right away so it does not flip once they add a board.
const detectLanguage = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(LANG_KEY))
    if (DICTIONARIES[saved]) return saved

    const boards = JSON.parse(localStorage.getItem("boards") || "[]")
    const existingUser = localStorage.getItem("sheetId") !== null || boards.length > 0
    const lang = existingUser || navigator.language?.toLowerCase().startsWith("zh") ? "zh-TW" : "en"
    localStorage.setItem(LANG_KEY, JSON.stringify(lang))
    return lang
  } catch {
    return "zh-TW"
  }
}

export const langAtom = atomWithStorage(LANG_KEY, detectLanguage(), undefined, { getOnInit: true })

const format = (lang, key, params) => {
  // A "<key>_one" entry, when present, is used for a count of 1 (English plurals).
  const dict = DICTIONARIES[lang]
  const text = (params?.count === 1 && dict?.[`${key}_one`]) || dict?.[key] || zhTW[key] || key
  return params ? text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "") : text
}

// For code outside React render (stores, API callbacks). Components should use
// useT() so they re-render when the language changes.
export const t = (key, params) => format(getDefaultStore().get(langAtom), key, params)

export function useT() {
  const lang = useAtomValue(langAtom)
  return useCallback((key, params) => format(lang, key, params), [lang])
}
