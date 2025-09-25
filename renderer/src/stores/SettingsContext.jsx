import { createContext, useContext, useState } from 'react'

const SettingsContext = createContext()

export const useSettings = () => {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState({
    // Visualization settings
    // Core spectrogram/worker params
    sampleRate: 16000,
    n_fft: 2048,
    win_length: 1024,
    hop_length: 256,
    f_min: 10,
    f_max: 8000,
    n_mels: 64,
    top_db: 80,
    windowDuration: 15,
    dynamicGain: true,
    autoGamma: true,
    gammaValue: 1.0,
    gainPercentile: 98,
    brightness: 0,
    contrast: 1.0,
    speciesList: []
  })

  const updateSettings = (newSettings) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }

  const resetSettings = () => {
    setSettings({
      sampleRate: 48000,
      n_fft: 2048,
      win_length: 1024,
      hop_length: 256,
      f_min: 10,
      f_max: 8000, // Will be automatically capped to Nyquist frequency (sampleRate/2)
      n_mels: 128,
      top_db: 80,
      windowDuration: 15,
      dynamicGain: true,
      autoGamma: true,
      gammaValue: 1.0,
      gainPercentile: 98,
      brightness: 0,
      contrast: 1.0,
      speciesList: []
    })
  }

  const value = {
    settings,
    updateSettings,
    resetSettings
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
} 