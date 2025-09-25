/*
  Spectrogram Worker (WASM + Tile Cache)
  -------------------------------------
  This Web Worker owns all DSP-heavy spectrogram work so the React/UI thread stays smooth.
  It:
    - Receives full PCM once per file (set_pcm)
    - Renders any time window (render) using a frame-aligned mel tile cache
    - Applies display-only transforms (gain/gamma/brightness/contrast) post-assembly
    - Color-maps to RGBA and returns a Blob for direct <image> consumption

  High-level pipeline for a render(fileId, t0, windowDuration):
    1) Convert the time window to global frame indices using hop_length
    2) Determine which tiles are needed to cover those frames
    3) Compute any contiguous runs of missing tiles in a single mel_spectrogram_db call (+pad)
       and slice the result into tile-sized chunks to populate the cache
    4) Concatenate tiles into a full-window mel buffer (flattened Float32Array)
    5) Compute display parameters (gain percentiles, gamma), color-map, and draw to OffscreenCanvas
    6) Convert to Blob and post back to the renderer
*/

// Note: Vite bundles this worker as an ES module worker.
// We import the wasm JS glue directly here; the rust-compiled WASM does the heavy DSP.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { mel_spectrogram_db } from "../../../wasm/pkg/rust_melspec_wasm.js";

type InitMsg = {
  type: 'init'
}

type SetPcmMsg = {
  type: 'set_pcm',
  fileId: string,
  sampleRate: number,
  pcm: Float32Array
}

type RenderMsg = {
  type: 'render'
  fileId: string
  params: {
    sampleRate: number
    n_fft: number
    win_length: number
    hop_length: number
    f_min: number
    f_max: number
    n_mels: number
    top_db: number
    t0: number
    windowDuration: number
    dynamicGain: boolean
    autoGamma: boolean
    gammaValue: number
    gainPercentile: number
    brightness: number
    contrast: number
    colormap: string
  }
}

type Msg = InitMsg | SetPcmMsg | RenderMsg

type Tile = { startFrame: number; frames: number }


// This computes the key for the tile section 
function tileKey(fileId: string, startFrame: number, tileFrames: number, p: RenderMsg['params']): string {
  // Only DSP params are included in keys; UI/display params excluded for reuse
  return `${fileId}:${startFrame}:${tileFrames}:${p.sampleRate}:${p.n_fft}:${p.win_length}:${p.hop_length}:${p.n_mels}:${p.f_min}:${p.f_max}:${p.top_db}`
}

let wasmReady = false                          // Tracks if WASM is initialized
const pcmStore = new Map<string, { sampleRate: number, pcm: Float32Array }>() // Full PCM per fileId

const melTileCache = new Map<string, Float32Array>()  // Tile cache: flattened (frames * n_mels)
const TILE_FRAMES = 1024                               // Tile width in frames (time columns)

// Build a viridis RGBA LUT for better visualization
function buildViridisLUT(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4)

  // Viridis colormap - interpolated RGB values for smooth color transition
  for (let i = 0; i < 256; i++) {
    const t = i / 255.0  // Normalize to [0, 1]

    // Viridis color interpolation
    let r, g, b

    if (t < 0.25) {
      // Dark purple to blue
      const localT = t / 0.25
      r = Math.round(68 * (1 - localT) + 59 * localT)
      g = Math.round(1 * (1 - localT) + 82 * localT)
      b = Math.round(84 * (1 - localT) + 139 * localT)
    } else if (t < 0.5) {
      // Blue to green
      const localT = (t - 0.25) / 0.25
      r = Math.round(59 * (1 - localT) + 53 * localT)
      g = Math.round(82 * (1 - localT) + 183 * localT)
      b = Math.round(139 * (1 - localT) + 121 * localT)
    } else if (t < 0.75) {
      // Green to yellow
      const localT = (t - 0.5) / 0.25
      r = Math.round(53 * (1 - localT) + 253 * localT)
      g = Math.round(183 * (1 - localT) + 231 * localT)
      b = Math.round(121 * (1 - localT) + 37 * localT)
    } else {
      // Yellow to bright yellow
      const localT = (t - 0.75) / 0.25
      r = Math.round(253 * (1 - localT) + 254 * localT)
      g = Math.round(231 * (1 - localT) + 240 * localT)
      b = Math.round(37 * (1 - localT) + 36 * localT)
    }

    lut[i * 4 + 0] = Math.max(0, Math.min(255, r))  // R
    lut[i * 4 + 1] = Math.max(0, Math.min(255, g))  // G
    lut[i * 4 + 2] = Math.max(0, Math.min(255, b))  // B
    lut[i * 4 + 3] = 255                            // A
  }
  return lut
}

