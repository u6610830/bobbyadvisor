import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import './index.css'
import App from './App.jsx'
import { msalConfig } from './msalConfig.js'

const msalInstance = new PublicClientApplication(msalConfig)

// MSAL must finish initializing before any component calls its APIs
// (loginPopup, useMsal, etc.), so we wait for it before the first render
// instead of rendering immediately and initializing in the background.
msalInstance.initialize().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </StrictMode>,
  )
})
