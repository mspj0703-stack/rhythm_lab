import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import appVersion from '../VERSION?raw'
import './index.css'
import App from './App.tsx'
import { BEATDASH_PLATFORM } from './platform/runtime'

// Android and Desktop use this to verify that the served Web UI matches the native release.
// Keep this value sourced from web/VERSION so the release version remains single-source.
const releaseVersion = appVersion.trim()
;(window as Window & { __BEATDASH_VERSION__?: string; __BEATDASH_PLATFORM__?: string }).__BEATDASH_VERSION__ = releaseVersion
;(window as Window & { __BEATDASH_PLATFORM__?: string }).__BEATDASH_PLATFORM__ = BEATDASH_PLATFORM

const params = new URLSearchParams(window.location.search)
const expectedDesktopVersion = params.get('desktopVersion')?.trim()
const desktopMismatch = BEATDASH_PLATFORM === 'DESKTOP' && expectedDesktopVersion && expectedDesktopVersion !== releaseVersion

if (desktopMismatch) {
  createRoot(document.getElementById('root')!).render(
    <main className="app-error" role="alert">
      Desktop {expectedDesktopVersion}와 Web {releaseVersion} 버전이 다릅니다. 같은 버전의 Web 배포 후 다시 실행해 주세요.
    </main>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
