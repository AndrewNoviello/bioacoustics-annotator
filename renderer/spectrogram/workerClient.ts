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
//
// Ready-handshake: messages sent to a module Worker during its initial module
// evaluation phase can be silently dropped — observed empirically: messages
// posted within the first ~200ms of worker creation never reached the worker's
// onmessage, while a message posted after the boundary processed normally on
// the same worker instance. The fix is the standard handshake: the worker
// posts {type:'ready'} once its onmessage is installed, and we hold all
// outbound messages until that arrives.

type WorkerReply = { type: string; fileId?: string; renderId?: number; blob?: Blob; error?: string };

let _worker: Worker | null = null;
let _workerReady = false;
const _pendingPosts: Array<{ msg: unknown; transfer: Transferable[] }> = [];
const listeners = new Map<string, Set<(msg: WorkerReply) => void>>();

function ensureWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(new URL('./worker/spectrogramWorker.ts', import.meta.url), { type: 'module' });
  _worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
    const msg = ev.data;
    if (msg?.type === 'ready') {
      // Worker's onmessage is installed. Flush anything we buffered during
      // module evaluation. We splice (not iterate-then-clear) so a reentrant
      // postWorkerMessage during flush appends to the new array, not the one
      // we're iterating.
      _workerReady = true;
      const drained = _pendingPosts.splice(0);
      for (const { msg: pm, transfer } of drained) {
        _worker!.postMessage(pm, transfer);
      }
      return;
    }
    if (!msg || !msg.fileId) return;
    const set = listeners.get(msg.fileId);
    if (!set) return;
    for (const cb of set) cb(msg);
  };
  // Surface worker crashes that previously vanished silently.
  _worker.onerror = (ev) => {
    console.error('[spectrogram-worker] onerror', ev.message, ev.filename, ev.lineno, ev.error);
  };
  _worker.onmessageerror = (ev) => {
    console.error('[spectrogram-worker] onmessageerror — message could not be deserialized', ev);
  };
  return _worker;
}

export function postWorkerMessage(msg: unknown, transfer?: Transferable[]): void {
  const transferArr = (transfer ?? []) as Transferable[];
  ensureWorker();
  if (!_workerReady) {
    _pendingPosts.push({ msg, transfer: transferArr });
    return;
  }
  _worker!.postMessage(msg, transferArr);
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
      // run queue doesn't stall and pcmStore doesn't grow unbounded. Route
      // through postWorkerMessage so the message is buffered if the worker
      // is somehow not ready yet.
      postWorkerMessage({ type: 'clear_pcm', fileId });
    }
  };
}
