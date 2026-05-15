import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import fs from 'fs/promises'
import crypto from 'crypto'
import { safePathJoin, atomicWriteFile } from './utils.js'

const wipeTemp = async (sessionId, state) => {
  try {
    const tempPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'temp.csv')
    if (!tempPath) return { success: false, error: 'Invalid path' }

    try { await fs.unlink(tempPath) } catch { /* ignore if already gone */ }

    const configPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'config.json')
    if (!configPath) return { success: false, error: 'Invalid path' }

    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'))
    delete configData.experiments.temp
    await atomicWriteFile(configPath, JSON.stringify(configData, null, 2))

    return { success: true, message: 'Temp file wiped successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const saveExperiment = async (sessionId, state) => {
  try {
    const configPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'config.json')
    const tempPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'temp.csv')
    if (!configPath || !tempPath) return { success: false, error: 'Invalid path' }

    const experimentId = crypto.randomUUID()
    const newExperimentPath = safePathJoin(
      state.dataDir, state.activeProfile, sessionId, `${experimentId}.csv`
    )
    if (!newExperimentPath) return { success: false, error: 'Invalid path' }

    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'))
    await fs.rename(tempPath, newExperimentPath)

    if (configData.experiments && configData.experiments.temp) {
      configData.experiments[experimentId] = configData.experiments.temp
      delete configData.experiments.temp
      await atomicWriteFile(configPath, JSON.stringify(configData, null, 2))
    }

    return { success: true, experimentId, message: 'Experiment saved successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const addDetection = async (sessionId, experimentId, fileName, start, end, state) => {
  try {
    const startNum = Number(start)
    const endNum = Number(end)
    if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) {
      return { success: false, error: 'start and end must be numbers' }
    }
    if (endNum <= startNum) {
      return { success: false, error: 'end_time must be greater than start_time' }
    }

    const experimentPath = safePathJoin(
      state.dataDir, state.activeProfile, sessionId, experimentId + '.csv'
    )
    if (!experimentPath) return { success: false, error: 'Invalid path' }

    const detectionId = crypto.randomUUID()
    const row = {
      id: detectionId,
      filename: fileName,
      start_time: startNum,
      end_time: endNum,
      species: 'null',
      detection_conf: 1.0,
      verified: 0
    }

    // If file exists append row; otherwise write with header
    let records = []
    try {
      const raw = await fs.readFile(experimentPath, 'utf-8')
      records = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
    } catch {
      // File doesn't exist yet — start fresh
    }
    records.push(row)
    await atomicWriteFile(experimentPath, stringify(records, { header: true }))

    return { success: true, detection: row, message: 'Detection added successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const startDetection = async (sessionId, posPrompts, negPrompts, theta = 0.5, pythonProcess, state) => {
  if (!pythonProcess) {
    return { success: false, error: 'Python backend not running' }
  }

  const thetaNum = Number(theta)
  if (!Number.isFinite(thetaNum) || thetaNum < 0 || thetaNum > 1) {
    return { success: false, error: 'theta must be a number between 0 and 1' }
  }

  try {
    const configPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'config.json')
    if (!configPath) return { success: false, error: 'Invalid path' }

    const sessionData = JSON.parse(await fs.readFile(configPath, 'utf8'))

    if (!sessionData.files || sessionData.files.length === 0) {
      return { success: false, error: 'No files found in session' }
    }

    const saveDir = safePathJoin(state.dataDir, state.activeProfile, sessionId)
    if (!saveDir) return { success: false, error: 'Invalid path' }

    const command = {
      action: 'run_batch_detection',
      saveDir,
      files: sessionData.files,
      posPrompts,
      negPrompts,
      theta: thetaNum
    }

    pythonProcess.stdin.write(JSON.stringify(command) + '\n')
    return { success: true, message: 'Detection started' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// Update the start/end_time of an existing detection. Used by the drag-edge
// UI to refine a detection's bounds. Other columns (species, verified,
// confidence) are preserved verbatim.
const updateDetectionTimes = async (sessionId, experimentId, detectionId, start, end, state) => {
  try {
    const startNum = Number(start)
    const endNum = Number(end)
    if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) {
      return { success: false, error: 'start and end must be numbers' }
    }
    if (endNum <= startNum) {
      return { success: false, error: 'end_time must be greater than start_time' }
    }

    const experimentPath = safePathJoin(
      state.dataDir, state.activeProfile, sessionId, experimentId + '.csv'
    )
    if (!experimentPath) return { success: false, error: 'Invalid path' }

    const raw = await fs.readFile(experimentPath, 'utf-8')
    const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
    let found = false
    const updated = records.map(row => {
      if (row.id === detectionId) {
        found = true
        return { ...row, start_time: String(startNum), end_time: String(endNum) }
      }
      return row
    })
    if (!found) return { success: false, error: 'Detection not found' }

    await atomicWriteFile(experimentPath, stringify(updated, { header: true }))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// Restore a previously-deleted detection by re-inserting its full row.
// Preserves the original detection id, species, verified state, and
// confidence so the user gets back exactly what was deleted.
const restoreDetection = async (sessionId, experimentId, detection, state) => {
  try {
    if (!detection || typeof detection !== 'object' || !detection.id) {
      return { success: false, error: 'detection object with id is required' }
    }
    const experimentPath = safePathJoin(
      state.dataDir, state.activeProfile, sessionId, experimentId + '.csv'
    )
    if (!experimentPath) return { success: false, error: 'Invalid path' }

    let records = []
    try {
      const raw = await fs.readFile(experimentPath, 'utf-8')
      records = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
    } catch { /* file may have been deleted/empty; start fresh */ }

    // Refuse to re-add if a row with the same id already exists — keeps the
    // CSV unique-by-id and prevents accidental duplicate restores.
    if (records.some(r => r.id === detection.id)) {
      return { success: false, error: 'Detection with this id already exists' }
    }

    const row = {
      id: detection.id,
      filename: detection.filename ?? '',
      start_time: String(detection.start_time ?? 0),
      end_time: String(detection.end_time ?? 0),
      species: detection.species == null ? 'null' : String(detection.species),
      detection_conf: String(detection.detection_conf ?? 0),
      verified: detection.verified ? 1 : 0,
    }
    records.push(row)
    await atomicWriteFile(experimentPath, stringify(records, { header: true }))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const deleteDetection = async (sessionId, experimentId, detectionId, state) => {
  try {
    const experimentPath = safePathJoin(
      state.dataDir, state.activeProfile, sessionId, experimentId + '.csv'
    )
    if (!experimentPath) return { success: false, error: 'Invalid path' }

    const raw = await fs.readFile(experimentPath, 'utf-8')
    const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
    const filtered = records.filter(row => row.id !== detectionId)
    await atomicWriteFile(experimentPath, stringify(filtered, { header: true }))

    return { success: true, message: 'Detection deleted successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const deleteExperiment = async (sessionId, experimentId, state) => {
  try {
    const experimentPath = safePathJoin(
      state.dataDir, state.activeProfile, sessionId, experimentId + '.csv'
    )
    const configPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'config.json')
    if (!experimentPath || !configPath) return { success: false, error: 'Invalid path' }

    await fs.unlink(experimentPath)

    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'))
    delete configData.experiments[experimentId]
    await atomicWriteFile(configPath, JSON.stringify(configData, null, 2))

    return { success: true, message: 'Experiment deleted successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export {
  addDetection,
  saveExperiment,
  startDetection,
  wipeTemp,
  deleteDetection,
  deleteExperiment,
  updateDetectionTimes,
  restoreDetection
}
