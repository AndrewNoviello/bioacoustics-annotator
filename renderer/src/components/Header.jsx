/**
 * Header - Main navigation and application state management component
 * 
 * This component provides the primary navigation interface for the bioacoustics annotation tool.
 * It manages:
 * - CLAP model loading and status display
 * - Data directory selection and persistence
 * - Profile management (creation, selection, validation)
 * - Session-specific navigation and controls
 * - Settings and modal management
 * 
 * The Header adapts its content based on the current route:
 * - Main page: Shows app title and branding
 * - Session page: Shows session name with back navigation and session-specific controls
 * 
 * State Management:
 * - Uses SessionContext for app-wide state (profile, data directory, model status)
 * - Manages local state for dropdowns, modals, and profile lists
 * - Handles IPC communication for model loading and directory/profile operations
 * 
 * Context Dependencies:
 * - SessionContext: activeProfile, activeDataDir, clapLoaded, pageTitle, etc.
 * 
 * IPC Dependencies:
 * - loadModel: Loads CLAP models via Python backend
 * - openDirectory: Opens directory selection dialog
 * - listProfiles: Fetches available profiles for current data directory
 */
import { useState, useContext, useEffect } from 'react'
import { Fish, CheckCircle, AlertCircle, ChevronDown, User, Folder, ArrowLeft, Plus, History, X, Settings } from 'lucide-react'
import { SessionContext } from '../stores/SessionContext'
import { useNavigate, useLocation } from 'react-router-dom'
import CreateProfileModal from './CreateProfileModal'
import SettingsModal from './SettingsModal'

