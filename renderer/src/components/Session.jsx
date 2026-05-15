import { useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Play, Save, RotateCcw, X, Loader2, ChevronUp, ChevronDown, ChevronRight, Trash2, StopCircle, Check } from 'lucide-react'
import Spectrogram from './Spectrogram'
import LazyMount from './LazyMount'
import { SessionContext } from '../stores/SessionContext'
import { useSettings } from '../stores/SettingsContext'
import NewExperimentPanel from './NewExperimentPanel'
import SessionHistory from './SessionHistory'
// Remove the hardcoded speciesList - will use from settings instead

// Hard cap on how many experiments can be overlaid at once. Lanes don't
// reflow as you add/remove — each selected experiment claims a fixed-height
// slot from this many slots — so the cap keeps the layout legible.
const MAX_SELECTED_EXPERIMENTS = 3

// Stable reference for files with no detections in the current selection.
// Without this, `multiExperimentDetections[filePath] || []` would allocate a
// fresh array per render and defeat React.memo on the Spectrogram component.
const EMPTY_DETECTIONS = Object.freeze([])

// Color palette for multi-experiment overlay. Palette size is decoupled from
// MAX_SELECTED_EXPERIMENTS so different experiments across a session still
// get distinct pegged colors even though only 3 can be shown at once.
const EXPERIMENT_COLORS = [
  { fill: 'rgba(59, 130, 246, 0.3)', stroke: 'rgba(59, 130, 246, 0.7)', name: 'Blue' },
  { fill: 'rgba(236, 72, 153, 0.3)', stroke: 'rgba(236, 72, 153, 0.7)', name: 'Pink' },
  { fill: 'rgba(34, 197, 94, 0.3)', stroke: 'rgba(34, 197, 94, 0.7)', name: 'Green' },
  { fill: 'rgba(249, 115, 22, 0.3)', stroke: 'rgba(249, 115, 22, 0.7)', name: 'Orange' },
  { fill: 'rgba(168, 85, 247, 0.3)', stroke: 'rgba(168, 85, 247, 0.7)', name: 'Purple' },
  { fill: 'rgba(20, 184, 166, 0.3)', stroke: 'rgba(20, 184, 166, 0.7)', name: 'Teal' },
  { fill: 'rgba(245, 158, 11, 0.3)', stroke: 'rgba(245, 158, 11, 0.7)', name: 'Amber' },
  { fill: 'rgba(239, 68, 68, 0.3)', stroke: 'rgba(239, 68, 68, 0.7)', name: 'Red' },
]

