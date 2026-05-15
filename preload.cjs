const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electronAPI', {

  // Event listeners
  onPythonMessage: (callback) => ipcRenderer.on('python-message', callback),
  removePythonMessageListener: (callback) => ipcRenderer.removeListener('python-message', callback),

  // General/Profile operations
  openDirectory: () => ipcRenderer.invoke('open-directory-dialog'),
  listFilesOfExtension: (dirPath, extension) => ipcRenderer.invoke('list-files-of-extension', { dirPath, extension }),
  createProfile: (profileName) => ipcRenderer.invoke('create-profile', { profileName }),
  listProfiles: () => ipcRenderer.invoke('list-profiles'),

  // Session operations
  createSession: (sessionName, files) => ipcRenderer.invoke('create-session', { sessionName, files }),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  getSession: (sessionId) => ipcRenderer.invoke('get-session', { sessionId }),
  getExperiment: (sessionId, experimentId) => ipcRenderer.invoke('get-experiment', { sessionId, experimentId }),
  deleteSession: (sessionId) => ipcRenderer.invoke('delete-session', { sessionId }),

  // Detection operations
  saveExperiment: (sessionId) => ipcRenderer.invoke('save-experiment', { sessionId }),
  addDetection: (sessionId, experimentId, fileName, start, end) => ipcRenderer.invoke('add-detection', { sessionId, experimentId, fileName, start, end }),
  wipeTemp: (sessionId) => ipcRenderer.invoke('wipe-temp', { sessionId }),

  // Annotation operations
  assignAnnotation: (sessionId, experimentId, detectionId, species) => ipcRenderer.invoke('assign-annotation', { sessionId, experimentId, detectionId, species }),

  // Verification operations
  verifyAnnotation: (sessionId, experimentId, detectionId, verify) => ipcRenderer.invoke('verify-annotation', { sessionId, experimentId, detectionId, verify }),
  unverifyAnnotation: (sessionId, experimentId, detectionId) => ipcRenderer.invoke('unverify-annotation', { sessionId, experimentId, detectionId }),
  deleteDetection: (sessionId, experimentId, detectionId) => ipcRenderer.invoke('delete-detection', { sessionId, experimentId, detectionId }),
  deleteExperiment: (sessionId, experimentId) => ipcRenderer.invoke('delete-experiment', { sessionId, experimentId }),
  updateDetectionTimes: (sessionId, experimentId, detectionId, start, end) => ipcRenderer.invoke('update-detection-times', { sessionId, experimentId, detectionId, start, end }),
  restoreDetection: (sessionId, experimentId, detection) => ipcRenderer.invoke('restore-detection', { sessionId, experimentId, detection }),

  // App state management
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  setDataDirectory: (dataDir) => ipcRenderer.invoke('set-data-directory', { dataDir }),
  setProfile: (profile) => ipcRenderer.invoke('set-profile', { profile }),

  // Settings persistence — per-session; sessionId is required
  getSettings: (sessionId) => ipcRenderer.invoke('get-session-settings', sessionId),
  setSettings: (sessionId, settings) => ipcRenderer.invoke('set-session-settings', sessionId, settings),

  // Python job management (invoke so renderer gets an ack)
  startDetection: (sessionId, posPrompts, negPrompts, theta) => ipcRenderer.invoke('start-detection', { sessionId, posPrompts, negPrompts, theta }),
  cancelDetection: () => ipcRenderer.invoke('cancel-detection'),
  loadModel: (modelName) => ipcRenderer.invoke('load-model', { modelName }),
  listAvailableModels: () => ipcRenderer.invoke('list-available-models'),
}
)
