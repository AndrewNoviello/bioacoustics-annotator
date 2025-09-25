import React, { useRef, useEffect, useState } from "react";
import SpectrogramViewer from "./SpectrogramViewer";
import SpectrogramAnnotations from "./SpectogramAnnotations";
import { useSpectrogram } from "./SpectrogramProvider";
import { useSettings } from "../src/stores/SettingsContext";
// Worker-based spectrogram rendering (WASM in worker, OffscreenCanvas drawing)

// (All DSP, normalization, colormap, and drawing is handled in the worker now.)

interface SpectrogramGraphicsProps {
  annotations?: any[];
  handleDetectionClick?: (detection: any) => void;
  activeDetection?: any;
}

// (No local normalization helpers needed here anymore.)

function SpectrogramGraphics(props: SpectrogramGraphicsProps & { fileId?: string }) {

  const { settings } = useSettings() as any;

  const {
    annotations = [],
    handleDetectionClick = null,
    activeDetection = null,
  } = props;

  const [dataURL, setDataURL] = useState<string>("");
  const { audioSamples, sampleRate, startTime, windowDuration, isLoading } = useSpectrogram();

  // Get all parameters from settings context
  const n_fft = settings?.n_fft ?? 1024;
  const win_length = settings?.win_length ?? 400;
  const hop_length = settings?.hop_length ?? 160;
  const f_min = settings?.f_min ?? 0.0;
  const f_max = settings?.f_max ?? sampleRate / 2;
  const n_mels = settings?.n_mels ?? 128;
  const top_db = settings?.top_db ?? 80;
  const dynamicGain = settings?.dynamicGain ?? true;
  const autoGamma = settings?.autoGamma ?? true;
  const gammaValue = settings?.gammaValue ?? 1.0;
  const gainPercentile = settings?.gainPercentile ?? 95;
  const brightness = settings?.brightness ?? 0;
  const contrast = settings?.contrast ?? 1;

  // Worker refs
  const workerRef = useRef<Worker | null>(null);
  const lastObjectUrlRef = useRef<string | null>(null);
  // Initialize worker
  useEffect(() => {
    // sxx path uses legacy client rendering; only init worker for PCM path
    const worker = new Worker(new URL('./worker/spectrogramWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.postMessage({ type: 'init' });
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as any
      if (msg?.type === 'image' && msg.blob) {
        if (lastObjectUrlRef.current) {
          URL.revokeObjectURL(lastObjectUrlRef.current)
          lastObjectUrlRef.current = null
        }
        const url = URL.createObjectURL(msg.blob)
        lastObjectUrlRef.current = url
        setDataURL(url)
      }
    }
    return () => {
      if (lastObjectUrlRef.current) {
        URL.revokeObjectURL(lastObjectUrlRef.current)
        lastObjectUrlRef.current = null
      }
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  // Post full PCM to worker once per file
  useEffect(() => {
    if (!workerRef.current) return;
    if (!audioSamples?.length || !sampleRate) return;
    if (!props.fileId) return;
    const pcmCopy = new Float32Array(audioSamples.length);
    pcmCopy.set(audioSamples);
    workerRef.current.postMessage({
      type: 'set_pcm',
      fileId: props.fileId,
      sampleRate,
      pcm: pcmCopy
    }, [pcmCopy.buffer as unknown as Transferable]);
  }, [audioSamples, sampleRate, props.fileId]);

  // Trigger render in worker when dependencies change
  useEffect(() => {
    if (!workerRef.current) return;
    if (!windowDuration || !props.fileId) return;

    workerRef.current.postMessage({
      type: 'render',
      fileId: props.fileId,
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
  }, [audioSamples, sampleRate, startTime, windowDuration, n_fft, win_length, hop_length, f_min, f_max, n_mels, top_db, dynamicGain, autoGamma, gammaValue, gainPercentile, brightness, contrast])

  // Create annotation overlays (only when not loading)
  const annotationOverlays = !isLoading && annotations?.length ? (
    <SpectrogramAnnotations
      data={annotations}
      handleDetectionClick={handleDetectionClick}
      activeDetection={activeDetection}
    />
  ) : null;

  return (
    <SpectrogramViewer dataURL={dataURL}>
      {annotationOverlays}
    </SpectrogramViewer>
  );
}

export default SpectrogramGraphics;
