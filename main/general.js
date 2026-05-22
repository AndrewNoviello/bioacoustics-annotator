import { listSubdirectories, safePathJoin } from './utils.js'
import fs from 'fs/promises'
import path from 'path'
import { dialog } from 'electron'

// Tracks directories the user has explicitly opened via the file dialog this
// session. listFilesOfExtension only allows reads from these directories (or
// the active data directory), which prevents the renderer from enumerating
// arbitrary filesystem locations even if it gets compromised by injected code.
const openedDirectories = new Set()

const isWithin = (parent, child) => {
  if (!parent || !child) return false
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

const createProfile = async (state, profileName) => {
  try {
    const profilePath = safePathJoin(state.dataDir, profileName)
    if (!profilePath) return { success: false, error: 'Invalid profile name' }
    await fs.mkdir(profilePath, { recursive: true })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const listProfiles = async (state) => {
  return listSubdirectories(state.dataDir)
}

const listFilesOfExtension = async (dirPath, extension, state) => {
  try {
    if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) {
      return { success: false, error: 'Invalid directory path' }
    }

    // Allow if the path was explicitly opened by the user, or sits anywhere
    // under the active data directory. Otherwise reject — the renderer
    // shouldn't be browsing arbitrary system folders.
    let allowed = false
    for (const opened of openedDirectories) {
      if (isWithin(opened, dirPath)) { allowed = true; break }
    }
    if (!allowed && state?.dataDir && isWithin(state.dataDir, dirPath)) {
      allowed = true
    }
    if (!allowed) {
      return { success: false, error: 'Directory not authorized. Open it via Browse first.' }
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => name.toLowerCase().endsWith(`.${extension.toLowerCase()}`))
    return { success: true, files }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const openDirectoryDialog = async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true }
  }

  // Remember this directory so subsequent listFilesOfExtension calls inside
  // it (and its subtree) are allowed.
  openedDirectories.add(result.filePaths[0])

  return { canceled: false, path: result.filePaths[0] }
}

// Enumerate available CLAP model checkpoints at the active models directory.
// Used as the source of truth for both the load-model IPC validation and any
// future "available models" UI, so we don't have to hand-sync a hardcoded list.
const listAvailableModels = async (modelsDir) => {
  try {
    if (!modelsDir) return []
    const entries = await fs.readdir(modelsDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pth'))
      .map((e) => e.name.replace(/\.pth$/i, ''))
  } catch {
    return []
  }
}

const loadModel = async (modelName, pythonProcess, modelsDir) => {
  const allowed = await listAvailableModels(modelsDir)
  if (!allowed.includes(modelName)) {
    return { success: false, error: `Unknown model: ${modelName}. Available: ${allowed.join(', ') || '(none)'}` }
  }
  if (!pythonProcess) {
    return { success: false, error: 'Python backend not running' }
  }

  const commandStr = JSON.stringify({ action: 'load_model', modelName }) + '\n'
  try {
    pythonProcess.stdin.write(commandStr)
  } catch (err) {
    // Broken pipe / EPIPE if Python died between the null-check above and
    // this write. Surface a real error so the renderer can clear its spinner
    // instead of waiting forever for a model_loading_completed that won't come.
    return { success: false, error: `Failed to send load command: ${err.message}` }
  }
  return { success: true, message: 'Model loading started' }
}

export {
  createProfile,
  listProfiles,
  listFilesOfExtension,
  openDirectoryDialog,
  loadModel,
  listAvailableModels
}
