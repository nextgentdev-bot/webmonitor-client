import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: 'var(--surface)',
          color: 'var(--ink)',
          border: '1px solid var(--line)',
          borderRadius: '0.25rem',
          boxShadow: '0 12px 32px -12px rgba(8, 14, 24, .35)',
          fontFamily: 'var(--font-ui)',
          fontSize: '13.5px',
        },
        success: { iconTheme: { primary: 'var(--ok)', secondary: 'var(--surface)' } },
        error: { iconTheme: { primary: 'var(--bad)', secondary: 'var(--surface)' } },
      }}
    />
    <App />
  </StrictMode>,
)
