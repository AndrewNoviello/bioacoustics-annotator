import fs from 'fs/promises'
import path from 'path'

export const listSubdirectories = async (dirPath) => {
  try {
    if (!dirPath) {
      return { success: false, error: 'Directory path is required' }
    }

    try {
      await fs.access(dirPath)
    } catch {
      return { success: false, error: `Directory not found: ${dirPath}` }
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
    return { success: true, dirs }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Safely joins path segments ensuring the result stays within basePath.
 * Uses path.relative() which is case-insensitive on Windows, unlike startsWith().
 * Returns null if the result would escape the base directory.
 */
export const safePathJoin = (basePath, ...segments) => {
  if (!basePath) return null
  const joined = path.join(basePath, ...segments)
  const resolved = path.resolve(joined)
  const resolvedBase = path.resolve(basePath)

  // path.relative() handles Windows case-insensitive paths correctly
  const rel = path.relative(resolvedBase, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null
  }
  return resolved
}

/**
 * Checks if a file or directory exists.
 */
export const pathExists = async (filePath) => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Atomically writes content to filePath by writing to a .tmp file first,
 * then renaming. On the same filesystem rename() is atomic on Windows/POSIX.
 */
export const atomicWriteFile = async (filePath, content) => {
  const tmp = filePath + '.tmp'
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, filePath)
}
