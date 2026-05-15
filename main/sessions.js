import { parse } from 'csv-parse/sync'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { listSubdirectories, safePathJoin, atomicWriteFile } from './utils.js'

// Maximum number of audio files allowed in a single session. The Python
// pipeline can handle larger batches but the UI becomes unresponsive and the
// CSV file grows unwieldy past a few hundred detections.
const MAX_FILES_PER_SESSION = 500

// Create a session from a list of files and a name
const createSession = async (sessionName, files, state) => {
  if (!state.dataDir || !state.activeProfile) {
    return { success: false, error: 'Missing dataDir or profile' }
  }
  // Accept an empty name and auto-generate from the current timestamp so
  // direct IPC callers don't need to know about the renderer's default-name
  // logic. The renderer already supplies an ISO timestamp; this is the fallback.
  const trimmedName = (sessionName || '').trim()
  const finalName = trimmedName || new Date().toISOString()

  if (!Array.isArray(files) || files.length === 0) {
    return { success: false, error: 'A session must include at least one audio file' }
  }
  if (files.length > MAX_FILES_PER_SESSION) {
    return { success: false, error: `Too many files (max ${MAX_FILES_PER_SESSION}). Split into multiple sessions.` }
  }
  // Require absolute paths so the on-disk reference can't be ambiguous later;
  // the renderer always supplies absolute paths via the file dialog.
  for (const f of files) {
    if (typeof f !== 'string' || !path.isAbsolute(f)) {
      return { success: false, error: 'All session files must be supplied as absolute paths' }
    }
  }

  try {
    // Require the active profile's directory to exist before creating a
    // session under it. `mkdir { recursive: true }` would otherwise
    // silently materialize a missing profile dir, masking a stale
    // activeProfile state instead of surfacing it as an error.
    const profileFolder = safePathJoin(state.dataDir, state.activeProfile)
    if (!profileFolder) return { success: false, error: 'Invalid path' }
    try {
      const stat = await fs.stat(profileFolder)
      if (!stat.isDirectory()) {
        return { success: false, error: 'Profile path is not a directory' }
      }
    } catch {
      return { success: false, error: 'Profile not found — pick a profile that exists in the current data directory' }
    }

    const sessionId = crypto.randomUUID()
    const sessionFolder = safePathJoin(profileFolder, sessionId)
    if (!sessionFolder) return { success: false, error: 'Invalid path' }

    const config = {
      id: sessionId,
      name: finalName,
      time: new Date().toISOString(),
      files,
      experiments: {}
    }

    await fs.mkdir(sessionFolder)
    await atomicWriteFile(path.join(sessionFolder, 'config.json'), JSON.stringify(config, null, 2))
    return { success: true, sessionPath: sessionFolder }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// List sessions by reading configs
const listSessions = async (state) => {
  try {
    const profilePath = safePathJoin(state.dataDir, state.activeProfile)
    if (!profilePath) return { success: false, error: 'Invalid path' }

    const entries = await listSubdirectories(profilePath)
    const sessions = []
    for (const sessionId of (entries.dirs || [])) {
      const configPath = safePathJoin(profilePath, sessionId, 'config.json')
      if (!configPath) continue
      try {
        const data = JSON.parse(await fs.readFile(configPath, 'utf-8'))
        sessions.push({ id: sessionId, ...data })
      } catch { /* ignore unreadable sessions */ }
    }
    return { success: true, sessions }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Parse experiment CSV into detections grouped by filename.
 * Uses named columns — robust against column reordering.
 */
const parseExperimentCSV = (raw) => {
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
  const grouped = {}

  for (const row of records) {
    const detection = {
      id: row.id,
      filename: row.filename,
      start_time: parseFloat(row.start_time) || 0,
      end_time: parseFloat(row.end_time) || 0,
      species: row.species === 'null' ? null : row.species,
      detection_conf: parseFloat(row.detection_conf) || 0,
      verified: parseInt(row.verified, 10) === 1
    }

    if (!grouped[detection.filename]) grouped[detection.filename] = []
    grouped[detection.filename].push(detection)
  }
  return grouped
}

const getSession = async (sessionId, state) => {
  try {
    const configPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'config.json')
    if (!configPath) return { success: false, error: 'Invalid path' }

    const data = JSON.parse(await fs.readFile(configPath, 'utf-8'))

    for (const experimentId of Object.keys(data.experiments)) {
      const experimentPath = safePathJoin(
        state.dataDir, state.activeProfile, sessionId, experimentId + '.csv'
      )
      if (!experimentPath) {
        data.experiments[experimentId].detections = {}
        continue
      }

      try {
        const raw = await fs.readFile(experimentPath, 'utf-8')
        data.experiments[experimentId].detections = parseExperimentCSV(raw)
      } catch {
        data.experiments[experimentId].detections = {}
      }
    }

    return { success: true, session: data }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// Load a single experiment's metadata + parsed detections without re-reading
// the whole session's other CSVs. Used by the renderer to refresh just the
// affected experiment after detection completes or after a save, instead of
// blowing the entire `sessionData` object away.
const getExperiment = async (sessionId, experimentId, state) => {
  try {
    const configPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'config.json')
    if (!configPath) return { success: false, error: 'Invalid path' }

    const data = JSON.parse(await fs.readFile(configPath, 'utf-8'))
    const meta = data.experiments?.[experimentId]
    if (!meta) return { success: false, error: 'Experiment not found' }

    const experimentPath = safePathJoin(
      state.dataDir, state.activeProfile, sessionId, experimentId + '.csv'
    )
    if (!experimentPath) return { success: false, error: 'Invalid path' }

    let detections = {}
    try {
      const raw = await fs.readFile(experimentPath, 'utf-8')
      detections = parseExperimentCSV(raw)
    } catch {
      detections = {}
    }

    return { success: true, experiment: { ...meta, detections } }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// Settings now live per-session, inside config.json under a `settings` field.
// The renderer treats a missing settings field as "use hardcoded defaults",
// so existing sessions opened after this change come up at defaults without
// needing a migration pass.
const getSessionSettings = async (sessionId, state) => {
  try {
    const configPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'config.json')
    if (!configPath) return { success: false, error: 'Invalid path' }
    const data = JSON.parse(await fs.readFile(configPath, 'utf-8'))
    return { success: true, settings: data.settings ?? null }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const setSessionSettings = async (sessionId, settings, state) => {
  if (!settings || typeof settings !== 'object') {
    return { success: false, error: 'settings must be an object' }
  }
  try {
    const configPath = safePathJoin(state.dataDir, state.activeProfile, sessionId, 'config.json')
    if (!configPath) return { success: false, error: 'Invalid path' }
    const data = JSON.parse(await fs.readFile(configPath, 'utf-8'))
    data.settings = settings
    await atomicWriteFile(configPath, JSON.stringify(data, null, 2))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const deleteSession = async (sessionId, state) => {
  try {
    const sessionPath = safePathJoin(state.dataDir, state.activeProfile, sessionId)
    if (!sessionPath) return { success: false, error: 'Invalid path' }

    try {
      await fs.access(sessionPath)
    } catch {
      return { success: false, error: 'Session not found' }
    }

    await fs.rm(sessionPath, { recursive: true, force: true })

    return { success: true, message: `Session '${sessionId}' deleted successfully` }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export {
  createSession,
  listSessions,
  getSession,
  getExperiment,
  deleteSession,
  getSessionSettings,
  setSessionSettings
}
