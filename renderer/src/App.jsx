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

  // Load initial CLAP state
  useEffect(() => {
    const loadClapState = async () => {
      try {
        const state = await window.electronAPI.getState()
        setClapLoaded(state.model_loaded)
        setSelectedModel(state.current_model)
      } catch (error) {
        console.error('Failed to load CLAP state:', error)
      }
    }
    loadClapState()
  }, [setClapLoaded, setSelectedModel])

  return (
    <SettingsProvider>
      <Router>
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
      </Router>
    </SettingsProvider>
  )
}

export default App