const viridisLUT = buildViridisLUT()            // Global LUT reused per render


async function ensureWasmInitialized(): Promise<void> {
  if (!wasmReady) {
    try {
      // WASM is automatically initialized when the module is imported
      // No explicit initialization function needed
      wasmReady = true
    } catch (err) {
      console.error('Failed to initialize rust-melspec-wasm in worker:', err)
      throw err
    }
  }
}


// Main message dispatcher: init -> set_pcm -> render
self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data
  if (msg.type === 'init') {
    try {
      await ensureWasmInitialized()
    } catch { }
    return
  }

  if (msg.type === 'set_pcm') {
    // Store PCM and sampleRate for this fileId in memory for fast repeated access
    pcmStore.set(msg.fileId, { sampleRate: msg.sampleRate, pcm: msg.pcm })
    return
  }

  if (msg.type === 'render') {
    try {
      await ensureWasmInitialized()
      const p = msg.params
      // Assemble the requested window by concatenating cached / freshly computed tiles
      const { mel, frames } = assembleWindowMel(msg.fileId, p)

      const width = frames
      const height = p.n_mels

      if (!mel || frames <= 0) {
        // Return an empty 1x1 image blob
        const off = new OffscreenCanvas(1, 1)
        const blob = await off.convertToBlob()
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        self.postMessage({ type: 'image', blob })
        return
      }

      // Compute display transform parameters (dynamic gain and gamma) from flattened mel
      let smin = Infinity
      let smax = -Infinity
      // Compute min/max over flattened mel (frames x n_mels)
      for (let i = 0; i < mel.length; i++) {
        const v = mel[i]
        if (!isFinite(v)) continue
        if (v < smin) smin = v
        if (v > smax) smax = v
      }
      if (p.dynamicGain) {
        // Percentiles on flattened data for low/high gain bounds
        const sorted = Array.from(mel).filter(Number.isFinite).sort((a, b) => a - b)
        if (sorted.length > 0) {
          const idxLow = Math.floor(0.05 * sorted.length)
          const idxHigh = Math.floor((p.gainPercentile / 100) * sorted.length)
          smin = sorted[Math.min(idxLow, sorted.length - 1)]
          smax = sorted[Math.min(idxHigh, sorted.length - 1)]
        }
      }
      if (!(smax > smin)) {
        smax = smin + 1e-6
      }
      let gamma = p.gammaValue
      if (p.autoGamma) {
        // Approximate median on flattened data to decide gamma
        const sorted = Array.from(mel).filter(Number.isFinite).sort((a, b) => a - b)
        const mid = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0
        const normalizedMedian = (mid - smin) / (smax - smin)
        gamma = normalizedMedian < 0.3 ? 0.6 : normalizedMedian > 0.7 ? 1.4 : 1.0
      }

      const off = new OffscreenCanvas(width, height)
      const ctx = off.getContext('2d')!
      const image = ctx.createImageData(width, height)
      const data = image.data

      // Rasterize: bottom-up so the lowest mel band is at the bottom of the image
      for (let j = height - 1; j >= 0; j--) {
        for (let i = width - 1; i >= 0; i--) {
          const v = mel[i * height + j] // flattened time-major
          let normalizedValue = (v - smin) / (smax - smin)
          if (!isFinite(normalizedValue)) normalizedValue = 0
          normalizedValue = Math.max(0, Math.min(1, normalizedValue))
          const gammaAdjusted = Math.pow(normalizedValue, gamma)
          const adjustedValue = (gammaAdjusted - 0.5) * p.contrast + 0.5 + p.brightness
          const clampedValue = Math.max(0, Math.min(1, adjustedValue))
          const num = (clampedValue * 255) | 0
          const o = ((height - 1 - j) * width + i) * 4
          data[o + 0] = viridisLUT[num * 4 + 0]
          data[o + 1] = viridisLUT[num * 4 + 1]
          data[o + 2] = viridisLUT[num * 4 + 2]
          data[o + 3] = 255
        }
      }
      ctx.putImageData(image, 0, 0)

      const blob = await off.convertToBlob()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      self.postMessage({ type: 'image', blob })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('worker render error:', err)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      self.postMessage({ type: 'error', error: (err as Error).message })
    }
  }
}