const Session = () => {
  const { clapLoaded, activeProfile, activeDataDir, setPageTitle, setHandleNewExperimentClick, setHandleSavedExperimentsClick, setOverlayCount } = useContext(SessionContext)
  const { settings } = useSettings()

  const { sessionId } = useParams()
  const [showHistory, setShowHistory] = useState(false)
  const [positivePrompt, setPositivePrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [theta, setTheta] = useState(0.5)
  const [isRunningDetection, setIsRunningDetection] = useState(false)
  const [detectionElapsed, setDetectionElapsed] = useState(0)
  const [detectionProgress, setDetectionProgress] = useState(null)
  const detectionTimerRef = useRef(null)
  const skipClearDetectionRef = useRef(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [files, setFiles] = useState([])
  const [loadingSession, setLoadingSession] = useState(true)
  const [sessionData, setSessionData] = useState(null)
  const [showExperimentPanel, setShowExperimentPanel] = useState(true)
  const [selectedExperiments, setSelectedExperiments] = useState([]) // Changed to array for multi-select
  const [activeExperiment, setActiveExperiment] = useState(null) // Primary experiment for editing
  const [activeDetection, setActiveDetection] = useState(null)
  const [tempSpecies, setTempSpecies] = useState('')
  // Undo stack of recently-deleted detections (F-6). Each entry holds the
  // experiment id the detection belonged to plus the full detection row so
  // we can restore exact species/verified/conf. Capped at 10 entries.
  const [undoStack, setUndoStack] = useState([])
  // Most recent deletion lives in state so we can render an Undo toast that
  // auto-dismisses after a few seconds.
  const [undoToast, setUndoToast] = useState(null)
  const undoToastTimerRef = useRef(null)

  // Per-file playhead registry. Each Spectrogram writes its current playback
  // time here via onTimeUpdate; the manual "Add Detection" button reads it on
  // click. Using a ref (not state) avoids re-rendering Session on every
  // playhead tick.
  const playheadsRef = useRef({})
  // Last spectrogram the user played/seeked on. Null until first interaction —
  // that's why the "Add Detection" button is hidden on initial load. Gated on
  // time > 0 to ignore mount and audio metadata-load transients (always at 0).
  const [lastInteractedFile, setLastInteractedFile] = useState(null)
  // Stable per-filePath callbacks so Spectrogram's React.memo holds. One
  // callback per file does both jobs: record the playhead time and signal
  // last-interacted (when time > 0).
  const timeUpdateCallbacksRef = useRef(new Map())
  const getTimeUpdateCallback = useCallback((filePath) => {
    if (!timeUpdateCallbacksRef.current.has(filePath)) {
      timeUpdateCallbacksRef.current.set(filePath, (time) => {
        playheadsRef.current[filePath] = time
        if (time > 0) setLastInteractedFile(filePath)
      })
    }
    return timeUpdateCallbacksRef.current.get(filePath)
  }, [])

  const loadSessionData = async () => {
    if (!activeDataDir || !activeProfile || !sessionId) {
      setLoadingSession(false)
      return
    }

    setLoadingSession(true)
    try {
      const sessionResult = await window.electronAPI.getSession(sessionId)

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
            setSelectedExperiments(['temp'])
          } else if (experimentIds.length > 0) {
            // Sort experiments by time and set to the most recent one
            const sortedExperiments = experimentIds.sort((a, b) => {
              const timeA = new Date(session.experiments[a].time || session.experiments[a].timestamp || 0).getTime()
              const timeB = new Date(session.experiments[b].time || session.experiments[b].timestamp || 0).getTime()
              return timeB - timeA
            })
            setActiveExperiment(sortedExperiments[0])
            setSelectedExperiments([sortedExperiments[0]])
          } else {
            setActiveExperiment(null)
            setSelectedExperiments([])
          }
        } else {
          setActiveExperiment(null)
          setSelectedExperiments([])
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

  // Clear activeDetection when activeExperiment changes, unless the change was triggered
  // by clicking a detection in a different experiment (skipClearDetectionRef prevents the race).
  useEffect(() => {
    if (skipClearDetectionRef.current) {
      skipClearDetectionRef.current = false
      return
    }
    setActiveDetection(null)
    setTempSpecies('')
  }, [activeExperiment])

  const wipeTemp = async () => {
    try {
      // Call wipeTemp to clear any existing temp data
      const result = await window.electronAPI.wipeTemp(sessionId)
      if (!result.success) {
        console.error('Failed to wipe temp:', result.error)
      } else {
        // Mirror the on-disk delete in local state. Gated on success so a
        // failed IPC doesn't silently desync the sidebar from disk.
        setSessionData(prev => {
          if (!prev?.experiments?.temp) return prev
          const { temp, ...rest } = prev.experiments
          return { ...prev, experiments: rest }
        })
      }

      // Reset form state
      setPositivePrompt('')
      setNegativePrompt('')
      setTheta(0.5)
      setErrorMessage('')
      setActiveExperiment(null)
      setSelectedExperiments([])
      setShowHistory(false)

      // Show the experiment panel
      setShowExperimentPanel(true)
    } catch (error) {
      console.error('Error in handleNewExperimentClick:', error)
      setErrorMessage('Failed to start new experiment')
    }
  }
  // Sync selected experiment count to context so Header can show a badge
  useEffect(() => {
    setOverlayCount(selectedExperiments.length)
  }, [selectedExperiments, setOverlayCount])

  // Clear the "Please load a model first" error once the model finishes
  // loading. The model-load is triggered from Header, so this component
  // would otherwise display a stale error.
  useEffect(() => {
    if (clapLoaded) {
      setErrorMessage(prev => prev === 'Please load a model first' ? '' : prev)
    }
  }, [clapLoaded])

  // Set up handler functions for the Header
  useEffect(() => {
    setHandleNewExperimentClick(() => wipeTemp);
    setHandleSavedExperimentsClick(() => () => setShowHistory(true))
  }, [sessionId, setHandleNewExperimentClick, setHandleSavedExperimentsClick])

  // Python message listener for detection events
  useEffect(() => {
    const stopDetectionTimer = () => {
      if (detectionTimerRef.current) {
        clearInterval(detectionTimerRef.current)
        detectionTimerRef.current = null
      }
      setDetectionElapsed(0)
    }

    const handlePythonMessage = (event, message) => {
      switch (message.type) {
        case 'detection_started':
          setIsRunningDetection(true)
          setErrorMessage('')
          setDetectionElapsed(0)
          setDetectionProgress(null)
          detectionTimerRef.current = setInterval(() => {
            setDetectionElapsed(s => s + 1)
          }, 1000)
          break
        case 'detection_progress':
          if (message.data && typeof message.data.percent === 'number') {
            setDetectionProgress(message.data.percent)
          }
          break
        case 'detection_completed':
          stopDetectionTimer()
          setIsRunningDetection(false)
          setDetectionProgress(null)
          if (message.data.success) {
            setErrorMessage('')
            setActiveExperiment('temp')
            setSelectedExperiments(['temp'])
            // Targeted fetch: only the new temp experiment changed on disk.
            // Pulling the full session here would re-parse every saved
            // experiment's CSV and replace the entire `sessionData` reference,
            // which cascades into a full spectrogram-subtree re-render.
            window.electronAPI.getExperiment(sessionId, 'temp').then(res => {
              if (!res.success) {
                setErrorMessage(`Failed to load detection results: ${res.error}`)
                return
              }
              setSessionData(prev => {
                if (!prev) return prev
                return {
                  ...prev,
                  experiments: {
                    ...(prev.experiments || {}),
                    temp: res.experiment
                  }
                }
              })
            })
          } else {
            setErrorMessage(`Detection failed: ${message.data.error}`)
          }
          break
        case 'error':
          stopDetectionTimer()
          setIsRunningDetection(false)
          setDetectionProgress(null)
          if (message.data.error) {
            setErrorMessage(`Detection error: ${message.data.error}`)
          }
          break
        case 'fatal_error':
          stopDetectionTimer()
          setIsRunningDetection(false)
          setDetectionProgress(null)
          setErrorMessage(`Backend error: ${message.data.message || 'ML backend encountered a fatal error.'}`)
          break
        default:
          break
      }
    }

    window.electronAPI.onPythonMessage(handlePythonMessage)
    return () => {
      window.electronAPI.removePythonMessageListener(handlePythonMessage)
    }
  }, [])

  const handleDetectionClick = useCallback((detection) => {
    setActiveDetection(detection)
    setTempSpecies(detection.species || '')
    setShowExperimentPanel(true)
  }, [])

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

    // Snapshot the detection BEFORE the delete IPC fires so we can offer to
    // restore exact species/verified/conf if the user clicks Undo.
    const snapshot = { ...activeDetection }
    const experimentIdForUndo = activeExperiment

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

        // Push onto the undo stack (cap at 10 — keeps memory bounded and the
        // UI honest about being a recent-undo, not a full history).
        setUndoStack(prev => {
          const entry = { experimentId: experimentIdForUndo, detection: snapshot }
          const next = [...prev, entry]
          return next.length > 10 ? next.slice(next.length - 10) : next
        })
        // Show a transient Undo toast.
        if (undoToastTimerRef.current) clearTimeout(undoToastTimerRef.current)
        setUndoToast({ experimentId: experimentIdForUndo, detection: snapshot })
        undoToastTimerRef.current = setTimeout(() => setUndoToast(null), 10000)

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

  // Restore the most recently deleted detection via the restoreDetection IPC.
  // Works for both the toast button and (if we later add it) Ctrl+Z. Pops
  // from the undo stack regardless of which entry is targeted so the stack
  // stays consistent with what the user expects.
  const handleUndoDelete = async (entryOverride) => {
    const entry = entryOverride || undoStack[undoStack.length - 1]
    if (!entry) return
    try {
      const result = await window.electronAPI.restoreDetection(
        sessionId,
        entry.experimentId,
        entry.detection
      )
      if (result.success) {
        // Optimistically re-insert into sessionData so the rect reappears
        // immediately, then reload from disk to ensure consistency.
        setSessionData(prev => {
          const next = { ...prev }
          const exp = next.experiments?.[entry.experimentId]
          if (exp) {
            const fname = entry.detection.filename
            if (!exp.detections) exp.detections = {}
            if (!exp.detections[fname]) exp.detections[fname] = []
            exp.detections[fname] = [...exp.detections[fname], entry.detection]
          }
          return next
        })
        setUndoStack(prev => prev.filter(e => e.detection.id !== entry.detection.id))
        if (undoToast?.detection?.id === entry.detection.id) {
          setUndoToast(null)
          if (undoToastTimerRef.current) clearTimeout(undoToastTimerRef.current)
        }
        setErrorMessage('')
      } else {
        setErrorMessage(`Failed to restore detection: ${result.error}`)
      }
    } catch (error) {
      setErrorMessage(`Failed to restore detection: ${error.message}`)
    }
  }

  // Commit a drag-resize of a detection's start/end time. Called after the
  // user releases the mouse over an edge handle. Optimistically updates the
  // local sessionData so the rect doesn't snap back while the IPC is in
  // flight.
  const handleResizeDetection = useCallback(async (detection, newStart, newEnd) => {
    const experimentIdForResize = detection.experimentId || activeExperiment
    if (!experimentIdForResize) return
    try {
      const result = await window.electronAPI.updateDetectionTimes(
        sessionId,
        experimentIdForResize,
        detection.id,
        newStart,
        newEnd
      )
      if (result.success) {
        setSessionData(prev => {
          const next = { ...prev }
          const exp = next.experiments?.[experimentIdForResize]
          const list = exp?.detections?.[detection.filename]
          if (list) {
            const idx = list.findIndex(d => d.id === detection.id)
            if (idx !== -1) {
              list[idx] = { ...list[idx], start_time: newStart, end_time: newEnd }
            }
          }
          return next
        })
        // Update the active detection (and the dependent rect) if it's the
        // one being resized.
        setActiveDetection(prev => prev && prev.id === detection.id
          ? { ...prev, start_time: newStart, end_time: newEnd }
          : prev)
      } else {
        setErrorMessage(`Failed to update detection times: ${result.error}`)
      }
    } catch (error) {
      setErrorMessage(`Failed to update detection times: ${error.message}`)
    }
  }, [sessionId, activeExperiment])

  // Manually add a 1-second detection at the given file's current playhead.
  // Targets the currently active experiment. The IPC returns the new row so we
  // can optimistically insert and immediately select it for editing.
  const handleAddDetection = async (filePath) => {
    if (!activeExperiment) {
      setErrorMessage('Select an experiment before adding a detection')
      return
    }
    const playhead = playheadsRef.current[filePath] ?? 0
    const start = playhead
    const end = playhead + 1.0

    try {
      const result = await window.electronAPI.addDetection(
        sessionId,
        activeExperiment,
        filePath,
        start,
        end
      )
      if (!result.success || !result.detection) {
        setErrorMessage(`Failed to add detection: ${result.error || 'no row returned'}`)
        return
      }
      const row = result.detection
      setSessionData(prev => {
        const next = { ...prev }
        const exp = next.experiments?.[activeExperiment]
        if (exp) {
          if (!exp.detections) exp.detections = {}
          if (!exp.detections[filePath]) exp.detections[filePath] = []
          exp.detections[filePath] = [...exp.detections[filePath], row]
        }
        return next
      })
      // Drop the user straight into the annotation/edit UI on the new row.
      setActiveDetection({ ...row, experimentId: activeExperiment })
      setTempSpecies(row.species || '')
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(`Failed to add detection: ${error.message}`)
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

        // Remove from selected experiments
        setSelectedExperiments(prev => prev.filter(id => id !== experimentId))

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
      const ack = await window.electronAPI.startDetection(sessionId, positivePrompt, negativePrompt, theta)
      if (ack && !ack.success) {
        setErrorMessage(`Detection failed: ${ack.error}`)
        setIsRunningDetection(false)
      }
      // Completion arrives via python-message event listener
    } catch (error) {
      setErrorMessage(`Detection failed: ${error.message}`)
      setIsRunningDetection(false)
    }
  }

  const handleCancelDetection = async () => {
    try {
      await window.electronAPI.cancelDetection()
    } catch (error) {
      console.error('Failed to cancel detection:', error)
    }
  }

  const handleSaveExperiment = async () => {
    if (activeExperiment !== 'temp') {
      setErrorMessage('No temporary detection results to save')
      return
    }
    try {
      const result = await window.electronAPI.saveExperiment(sessionId)
      if (!result.success) {
        setErrorMessage(`Failed to save experiment: ${result.error}`)
        return
      }
      // Disk side just renamed temp.csv → {experimentId}.csv and swapped the
      // key in config.json. The detections themselves are unchanged, so we
      // can mirror the rename in local state instead of reloading anything.
      const experimentId = result.experimentId
      setErrorMessage('')
      setSessionData(prev => {
        if (!prev?.experiments?.temp) return prev
        const { temp, ...rest } = prev.experiments
        return {
          ...prev,
          experiments: {
            ...rest,
            [experimentId]: temp
          }
        }
      })
      setActiveExperiment(experimentId)
      setSelectedExperiments([experimentId])
    } catch (error) {
      setErrorMessage(`Failed to save experiment: ${error.message}`)
    }
  }

  // Build combined detections from all selected experiments with color coding
  const [multiExperimentDetections, setMultiExperimentDetections] = useState({})

  // Create a map of experiment IDs to their assigned colors (based on index in full sidebar list, not selection)
  const experimentColorMap = useMemo(() => {
    const map = {}
    const allExperiments = Object.entries(sessionData?.experiments || {})
      .sort(([, a], [, b]) => {
        const timeA = new Date((a || {}).time || (a || {}).timestamp || 0).getTime()
        const timeB = new Date((b || {}).time || (b || {}).timestamp || 0).getTime()
        return timeB - timeA
      })
      .map(([id]) => id)
    allExperiments.forEach((expId, index) => {
      map[expId] = EXPERIMENT_COLORS[index % EXPERIMENT_COLORS.length]
    })
    return map
  }, [sessionData?.experiments])

  // Sidebar-ordered view of the selection. Lane positions in the
  // spectrogram and navigator are derived via indexOf on this list, so the
  // lane order matches the sidebar's time-descending order. Object.keys
  // iterates in insertion order, and experimentColorMap is built from the
  // same sorted list as the sidebar — so filtering its keys by the current
  // selection gives a stable, sidebar-ordered array.
  const sortedSelectedExperiments = useMemo(
    () => Object.keys(experimentColorMap).filter(id => selectedExperiments.includes(id)),
    [selectedExperiments, experimentColorMap]
  )

  useEffect(() => {
    if (!sessionData?.experiments || selectedExperiments.length === 0) {
      setMultiExperimentDetections({})
      return
    }

    // Combine detections from all selected experiments
    const combinedDetections = {}

    selectedExperiments.forEach((expId) => {
      const expDetections = sessionData.experiments[expId]?.detections || {}
      const colorInfo = experimentColorMap[expId]

      Object.entries(expDetections).forEach(([filePath, detectionsList]) => {
        if (!combinedDetections[filePath]) {
          combinedDetections[filePath] = []
        }

        // Add experiment info and color to each detection
        const detectionsWithMeta = detectionsList.map(detection => ({
          ...detection,
          experimentId: expId,
          experimentColor: colorInfo,
          experimentTime: sessionData.experiments[expId]?.time || sessionData.experiments[expId]?.timestamp
        }))

        combinedDetections[filePath].push(...detectionsWithMeta)
      })
    })

    setMultiExperimentDetections(combinedDetections)
  }, [selectedExperiments, sessionData, experimentColorMap])

  // Keep single experiment detections for backward compatibility (editing purposes)
  const [detections, setDetections] = useState([])
  useEffect(() => {
    if (activeExperiment && sessionData?.experiments?.[activeExperiment]?.detections) {
      setDetections(sessionData.experiments[activeExperiment].detections)
    }
  }, [activeExperiment, sessionData])

  const handleDetectionClickMulti = useCallback((detection) => {
    // If switching experiments, set the skip flag so the useEffect([activeExperiment])
    // does not clear the detection we are about to select.
    if (detection.experimentId && detection.experimentId !== activeExperiment) {
      skipClearDetectionRef.current = true
      setActiveExperiment(detection.experimentId)
    }
    handleDetectionClick(detection)
  }, [activeExperiment, handleDetectionClick])

  // Derive the audio source folder from the loaded files. Sessions are
  // created from a single picked folder, so in the common case every file
  // shares a parent. When they don't, the suffix flags that the displayed
  // folder is only one of several rather than silently lying.
  const sourceFolder = useMemo(() => {
    if (!files.length) return null
    const dirOf = (p) => p.replace(/[/\\][^/\\]+$/, '')
    const first = dirOf(files[0])
    const allSame = files.every(f => dirOf(f) === first)
    return { path: first, mixed: !allSame }
  }, [files])

  const renderSpectrograms = () => {
    if (!files.length) return null
    return (
      <div className="space-y-2">
        {sourceFolder && (
          <div
            className="text-xs text-gray-500 px-1 truncate"
            title={sourceFolder.path}
          >
            <span className="font-medium text-gray-600">Source:</span>{' '}
            {sourceFolder.path}
            {sourceFolder.mixed && <span className="text-gray-400"> (mixed locations)</span>}
          </div>
        )}
        {files.map((filePath) => (
          <div key={filePath}>
            <LazyMount placeholderHeight={408}>
              <div className="bg-white rounded-lg p-2">
                <Spectrogram
                  filePath={filePath}
                  height={400}
                  detections={multiExperimentDetections[filePath] || EMPTY_DETECTIONS}
                  windowLength={15}
                  activeDetection={activeDetection}
                  onDetectionClick={handleDetectionClickMulti}
                  selectedExperiments={sortedSelectedExperiments}
                  maxLanes={MAX_SELECTED_EXPERIMENTS}
                  onDetectionResize={handleResizeDetection}
                  onTimeUpdate={getTimeUpdateCallback(filePath)}
                />
                {/* File info */}
                <div className="mt-1 text-xs text-gray-500">
                  <span className="truncate" title={filePath}>
                    {filePath.split(/[/\\]/).pop()}
                  </span>
                </div>
              </div>
            </LazyMount>
          </div>
        ))}
      </div>
    )
  }


  // Toggle experiment selection (for multi-select)
  const toggleExperimentSelection = (experimentId) => {
    setSelectedExperiments(prev => {
      if (prev.includes(experimentId)) {
        // Remove from selection
        const newSelection = prev.filter(id => id !== experimentId)
        // If we're removing the active experiment, update active to another selected one
        if (activeExperiment === experimentId && newSelection.length > 0) {
          setActiveExperiment(newSelection[0])
        } else if (newSelection.length === 0) {
          setActiveExperiment(null)
        }
        return newSelection
      } else {
        // Add to selection (cap on simultaneous overlays)
        if (prev.length >= MAX_SELECTED_EXPERIMENTS) return prev
        // Set as active if it's the first selection
        if (prev.length === 0) {
          setActiveExperiment(experimentId)
        }
        return [...prev, experimentId]
      }
    })
  }

  const renderHistory = () => {
    return (
      <SessionHistory
        setShowHistory={setShowHistory}
        sessionData={sessionData}
        activeExperiment={activeExperiment}
        setActiveExperiment={setActiveExperiment}
        selectedExperiments={selectedExperiments}
        toggleExperimentSelection={toggleExperimentSelection}
        experimentColorMap={experimentColorMap}
        handleDeleteExperiment={handleDeleteExperiment}
        maxExperiments={MAX_SELECTED_EXPERIMENTS}
      />
    )
  }


  const renderExperimentPanel = () => {
    // A detection is currently selected - show detection annotation panel.
    // This takes priority over the temp/new-experiment view so users can
    // annotate detections immediately after running detection (before saving).
    if (activeDetection) {
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
                <div><strong>Species:</strong> {(!activeDetection.species || activeDetection.species === 'null' || activeDetection.species === 'None') ? 'Not annotated' : activeDetection.species}</div>
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
                          <Check className="h-3 w-3" />
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

                {(() => {
                  // Compute the sorted detection list and the active index once so we
                  // can both disable the button at end-of-list and use the same
                  // ordering when advancing.
                  const expDetections = (activeExperiment && sessionData?.experiments?.[activeExperiment]?.detections) || {}
                  const allDetections = []
                  Object.entries(expDetections).forEach(([filePath, detections]) => {
                    detections.forEach(d => allDetections.push({ ...d, filePath }))
                  })
                  allDetections.sort((a, b) =>
                    a.filePath !== b.filePath
                      ? a.filePath.localeCompare(b.filePath)
                      : a.start_time - b.start_time
                  )
                  const currentIndex = allDetections.findIndex(d => d.id === activeDetection.id)
                  const atEnd = currentIndex === -1 || currentIndex >= allDetections.length - 1
                  return (
                    <button
                      disabled={atEnd}
                      title={atEnd ? 'No more detections in this experiment' : 'Next detection'}
                      onClick={() => {
                        if (atEnd) return
                        const nextDetection = allDetections[currentIndex + 1]
                        setActiveDetection(nextDetection)
                        setTempSpecies(nextDetection.species || '')
                      }}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center space-x-1 text-xs font-medium"
                    >
                      <span>Next</span>
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )
    }

    // No detection selected and no saved experiment chosen - show the
    // 'New Experiment' panel for temp or null active experiment.
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
          detectionElapsed={detectionElapsed}
          detectionProgress={detectionProgress}
          onCancelDetection={handleCancelDetection}
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

            <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
              <p className="text-xs text-gray-600">
                Click on any detection in the spectrogram to annotate it.
              </p>
              {lastInteractedFile && files.includes(lastInteractedFile) ? (
                <button
                  onClick={() => handleAddDetection(lastInteractedFile)}
                  className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                  title={lastInteractedFile}
                >
                  + Add Detection at Playhead in {lastInteractedFile.split(/[/\\]/).pop()}
                </button>
              ) : null}
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

  if (!activeDataDir || !activeProfile) {
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
      {/* Undo toast for the most recent deletion (F-6). Auto-dismisses after
          ~10s; clicking Undo restores the detection via restoreDetection IPC. */}
      {undoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-lg shadow-lg px-4 py-2 flex items-center space-x-3 z-50">
          <span className="text-xs">
            Detection deleted
            {undoToast.detection.species && undoToast.detection.species !== 'null' && undoToast.detection.species !== 'None'
              ? ` (${undoToast.detection.species})`
              : ''}
          </span>
          <button
            onClick={() => handleUndoDelete(undoToast)}
            className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium"
          >
            Undo
          </button>
          <button
            onClick={() => {
              setUndoToast(null)
              if (undoToastTimerRef.current) clearTimeout(undoToastTimerRef.current)
            }}
            className="text-gray-400 hover:text-white text-xs"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

export default Session