const Header = () => {
  // Context values - app-wide state and actions
  const {
    activeProfile,           // Currently selected profile (null if none)
    activeDataDir,          // Currently selected data directory (null if none)
    clapLoaded,             // Whether CLAP model is loaded and ready
    setClapLoaded,          // Set CLAP model loaded state
    selectedModel,          // Currently loaded CLAP model name
    setSelectedModel,       // Set selected model name
    pageTitle,              // Current page title (used in session pages)
    handleNewExperimentClick,      // Function to handle "New Experiment" button
    handleSavedExperimentsClick,   // Function to handle "Saved Experiments" button
    setProfile,             // Action to set active profile (with IPC persistence)
    setDataDirectory        // Action to set data directory (with IPC persistence)
  } = useContext(SessionContext)

  // Local state for profile management
  const [profiles, setProfiles] = useState([])  // List of available profiles in current data dir

  // Navigation hooks
  const navigate = useNavigate()
  const location = useLocation()

  // UI state for dropdowns and modals
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [showCreateProfile, setShowCreateProfile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Available CLAP models
  const models = ['CLAP_Jan23']

  /**
   * Python message listener for model loading events
   * 
   * Listens for messages from the Python backend regarding CLAP model loading:
   * - model_loading_started: Sets loading state and clears errors
   * - model_loading_completed: Updates model state based on success/failure
   * 
   * This allows the UI to react to async model loading operations initiated
   * by the handleModelLoad function.
   */
  useEffect(() => {
    const handlePythonMessage = (event, message) => {
      console.log('Python message:', message)
      switch (message.type) {
        case 'model_loading_started':
          setIsModelLoading(true)
          setErrorMessage('')
          break
        case 'model_loading_completed':
          setIsModelLoading(false)
          if (message.data.success) {
            setClapLoaded(true)
            setSelectedModel(message.data.model_name)
            setShowModelDropdown(false)
            setErrorMessage('')
          } else {
            setClapLoaded(false)
            setSelectedModel(null)
            setErrorMessage(`Failed to load model: ${message.data.error}`)
          }
          break
        default:
          // Ignore other message types
          break
      }
    }

    window.electronAPI.onPythonMessage(handlePythonMessage)
    return () => {
      window.electronAPI.removePythonMessageListener(handlePythonMessage)
    }
  }, [setClapLoaded, setSelectedModel])

  /**
   * Initiates CLAP model loading
   * 
   * Sends a fire-and-forget command to the Python backend to load the specified model.
   * The loading state is managed through Python message events, not return values.
   * 
   * @param {string} modelName - Name of the CLAP model to load
   */
  const handleModelLoad = (modelName) => {
    console.log(modelName)
    try {
      setIsModelLoading(true)
      setShowModelDropdown(false) // Hide dropdown when loading starts
      // Fire-and-forget: send command to Python backend
      window.electronAPI.loadModel(modelName)
      // Don't await - the Python message listener will handle the response
    } catch (err) {
      console.error('Failed to start model loading:', err)
      setErrorMessage('Failed to start model loading')
    }
  }

  /**
   * Handles profile selection
   * 
   * Sets the selected profile as active via context action (which persists to main process).
   * Closes the profile dropdown on success.
   * 
   * @param {string} profile - Name of the profile to select
   */
  const handleProfileChange = async (profile) => {
    try {
      await setProfile(profile)
      setShowProfileDropdown(false)
    } catch (err) {
      console.error('Failed to set profile:', err)
    }
  }

  /**
   * Handles data directory selection
   * 
   * Opens a directory selection dialog and sets the chosen directory as the active
   * data directory via context action (which persists to main process).
   * The profiles list will be automatically refreshed via the useEffect below.
   */
  const handleDataDirectorySelect = async () => {
    try {
      const result = await window.electronAPI.openDirectory();
      if (!result.canceled && result.path) {
        await setDataDirectory(result.path)
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  }

  /**
   * Effect to load profiles when data directory changes
   * 
   * Automatically fetches the list of available profiles whenever the active
   * data directory changes. This ensures the profile dropdown is always up-to-date.
   * Also runs when activeProfile changes to ensure validation state is current.
   */
  useEffect(() => {
    const loadProfiles = async () => {
      if (!activeDataDir) {
        setProfiles([])
        return
      }
      try {
        const res = await window.electronAPI.listProfiles()
        if (res.success) setProfiles(res.dirs || [])
        else setProfiles([])
      } catch (e) {
        console.error('Error listing profiles:', e)
        setProfiles([])
      }
    }
    loadProfiles()
  }, [activeDataDir, activeProfile])

  /**
   * Renders the left side of the header based on current route
   * 
   * - Main page: Shows app branding with fish icon and title
   * - Session page: Shows back button and session/page title
   * 
   * @returns {JSX.Element} Left side header content
   */
  const renderLeftSide = () => {
    const isSessionPage = location.pathname.startsWith('/session/')

    if (!isSessionPage) {
      return (
        <div className="flex items-center gap-3">
          <Fish className="h-4 w-4 text-blue-600" />
          <h1 className="text-sm font-semibold text-gray-900">Bioacoustics Annotation Tool</h1>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-3">
        <button className="cursor-pointer" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold text-gray-900">
          {pageTitle || 'Session'}{' '}
        </h1>
      </div>
    )
  }

  /**
   * Renders session-specific action buttons
   * 
   * Only shows on session pages. Provides quick access to:
   * - Saved Experiments: View/manage previous experiment results
   * - New Experiment: Start a new detection experiment
   * 
   * These buttons call functions provided via SessionContext by the Session component.
   * 
   * @returns {JSX.Element|null} Session buttons or null if not on session page
   */
  const renderSessionButtons = () => {
    const isSessionPage = location.pathname.startsWith('/session/')

    if (!isSessionPage) return null

    return (
      <div className="flex items-center space-x-2">
        <button
          onClick={handleSavedExperimentsClick}
          className="border border-green-600 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center space-x-1 text-xs font-medium"
        >
          <History className="h-3 w-3" />
          <span>Saved Experiments</span>
        </button>
        <button
          onClick={handleNewExperimentClick}
          className="px-3 py-1 border border-blue-600 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center space-x-1 text-xs font-medium"
        >
          <Plus className="h-3 w-3" />
          <span>New Experiment</span>
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2">
      <div className="flex items-center justify-between">
        {renderLeftSide()}

        <div className="flex flex-row items-center space-x-3">
          {/* CLAP Status */}
          <div className="relative">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              disabled={isModelLoading}
              className={`flex items-center space-x-1 px-2 py-1 rounded border text-xs transition-colors ${clapLoaded
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                } ${isModelLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isModelLoading ? (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : clapLoaded ? (
                <CheckCircle className="h-3 w-3" />
              ) : (
                <AlertCircle className="h-3 w-3" />
              )}
              <p className="font-medium">{isModelLoading ? 'Loading...' : clapLoaded ? (selectedModel || 'CLAP Loaded') : 'CLAP Not Loaded'}</p>
              <ChevronDown className="h-2 w-2" />
            </button>

            {errorMessage && (
              <div className="absolute top-full mt-1 left-0 w-64 bg-red-50 border border-red-200 rounded p-2 z-20">
                <p className="text-xs text-red-700">{errorMessage}</p>
                <button
                  onClick={() => setErrorMessage('')}
                  className="absolute top-1 right-1 text-red-500 hover:text-red-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {showModelDropdown && (
              <div className="absolute right-0 mt-1 w-40 bg-white rounded shadow-lg border border-gray-200 z-10">
                <div className="py-1">
                  {models.map((model) => (
                    <button
                      key={model}
                      onClick={() => handleModelLoad(model)}
                      className="block w-full text-left px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 font-medium"
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Data Directory Selector */}
          <div>
            <button
              onClick={handleDataDirectorySelect}
              className="flex items-center space-x-1 px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              <Folder className="h-3 w-3 text-gray-500" />
              <p className="text-xs font-medium text-gray-700">
                {activeDataDir ? `${activeDataDir.split(/[\\\/]/).pop()}` : 'Set Data Directory'}
              </p>
            </button>
          </div>

          {/* Profile Selector */}
          <div className="relative">
            <button
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
              className="flex items-center space-x-1 px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              <User className="h-3 w-3 text-gray-500" />
              <span className="text-xs font-medium text-gray-700">
                {activeProfile
                  ? (profiles.includes(activeProfile)
                    ? activeProfile.charAt(0).toUpperCase() + activeProfile.slice(1)
                    : 'Invalid Profile')
                  : 'No Profile Selected'}
              </span>
              <ChevronDown className="h-2 w-2 text-gray-500" />
            </button>

            {showProfileDropdown && (
              <div className="absolute right-0 mt-1 w-48 bg-white rounded shadow-lg border border-gray-200 z-10">
                <div className="py-1">
                  {profiles.length === 0 ? (
                    <div className="px-3 py-1">
                      <p className="text-xs text-gray-500 font-medium">No profiles found</p>
                      {activeDataDir && (
                        <button
                          onClick={() => setShowCreateProfile(true)}
                          className="flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-700 font-medium mt-1"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Create Profile</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {profiles.map((profile) => (
                        <button
                          key={profile}
                          onClick={() => handleProfileChange(profile)}
                          className={`block w-full text-left px-3 py-1 text-xs hover:bg-gray-50 font-medium ${activeProfile === profile ? 'text-blue-600' : 'text-gray-700'
                            }`}
                        >
                          {profile}
                        </button>
                      ))}
                      {activeDataDir && (
                        <div className="border-t border-gray-100 pt-1">
                          <button
                            onClick={() => setShowCreateProfile(true)}
                            className="flex items-center space-x-1 w-full text-left px-3 py-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            <Plus className="h-3 w-3" />
                            <span>Create Profile</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Settings Button */}
          <div>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center space-x-1 px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              <Settings className="h-3 w-3 text-gray-500" />
              <span className="text-xs font-medium text-gray-700">Settings</span>
            </button>
          </div>
          {renderSessionButtons()}

        </div>

      </div>

      {/* Create Profile Modal */}
      {showCreateProfile && (
        <CreateProfileModal
          onClose={() => setShowCreateProfile(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

export default Header 