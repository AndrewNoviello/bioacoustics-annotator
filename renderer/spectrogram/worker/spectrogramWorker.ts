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

// Surface worker-side errors that previously vanished silently. Without these,
// a WASM load failure or unhandled rejection inside the worker leaves the
// renderer-side render queue waiting forever with no signal.
self.addEventListener('error', (e) => {
  console.error('[spectrogram-worker] uncaught error', e.message, (e as ErrorEvent).filename, (e as ErrorEvent).lineno, (e as ErrorEvent).error);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[spectrogram-worker] unhandledrejection', (e as PromiseRejectionEvent).reason);
});

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
  renderId?: number
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

type ClearPcmMsg = {
  type: 'clear_pcm'
  fileId: string
}

type Msg = InitMsg | SetPcmMsg | RenderMsg | ClearPcmMsg

type Tile = { startFrame: number; frames: number }


// This computes the key for the tile section 
function tileKey(fileId: string, startFrame: number, tileFrames: number, p: RenderMsg['params']): string {
  // Only DSP params are included in keys; UI/display params excluded for reuse
  return `${fileId}:${startFrame}:${tileFrames}:${p.sampleRate}:${p.n_fft}:${p.win_length}:${p.hop_length}:${p.n_mels}:${p.f_min}:${p.f_max}:${p.top_db}`
}

let wasmReady = false                          // Tracks if WASM is initialized
// Render coalescing: at most one render runs at a time, and one pending render
// per fileId is queued. A new render for the same fileId overwrites the queued
// one (slider-drag coalescing). Renders for different fileIds are processed
// sequentially in FIFO insertion order. Single-runner — re-entry from onmessage
// during an in-flight render's await points is guarded by `renderInFlight`.
let renderInFlight = false
const pendingRenders = new Map<string, RenderMsg>()
const pcmStore = new Map<string, { sampleRate: number, pcm: Float32Array }>() // Full PCM per fileId

// Resolvers waiting for set_pcm. A render can arrive before the renderer has
// finished fetching + decoding the WAV; instead of throwing, render handlers
// await waitForPCM(fileId), which resolves as soon as set_pcm lands for that id.
// On clear_pcm, waiters are resolved with `undefined` so the run queue can
// drain instead of stalling forever — the subsequent pcmStore lookup throws and
// the catch in processRender posts an error reply that nobody listens to.
type PCMEntry = { sampleRate: number, pcm: Float32Array }
const pcmReadyResolvers = new Map<string, Array<(entry: PCMEntry | undefined) => void>>()

function waitForPCM(fileId: string): Promise<PCMEntry | undefined> {
  const existing = pcmStore.get(fileId)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const list = pcmReadyResolvers.get(fileId) || []
    list.push(resolve)
    pcmReadyResolvers.set(fileId, list)
  })
}

const melTileCache = new Map<string, Float32Array>()  // Tile cache: flattened (frames * n_mels)
const TILE_FRAMES = 1024                               // Tile width in frames (time columns)
const MAX_TILES = 200                                  // LRU eviction limit (~200 MB at 1024 frames × 128 bins × f32)

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


