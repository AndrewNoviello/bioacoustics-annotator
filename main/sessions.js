import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { listSubdirectories } from './utils.js'

// Create a session from a list of files and a name
const createSession = async (sessionName, files, state) => {
  if (!state.dataDir || !state.activeProfile || !sessionName) {
    return { success: false, error: 'Missing dataDir, profile or sessionName' }
  }
  try {
    const sessionId = crypto.randomUUID()
    const sessionFolder = path.join(state.dataDir, state.activeProfile, sessionId)

    const fullPaths = files.map((f) => path.isAbsolute(f) ? f : path.join(state.dataDir, state.activeProfile, sessionId, f))

    const config = {
      id: sessionId,
      name: sessionName,
      time: new Date().toISOString(),
      files: fullPaths,
      experiments: {}
    }

    await fs.mkdir(sessionFolder, { recursive: true })
    await fs.writeFile(path.join(sessionFolder, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')
    return { success: true, sessionPath: sessionFolder }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// List sessions by reading configs
const listSessions = async (state) => {
  try {
    const entries = await listSubdirectories(path.join(state.dataDir, state.activeProfile))
    const sessions = []
    for (const sessionId of entries.dirs) {
      const configPath = path.join(state.dataDir, state.activeProfile, sessionId, 'config.json')
      try {
        const data = JSON.parse(await fs.readFile(configPath, 'utf-8'))
        sessions.push({ id: sessionId, ...data })
      } catch { /* ignore */ }
    }
    return { success: true, sessions }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const getSession = async (sessionId, state) => {
  try {
    const configPath = path.join(state.dataDir, state.activeProfile, sessionId, 'config.json')
    const data = JSON.parse(await fs.readFile(configPath, 'utf-8'))

    for (const experimentId of Object.keys(data.experiments)) {
      const experimentPath = path.join(state.dataDir, state.activeProfile, sessionId, experimentId + '.csv')

      try {
        const experimentData = await fs.readFile(experimentPath, 'utf-8')
        const lines = experimentData.split('\n').filter(line => line.trim())

        if (lines.length > 1) { // Has header and at least one data row
          const headers = lines[0].split(',')
          const detections = []

          // Parse CSV rows (skip header)
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',')
            const detection = {}

            headers.forEach((header, index) => {
              const value = values[index]?.trim() || ''

              // Parse start_time and end_time as integers
              if (header.trim() === 'start_time') {
                detection[header.trim()] = parseInt(value) || 0
              } else if (header.trim() === 'end_time') {
                detection[header.trim()] = parseInt(value) || 0
              } else if (header.trim() === 'verified') {
                detection[header.trim()] = parseInt(value) === 1 ? true : false
              } else if (header.trim() === 'species') {
                if (value === 'null') {
                  detection[header.trim()] = null
                } else {
                  detection[header.trim()] = value
                }
              } else {
                detection[header.trim()] = value
              }
            })

            detections.push(detection)
          }

          // Group detections by filename
          const groupedDetections = {}
          detections.forEach(detection => {
            const fileName = detection.filename
            if (!groupedDetections[fileName]) {
              groupedDetections[fileName] = []
            }
            groupedDetections[fileName].push(detection)
          })

          data.experiments[experimentId].detections = groupedDetections
        } else {
          data.experiments[experimentId].detections = {}
        }
      } catch (fileErr) {
        // If CSV file doesn't exist or can't be read, set empty detections
        data.experiments[experimentId].detections = {}
      }
    }

    return { success: true, session: data }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const deleteSession = async (sessionId, state) => {
  try {
    const sessionPath = path.join(state.dataDir, state.activeProfile, sessionId)

    // Check if session directory exists
    try {
      await fs.access(sessionPath)
    } catch {
      return { success: false, error: 'Session not found' }
    }

    // Recursively delete the session directory and all its contents
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
  deleteSession
}