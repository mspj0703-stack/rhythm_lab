import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import appVersion from '../VERSION?raw'
import './index.css'
import App from './App.tsx'

// Android uses this to verify that the remotely served Web UI matches the APK release.
// Keep this value sourced from web/VERSION so the release version remains single-source.
;(window as Window & { __BEATDASH_VERSION__?: string }).__BEATDASH_VERSION__ = appVersion.trim()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
