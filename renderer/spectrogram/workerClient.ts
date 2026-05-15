// Shared spectrogram worker client.
//
// All SpectrogramGraphics instances on the page route through one Worker, rather
// than spawning one per spectrogram. The per-instance design was hitting a
// Chromium/Electron failure where some Workers came up with non-functional IPC
// channels — boot would complete, but postMessage from main never delivered, so
// the badge stayed on "Rendering…" forever. The failure rate per Worker was
// non-trivial and broken Workers appeared to leak across sessions, so even
// single-file sessions could hang after a previous session had stuck spectrograms.
//
// Routing model: replies are tagged with `fileId`. Subscribers register for a
// fileId and receive only matching replies. PCM is freed in the worker when the
// last subscriber for a fileId unsubscribes.

type WorkerReply = { type: string; fileId?: string; renderId?: number; blob?: Blob; error?: string };

let _worker: Worker | null = null;
const listeners = new Map<string, Set<(msg: WorkerReply) => void>>();

function ensureWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(new URL('./worker/spectrogramWorker.ts', import.meta.url), { type: 'module' });
  _worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
    const msg = ev.data;
    if (!msg || !msg.fileId) return;
    const set = listeners.get(msg.fileId);
    if (!set) return;
    for (const cb of set) cb(msg);
  };
  _worker.postMessage({ type: 'init' });
  return _worker;
}

export function postWorkerMessage(msg: unknown, transfer?: Transferable[]): void {
  ensureWorker().postMessage(msg, (transfer ?? []) as Transferable[]);
}

export function subscribeWorker(
  fileId: string,
  cb: (msg: WorkerReply) => void,
): () => void {
  ensureWorker();
  let set = listeners.get(fileId);
  if (!set) {
    set = new Set();
    listeners.set(fileId, set);
  }
  set.add(cb);
  return () => {
    const s = listeners.get(fileId);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) {
      listeners.delete(fileId);
      // No more consumers for this fileId — tell the worker to free the PCM
      // (and abort any in-flight render that was waiting for it) so the worker's
      // run queue doesn't stall and pcmStore doesn't grow unbounded.
      ensureWorker().postMessage({ type: 'clear_pcm', fileId });
    }
  };
}
