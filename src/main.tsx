import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
// Fonts ship with the app (no Google Fonts request); unicode-range means a
// browser only downloads the subsets a page actually uses.
import '@fontsource/libre-franklin/400.css'
import '@fontsource/libre-franklin/400-italic.css'
import '@fontsource/libre-franklin/500.css'
import '@fontsource/libre-franklin/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
