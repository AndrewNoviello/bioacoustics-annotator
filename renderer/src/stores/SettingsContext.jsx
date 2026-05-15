import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useLocation } from 'react-router-dom'

const SettingsContext = createContext()

// Default settings - single source of truth.
// Note: sample rate is read from the WAV header on each load (see
// SpectrogramProvider), so it isn't a user-configurable setting here.
const DEFAULT_SETTINGS = {
  // Core spectrogram/worker params
  n_fft: 2048,
  win_length: 1024,
  hop_length: 256,
  f_min: 10,
  f_max: 16000,           // Will be automatically capped to Nyquist frequency (sampleRate/2)
  n_mels: 128,
  top_db: 80,
  windowDuration: 15,
  // Visualization settings
  dynamicGain: true,
  autoGamma: true,
  gammaValue: 1.0,
  gainPercentile: 98,
  brightness: 0,
  contrast: 1.0,
  // Species list for annotations
  speciesList: []
}

// Extract the active session id from the current route. We match
// `/session/:sessionId` directly off the pathname so the provider doesn't
// need to live inside a <Route>. Returns null when the user is anywhere
// outside a session view, which is the signal we use to disable settings
// editing globally.
const sessionIdFromPath = (pathname) => {
  const m = /^\/session\/([^/]+)/.exec(pathname || '')
  return m ? m[1] : null
}

export const useSettings = () => {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}

export const SettingsProvider = ({ children }) => {
  const location = useLocation()
  const sessionId = sessionIdFromPath(location.pathname)
  const hasSession = !!sessionId

  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS })
  // Track which session our state is currently mirroring so writes never
  // race across a navigation: if the user changed slider X on session A and
  // then navigated to session B, we don't want the in-flight setSettings to
  // land in B's config.json.
  const activeSessionRef = useRef(null)

  // Hydrate from the active session whenever the route changes. Missing
  // `settings` in the config (existing or freshly-created sessions) means
  // "use hardcoded defaults" — no migration.
  useEffect(() => {
    activeSessionRef.current = sessionId

    if (!sessionId) {
      setSettings({ ...DEFAULT_SETTINGS })
      return
    }

    let cancelled = false
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.getSettings(sessionId)
        if (cancelled) return
        if (result?.success && result.settings) {
          setSettings({ ...DEFAULT_SETTINGS, ...result.settings })
        } else {
          setSettings({ ...DEFAULT_SETTINGS })
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to load session settings:', err)
      }
    }
    loadSettings()
    return () => { cancelled = true }
  }, [sessionId])

  const updateSettings = useCallback(async (newSettings) => {
    if (!sessionId) {
      console.warn('updateSettings called with no active session — ignored')
      return
    }
    const merged = { ...settings, ...newSettings }
    setSettings(merged)
    const targetSession = activeSessionRef.current
    try {
      const result = await window.electronAPI.setSettings(targetSession, merged)
      if (!result?.success) {
        console.error('Failed to persist session settings:', result?.error)
      }
    } catch (err) {
      console.error('Failed to persist session settings:', err)
    }
  }, [settings, sessionId])

  const resetSettings = useCallback(async () => {
    if (!sessionId) {
      console.warn('resetSettings called with no active session — ignored')
      return
    }
    setSettings({ ...DEFAULT_SETTINGS })
    const targetSession = activeSessionRef.current
    try {
      await window.electronAPI.setSettings(targetSession, { ...DEFAULT_SETTINGS })
    } catch (err) {
      console.error('Failed to persist settings reset:', err)
    }
  }, [sessionId])

  // Memoize so consumers don't re-render on every parent render. Without this
  // the value object is fresh each render and every component using
  // useSettings() rebuilds — including SpectrogramGraphics, which has scalar
  // setting deps that would still be value-equal but would push reconcilation
  // work through the spectrogram subtree unnecessarily.
  const value = useMemo(() => ({
    settings,
    updateSettings,
    resetSettings,
    hasSession
  }), [settings, updateSettings, resetSettings, hasSession])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
