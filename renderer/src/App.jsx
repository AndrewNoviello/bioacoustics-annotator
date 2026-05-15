import { useEffect, useContext } from 'react'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/Header'
import MainPage from './components/MainPage'
import Session from './components/Session'
import { SessionContext } from './stores/SessionContext'
import { SettingsProvider } from './stores/SettingsContext'
import './index.css'

function App() {
  const { setClapLoaded, setSelectedModel } = useContext(SessionContext)

  // Load initial CLAP state from the main process. The main process tracks
  // model state by observing Python's model_loading_completed events, so this
  // survives renderer reloads as long as Python is still running.
  useEffect(() => {
    const loadClapState = async () => {
      try {
        const state = await window.electronAPI.getAppState()
        if (state?.success) {
          setClapLoaded(!!state.modelLoaded)
          setSelectedModel(state.currentModel || null)
        }
      } catch (error) {
        console.error('Failed to load CLAP state:', error)
      }
    }
    loadClapState()
  }, [setClapLoaded, setSelectedModel])

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SettingsProvider>
        <div className="h-screen flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Routes>
              <Route path="/" element={<MainPage />} />
              <Route path="/session/:sessionId" element={<Session />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </SettingsProvider>
    </Router>
  )
}

export default App
