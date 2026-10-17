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
        style: { background: '#fffdf7', color: '#17211f', border: '1px solid #d9ded7', fontFamily: 'Manrope, sans-serif' },
        success: { iconTheme: { primary: '#607b26', secondary: '#fffdf7' } },
        error: { iconTheme: { primary: '#a84337', secondary: '#fffdf7' } },
      }}
    />
    <App />
  </StrictMode>,
)
