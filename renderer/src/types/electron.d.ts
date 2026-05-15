/**
 * Type definitions for the Electron IPC API exposed via preload script.
 * All methods reflect the actual preload.js signatures (positional args).
 */

export interface ElectronAPI {
  // Event listeners
  onPythonMessage: (callback: (event: unknown, message: PythonMessage) => void) => void;
  removePythonMessageListener: (callback: (event: unknown, message: PythonMessage) => void) => void;

  // General/Profile operations
  openDirectory: () => Promise<{ canceled: boolean; path?: string }>;
  listFilesOfExtension: (dirPath: string, extension: string) => Promise<{
    success: boolean;
    files?: string[];
    error?: string;
  }>;
  createProfile: (profileName: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  listProfiles: () => Promise<{ success: boolean; dirs?: string[]; error?: string }>;

  // Session operations
  createSession: (sessionName: string, files: string[]) => Promise<{
    success: boolean;
    sessionPath?: string;
    error?: string;
  }>;
  listSessions: () => Promise<{
    success: boolean;
    sessions?: Array<{
      id: string;
      name: string;
      time: string;
      files: string[];
      experiments: Record<string, unknown>;
    }>;
    error?: string;
  }>;
  getSession: (sessionId: string) => Promise<{
    success: boolean;
    session?: SessionData;
    error?: string;
  }>;
  getExperiment: (sessionId: string, experimentId: string) => Promise<{
    success: boolean;
    experiment?: Experiment;
    error?: string;
  }>;
  deleteSession: (sessionId: string) => Promise<{ success: boolean; message?: string; error?: string }>;

  // Detection operations
  startDetection: (sessionId: string, posPrompts: string, negPrompts: string, theta?: number) => Promise<{
    success: boolean;
    error?: string;
  }>;
  cancelDetection: () => Promise<{ success: boolean; error?: string }>;
  saveExperiment: (sessionId: string) => Promise<{ success: boolean; experimentId?: string; message?: string; error?: string }>;
  addDetection: (sessionId: string, experimentId: string, fileName: string, start: number, end: number) => Promise<{
    success: boolean;
    detection?: Detection;
    message?: string;
    error?: string;
  }>;
  wipeTemp: (sessionId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  deleteDetection: (sessionId: string, experimentId: string, detectionId: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  deleteExperiment: (sessionId: string, experimentId: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  // Annotation operations
  assignAnnotation: (sessionId: string, experimentId: string, detectionId: string, species: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  // Verification operations
  verifyAnnotation: (sessionId: string, experimentId: string, detectionId: string, verify: boolean) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  unverifyAnnotation: (sessionId: string, experimentId: string, detectionId: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  // App state management
  getAppState: () => Promise<{
    success: boolean;
    dataDir: string | null;
    activeProfile: string | null;
  }>;
  setDataDirectory: (dataDir: string) => Promise<{ success: boolean; message?: string }>;
  setProfile: (profile: string) => Promise<{ success: boolean; message?: string }>;

  // Settings persistence — per-session
  getSettings: (sessionId: string) => Promise<{ success: boolean; settings: Record<string, unknown> | null; error?: string }>;
  setSettings: (sessionId: string, settings: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;

  // Model operations
  loadModel: (modelName: string) => Promise<{ success: boolean; message?: string; error?: string }>;
}

export interface Detection {
  id: string;
  filename: string;
  start_time: number;
  end_time: number;
  species: string | null;
  detection_conf: number;
  verified: boolean;
}

export interface Experiment {
  posPrompts?: string;
  negPrompts?: string;
  theta?: number;
  time?: string;
  detections?: Record<string, Detection[]>;
}

export interface SessionData {
  id: string;
  name: string;
  time: string;
  files: string[];
  experiments: Record<string, Experiment>;
}

export interface PythonMessage {
  type: 'ready' | 'model_loading_started' | 'model_loading_completed' | 'detection_started' |
        'detection_completed' | 'error' | 'fatal_error' | 'backend_timeout' | string;
  data: Record<string, unknown>;
  timestamp: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export { };
