import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import fs from 'fs';

// Import all main functions
import * as api from './main/index.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize electron-store for state persistence
const store = new Store();

let mainWindow;
let pythonProcess = null;
let appState = {
  dataDir: store.get('dataDir', null),
  activeProfile: store.get('activeProfile', null)
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    },
  });

  mainWindow.loadURL('http://localhost:5173');
  mainWindow.webContents.openDevTools();
}

// Python Process Management
function startPythonBackend() {
  const venvPythonPath = process.platform === 'win32'
    ? path.join(__dirname, 'ml', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, 'ml', '.venv', 'bin', 'python');

  const pythonPath = fs.existsSync(venvPythonPath)
    ? venvPythonPath
    : (process.platform === 'win32' ? 'python' : 'python3');

  const scriptPath = path.join(__dirname, 'ml', 'main.py');

  try {
    console.log("Spawning Python process")
    pythonProcess = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, 'ml')
    });

    pythonProcess.stdout.on('data', (chunk) => {
      console.log("Python stdout:", chunk.toString());
      const text = chunk.toString();
      const lines = text.split(/\r?\n/).filter(line => line.trim());

      for (const line of lines) {
        try {
          const response = JSON.parse(line);

          // Forward all messages to frontend
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('python-message', response);
          }
        } catch (err) {
          console.error('Failed to parse Python response:', err.message);
        }
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error('Python stderr:', data.toString());
    });

    pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
      pythonProcess = null;
    });

    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python process:', error);
    });

  } catch (error) {
    console.error('Error starting Python backend:', error);
  }
}

function stopPythonBackend() {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
}

// General/Profile operations
ipcMain.handle('open-directory-dialog', async () => {
  return api.openDirectoryDialog()
});

ipcMain.handle('list-files-of-extension', async (event, { dirPath, extension }) => {
  return api.listFilesOfExtension(dirPath, extension)
});

ipcMain.handle('create-profile', async (event, { profileName }) => {
  return api.createProfile(appState, profileName)
});

ipcMain.handle('list-profiles', async () => {
  return api.listProfiles(appState)
});

ipcMain.on('load-model', async (event, { modelName }) => {
  return api.loadModel(modelName, pythonProcess)
});

// Session operations
ipcMain.handle('create-session', async (event, { sessionName, files }) => {
  return api.createSession(sessionName, files, appState)
});

ipcMain.handle('list-sessions', async () => {
  return api.listSessions(appState)
});

ipcMain.handle('get-session', async (event, { sessionId }) => {
  return api.getSession(sessionId, appState)
});

ipcMain.handle('delete-session', async (event, { sessionId }) => {
  return api.deleteSession(sessionId, appState)
});

// Detection operations
ipcMain.handle('save-experiment', async (event, { sessionId }) => {
  return api.saveExperiment(sessionId, appState)
});

ipcMain.handle('add-detection', async (event, { sessionId, experimentId, fileName, start, end }) => {
  return api.addDetection(sessionId, experimentId, fileName, start, end, appState)
});

ipcMain.on('start-detection', async (event, { sessionId, posPrompts, negPrompts, theta = 0.5 }) => {
  return api.startDetection(sessionId, posPrompts, negPrompts, theta, pythonProcess, appState)
});

ipcMain.handle('wipe-temp', async (event, { sessionId }) => {
  return api.wipeTemp(sessionId, appState)
});

// Annotation operations
ipcMain.handle('assign-annotation', async (event, { sessionId, experimentId, detectionId, species }) => {
  return api.assignAnnotation(sessionId, experimentId, detectionId, species, appState)
});

// Verification operations
ipcMain.handle('verify-annotation', async (event, { sessionId, experimentId, detectionId, verify }) => {
  return api.verifyAnnotation(sessionId, experimentId, detectionId, verify, appState)
})

ipcMain.handle('unverify-annotation', async (event, { sessionId, experimentId, detectionId }) => {
  return api.unverifyAnnotation(sessionId, experimentId, detectionId, appState)
})

ipcMain.handle('delete-detection', async (event, { sessionId, experimentId, detectionId }) => {
  return api.deleteDetection(sessionId, experimentId, detectionId, appState)
})

ipcMain.handle('delete-experiment', async (event, { sessionId, experimentId }) => {
  return api.deleteExperiment(sessionId, experimentId, appState)
});

// App state management
ipcMain.handle('get-app-state', async () => {
  return { success: true, ...appState }
});

ipcMain.handle('set-data-directory', (event, { dataDir }) => {
  appState.dataDir = dataDir;
  store.set('dataDir', dataDir);
  console.log('Data directory set to:', dataDir);
  return { success: true, message: 'Data directory set successfully' }
});

ipcMain.handle('set-profile', (event, { profile }) => {
  appState.activeProfile = profile;
  store.set('activeProfile', profile);
  console.log('Active profile set to:', profile);
  return { success: true, message: 'Active profile set successfully' }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  console.log("Calling startPythonBackend")
  startPythonBackend();
});

app.on('window-all-closed', () => {
  stopPythonBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopPythonBackend();
});
