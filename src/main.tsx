import { StrictMode } from 'react'
import { initTheme } from './lib/theme'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

initTheme()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
