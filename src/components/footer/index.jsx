import React from 'react'
import { useAtomValue } from 'jotai'
import { langAtom, useT } from '@/i18n'

const CHANGELOG_URL = {
  "zh-TW": "https://github.com/whlshy/SAF_Kanban/blob/main/CHANGELOG.md",
  en: "https://github.com/whlshy/SAF_Kanban/blob/main/CHANGELOG.en.md",
}

function index() {
  const lang = useAtomValue(langAtom)
  const t = useT()

  return (
    <footer>
      <div className='footer-content footer-info flex aic'>
        <div className='flex rowTitle'>
          <a
            href="https://github.com/whlshy/SAF_Kanban"
            target="_blank"
            rel="noopener noreferrer"
            className='reset-link underline-offset-2 hover:underline'
          >
            SAF Kanban
          </a>
          {/* The version links to what changed in it. */}
          <a
            href={CHANGELOG_URL[lang] || CHANGELOG_URL.en}
            target="_blank"
            rel="noopener noreferrer"
            title={t("footer.changelog")}
            className='reset-link underline-offset-2 hover:underline ml-1'
          >
            v{__APP_VERSION__}
          </a>
          . WHL. All rights reserved.
        </div>
      </div>
    </footer>

  )
}

export default index