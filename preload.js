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

  // App state management
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  setDataDirectory: (dataDir) => ipcRenderer.invoke('set-data-directory', { dataDir }),
  setProfile: (profile) => ipcRenderer.invoke('set-profile', { profile }),

  // Python job management (fire-and-forget)
  startDetection: (sessionId, posPrompts, negPrompts, theta = 0.5) => ipcRenderer.send('start-detection', { sessionId, posPrompts, negPrompts, theta }),
  loadModel: (modelName) => ipcRenderer.send('load-model', { modelName }),

  // Batch detection (Python backend)
  runBatchDetection: (dataDir, profile, sessionId, files, posPrompts, negPrompts, theta = 0.5) =>
    ipcRenderer.invoke('batch-detection', {
      action: 'run_batch_detection',
      params: {
        data_dir: dataDir,
        profile: profile,
        session_id: sessionId,
        files: files,
        pos_prompts: posPrompts,
        neg_prompts: negPrompts,
        theta: theta
      }
    })
}
) 