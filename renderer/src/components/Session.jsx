import { useState, useEffect, useContext } from 'react'
import { useParams } from 'react-router-dom'
import { Play, Save, RotateCcw, X, Loader2, ChevronUp, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import Spectrogram from './Spectrogram'
import { SessionContext } from '../stores/SessionContext'
import { useSettings } from '../stores/SettingsContext'
import NewExperimentPanel from './NewExperimentPanel'
import SessionHistory from './SessionHistory'
// Remove the hardcoded speciesList - will use from settings instead

const Session = () => {
  const { clapLoaded, activeProfile, activeDataDir, pageTitle, setPageTitle, setHandleNewExperimentClick, setHandleSavedExperimentsClick } = useContext(SessionContext)
  const { settings } = useSettings()

  const { sessionId } = useParams()
  const [showHistory, setShowHistory] = useState(false)
  const [positivePrompt, setPositivePrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [theta, setTheta] = useState(0.5)
  const [isRunningDetection, setIsRunningDetection] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [files, setFiles] = useState([])
  const [loadingSession, setLoadingSession] = useState(true)
  const [sessionData, setSessionData] = useState(null)
  const [showExperimentPanel, setShowExperimentPanel] = useState(true)
  const [activeExperiment, setActiveExperiment] = useState(null)
  const [activeDetection, setActiveDetection] = useState(null)
  const [tempSpecies, setTempSpecies] = useState('')

  const loadSessionData = async () => {
    if (!activeDataDir || !activeProfile || !sessionId) {
      setLoadingSession(false)
      return
    }

    setLoadingSession(true)
    try {
      const sessionResult = await window.electronAPI.getSession(sessionId)

      console.log(sessionResult)
      if (sessionResult.success) {
        const session = sessionResult.session
        setSessionData(session)
        setFiles(session.files || [])
        setPageTitle(session.name || sessionId)
        setErrorMessage('')

        // Set active experiment to the most recent one, or temp if it exists
        if (session.experiments) {
          const experimentIds = Object.keys(session.experiments)
          if (experimentIds.includes('temp')) {
            setActiveExperiment('temp')
          } else if (experimentIds.length > 0) {
            // Sort experiments by time and set to the most recent one
            const sortedExperiments = experimentIds.sort((a, b) => {
              const timeA = new Date(session.experiments[a].time || session.experiments[a].timestamp || 0).getTime()
              const timeB = new Date(session.experiments[b].time || session.experiments[b].timestamp || 0).getTime()
              return timeB - timeA
            })
            setActiveExperiment(sortedExperiments[0])
          } else {
            setActiveExperiment(null)
          }
        } else {
          setActiveExperiment(null)
        }
      } else {
        setErrorMessage(`Failed to load session: ${sessionResult.error}`)
        setFiles([])
        setPageTitle('')
      }
    } catch (error) {
      setErrorMessage(`Failed to load session data: ${error.message}`)
      setFiles([])
      setPageTitle('')
    } finally {
      setLoadingSession(false)
    }
  }

  useEffect(() => {
    loadSessionData()
  }, [activeDataDir, activeProfile, sessionId])

  useEffect(() => {
    setPageTitle(pageTitle || sessionId)
  }, [pageTitle, sessionId, setPageTitle])

  // Clear activeDetection when activeExperiment changes
  useEffect(() => {
    setActiveDetection(null)
    setTempSpecies('')
  }, [activeExperiment])

  console.log('sessionData', sessionData)
  const wipeTemp = async () => {
    try {
      console.log('handleNewExperimentClick')
      // Call wipeTemp to clear any existing temp data
      const result = await window.electronAPI.wipeTemp(sessionId)
      if (!result.success) {
        console.error('Failed to wipe temp:', result.error)
      }

      // Reset form state
      setPositivePrompt('')
      setNegativePrompt('')
      setTheta(0.5)
      setErrorMessage('')
      setActiveExperiment(null)

      // Show the experiment panel
      setShowExperimentPanel(true)
    } catch (error) {
      console.error('Error in handleNewExperimentClick:', error)
      setErrorMessage('Failed to start new experiment')
    }
  }
  // Set up handler functions for the Header
  useEffect(() => {
    setHandleNewExperimentClick(() => wipeTemp);
    setHandleSavedExperimentsClick(() => () => setShowHistory(true))
  }, [sessionId, setHandleNewExperimentClick, setHandleSavedExperimentsClick])

  // Python message listener for detection events
  useEffect(() => {
    const handlePythonMessage = (event, message) => {
      console.log('Python message in Session:', message)
      switch (message.type) {
        case 'detection_started':
          setIsRunningDetection(true)
          setErrorMessage('')
          break
        case 'detection_completed':
          setIsRunningDetection(false)
          if (message.data.success) {
            setErrorMessage('')
            // Set active experiment to temp and reload session data
            setActiveExperiment('temp')
            loadSessionData()
          } else {
            setErrorMessage(`Detection failed: ${message.data.error}`)
          }
          break
        case 'error':
          setIsRunningDetection(false)
          if (message.data.error) {
            setErrorMessage(`Detection error: ${message.data.error}`)
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
  }, [])

  const handleDetectionClick = (detection) => {
    setActiveDetection(detection)
    setTempSpecies(detection.species || '')
    setShowExperimentPanel(true)
  }

  const handleSaveAnnotation = async () => {
    if (!activeDetection) {
      setErrorMessage('Please select a species to annotate')
      return
    }

    try {
      const result = await window.electronAPI.assignAnnotation(
        sessionId,
        activeExperiment,
        activeDetection.id,
        tempSpecies || 'null'
      )

      if (result.success) {
        // Update local state
        setActiveDetection(prev => ({ ...prev, species: tempSpecies }))

        // Update the detections in sessionData
        setSessionData(prevSessionData => {
          const newSessionData = { ...prevSessionData }
          if (newSessionData.experiments[activeExperiment]?.detections[activeDetection.filename]) {
            const detectionIndex = newSessionData.experiments[activeExperiment].detections[activeDetection.filename].findIndex(
              d => d.id === activeDetection.id
            )
            if (detectionIndex !== -1) {
              newSessionData.experiments[activeExperiment].detections[activeDetection.filename][detectionIndex].species = tempSpecies
            }
          }
          return newSessionData
        })

        setErrorMessage('')
      } else {
        setErrorMessage(`Failed to save annotation: ${result.error}`)
      }
    } catch (error) {
      setErrorMessage(`Failed to save annotation: ${error.message}`)
    }
  }

  const handleVerifyAnnotation = async () => {
    if (!activeDetection) {
      setErrorMessage('No detection selected')
      return
    }

    try {
      const result = await window.electronAPI.verifyAnnotation(
        sessionId,
        activeExperiment,
        activeDetection.id,
        true
      )

      if (result.success) {
        // Update local state
        setActiveDetection(prev => ({ ...prev, verified: true }))

        // Update the detections in sessionData
        setSessionData(prevSessionData => {
          const newSessionData = { ...prevSessionData }
          if (newSessionData.experiments[activeExperiment]?.detections[activeDetection.filename]) {
            const detectionIndex = newSessionData.experiments[activeExperiment].detections[activeDetection.filename].findIndex(
              d => d.id === activeDetection.id
            )
            if (detectionIndex !== -1) {
              newSessionData.experiments[activeExperiment].detections[activeDetection.filename][detectionIndex].verified = true
            }
          }
          return newSessionData
        })

        setErrorMessage('')
      } else {
        setErrorMessage(`Failed to verify annotation: ${result.error}`)
      }
    } catch (error) {
      setErrorMessage(`Failed to verify annotation: ${error.message}`)
    }
  }

  const handleUnverifyAnnotation = async () => {
    if (!activeDetection) {
      setErrorMessage('No detection selected')
      return
    }

    try {
      const result = await window.electronAPI.unverifyAnnotation(
        sessionId,
        activeExperiment,
        activeDetection.id
      )

      if (result.success) {
        // Update local state
        setActiveDetection(prev => ({ ...prev, verified: false }))

        // Update the detections in sessionData
        setSessionData(prevSessionData => {
          const newSessionData = { ...prevSessionData }
          if (newSessionData.experiments[activeExperiment]?.detections[activeDetection.filename]) {
            const detectionIndex = newSessionData.experiments[activeExperiment].detections[activeDetection.filename].findIndex(
              d => d.id === activeDetection.id
            )
            if (detectionIndex !== -1) {
              newSessionData.experiments[activeExperiment].detections[activeDetection.filename][detectionIndex].verified = false
            }
          }
          return newSessionData
        })

        setErrorMessage('')
      } else {
        setErrorMessage(`Failed to unverify annotation: ${result.error}`)
      }
    } catch (error) {
      setErrorMessage(`Failed to unverify annotation: ${error.message}`)
    }
  }

  const handleDeleteDetection = async () => {
    if (!activeDetection) {
      setErrorMessage('No detection selected')
      return
    }

    try {
      const result = await window.electronAPI.deleteDetection(
        sessionId,
        activeExperiment,
        activeDetection.id
      )

      if (result.success) {
        // Remove the detection from sessionData
        setSessionData(prevSessionData => {
          const newSessionData = { ...prevSessionData }
          if (newSessionData.experiments[activeExperiment]?.detections[activeDetection.filename]) {
            newSessionData.experiments[activeExperiment].detections[activeDetection.filename] =
              newSessionData.experiments[activeExperiment].detections[activeDetection.filename].filter(
                d => d.id !== activeDetection.id
              )
          }
          return newSessionData
        })

        // Clear the active detection
        setActiveDetection(null)
        setTempSpecies('')
        setErrorMessage('')
      } else {
        setErrorMessage(`Failed to delete detection: ${result.error}`)
      }
    } catch (error) {
      setErrorMessage(`Failed to delete detection: ${error.message}`)
    }
  }

  const handleDeleteExperiment = async (experimentId) => {
    if (!experimentId || experimentId === 'temp') {
      setErrorMessage('Cannot delete temporary experiment')
      return
    }

    try {
      const result = await window.electronAPI.deleteExperiment(sessionId, experimentId)

      if (result.success) {
        // Remove the experiment from sessionData
        setSessionData(prevSessionData => {
          const newSessionData = { ...prevSessionData }
          if (newSessionData.experiments) {
            delete newSessionData.experiments[experimentId]
          }
          return newSessionData
        })

        // If the deleted experiment was active, clear it
        if (activeExperiment === experimentId) {
          setActiveExperiment(null)
          setActiveDetection(null)
          setTempSpecies('')
        }

        setErrorMessage('')
      } else {
        setErrorMessage(`Failed to delete experiment: ${result.error}`)
      }
    } catch (error) {
      setErrorMessage(`Failed to delete experiment: ${error.message}`)
    }
  }

  const handleRunDetection = async () => {
    setErrorMessage('')
    if (!positivePrompt.trim() || !negativePrompt.trim()) {
      setErrorMessage('Please enter both positive and negative prompts')
      return
    }
    if (!clapLoaded) {
      setErrorMessage('Please load a model first')
      return
    }

    setIsRunningDetection(true)
    try {
      // Fire-and-forget: send command to Python backend
      window.electronAPI.startDetection(sessionId, positivePrompt, negativePrompt, theta)
      console.log('Detection started successfully')
      // The Python message listener will handle the response
    } catch (error) {
      setErrorMessage(`Detection failed: ${error.message}`)
      setIsRunningDetection(false)
    }
  }

  const handleSaveExperiment = async () => {
    if (activeExperiment !== 'temp') {
      setErrorMessage('No temporary detection results to save')
      return
    }
    try {
      const result = await window.electronAPI.saveExperiment(sessionId)
      if (result.success) {
        setErrorMessage('')
        await loadSessionData() // Reload session data to get updated experiments

        // Set active experiment to the most recent one (first in the sorted list)
        const sessionResult = await window.electronAPI.getSession(sessionId)
        console.log('sessionResult', sessionResult)
        if (sessionResult.success && sessionResult.session.experiments) {
          const experimentIds = Object.keys(sessionResult.session.experiments)
          if (experimentIds.length > 0) {
            // Sort experiments by time and set to the most recent one
            const sortedExperiments = experimentIds.sort((a, b) => {
              const timeA = new Date(sessionResult.session.experiments[a].time || sessionResult.session.experiments[a].timestamp || 0).getTime()
              const timeB = new Date(sessionResult.session.experiments[b].time || sessionResult.session.experiments[b].timestamp || 0).getTime()
              return timeB - timeA
            })
            setActiveExperiment(sortedExperiments[0]) // Most recent experiment
          }
        }
      } else {
        setErrorMessage(`Failed to save experiment: ${result.error}`)
      }
    } catch (error) {
      setErrorMessage(`Failed to save experiment: ${error.message}`)
    }
  }

  const [detections, setDetections] = useState([])
  useEffect(() => {
    if (activeExperiment && sessionData?.experiments?.[activeExperiment]?.detections) {
      setDetections(sessionData.experiments[activeExperiment].detections)
    }
  }, [activeExperiment, sessionData])

  const renderSpectrograms = () => {
    if (!files.length) return null
    return (
      <div className="space-y-2">
        {files.map((filePath, index) => (
          <div key={index}>
            <div className="bg-white rounded-lg p-2">
              <Spectrogram
                filePath={filePath}
                height={400}
                detections={detections[filePath] || []}
                windowLength={15}
                activeDetection={activeDetection}
                onDetectionClick={handleDetectionClick}
              />
              {/* File info */}
              <div className="mt-1 text-xs text-gray-500">
                <span className="truncate" title={filePath}>
                  {filePath.split(/[/\\]/).pop()}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }


  const renderHistory = () => {
    return (
      <SessionHistory
        setShowHistory={setShowHistory}
        sessionData={sessionData}
        activeExperiment={activeExperiment}
        setActiveExperiment={setActiveExperiment}
        handleDeleteExperiment={handleDeleteExperiment}
      />
    )
  }


  const renderExperimentPanel = () => {
    // If active experiment is temp, show the 'New Experiment' panel
    if (activeExperiment === 'temp' || activeExperiment === null) {
      return (
        <NewExperimentPanel
          showExperimentPanel={showExperimentPanel}
          setShowExperimentPanel={setShowExperimentPanel}
          setPositivePrompt={setPositivePrompt}
          setNegativePrompt={setNegativePrompt}
          setTheta={setTheta}
          errorMessage={errorMessage}
          isRunningDetection={isRunningDetection}
          activeExperiment={activeExperiment}
          handleRunDetection={handleRunDetection}
          handleSaveExperiment={handleSaveExperiment}
          wipeTemp={wipeTemp}
          positivePrompt={positivePrompt}
          negativePrompt={negativePrompt}
          theta={theta}
          setErrorMessage={setErrorMessage}
        />
      )
    }

    // A detection is currently selected - show detection annotation panel
    else if (activeDetection) {
      return (
        <div className="bg-white border-t border-gray-200">
          <div className="px-3 py-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Detection Annotation</h3>
            <button
              onClick={() => {
                setActiveDetection(null);
                setShowExperimentPanel(false);
              }}
              className="p-1 hover:bg-gray-100 rounded text-xs"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <div className="px-3 pb-3">
            <div className="mb-3 p-3 border border-gray-200 rounded relative">
              <button
                onClick={handleDeleteDetection}
                className="absolute top-2 right-2 p-1 hover:bg-red-100 rounded text-red-600 hover:text-red-700 transition-colors"
                title="Delete detection"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <div className="text-xs space-y-1">
                <div><strong>File:</strong> {activeDetection.filename}</div>
                <div><strong>Time:</strong> {activeDetection.start_time?.toFixed(2)}s - {activeDetection.end_time?.toFixed(2)}s</div>
                <div><strong>Confidence:</strong> {(activeDetection.detection_conf * 100).toFixed(1)}%</div>
                <div><strong>Species:</strong> {activeDetection.species || 'Not annotated'}</div>
                <div className="flex items-center space-x-2">
                  <strong>Status:</strong>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${activeDetection.verified
                    ? 'bg-green-100 text-green-800'
                    : 'bg-yellow-100 text-yellow-800'
                    }`}>
                    {activeDetection.verified ? 'Verified' : 'Unverified'}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {(!activeDetection.species || activeDetection.species === 'null' || activeDetection.species === 'None' || !activeDetection.verified) &&
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {(!activeDetection.species || activeDetection.species === 'null' || activeDetection.species === 'None')
                      ? 'Species Annotation'
                      : 'Change Species Annotation'}
                  </label>
                  <select
                    className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                    value={tempSpecies}
                    onChange={(e) => setTempSpecies(e.target.value)}
                  >
                    <option value="">Select species...</option>
                    {settings.speciesList?.map((species) => (
                      <option key={species} value={species}>
                        {species}
                      </option>
                    ))}
                  </select>
                </div>}

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {activeDetection.species && activeDetection.species !== 'null' && activeDetection.species !== 'None' ?
                    // Show buttons for annotated detections
                    activeDetection.verified ? (
                      // Verified detection - only show unverify
                      <button
                        onClick={handleUnverifyAnnotation}
                        className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 transition-colors flex items-center space-x-1 text-xs font-medium"
                      >
                        <X className="h-3 w-3" />
                        <span>Unverify</span>
                      </button>
                    ) : (
                      // Unverified detection - show save annotation (if changed) and verify buttons
                      <>
                        {tempSpecies !== activeDetection.species && (
                          <button
                            onClick={handleSaveAnnotation}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center space-x-1 text-xs font-medium"
                          >
                            <Save className="h-3 w-3" />
                            <span>Update Annotation</span>
                          </button>
                        )}
                        <button
                          onClick={handleVerifyAnnotation}
                          className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center space-x-1 text-xs font-medium"
                        >
                          <Save className="h-3 w-3" />
                          <span>Verify</span>
                        </button>
                      </>
                    ) :
                    // Show save annotation button for unannotated detections
                    <button
                      onClick={handleSaveAnnotation}
                      disabled={!tempSpecies}
                      className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center space-x-1 text-xs font-medium"
                    >
                      <Save className="h-3 w-3" />
                      <span>Save Annotation</span>
                    </button>}

                  <button
                    onClick={() => {
                      setActiveDetection(null)
                      setTempSpecies('')
                    }}
                    className="px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors flex items-center space-x-1 text-xs font-medium"
                  >
                    <X className="h-3 w-3" />
                    <span>Cancel</span>
                  </button>
                </div>

                <button
                  onClick={() => {
                    // Find next detection in current experiment
                    if (activeExperiment && sessionData?.experiments?.[activeExperiment]?.detections) {
                      const allDetections = []

                      // Collect all detections from all files
                      Object.entries(sessionData.experiments[activeExperiment].detections).forEach(([filePath, detections]) => {
                        detections.forEach(detection => {
                          allDetections.push({
                            ...detection,
                            filePath: filePath
                          })
                        })
                      })

                      // Sort detections by file path and start time
                      allDetections.sort((a, b) => {
                        if (a.filePath !== b.filePath) {
                          return a.filePath.localeCompare(b.filePath)
                        }
                        return a.start_time - b.start_time
                      })

                      // Find current detection index
                      const currentIndex = allDetections.findIndex(detection =>
                        detection.filePath === activeDetection.filename &&
                        detection.start_time === activeDetection.start_time &&
                        detection.end_time === activeDetection.end_time
                      )

                      if (currentIndex !== -1 && currentIndex < allDetections.length - 1) {
                        // Move to next detection
                        const nextDetection = allDetections[currentIndex + 1]
                        setActiveDetection(nextDetection)
                        setTempSpecies(nextDetection.species || '')
                      } else {
                        // No more detections or current detection not found
                        console.log('No more detections to navigate to')
                      }
                    }
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center space-x-1 text-xs font-medium"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // No detection selected - show experiment info panel
    else {
      const activeExp = sessionData?.experiments?.[activeExperiment]
      if (!activeExp) return null

      return (
        <div className="bg-white border-t border-gray-200">
          <div className="px-3 py-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Experiment Details</h3>
            <button
              onClick={() => setShowExperimentPanel(!showExperimentPanel)}
              className="p-1 hover:bg-gray-100 rounded text-xs"
            >
              {showExperimentPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>

          <div className="px-3 pb-3">
            <div className="text-xs space-y-2">
              <div><strong>Time:</strong> {new Date(activeExp.time || activeExp.timestamp).toLocaleString()}</div>
              <div><strong>Positive Prompts:</strong> {activeExp.posPrompts || activeExp.positive_prompts || 'None'}</div>
              <div><strong>Negative Prompts:</strong> {activeExp.negPrompts || activeExp.negative_prompts || 'None'}</div>
              <div><strong>Threshold:</strong> θ = {activeExp.theta || 0.5}</div>
              <div><strong>Detections:</strong> {Object.values(activeExp.detections || {}).flat().length} total</div>
            </div>

            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-600">
                  Click on any detection in the spectrogram to annotate it.
                </p>
                <button
                  onClick={() => {
                    // TODO: Implement add detection functionality
                    console.log('Add detection for current experiment')
                  }}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center space-x-1"
                >
                  <span>+</span>
                  <span>Add Detection</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }
  }

  if (loadingSession) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500 font-medium">Loading session data...</p>
        </div>
      </div>
    )
  }

  if (!activeDataDir || activeProfile === 'No Profile Selected') {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">You must select a data directory and profile.</p>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">No files in this detection session.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-row flex-1 min-h-0 h-full bg-gray-50 overflow-hidden relative">
      <div className="flex flex-col flex-1 p-2">
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-2 pb-2">
          {renderSpectrograms()}
        </div>
        {showExperimentPanel && renderExperimentPanel()}
        {/* Collapsed Panel Toggle - Fixed Position */}
        {!showExperimentPanel && (
          <button
            onClick={() => setShowExperimentPanel(true)}
            className="fixed bottom-4 right-4 w-8 h-8 bg-white rounded-full shadow-lg border border-gray-200 hover:shadow-xl hover:bg-gray-50 transition-all flex items-center justify-center z-50"
          >
            <ChevronUp className="h-4 w-4 text-gray-600" />
          </button>
        )}
      </div>
      {showHistory && renderHistory()}
    </div>
  )
}

export default Session 