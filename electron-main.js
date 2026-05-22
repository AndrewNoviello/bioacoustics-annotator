import { app, BrowserWindow, ipcMain } from 'electron';
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

// Determine if we're in development or production mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

if (process.env.ELECTRON_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

/**
 * Resolve the models directory. Mirrors the Python `get_models_dir` so the
 * JS-side allowlist (used for the load-model IPC) sees the same `.pth`
 * files Python sees.
 */
function getModelsDir() {
  if (process.env.CLAP_MODELS_DIR && fs.existsSync(process.env.CLAP_MODELS_DIR)) {
    return process.env.CLAP_MODELS_DIR;
  }
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'models');
    if (fs.existsSync(bundled)) return bundled;
  }
  return path.join(__dirname, 'ml', 'models');
}

/**
 * Resolve the Python backend executable and arguments.
 * Production: bundled PyInstaller binary (resources/clap_backend/clap_backend.exe)
 * Development: .venv python + main.py
 */
function getPythonBackend() {
  // 1. Production: bundled PyInstaller one-dir
  const bundledExe = path.join(process.resourcesPath, 'clap_backend', 'clap_backend.exe');
  if (app.isPackaged && fs.existsSync(bundledExe)) {
    return { exe: bundledExe, args: [] };
  }

  // 2. Development: virtual environment python
  const mlDir = path.join(__dirname, 'ml');
  const venvExe = path.join(mlDir, '.venv', 'Scripts', 'python.exe');
  const scriptPath = path.join(mlDir, 'main.py');
  if (fs.existsSync(venvExe)) {
    return { exe: venvExe, args: [scriptPath] };
  }

  // 3. Last resort: system python (development only)
  return { exe: 'python', args: [scriptPath] };
}

/**
 * Validate a name string (profile name, session name, etc.) for use as a
 * filesystem directory name. Returns null if invalid.
 */
function sanitizeName(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  // Reject characters that are illegal in Windows directory names
  if (/[/\\:*?"<>|\0]/.test(trimmed)) return null;
  // Reject pure dots/spaces
  if (/^[.\s]+$/.test(trimmed)) return null;
  return trimmed;
}

// Initialize electron-store for state persistence
const store = new Store();

let mainWindow;
let pythonProcess = null;
let pythonRestartCount = 0;
let pythonRestartResetTimer = null;

let appState = {
  dataDir: store.get('dataDir', null),
  activeProfile: store.get('activeProfile', null),
  // Model state is intentionally NOT persisted across app restarts because
  // it reflects the live Python process — a fresh Python has no model loaded.
  modelLoaded: false,
  currentModel: null,
  // Tracks whether a detection job is currently in flight in Python; used by
  // cancel-detection so it can distinguish "no job" from "cancel sent".
  detectionInProgress: false
};

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: !isDev
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
  }
}

// ── Python Process Management ─────────────────────────────────────────────────

