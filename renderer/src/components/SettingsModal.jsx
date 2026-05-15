import { useState, useMemo } from 'react'
import { X, Save, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '../stores/SettingsContext'

const isPowerOfTwo = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0

// Compute validation errors for a settings object. Returns an object keyed
// by setting field; an empty object means the settings are valid. WASM
// mel-spectrogram code requires power-of-two n_fft and a consistent ordering
// of win_length ≤ n_fft, hop_length < win_length.
const validateSettings = (s) => {
  const errors = {}
  if (!Number.isFinite(s.n_fft) || s.n_fft < 128 || s.n_fft > 8192) {
    errors.n_fft = 'Must be between 128 and 8192'
  } else if (!isPowerOfTwo(s.n_fft)) {
    errors.n_fft = 'Must be a power of 2 (e.g. 256, 512, 1024, 2048)'
  }
  if (!Number.isFinite(s.win_length) || s.win_length < 64 || s.win_length > 8192) {
    errors.win_length = 'Must be between 64 and 8192'
  } else if (Number.isFinite(s.n_fft) && s.win_length > s.n_fft) {
    errors.win_length = 'Must be ≤ FFT size'
  }
  if (!Number.isFinite(s.hop_length) || s.hop_length < 1 || s.hop_length > 4096) {
    errors.hop_length = 'Must be between 1 and 4096'
  } else if (Number.isFinite(s.win_length) && s.hop_length > s.win_length) {
    errors.hop_length = 'Must be ≤ window length'
  }
  if (!Number.isFinite(s.f_min) || s.f_min < 0) {
    errors.f_min = 'Must be ≥ 0'
  }
  if (!Number.isFinite(s.f_max) || s.f_max <= 0) {
    errors.f_max = 'Must be > 0'
  } else if (Number.isFinite(s.f_min) && s.f_max <= s.f_min) {
    errors.f_max = 'Must be > min frequency'
  }
  if (!Number.isFinite(s.n_mels) || s.n_mels < 16 || s.n_mels > 512) {
    errors.n_mels = 'Must be between 16 and 512'
  }
  if (!Number.isFinite(s.top_db) || s.top_db < 20 || s.top_db > 120) {
    errors.top_db = 'Must be between 20 and 120'
  }
  if (!Number.isFinite(s.windowDuration) || s.windowDuration < 1 || s.windowDuration > 120) {
    errors.windowDuration = 'Must be between 1 and 120'
  }
  return errors
}

const SettingsModal = ({ onClose }) => {
  const { settings, updateSettings } = useSettings()
  const [localSettings, setLocalSettings] = useState(settings)
  const [newSpecies, setNewSpecies] = useState('')
  const [showAddSpecies, setShowAddSpecies] = useState(false)

  const errors = useMemo(() => validateSettings(localSettings), [localSettings])
  const hasErrors = Object.keys(errors).length > 0

  const handleSave = async () => {
    if (hasErrors) return
    try {
      updateSettings(localSettings)
      onClose()
    } catch (err) {
      console.error('Error saving settings:', err)
      alert('Error saving settings. Please try again.')
    }
  }

  const handleAddSpecies = () => {
    if (newSpecies.trim() && !localSettings.speciesList?.includes(newSpecies.trim())) {
      setLocalSettings(prev => ({
        ...prev,
        speciesList: [...(prev.speciesList || []), newSpecies.trim()]
      }))
      setNewSpecies('')
      setShowAddSpecies(false)
    }
  }

  const handleShowAddSpecies = () => {
    setShowAddSpecies(true)
  }

  const handleCancelAddSpecies = () => {
    setShowAddSpecies(false)
    setNewSpecies('')
  }

  const handleDeleteSpecies = (speciesToDelete) => {
    setLocalSettings(prev => ({
      ...prev,
      speciesList: prev.speciesList?.filter(species => species !== speciesToDelete) || []
    }))
  }

  return (
    <div className="fixed inset-0 bg-white/30 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          {/* Visualization Settings */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center">
              Spectrogram Settings
            </h3>
            <div className="space-y-2">
              {/* Core Spectrogram Parameters */}
              <div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">FFT Size (n_fft)</label>
                    <input
                      type="number"
                      min="128"
                      max="8192"
                      step="1"
                      value={localSettings.n_fft}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, n_fft: parseInt(e.target.value) }))}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${errors.n_fft ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                    />
                    {errors.n_fft && <p className="text-[10px] text-red-600 mt-0.5">{errors.n_fft}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Window Length</label>
                    <input
                      type="number"
                      min="64"
                      max="8192"
                      step="1"
                      value={localSettings.win_length}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, win_length: parseInt(e.target.value) }))}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${errors.win_length ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                    />
                    {errors.win_length && <p className="text-[10px] text-red-600 mt-0.5">{errors.win_length}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Hop Length</label>
                    <input
                      type="number"
                      min="1"
                      max="4096"
                      step="1"
                      value={localSettings.hop_length}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, hop_length: parseInt(e.target.value) }))}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${errors.hop_length ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                    />
                    {errors.hop_length && <p className="text-[10px] text-red-600 mt-0.5">{errors.hop_length}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Min Frequency (Hz)</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={localSettings.f_min}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, f_min: parseFloat(e.target.value) }))}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${errors.f_min ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                    />
                    {errors.f_min && <p className="text-[10px] text-red-600 mt-0.5">{errors.f_min}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Max Frequency (Hz)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={localSettings.f_max}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, f_max: parseFloat(e.target.value) }))}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${errors.f_max ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                    />
                    {errors.f_max && <p className="text-[10px] text-red-600 mt-0.5">{errors.f_max}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Mel Bands (n_mels)</label>
                    <input
                      type="number"
                      min="16"
                      max="512"
                      step="1"
                      value={localSettings.n_mels}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, n_mels: parseInt(e.target.value) }))}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${errors.n_mels ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                    />
                    {errors.n_mels && <p className="text-[10px] text-red-600 mt-0.5">{errors.n_mels}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Top dB</label>
                    <input
                      type="number"
                      min="20"
                      max="120"
                      step="1"
                      value={localSettings.top_db}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, top_db: parseInt(e.target.value) }))}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${errors.top_db ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                    />
                    {errors.top_db && <p className="text-[10px] text-red-600 mt-0.5">{errors.top_db}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Window Duration (sec)</label>
                    <input
                      type="number"
                      min="1"
                      max="120"
                      step="1"
                      value={localSettings.windowDuration}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, windowDuration: parseInt(e.target.value) }))}
                      className={`w-full px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 ${errors.windowDuration ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                    />
                    {errors.windowDuration && <p className="text-[10px] text-red-600 mt-0.5">{errors.windowDuration}</p>}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {localSettings.dynamicGain && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Gain Percentile [90-99]</label>
                    <input
                      type="number"
                      min="90"
                      max="99"
                      step="1"
                      value={localSettings.gainPercentile}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, gainPercentile: parseInt(e.target.value) }))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}

                {!localSettings.autoGamma && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Gamma [0.3-2.0]</label>
                    <input
                      type="number"
                      min="0.3"
                      max="2.0"
                      step="0.1"
                      value={localSettings.gammaValue}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, gammaValue: parseFloat(e.target.value) }))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Brightness [-0.5, 0.5]</label>
                  <input
                    type="number"
                    min="-0.5"
                    max="0.5"
                    step="0.05"
                    value={localSettings.brightness}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, brightness: parseFloat(e.target.value) }))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Contrast [0.5-2.0]</label>
                  <input
                    type="number"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={localSettings.contrast}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, contrast: parseFloat(e.target.value) }))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="flex items-center space-x-1 text-xs">
                    <input
                      type="checkbox"
                      checked={localSettings.dynamicGain}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, dynamicGain: e.target.checked }))}
                      className="h-3 w-3"
                    />
                    <span>Dynamic Gain</span>
                  </label>
                </div>

                <div>
                  <label className="flex items-center space-x-1 text-xs">
                    <input
                      type="checkbox"
                      checked={localSettings.autoGamma}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, autoGamma: e.target.checked }))}
                      className="h-3 w-3"
                    />
                    <span>Auto Gamma</span>
                  </label>
                </div>
              </div>

            </div>

            {/* Species List Settings */}
            <div className="mt-4">
              <div className="flex flex-row items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center">
                  Species List
                </h3>
                <button
                  onClick={handleShowAddSpecies}
                  className="cursor-pointer text-blue-600 hover:text-blue-700"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                <div>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {localSettings.speciesList?.length > 0 ? (
                      localSettings.speciesList.map((species) => (
                        <div key={species} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                          <span className="text-sm text-gray-700">{species}</span>
                          <button
                            onClick={() => handleDeleteSpecies(species)}
                            className="p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))
                    ) : !showAddSpecies && (
                      <p className="text-sm text-gray-500">No species added yet</p>
                    )}
                  </div>
                </div>

                {showAddSpecies && (
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={newSpecies}
                      onChange={(e) => setNewSpecies(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddSpecies()}
                      placeholder="Enter species name..."
                      className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                    />
                    <button
                      onClick={handleAddSpecies}
                      disabled={!newSpecies.trim()}
                      className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-xs"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelAddSpecies}
                      className="px-2 py-1 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 p-3 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          {hasErrors && (
            <span className="text-xs text-red-600 mr-2">Fix validation errors to save</span>
          )}
          <button
            onClick={handleSave}
            disabled={hasErrors}
            className="px-4 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center space-x-1"
          >
            <Save className="h-3 w-3" />
            <span className="text-xs font-medium">Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal 