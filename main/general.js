import { listSubdirectories } from './utils.js'
import fs from 'fs/promises'
import path from 'path'
import { dialog } from 'electron'

const createProfile = async (state, profileName) => {
  try {
    const profilePath = path.join(state.dataDir, profileName)
    await fs.mkdir(profilePath, { recursive: true })
    return { success: true, message: 'Profile created successfully' }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

const listProfiles = async (state) => {
  return listSubdirectories(state.dataDir)
}

const listFilesOfExtension = async (dirPath, extension) => {
  try {
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
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }

  return { canceled: false, path: result.filePaths[0] };
}

const loadModel = async (modelName, pythonProcess) => {
  if (!pythonProcess) {
    throw new Error('Python backend not running');
  }

  console.log('Loading model:', modelName)
  const commandStr = JSON.stringify({
    action: 'load_model',
    modelName: modelName
  }) + '\n';

  console.log('Sending command to Python:', commandStr)
  pythonProcess.stdin.write(commandStr);
  return { success: true, message: 'Model loading started' };
}

export {
  createProfile,
  listProfiles,
  listFilesOfExtension,
  openDirectoryDialog,
  loadModel
}