function startPythonBackend() {
  const mlDir = isDev ? path.join(__dirname, 'ml') : null;
  const { exe, args } = getPythonBackend();

  // Determine working directory for the Python process
  const cwd = mlDir || path.join(process.resourcesPath, 'clap_backend');

  if (!fs.existsSync(exe)) {
    console.error('Python backend not found at:', exe);
    // Notify renderer once it is ready
    const notifyMissing = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('python-message', {
          type: 'fatal_error',
          data: { message: 'ML backend not found. Run `npm run build:backend` or reinstall.' },
          timestamp: new Date().toISOString()
        });
      }
    };
    // Renderer may not be ready yet; retry after a short delay
    setTimeout(notifyMissing, 3000);
    return;
  }

  try {
    console.log('Spawning Python backend:', exe, args.join(' '));
    pythonProcess = spawn(exe, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      // Force HuggingFace libraries fully offline. Defense-in-depth: the CLAP
      // text encoder is loaded from local config files only (see
      // ml/clap/clap.py + CLAPWrapper.py), but if any from_pretrained ever
      // slips in, these env vars make it raise immediately instead of
      // hanging on a network call — which was the root cause of the
      // indefinite "Loading…" spinner.
      env: {
        ...process.env,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
      }
    });

    // ── stdout: JSON messages from Python ──────────────────────────────────
    let stdoutBuffer = '';
    pythonProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);

          // Reset the restart counter after 60 s of successful communication
          if (pythonRestartResetTimer) clearTimeout(pythonRestartResetTimer);
          pythonRestartResetTimer = setTimeout(() => { pythonRestartCount = 0; }, 60000);

          // Track model + detection state from Python events so the renderer
          // can recover them across reloads (model state) and the cancel-detection
          // handler knows whether there is anything to cancel.
          switch (response.type) {
            case 'model_loading_completed':
              if (response.data?.success) {
                appState.modelLoaded = true;
                appState.currentModel = response.data.model_name || null;
              } else {
                appState.modelLoaded = false;
                appState.currentModel = null;
              }
              break;
            case 'detection_started':
              appState.detectionInProgress = true;
              break;
            case 'detection_completed':
            case 'detection_cancelled':
            case 'error':
            case 'fatal_error':
              appState.detectionInProgress = false;
              break;
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('python-message', response);
          }
        } catch (err) {
          console.error('Failed to parse Python response:', err.message, '| line:', line);
        }
      }
    });

    // ── stderr: log but don't surface to user ─────────────────────────────
    pythonProcess.stderr.on('data', (data) => {
      console.error('Python stderr:', data.toString());
    });

    // ── exit: attempt restart on non-zero code ────────────────────────────
    pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
      pythonProcess = null;
      // Python died — any model it had loaded is gone, and any in-flight
      // detection is no longer running.
      appState.modelLoaded = false;
      appState.currentModel = null;
      appState.detectionInProgress = false;
      if (code !== 0 && code !== null) {
        pythonRestartCount++;
        if (pythonRestartCount <= 3) {
          console.log(`Restarting Python backend (attempt ${pythonRestartCount}/3)…`);
          setTimeout(startPythonBackend, 1500);
        } else {
          console.error('Python backend failed to start after 3 attempts.');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('python-message', {
              type: 'fatal_error',
              data: { message: 'ML backend crashed repeatedly. Please restart the application.' },
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python process:', error);
    });

    // ── Startup watchdog: expect a "ready" message within 30 s ────────────
    const startupTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('python-message', {
          type: 'backend_timeout',
          data: { message: 'ML backend is taking longer than expected to start.' },
          timestamp: new Date().toISOString()
        });
      }
    }, 30000);

    // Clear watchdog once we get any message (including "ready")
    const clearWatchdog = () => {
      clearTimeout(startupTimeout);
      pythonProcess.stdout.removeListener('data', clearWatchdog);
    };
    pythonProcess.stdout.once('data', clearWatchdog);

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

// ── IPC Handlers ─────────────────────────────────────────────────────────────

// General/Profile operations
ipcMain.handle('open-directory-dialog', async () => {
  return api.openDirectoryDialog()
});

ipcMain.handle('list-files-of-extension', async (_event, { dirPath, extension }) => {
  return api.listFilesOfExtension(dirPath, extension, appState)
});

ipcMain.handle('create-profile', async (_event, { profileName }) => {
  const name = sanitizeName(profileName);
  if (!name) return { success: false, error: 'Invalid profile name. Avoid special characters: / \\ : * ? " < > |' };
  return api.createProfile(appState, name)
});

ipcMain.handle('list-profiles', async () => {
  return api.listProfiles(appState)
});

// Model loading — use handle (invoke) so renderer gets an ack
ipcMain.handle('load-model', async (_event, { modelName }) => {
  if (!pythonProcess) {
    return { success: false, error: 'ML backend is not running' };
  }
  // Block model loads while a detection is running. The worker thread on
  // the Python side is using the current model; loading a new one mid-flight
  // would race with that. The Python backend will also reject this, but
  // intercepting here keeps the rejection out of the python-message stream
  // (where Session.jsx would otherwise interpret an 'error' message as a
  // detection failure and clear the running-state UI).
  if (appState.detectionInProgress) {
    return { success: false, error: 'Cannot load model while detection is running' };
  }
  return api.loadModel(modelName, pythonProcess, getModelsDir())
});

// Allow the renderer to enumerate available CLAP models for the picker
// without hand-syncing the JS and Python allowlists.
ipcMain.handle('list-available-models', async () => {
  const models = await api.listAvailableModels(getModelsDir());
  return { success: true, models };
});

// Session operations
ipcMain.handle('create-session', async (_event, { sessionName, files }) => {
  // Empty name is allowed: createSession will auto-fill an ISO timestamp.
  // Otherwise sanitize the name to keep filesystem characters safe.
  if (sessionName) {
    const name = sanitizeName(sessionName);
    if (!name) return { success: false, error: 'Invalid session name. Avoid special characters: / \\ : * ? " < > |' };
    return api.createSession(name, files, appState)
  }
  return api.createSession('', files, appState)
});

ipcMain.handle('list-sessions', async () => {
  return api.listSessions(appState)
});

ipcMain.handle('get-session', async (_event, { sessionId }) => {
  return api.getSession(sessionId, appState)
});

ipcMain.handle('get-experiment', async (_event, { sessionId, experimentId }) => {
  return api.getExperiment(sessionId, experimentId, appState)
});

