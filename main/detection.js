import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

const wipeTemp = async (sessionId, state) => {
  try {
    const tempPath = path.join(state.dataDir, state.activeProfile, sessionId, 'temp.csv')
    await fs.unlink(tempPath)

    const configPath = path.join(state.dataDir, state.activeProfile, sessionId, 'config.json')
    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'))

    delete configData.experiments.temp

    await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8')

    return { success: true, message: 'Temp file wiped successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const saveExperiment = async (sessionId, state) => {
  try {
    const configPath = path.join(state.dataDir, state.activeProfile, sessionId, 'config.json')
    const tempPath = path.join(state.dataDir, state.activeProfile, sessionId, 'temp.csv')

    const experimentId = crypto.randomUUID()

    const newExperimentPath = path.join(state.dataDir, state.activeProfile, sessionId, `${experimentId}.csv`)

    // Read the current config
    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'))

    await fs.rename(tempPath, newExperimentPath)

    // Update the config.json - move 'temp' to experimentId
    if (configData.experiments && configData.experiments.temp) {
      configData.experiments[experimentId] = configData.experiments.temp
      delete configData.experiments.temp

      await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8')
    }

    return { success: true, message: 'Experiment saved successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const addDetection = async (sessionId, experimentId, fileName, start, end, state) => {
  try {
    const experimentPath = path.join(state.dataDir, state.activeProfile, sessionId, experimentId + '.csv')

    const detectionId = crypto.randomUUID()
    const species = "None"
    const detectionConf = 1.0
    const verified = 0

    const csvRow = `${detectionId},${fileName},${start},${end},${species},${detectionConf},${verified}\n`

    await fs.appendFile(experimentPath, csvRow, 'utf8')

    return { success: true, message: 'Detection added successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

const startDetection = async (sessionId, posPrompts, negPrompts, theta = 0.5, pythonProcess, state) => {
  if (!pythonProcess) {
    throw new Error('Python backend not running');
  }

  try {
    // Get session config to access files
    const configPath = path.join(state.dataDir, state.activeProfile, sessionId, 'config.json');
    const sessionData = JSON.parse(await fs.readFile(configPath, 'utf8'));

    if (!sessionData.files || sessionData.files.length === 0) {
      return { success: false, error: 'No files found in session' };
    }

    // Use the full file paths from the session
    const files = sessionData.files;

    const commandStr = JSON.stringify({
      action: 'run_batch_detection',
      saveDir: path.join(state.dataDir, state.activeProfile, sessionId),
      files: files,
      posPrompts: posPrompts,
      negPrompts: negPrompts,
      theta: theta
    }) + '\n';

    pythonProcess.stdin.write(commandStr);
    return { success: true, message: 'Detection started' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

const deleteDetection = async (sessionId, experimentId, detectionId, state) => {
  const experimentPath = path.join(state.dataDir, state.activeProfile, sessionId, experimentId + '.csv')
  const experimentData = await fs.readFile(experimentPath, 'utf-8')
  const lines = experimentData.split('\n').filter(line => line.trim())

  const updatedLines = lines.filter(line => line.split(',')[0] !== detectionId)

  const newContent = [lines[0], ...updatedLines].join('\n')

  await fs.writeFile(experimentPath, newContent, 'utf-8')

  return { success: true, message: 'Detection deleted successfully' }
}

const deleteExperiment = async (sessionId, experimentId, state) => {
  const experimentPath = path.join(state.dataDir, state.activeProfile, sessionId, experimentId + '.csv')
  await fs.unlink(experimentPath)

  const configPath = path.join(state.dataDir, state.activeProfile, sessionId, 'config.json')
  const configData = JSON.parse(await fs.readFile(configPath, 'utf8'))

  delete configData.experiments[experimentId]

  await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8')

  return { success: true, message: 'Experiment deleted successfully' }
}

export {
  addDetection,
  saveExperiment,
  startDetection,
  wipeTemp,
  deleteDetection,
  deleteExperiment
}