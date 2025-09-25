import fs from 'fs/promises'
import path from 'path'

async function verifyAnnotation(sessionId, experimentId, detectionId, verify, state) {
  const experimentPath = path.join(state.dataDir, state.activeProfile, sessionId, experimentId + '.csv')

  try {
    const experimentData = await fs.readFile(experimentPath, 'utf-8')
    const lines = experimentData.split('\n').filter(line => line.trim())

    if (lines.length < 2) {
      return { success: false, error: 'No detections found' }
    }

    const header = lines[0]
    const dataLines = lines.slice(1)

    // Find and update the specific detection
    const updatedLines = dataLines.map(line => {
      const values = line.split(',')
      if (values[0] === detectionId) {
        values[6] = verify ? 1 : 0 // Update verified column
        return values.join(',')
      }
      return line
    })

    // Write back the entire file
    const newContent = [header, ...updatedLines].join('\n')
    await fs.writeFile(experimentPath, newContent, 'utf-8')

    return { success: true, message: 'Detection verified successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

async function unverifyAnnotation(sessionId, experimentId, detectionId, state) {
  return verifyAnnotation(sessionId, experimentId, detectionId, false, state)
}

export {
  verifyAnnotation,
  unverifyAnnotation
}