import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import fs from 'fs/promises'
import { safePathJoin, atomicWriteFile } from './utils.js'

async function assignAnnotation(sessionId, experimentId, detectionId, species, state) {
  const experimentPath = safePathJoin(
    state.dataDir, state.activeProfile, sessionId, experimentId + '.csv'
  )
  if (!experimentPath) return { success: false, error: 'Invalid path' }

  try {
    const raw = await fs.readFile(experimentPath, 'utf-8')
    const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true })

    if (records.length === 0) {
      return { success: false, error: 'No detections found' }
    }

    let updated = false
    const updatedRecords = records.map(row => {
      if (row.id === detectionId) {
        updated = true
        return { ...row, species }
      }
      return row
    })

    if (!updated) {
      return { success: false, error: 'Detection not found' }
    }

    const csv = stringify(updatedRecords, { header: true })
    await atomicWriteFile(experimentPath, csv)

    return { success: true, message: 'Detection annotated successfully' }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export { assignAnnotation }