function framesForWindow(p: RenderMsg['params']): { F0: number, F1: number } {
  // framesPerSecond = how many hop-aligned frames fit in one second
  const framesPerSecond = p.sampleRate / p.hop_length
  // Convert start time to a global frame index
  const F0 = Math.floor(p.t0 * framesPerSecond)
  // Total frames requested = windowDuration in seconds * framesPerSecond
  const totalFrames = Math.max(1, Math.floor(p.windowDuration * framesPerSecond))
  // Inclusive end index
  const F1 = F0 + totalFrames - 1
  return { F0, F1 }
}

function flattenMel(melFrames: Float32Array[], n_mels: number): Float32Array {
  // Flatten time-major frames into a single buffer [t0..tn][m0..m_{n_mels-1}]
  const frames = melFrames.length
  const out = new Float32Array(frames * n_mels)
  for (let t = 0; t < frames; t++) {
    out.set(melFrames[t], t * n_mels)
  }
  return out
}

function concatTiles(tiles: Float32Array[]): Float32Array {
  let total = 0
  for (const t of tiles) total += t.length
  const out = new Float32Array(total)
  let offset = 0
  for (const t of tiles) {
    out.set(t, offset)
    offset += t.length
  }
  return out
}

// Analyze which tiles are needed and which are missing, returning both
function analyzeTiles(fileId: string, F0: number, F1: number, p: RenderMsg['params']): { needed: Tile[], missing: Tile[] } {
  // Build list of needed tiles
  const needed: Tile[] = []
  let cursor = F0
  while (cursor <= F1) {
    const frames = Math.min(TILE_FRAMES, F1 - cursor + 1)
    needed.push({ startFrame: cursor, frames })
    cursor += frames
  }

  // Find contiguous missing segments
  const missing: Tile[] = []
  let segStart = -1
  let segEnd = -1

  for (const tile of needed) {
    const key = tileKey(fileId, tile.startFrame, tile.frames, p)
    const isCached = melTileCache.has(key)

    if (isCached) {
      if (segStart !== -1) {
        missing.push({ startFrame: segStart, frames: segEnd - segStart + 1 })
        segStart = segEnd = -1
      }
      continue
    }

    if (segStart === -1) {
      segStart = tile.startFrame
      segEnd = tile.startFrame + tile.frames - 1
    } else if (tile.startFrame === segEnd + 1) {
      segEnd = tile.startFrame + tile.frames - 1
    } else {
      missing.push({ startFrame: segStart, frames: segEnd - segStart + 1 })
      segStart = tile.startFrame
      segEnd = tile.startFrame + tile.frames - 1
    }
  }

  if (segStart !== -1) {
    missing.push({ startFrame: segStart, frames: segEnd - segStart + 1 })
  }

  return { needed, missing }
}

