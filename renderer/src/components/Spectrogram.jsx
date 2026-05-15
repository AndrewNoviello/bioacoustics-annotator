// SpectrogramPlayer component using react-audio-spectrogram-player
import React, { useState, useMemo } from 'react'
import SpectrogramPlayer from '../../spectrogram/SpectrogramPlayer'

const Spectrogram = React.memo(({
  filePath,
  height = 300,
  detections = [],
  onDetectionClick = null,
  windowLength = 15,
  activeDetection = null,
  selectedExperiments = [],
  maxLanes = 3,
  onDetectionResize = null,
  onTimeUpdate = null
}) => {
  const [error, setError] = useState(null)

  if (!filePath) {
    return (
      <div className="bg-gray-100 rounded-lg p-4 text-center">
        <p className="text-gray-500">No file selected</p>
      </div>
    )
  }

  // Convert file path to proper URL format
  const getAudioUrl = (path) => {
    try {
      const normalizedPath = path.replace(/\\/g, '/')
      const url = `file:///${normalizedPath}`
      return url
    } catch (err) {
      console.error('Error converting file path:', err)
      setError(`Invalid file path: ${err.message}`)
      return null
    }
  }

  const audioUrl = getAudioUrl(filePath)

  // Convert CLAP detections to spectrogram annotations format
  const formatDetections = (detections) => {
    if (!detections || detections.length === 0) return []

    // Convert all detections to a single annotation group
    // Include experiment color info if available (multi-experiment mode)
    const data = detections.map((detection) => {
      return {
        id: detection.id,
        detection: detection,
        interval: [
          detection.start_time || 0,
          detection.end_time || detection.start_time + 1 || 0,
          '' // No label needed
        ],
        // Include experiment metadata for color coding
        experimentId: detection.experimentId,
        experimentColor: detection.experimentColor
      }
    })

    // Return flat list of annotations
    return data
  }

  // Memoize the annotations to prevent unnecessary re-renders
  const annotations = useMemo(() => {
    return formatDetections(detections)
  }, [detections])

  if (!audioUrl || error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-700 text-sm font-medium">Error loading audio:</p>
        <p className="text-red-600 text-sm mt-1">{error || 'Invalid file path'}</p>
        <p className="text-gray-600 text-xs mt-2">File: {filePath}</p>
      </div>
    )
  }

  try {
    return (

      <SpectrogramPlayer
        fileId={filePath}
        src={audioUrl}
        annotations={annotations}
        handleDetectionClick={onDetectionClick}
        activeDetection={activeDetection}
        selectedExperiments={selectedExperiments}
        maxLanes={maxLanes}
        onDetectionResize={onDetectionResize}
        onTimeUpdate={onTimeUpdate}
      />
    )
  } catch (err) {
    console.error('SpectrogramPlayer error:', err)
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-700 text-sm font-medium">Error rendering spectrogram:</p>
        <p className="text-red-600 text-sm mt-1">{err.message}</p>
        <p className="text-gray-600 text-xs mt-2">File: {filePath}</p>
      </div>
    )
  }
})

Spectrogram.displayName = 'Spectrogram'

export default Spectrogram 