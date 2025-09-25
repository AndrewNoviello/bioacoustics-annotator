/**
 * CreateSessionModal - Modal component for creating new detection sessions
 * 
 * This modal enables users to create a detection session by selecting a folder,
 * choosing files (with an optional Random Select helper), and providing a session name.
 * It validates that a data directory and profile are selected in context before creating.
 * 
 * UX details:
 * - Error and success messages are displayed in MessageBars at the bottom of the form content
 * - On successful creation, a green success bar is shown briefly before the modal closes
 * 
 * Props:
 * @param {Function} onClose - Callback to close the modal
 * 
 * Context Dependencies:
 * - SessionContext: activeDataDir, activeProfile (required for creation)
 * 
 * IPC Dependencies:
 * - openDirectory: Selects the folder to choose files from
 * - listFilesOfExtension: Lists files in the selected folder by extension
 * - createSession: Creates a new detection session with chosen files
 */
import { useState, useContext } from 'react'
import { X, Folder, FileAudio, Shuffle, Plus } from 'lucide-react'
import { SessionContext } from '../stores/SessionContext'

const CreateSessionModal = ({ onClose }) => {
  const [selectedFolder, setSelectedFolder] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [selectedFileType, setSelectedFileType] = useState('WAV')
  const [availableFiles, setAvailableFiles] = useState([])
  const [selectedFiles, setSelectedFiles] = useState([])
  const [randomCount, setRandomCount] = useState(10)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const { activeDataDir, activeProfile } = useContext(SessionContext)

  /**
   * Randomly selects a subset of available files based on `randomCount`.
   * Uses a simple shuffle + slice to choose files without replacement.
   */
  const handleRandomSelect = () => {
    const shuffled = [...availableFiles].sort(() => 0.5 - Math.random())
    const selected = shuffled.slice(0, Math.min(randomCount, availableFiles.length))
    setSelectedFiles(selected)
  }

  /**
   * Toggles a file in the selected list.
   * If the file is present it is removed; otherwise it is added.
   *
   * @param {string} fileName - The file name to toggle
   */
  const toggleFile = (fileName) => {
    setSelectedFiles(prev =>
      prev.includes(fileName)
        ? prev.filter(f => f !== fileName)
        : [...prev, fileName]
    )
  }

  /**
   * Creates a detection session using the selected files.
   * Validates the presence of `activeDataDir` and `activeProfile` before creation.
   * Shows a success or error MessageBar; on success, auto-closes the modal.
   */
  const handleCreate = async () => {
    if (!activeDataDir || !activeProfile) {
      setErrorMessage('No data directory or profile selected')
      setSuccessMessage('')
      return
    }

    try {
      const sessionNameToUse = sessionName || `Session ${new Date().toLocaleString()}`
      const fullPaths = selectedFiles.map((f) => `${selectedFolder}/${f}`)

      const res = await window.electronAPI.createSession(sessionNameToUse, fullPaths)

      if (res.success) {
        setErrorMessage('')
        setSuccessMessage('Session created successfully')
        setTimeout(() => {
          onClose()
        }, 900)
      } else {
        setSuccessMessage('')
        setErrorMessage(res.error || 'Failed to create session')
      }
    } catch (err) {
      console.error('Error creating session:', err)
      setSuccessMessage('')
      setErrorMessage('Error creating session. Please try again.')
    }
  }

  /**
   * Opens a directory picker to select a folder and lists audio files
   * of the chosen type within it. Resets selected files and clamps
   * the random selection count to the number of available files.
   */
  const handleBrowse = async () => {
    try {
      const res = await window.electronAPI.openDirectory()
      if (!res.canceled && res.path) {
        setSelectedFolder(res.path)
        const list = await window.electronAPI.listFilesOfExtension(res.path, selectedFileType)
        if (list.success) {
          setAvailableFiles(list.files)
          setSelectedFiles([])
          // adjust random count if bigger than available files
          setRandomCount((prev) => Math.min(prev, list.files.length))
        } else {
          console.error('Failed to read directory:', list.error)
        }
      }
    } catch (err) {
      console.error('Error selecting folder:', err)
    }
  }

  return (
    <div className="fixed inset-0 bg-white/30 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-3xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Create Detection Session</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)] space-y-4">
          {/* Session Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Detection Session Name</label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g., Whale Detection Jan 2025"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Folder Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Folder
            </label>
            <div className="flex items-center space-x-3">
              <div className="flex-1">
                <input
                  type="text"
                  value={selectedFolder}
                  readOnly
                  placeholder="Click browse to choose folder..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                />
              </div>
              <button
                onClick={handleBrowse}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2"
              >
                <Folder className="h-4 w-4" />
                <span>Browse</span>
              </button>
            </div>
          </div>

          {/* File Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">File Type</label>
            <select
              value={selectedFileType}
              onChange={(e) => setSelectedFileType(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="WAV">WAV</option>
            </select>
          </div>

          {/* Files Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-semibold text-gray-900">Files ({availableFiles.length} total)</h3>
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    value={randomCount}
                    onChange={(e) => setRandomCount(parseInt(e.target.value) || 0)}
                    min="1"
                    max={availableFiles.length}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-center"
                  />
                  <span className="text-sm text-gray-600">files</span>
                </div>
                <button
                  onClick={handleRandomSelect}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors flex items-center space-x-1"
                >
                  <Shuffle className="h-3 w-3" />
                  <span>Random Select</span>
                </button>
              </div>
            </div>

            {/* File List */}
            <div className="border rounded-lg max-h-64 overflow-y-auto">
              {availableFiles.map((fileName) => (
                <div
                  key={fileName}
                  onClick={() => toggleFile(fileName)}
                  className={`flex items-center space-x-3 p-3 border-b last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors ${selectedFiles.includes(fileName) ? 'bg-blue-50 border-blue-200' : ''
                    }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedFiles.includes(fileName)}
                    onChange={() => { }}
                    className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <FileAudio className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-700">{fileName}</span>
                </div>
              ))}
            </div>

            <p className="text-sm text-gray-500 mt-2">
              Selected {selectedFiles.length} of {availableFiles.length} files
            </p>
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

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={selectedFiles.length === 0 || !activeDataDir}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm font-medium">Create Session</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default CreateSessionModal 