// Single-runner render pipeline. processRender does the work; runLoop drains
// pendingRender one at a time. The renderInFlight guard makes runLoop safe to
// call re-entrantly from onmessage during an in-flight render's await points.
async function processRender(msg: RenderMsg): Promise<void> {
  const renderId = msg.renderId
  const fileId = msg.fileId
  try {
    await ensureWasmInitialized()
    // Wait for PCM if the renderer dispatched render before set_pcm landed.
    // assembleWindowMel below relies on pcmStore being populated.
    await waitForPCM(fileId)
    const p = msg.params
    // Assemble the requested window by concatenating cached / freshly computed tiles
    const { mel, frames } = assembleWindowMel(fileId, p)

    const width = frames
    const height = p.n_mels

    if (!mel || frames <= 0) {
      // Return an empty 1x1 image blob
      const off = new OffscreenCanvas(1, 1)
      const blob = await off.convertToBlob()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      self.postMessage({ type: 'image', blob, renderId, fileId })
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
    // Sort finite mel values ONCE — both dynamicGain (percentiles) and autoGamma (median) need it.
    // The previous `Array.from(typedArray).filter(...).sort((a,b)=>a-b)` allocated a boxed JS array
    // and used a JS-comparator sort; on multi-million-element mels that ran for seconds, and when
    // multiple spectrogram workers ran concurrently most of them never finished — so settings
    // saves visibly failed to redraw. Filter into a Float32Array and use the native typed-array
    // sort (numerical by default).
    let sortedFinite: Float32Array | null = null
    if (p.dynamicGain || p.autoGamma) {
      const tmp = new Float32Array(mel.length)
      let n = 0
      for (let i = 0; i < mel.length; i++) {
        const v = mel[i]
        if (Number.isFinite(v)) tmp[n++] = v
      }
      sortedFinite = tmp.subarray(0, n)
      sortedFinite.sort()
    }
    if (p.dynamicGain && sortedFinite && sortedFinite.length > 0) {
      const idxLow = Math.floor(0.05 * sortedFinite.length)
      const idxHigh = Math.floor((p.gainPercentile / 100) * sortedFinite.length)
      smin = sortedFinite[Math.min(idxLow, sortedFinite.length - 1)]
      smax = sortedFinite[Math.min(idxHigh, sortedFinite.length - 1)]
    }
    if (!(smax > smin)) {
      smax = smin + 1e-6
    }
    let gamma = p.gammaValue
    if (p.autoGamma && sortedFinite) {
      const mid = sortedFinite.length ? sortedFinite[Math.floor(sortedFinite.length * 0.5)] : 0
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
    self.postMessage({ type: 'image', blob, renderId, fileId })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('worker render error:', err)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    self.postMessage({ type: 'error', error: (err as Error).message, renderId, fileId })
  }
}

async function runLoop(): Promise<void> {
  if (renderInFlight) return
  while (pendingRenders.size > 0) {
    // Drain FIFO: insertion order across fileIds is preserved by Map. New
    // renders for an already-queued fileId have replaced the entry, so slider
    // drags still coalesce to ~1 render per fileId.
    const fileId = pendingRenders.keys().next().value as string
    const next = pendingRenders.get(fileId)!
    pendingRenders.delete(fileId)
    renderInFlight = true
    try {
      await processRender(next)
    } finally {
      renderInFlight = false
    }
  }
}

// Main message dispatcher: init -> set_pcm -> render
self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data
  if (msg.type === 'init') {
    try {
      await ensureWasmInitialized()
    } catch { /* swallow — render path will surface a real error reply */ }
    return
  }

  if (msg.type === 'set_pcm') {
    // Store PCM and sampleRate for this fileId in memory for fast repeated access
    const entry = { sampleRate: msg.sampleRate, pcm: msg.pcm }
    pcmStore.set(msg.fileId, entry)
    // Resolve any render handlers that started before this PCM arrived.
    const waiters = pcmReadyResolvers.get(msg.fileId)
    if (waiters) {
      pcmReadyResolvers.delete(msg.fileId)
      for (const w of waiters) w(entry)
    }
    return
  }

  if (msg.type === 'render') {
    // Newest wins per fileId: a queued render for the same file that hasn't
    // started yet is dropped silently. The main thread doesn't need a reply
    // for it — its renderId never settles, but the next reply's id catches
    // lastSettledRef up past lastDispatchedRef. Renders for different fileIds
    // queue independently, so one file's slider drag doesn't starve another.
    pendingRenders.set(msg.fileId, msg)
    runLoop()
    return
  }

  if (msg.type === 'clear_pcm') {
    // Last subscriber for this fileId went away. Free the PCM and drop any
    // queued render. Wake up any waitForPCM resolvers with `undefined` so an
    // in-flight render awaiting this PCM unblocks, the run queue drains, and
    // we don't leak a permanently-pending Promise that wedges renderInFlight.
    pcmStore.delete(msg.fileId)
    pendingRenders.delete(msg.fileId)
    const waiters = pcmReadyResolvers.get(msg.fileId)
    if (waiters) {
      pcmReadyResolvers.delete(msg.fileId)
      for (const w of waiters) w(undefined)
    }
    return
  }
}

// Ready handshake: now that self.onmessage is installed, tell the main thread
// it can start delivering. Messages posted to a module Worker during its
// initial evaluation are silently dropped by Chromium/Electron in dev mode —
// observed empirically: the very first render's init/set_pcm/render produced
// zero onmessage callbacks here, while the same worker happily processed a
// clear_pcm sent ~200ms later. workerClient buffers outbound messages until
// this 'ready' arrives.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
self.postMessage({ type: 'ready' })

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

  const framesPerPad = Math.floor(pad / hop)
  const usable = melFrames.slice(framesPerPad, framesPerPad + seg.frames)

  let cursor = 0
  while (cursor < seg.frames) {
    const thisFrames = Math.min(TILE_FRAMES, seg.frames - cursor)
    const tileFrames = usable.slice(cursor, cursor + thisFrames)
    const flat = flattenMel(tileFrames, p.n_mels)
    const tStart = seg.startFrame + cursor
    const key = tileKey(fileId, tStart, thisFrames, p)
    // LRU eviction: remove oldest entry when cache is full
    if (melTileCache.size >= MAX_TILES) {
      melTileCache.delete(melTileCache.keys().next().value!)
    }
    melTileCache.set(key, flat)
    cursor += thisFrames
  }
}


