import React from 'react'
import { useAtomValue } from 'jotai'
import { langAtom, useT } from '@/i18n'
import { localServerVersion } from '@/data/localApi'

const CHANGELOG_URL = {
  "zh-TW": "https://github.com/whlshy/SAF_Kanban/blob/main/CHANGELOG.md",
  en: "https://github.com/whlshy/SAF_Kanban/blob/main/CHANGELOG.en.md",
}

function Footer() {
  const lang = useAtomValue(langAtom)
  const t = useT()
  const desktopVersion = localServerVersion()

  return (
    <footer>
      <div className='footer-content footer-info flex items-center'>
        <div className='flex rowTitle items-center flex-wrap justify-center'>
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
            {desktopVersion ? ` (Desktop v${desktopVersion})` : ""}
          </a>
          . WHL. All rights reserved.
        </div>
      </div>
    </footer>

  )
}

export default Footer