function assembleWindowMel(fileId: string, p: RenderMsg['params']): { mel: Float32Array, frames: number } {
  const { F0, F1 } = framesForWindow(p)
  const { needed, missing } = analyzeTiles(fileId, F0, F1, p)

  // Compute missing segments
  for (const seg of missing) {
    computeSegmentAndPopulateTiles(fileId, seg, p)
  }

  // Concatenate all tiles
  const tiles = needed.map(t => melTileCache.get(tileKey(fileId, t.startFrame, t.frames, p))!)
  return { mel: concatTiles(tiles), frames: F1 - F0 + 1 }
}


// Compute a whole contiguous segment once (+pad) and populate per-tile cache entries
function computeSegmentAndPopulateTiles(
  fileId: string,
  seg: { startFrame: number; frames: number },
  p: RenderMsg['params']
) {
  const pcmEntry = pcmStore.get(fileId)
  if (!pcmEntry) throw new Error('PCM not loaded for fileId')

  const hop = p.hop_length
  const pad = p.n_fft
  const startSample = Math.max(0, seg.startFrame * hop - pad)
  const endSample = Math.min(pcmEntry.pcm.length, (seg.startFrame + seg.frames) * hop + pad)

  const slice = pcmEntry.pcm.subarray(startSample, endSample)


  console.log('slice', slice)
  const melFrames = mel_spectrogram_db(
    p.sampleRate,
    slice,
    p.n_fft,
    p.win_length,
    p.hop_length,
    p.f_min,
    p.f_max,
    p.n_mels,
    p.top_db
  ) as Float32Array[]

  console.log('melFrames', melFrames)

  // Debug: Check frequency distribution across mel bins
  if (melFrames.length > 0) {
    const firstFrame = melFrames[0]
    console.log('Spectrogram parameters:')
    console.log('  sampleRate:', p.sampleRate)
    console.log('  n_fft:', p.n_fft)
    console.log('  win_length:', p.win_length)
    console.log('  hop_length:', p.hop_length)
    console.log('  f_min:', p.f_min, 'f_max:', p.f_max)
    console.log('  n_mels:', p.n_mels)
    console.log('  top_db:', p.top_db)

    console.log('First frame mel values:')
    console.log('  Length:', firstFrame.length)
    console.log('  Min value:', Math.min(...firstFrame))
    console.log('  Max value:', Math.max(...firstFrame))
    console.log('  Top 8 mels (indices 56-63):', firstFrame.slice(56, 64))
    console.log('  Bottom 8 mels (indices 0-7):', firstFrame.slice(0, 8))
    console.log('  Middle 8 mels (indices 28-35):', firstFrame.slice(28, 36))

    // Check if the issue is consistent across multiple frames
    if (melFrames.length > 5) {
      console.log('Checking multiple frames for consistency:')
      for (let i = 0; i < Math.min(5, melFrames.length); i++) {
        const frame = melFrames[i]
        const top8 = frame.slice(56, 64)
        const avgTop8 = top8.reduce((a, b) => a + b, 0) / top8.length
        console.log(`  Frame ${i}: avg top 8 mels = ${avgTop8.toFixed(2)} dB`)
      }
    }
  }

  const framesPerPad = Math.floor(pad / hop)
  const usable = melFrames.slice(framesPerPad, framesPerPad + seg.frames)

  let cursor = 0
  while (cursor < seg.frames) {
    const thisFrames = Math.min(TILE_FRAMES, seg.frames - cursor)
    const tileFrames = usable.slice(cursor, cursor + thisFrames)
    const flat = flattenMel(tileFrames, p.n_mels)
    const tStart = seg.startFrame + cursor
    const key = tileKey(fileId, tStart, thisFrames, p)
    melTileCache.set(key, flat)
    cursor += thisFrames
  }
}


