import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@fontsource-variable/space-grotesk'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import '@/index.css'
import { applyComfort } from '@/lib/comfort'

applyComfort()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
