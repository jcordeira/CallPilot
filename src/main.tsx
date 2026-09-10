import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { StoreProvider } from './state/store'
import { TimeZoneProvider } from './state/timezone'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <TimeZoneProvider>
          <App />
        </TimeZoneProvider>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