ipcMain.handle('delete-session', async (_event, { sessionId }) => {
  return api.deleteSession(sessionId, appState)
});

// Detection operations
ipcMain.handle('save-experiment', async (_event, { sessionId }) => {
  return api.saveExperiment(sessionId, appState)
});

ipcMain.handle('add-detection', async (_event, { sessionId, experimentId, fileName, start, end }) => {
  return api.addDetection(sessionId, experimentId, fileName, start, end, appState)
});

// start-detection: use handle so renderer gets an ack; completion arrives via python-message event
ipcMain.handle('start-detection', async (_event, { sessionId, posPrompts, negPrompts, theta = 0.5 }) => {
  if (!pythonProcess) {
    return { success: false, error: 'ML backend is not running' };
  }
  return api.startDetection(sessionId, posPrompts, negPrompts, theta, pythonProcess, appState)
});

ipcMain.handle('cancel-detection', async (_event) => {
  if (!pythonProcess || !pythonProcess.stdin) {
    return { success: false, error: 'No active backend process' };
  }
  if (!appState.detectionInProgress) {
    return { success: false, error: 'No detection currently running' };
  }
  try {
    pythonProcess.stdin.write(JSON.stringify({ action: 'cancel' }) + '\n');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wipe-temp', async (_event, { sessionId }) => {
  return api.wipeTemp(sessionId, appState)
});

// Annotation operations
ipcMain.handle('assign-annotation', async (_event, { sessionId, experimentId, detectionId, species }) => {
  return api.assignAnnotation(sessionId, experimentId, detectionId, species, appState)
});

// Verification operations
ipcMain.handle('verify-annotation', async (_event, { sessionId, experimentId, detectionId, verify }) => {
  return api.verifyAnnotation(sessionId, experimentId, detectionId, verify, appState)
})

ipcMain.handle('unverify-annotation', async (_event, { sessionId, experimentId, detectionId }) => {
  return api.unverifyAnnotation(sessionId, experimentId, detectionId, appState)
})

ipcMain.handle('delete-detection', async (_event, { sessionId, experimentId, detectionId }) => {
  return api.deleteDetection(sessionId, experimentId, detectionId, appState)
})

ipcMain.handle('update-detection-times', async (_event, { sessionId, experimentId, detectionId, start, end }) => {
  return api.updateDetectionTimes(sessionId, experimentId, detectionId, start, end, appState)
})

ipcMain.handle('restore-detection', async (_event, { sessionId, experimentId, detection }) => {
  return api.restoreDetection(sessionId, experimentId, detection, appState)
})

ipcMain.handle('delete-experiment', async (_event, { sessionId, experimentId }) => {
  return api.deleteExperiment(sessionId, experimentId, appState)
});

// App state management
ipcMain.handle('get-app-state', async () => {
  return { success: true, ...appState }
});

ipcMain.handle('set-data-directory', (_event, { dataDir }) => {
  // Changing the workspace invalidates any in-flight profile selection — the
  // old profile almost certainly doesn't exist under the new data dir. Clear
  // both in-memory and persisted state so an app restart doesn't restore a
  // zombie profile that the rest of the UI silently can't find.
  appState.dataDir = dataDir;
  appState.activeProfile = null;
  store.set('dataDir', dataDir);
  store.delete('activeProfile');
  return { success: true, message: 'Data directory set successfully' }
});

ipcMain.handle('set-profile', (_event, { profile }) => {
  // Accept null explicitly (used to clear) but otherwise require a sanitized
  // name. Mirrors the validation applied at creation time so the renderer
  // can't slip a path-traversal or empty-string value into appState that
  // would later get joined into a filesystem path.
  if (profile === null) {
    appState.activeProfile = null;
    store.delete('activeProfile');
    return { success: true, message: 'Active profile cleared' }
  }
  const sanitized = sanitizeName(profile);
  if (!sanitized) {
    return { success: false, error: 'Invalid profile name' }
  }
  appState.activeProfile = sanitized;
  store.set('activeProfile', sanitized);
  return { success: true, message: 'Active profile set successfully' }
});

// Settings persistence — now per-session, stored inside the session's
// config.json. A missing settings field signals "use renderer-side defaults",
// which keeps pre-existing sessions opening cleanly without a migration.
ipcMain.handle('get-session-settings', (_event, sessionId) => {
  return api.getSessionSettings(sessionId, appState);
});

ipcMain.handle('set-session-settings', (_event, sessionId, settings) => {
  return api.setSessionSettings(sessionId, settings, appState);
});

// ── App lifecycle ──────────────────────────────────────────────────────────────

if (process.platform === 'win32') {
  app.setAppUserModelId('com.bioacoustics.annotation');
}

app.whenReady().then(() => {
  createWindow();
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
