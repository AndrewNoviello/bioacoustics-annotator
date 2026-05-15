import React, { useRef, useEffect, useState } from "react";
import SpectrogramViewer from "./SpectrogramViewer";
import SpectrogramAnnotations from "./SpectogramAnnotations";
import { useSpectrogram } from "./SpectrogramProvider";
import { useSettings } from "../src/stores/SettingsContext";
import { postWorkerMessage, subscribeWorker } from "./workerClient";
// Worker-based spectrogram rendering (WASM in shared worker, OffscreenCanvas drawing).
// All SpectrogramGraphics instances share one Worker via workerClient — see that
// file for the rationale (per-instance Workers hit a Chromium IPC bug that
// stranded some spectrograms on "Rendering…" forever).

// (All DSP, normalization, colormap, and drawing is handled in the worker now.)

interface SpectrogramGraphicsProps {
  annotations?: any[];
  handleDetectionClick?: (detection: any) => void;
  activeDetection?: any;
  selectedExperiments?: string[];
  onDetectionResize?: (detection: any, newStart: number, newEnd: number) => void;
}

// (No local normalization helpers needed here anymore.)

function SpectrogramGraphics(props: SpectrogramGraphicsProps & { fileId?: string }) {

  const { settings } = useSettings() as any;

  const {
    annotations = [],
    handleDetectionClick = null,
    activeDetection = null,
    selectedExperiments = [],
    onDetectionResize,
  } = props;

  const [dataURL, setDataURL] = useState<string>("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const { audioSamples, sampleRate, startTime, windowDuration } = useSpectrogram();

  // SettingsContext always initializes from DEFAULT_SETTINGS (see SettingsContext.jsx:53,77,79),
  // so `settings` is guaranteed to be a complete object — destructure directly, no per-prop
  // fallbacks (those would have diverged from DEFAULT_SETTINGS, becoming a misleading second
  // source of truth).
  const {
    n_fft, win_length, hop_length, f_min, f_max, n_mels, top_db,
    dynamicGain, autoGamma, gammaValue, gainPercentile, brightness, contrast,
  } = settings;

  const lastObjectUrlRef = useRef<string | null>(null);

  // In-flight render tracking via monotonic renderIds. The badge is visible
  // iff lastSettled < lastDispatched. This is desync-proof: a never-arriving
  // reply for an old render (e.g. worker stuck awaiting set_pcm that never
  // came) cannot wedge the badge — the next dispatch raises lastDispatched
  // and any later reply raises lastSettled past it. The 150ms show-timer
  // still suppresses the badge for fast cache-hit renders.
  const lastDispatchedRef = useRef(0);
  const lastSettledRef = useRef(0);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markRenderPosted = (): number => {
    const id = ++lastDispatchedRef.current;
    if (showTimerRef.current === null) {
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        if (lastSettledRef.current < lastDispatchedRef.current) {
          setIsRendering(true);
        }
      }, 150);
    }
    return id;
  };
  const markRenderDone = (id: number) => {
    if (id > lastSettledRef.current) lastSettledRef.current = id;
    if (lastSettledRef.current >= lastDispatchedRef.current) {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      setIsRendering(false);
    }
  };
  // Subscribe to shared-worker replies for this fileId. The worker echoes
  // fileId in every reply so workerClient.ts can fan replies out to the right
  // consumer; without that tag, replies for one spectrogram would settle
  // another's badge.
  useEffect(() => {
    if (!props.fileId) return;
    const fileId = props.fileId;
    const unsubscribe = subscribeWorker(fileId, (msg) => {
      // Defensive: if the worker ever forgets to echo renderId, treat the
      // reply as if it were for the latest dispatch so the badge still settles.
      const replyId = typeof msg?.renderId === 'number' ? msg.renderId : lastDispatchedRef.current
      // A newer render has already been dispatched — drop this reply on the
      // floor so the UI doesn't snap back to an older spectrogram.
      const stale = replyId < lastDispatchedRef.current
      if (msg?.type === 'image' && msg.blob) {
        markRenderDone(replyId)
        if (stale) return
        if (lastObjectUrlRef.current) {
          URL.revokeObjectURL(lastObjectUrlRef.current)
          lastObjectUrlRef.current = null
        }
        const url = URL.createObjectURL(msg.blob)
        lastObjectUrlRef.current = url
        setDataURL(url)
        setRenderError(null)
      } else if (msg?.type === 'error') {
        // WASM/render error — usually caused by bad settings (e.g. n_fft is
        // not a power of two, win_length > n_fft, f_max above Nyquist).
        // Surface it so the user can recover instead of staring at a blank
        // spectrogram.
        // Exception: the worker can throw "PCM not loaded for fileId" during
        // a transient race where a render is requested before set_pcm arrives.
        // The PCM loads moments later and the next render succeeds, so we
        // don't want to alarm the user with this race.
        const errMsg = typeof msg.error === 'string' ? msg.error : 'Spectrogram render failed'
        // Settle the renderId regardless — even the suppressed PCM-not-loaded
        // reply is a terminal response for that request.
        markRenderDone(replyId)
        if (stale) return
        if (errMsg.includes('PCM not loaded')) return
        setRenderError(errMsg)
      }
    });
    return () => {
      if (lastObjectUrlRef.current) {
        URL.revokeObjectURL(lastObjectUrlRef.current)
        lastObjectUrlRef.current = null
      }
      // Unsubscribing also tells the worker (via workerClient) to free the
      // PCM cache for this fileId when no consumers remain. Reset renderId
      // refs and clear the show-timer so a remount starts clean.
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
      lastDispatchedRef.current = 0
      lastSettledRef.current = 0
      setIsRendering(false)
      unsubscribe();
    }
  }, [props.fileId])

  // Post full PCM to worker once per file
  useEffect(() => {
    if (!audioSamples?.length || !sampleRate) return;
    if (!props.fileId) return;
    const pcmCopy = new Float32Array(audioSamples.length);
    pcmCopy.set(audioSamples);
    postWorkerMessage({
      type: 'set_pcm',
      fileId: props.fileId,
      sampleRate,
      pcm: pcmCopy
    }, [pcmCopy.buffer as unknown as Transferable]);
  }, [audioSamples, sampleRate, props.fileId]);

  // Trigger render in worker when dependencies change.
  // Gate on audioSamples being loaded — with a shared worker, dispatching a
  // render before set_pcm has been posted would make the worker await PCM
  // and starve every other spectrogram queued behind it. The set_pcm effect
  // above runs in declaration order before this one when audioSamples lands,
  // so by the time this effect fires the PCM is already in flight.
  useEffect(() => {
    if (!windowDuration || !props.fileId) return;
    if (!audioSamples?.length) return;

    const renderId = markRenderPosted()
    postWorkerMessage({
      type: 'render',
      fileId: props.fileId,
      renderId,
      params: {
        sampleRate,
        n_fft,
        win_length,
        hop_length,
        f_min,
        f_max,
        n_mels,
        top_db,
        t0: startTime,
        windowDuration: windowDuration,
        dynamicGain,
        autoGamma,
        gammaValue,
        gainPercentile,
        brightness,
        contrast,
      }
    })
  }, [props.fileId, audioSamples, sampleRate, startTime, windowDuration, n_fft, win_length, hop_length, f_min, f_max, n_mels, top_db, dynamicGain, autoGamma, gammaValue, gainPercentile, brightness, contrast])

  const annotationOverlays = annotations?.length ? (
    <SpectrogramAnnotations
      data={annotations}
      handleDetectionClick={handleDetectionClick ?? undefined}
      activeDetection={activeDetection}
      selectedExperiments={selectedExperiments}
      onDetectionResize={onDetectionResize}
    />
  ) : null;

  return (
    <div style={{ position: 'relative' }}>
      <SpectrogramViewer dataURL={dataURL}>
        {annotationOverlays}
      </SpectrogramViewer>
      {isRendering && !renderError && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '4px 8px',
            background: 'rgba(17, 24, 39, 0.75)',
            color: 'white',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 500,
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            pointerEvents: 'none',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 50 50" aria-hidden="true">
            <circle
              cx="25"
              cy="25"
              r="20"
              stroke="white"
              strokeWidth="6"
              fill="none"
              strokeDasharray="90 150"
              strokeLinecap="round"
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 25 25"
                to="360 25 25"
                dur="0.8s"
                repeatCount="indefinite"
              />
            </circle>
          </svg>
          Rendering…
        </div>
      )}
      {renderError && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            padding: '6px 10px',
            background: 'rgba(254, 226, 226, 0.95)',
            border: '1px solid #FCA5A5',
            borderRadius: 4,
            color: '#991B1B',
            fontSize: 12,
            zIndex: 10
          }}
        >
          <strong>Spectrogram render failed:</strong> {renderError}
          <div style={{ fontSize: 11, marginTop: 2, color: '#7F1D1D' }}>
            Check Settings — common causes: n_fft must be a power of 2,
            win_length ≤ n_fft, hop_length &lt; win_length, f_max above the
            sample rate's Nyquist limit.
          </div>
        </div>
      )}
    </div>
  );
}

export default SpectrogramGraphics;
