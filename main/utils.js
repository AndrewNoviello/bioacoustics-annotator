import fs from 'fs/promises'

export const listSubdirectories = async (dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
    return { success: true, dirs }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export const handlePythonCommand = async (pythonProcess, command) => {
  if (!pythonProcess) {
    throw new Error('Python backend not running');
  }

  return new Promise((resolve, reject) => {
    try {
      const commandStr = JSON.stringify(command) + '\n';
      pythonProcess.stdin.write(commandStr);

      const timer = setTimeout(() => {
        const index = pendingCommands.findIndex((item) => item.reject === reject);
        if (index !== -1) pendingCommands.splice(index, 1);
        reject(new Error('Python command timeout'));
      }, 30000);

      pendingCommands.push({ resolve, reject, timer });

    } catch (error) {
      reject(error);
    }
  });
}