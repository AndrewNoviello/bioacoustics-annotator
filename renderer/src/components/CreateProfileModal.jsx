/**
 * CreateProfileModal - Modal component for creating new user profiles
 * 
 * This modal allows users to create new profiles within the current data directory.
 * It validates the profile name and data directory before creation, and automatically
 * sets the newly created profile as the active profile upon success.
 * 
 * Props:
 * @param {Function} onClose - Callback function to close the modal
 * 
 * Context Dependencies:
 * - SessionContext: Uses setProfile and activeDataDir
 * 
 * IPC Dependencies:
 * - createProfile: Creates a new profile directory and configuration
 */
import { useState, useContext, useMemo } from 'react'
import { X, Plus } from 'lucide-react'
import { SessionContext } from '../stores/SessionContext'

const INVALID_CHARS = /[/\\:*?"<>|]/

const CreateProfileModal = ({ onClose }) => {
  // Local state for the profile name input
  const [profileName, setProfileName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Live validation: flag invalid characters as the user types so the Create
  // button stays disabled and the user gets immediate feedback.
  const nameValidationError = useMemo(() => {
    if (!profileName) return null
    if (INVALID_CHARS.test(profileName)) {
      return 'Profile name contains invalid characters: / \\ : * ? " < > |'
    }
    return null
  }, [profileName])

  // Get context values for profile creation and data directory validation
  const { setProfile, activeDataDir, refreshProfiles } = useContext(SessionContext);

  /**
   * Handles the profile creation process
   * 
   * Validates inputs, calls the IPC createProfile method, and on success:
   * - Sets the new profile as active via context
   * - Closes the modal
   * 
   * On failure, shows an alert with the error message
   */
  const handleCreate = async () => {
    const trimmed = profileName.trim()
    if (!trimmed || !activeDataDir) {
      setErrorMessage('Profile name and data directory are required')
      return
    }
    if (nameValidationError) {
      setErrorMessage(nameValidationError)
      return
    }

    setIsCreating(true)
    try {
      const result = await window.electronAPI.createProfile(trimmed)

      if (result.success) {
        // Refresh the profiles list FIRST so the new name is in it by the
        // time we mark it active. Otherwise Header renders "Invalid Profile"
        // for the brief window between setProfile resolving and the next
        // refreshProfiles tick.
        await refreshProfiles()
        await setProfile(trimmed)
        setErrorMessage('')
        setSuccessMessage('Profile created successfully')
        setTimeout(() => {
          onClose()
        }, 900)
      } else {
        setSuccessMessage('')
        setErrorMessage(result.error || 'Failed to create profile')
      }
    } catch (err) {
      console.error('Error creating profile:', err)
      setSuccessMessage('')
      setErrorMessage('Error creating profile. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  /**
   * Handles Enter key press in the profile name input
   * Triggers profile creation for better UX
   */
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleCreate()
    }
  }

  return (
    // Modal backdrop with blur effect
    <div className="fixed inset-0 bg-white/30 backdrop-blur-sm flex items-center justify-center z-50">
      {/* Modal container */}
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Create New Profile</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form content */
        }
        <div className="p-4 space-y-4">
          {/* Profile Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Profile Name</label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="e.g., Marine Biology Project"
              className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 ${nameValidationError ? 'border-red-400 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
              autoFocus
            />
            {nameValidationError && (
              <p className="text-xs text-red-600 mt-1">{nameValidationError}</p>
            )}
          </div>

          {/* Data Directory Info - Read-only display */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Data Directory</label>
            <div className="px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg">
              <p className="text-sm text-gray-600 truncate">
                {activeDataDir || 'No data directory selected'}
              </p>
            </div>
          </div>

          {/* Message Bars - appear at bottom of form content */}
          {errorMessage && (
            <div className="p-2 border border-red-200 bg-red-50 text-red-700 rounded text-xs">
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="p-2 border border-green-200 bg-green-50 text-green-700 rounded text-xs">
              {successMessage}
            </div>
          )}
        </div>

        {/* Footer with action buttons */}
        <div className="flex items-center justify-end space-x-3 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!profileName.trim() || !activeDataDir || isCreating || !!nameValidationError}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm font-medium">{isCreating ? 'Creating…' : 'Create Profile'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default CreateProfileModal 