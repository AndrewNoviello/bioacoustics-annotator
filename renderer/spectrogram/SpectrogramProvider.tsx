import React, {
  createContext,
  useState,
  useEffect,
  useRef,
  useContext,
  useCallback,
  useMemo,
  SetStateAction,
  Dispatch,
} from "react";
import { useSettings } from "../src/stores/SettingsContext";

export type SpectrogramContextType = {
  // Audio playback state
  duration: number | null;
  currentTime: number;
  playbackRate: number;
  sampleRate: number;
  audioSamples: Float32Array;

  // Viewport/zoom state
  startTime: number;
  endTime: number; // Derived: startTime + windowDuration
  windowDuration: number;
  isZoomed: boolean;

  // Audio playback methods
  setDuration: Dispatch<SetStateAction<number | null>>;
  setCurrentTime: (newTime: number) => void;
  setPlaybackRate: (newRate: number) => void;
  pause: () => void;

  // Viewport/zoom methods
  setStartTime: (newStartTime: number) => void;
};

export const SpectrogramContext = createContext<SpectrogramContextType>({
  // Audio playback defaults
  duration: null,
  currentTime: 0,
  playbackRate: 1.0,
  sampleRate: 32000,
  audioSamples: new Float32Array(0),

  // Audio playback methods
  setDuration: () => { },
  setCurrentTime: () => { },
  setPlaybackRate: () => { },
  pause: () => { },

  // Viewport/zoom defaults
  startTime: 0,
  endTime: 1,
  windowDuration: 15,
  isZoomed: false,


  // Viewport/zoom methods
  setStartTime: () => { },
});

export function useSpectrogram() {
  return useContext(SpectrogramContext);
}

export type SpectrogramProviderProps = {
  children: JSX.Element | JSX.Element[];
  src: string;
};

// Reduce frequency to improve performance (updates ~10×/sec)
const CURRENT_TIME_UPDATE_INTERVAL = 100;

function SpectrogramProvider(props: SpectrogramProviderProps) {
  const {
    children,
    src
  } = props;

  // Get settings
  const { settings } = useSettings() as any;
  const windowDuration = settings?.windowDuration ?? 15;

  // Audio playback state
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, _setCurrentTime] = useState(0);
  const [playbackRate, _setPlaybackRate] = useState(1.0);
  const [audioSamples, setAudioSamples] = useState<Float32Array>(new Float32Array(0));
  const [sampleRate, setSampleRate] = useState<number>(32000);

  // Viewport/zoom state - only track startTime, derive endTime
  const [startTime, setStartTimeState] = useState(0);

  // Derived values
  const endTime = startTime + windowDuration;

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null);
  const intervalRef = useRef<number>();
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Audio playback effects
  useEffect(() => {
    if (audioRef.current !== null) {
      if (audioRef.current.duration) {
        setDuration(audioRef.current.duration);
      }

      if (audioRef.current.readyState >= 1) {
        setDuration(audioRef.current.duration);
      }

      audioRef.current.playbackRate = 1.0;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      const audio = audioRef.current;

      const startInterval = () => {
        intervalRef.current = window.setInterval(() => {
          if (audio && audio.currentTime) {
            _setCurrentTime(audio.currentTime);
          }
        }, CURRENT_TIME_UPDATE_INTERVAL);
      };

      const clearCurrentInterval = () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
      };

      audio.addEventListener("play", startInterval);
      audio.addEventListener("pause", clearCurrentInterval);
      audio.addEventListener("ended", clearCurrentInterval);

      return () => {
        audio.removeEventListener("play", startInterval);
        audio.removeEventListener("pause", clearCurrentInterval);
        audio.removeEventListener("ended", clearCurrentInterval);
        clearCurrentInterval();
      };
    }
  }, [audioRef.current]);
  // Audio loading effect
  useEffect(() => {
    let cancelled = false;
    let audioContext: AudioContext | null = null;

    const fetchAudioData = async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        if (cancelled) return;

        const samples = audioBuffer.getChannelData(0);

        // The PCM returned by audioBuffer.getChannelData() is at the AudioContext's
        // own sample rate (often 48000), regardless of the original file. Send that
        // rate to the spectrogram worker; using the header rate would mis-scale time
        // and clamp f_max to the wrong Nyquist.
        setAudioSamples(samples);
        setSampleRate(audioBuffer.sampleRate);
      } catch (error) {
        if (!cancelled) console.error('Error loading audio:', error);
      } finally {
        // Browsers cap concurrent AudioContexts (~6 in Chrome). Without this
        // close(), every file switch leaks one — eventually new AudioContext()
        // throws or decodeAudioData fails silently and spectrograms stop loading.
        if (audioContext) {
          audioContext.close().catch(() => { });
        }
      }
    };

    fetchAudioData();
    return () => { cancelled = true; };
  }, [src]);

  // Initialize viewport with duration
  useEffect(() => {
    if (duration !== null) {
      const newStart = 0;
      setStartTimeState(newStart);
      setCurrentTime(newStart);
    }
  }, [duration]);

  // Enforce boundaries helper function
  const enforceBoundaries = useCallback((start: number) => {
    if (!duration) return start;

    let boundedStart = Math.max(0, start);
    const boundedEnd = boundedStart + windowDuration;

    // If the window would extend beyond duration, adjust start
    if (boundedEnd > duration) {
      boundedStart = Math.max(0, duration - windowDuration);
    }

    return boundedStart;
  }, [duration, windowDuration]);

  // Audio playback methods
  const setCurrentTime = useCallback((newTime: number) => {
    if (audioRef.current !== null) {
      audioRef.current.currentTime = newTime;
    }
    _setCurrentTime(newTime);
  }, []);

  const setPlaybackRate = useCallback((newRate: number) => {
    if (audioRef.current !== null) {
      audioRef.current.playbackRate = newRate;
    }
    _setPlaybackRate(newRate);
  }, []);

  const pause = useCallback(() => {
    if (audioRef.current !== null) {
      audioRef.current.pause();
    }
  }, []);

  // Viewport/zoom methods
  const setStartTime = useCallback((newStartTime: number) => {
    const boundedStart = enforceBoundaries(newStartTime);
    setStartTimeState(boundedStart);
  }, [enforceBoundaries]);

  // Auto-scroll effect (from original ZoomProvider)
  useEffect(() => {
    if (currentTime >= endTime && currentTime <= endTime + 0.1) {
      const newStartTime = endTime;
      const boundedStart = enforceBoundaries(newStartTime);
      setStartTimeState(boundedStart);
    } else if (currentTime > endTime + 0.1) {
      const newStartTime = endTime;
      const boundedStart = enforceBoundaries(newStartTime);
      setStartTimeState(boundedStart);
    } else if (currentTime < startTime - 0.1) {
      const newStartTime = startTime - windowDuration;
      const boundedStart = enforceBoundaries(newStartTime);
      setStartTimeState(boundedStart);
    }
  }, [currentTime, startTime, endTime, windowDuration, duration]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const isZoomed = windowDuration < (duration || 0);

  // Audio event handlers
  const onDurationChange = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    if (audioRef.current !== null) {
      if (audioRef.current.duration) {
        setDuration(audioRef.current.duration);
      }
    }
  };

  const onTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    if (audioRef.current !== null) {
      _setCurrentTime(audioRef.current.currentTime);
    }
  };

  const onRateChange = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    if (audioRef.current !== null) {
      if (audioRef.current.duration) {
        setPlaybackRate(audioRef.current.playbackRate);
      }
    }
  };

  // Memoize the context value so consumers don't re-render on every parent
  // render. Without this, every Session-tree render propagates a fresh value
  // into SpectrogramGraphics — the component that owns the worker render
  // effect — even when no spectrogram-relevant state has changed.
  const contextValue = useMemo(() => ({
    duration,
    currentTime,
    playbackRate,
    sampleRate,
    audioSamples,
    startTime,
    endTime,
    windowDuration,
    isZoomed,
    setDuration,
    setCurrentTime,
    setPlaybackRate,
    pause,
    setStartTime,
  }), [
    duration, currentTime, playbackRate, sampleRate, audioSamples,
    startTime, endTime, windowDuration, isZoomed,
    setCurrentTime, setPlaybackRate, pause, setStartTime,
  ]);

  return (
    <SpectrogramContext.Provider
      value={contextValue}
    >
      {children}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
          }}
        >
          <audio
            ref={audioRef}
            controls
            style={{
              width: "100%",
              height: "30px"
            }}
            onTimeUpdate={onTimeUpdate}
            onDurationChange={onDurationChange}
            onRateChange={onRateChange}
            controlsList="nodownload"
          >
            <source src={src} />
          </audio>
        </div>
      </div>
    </SpectrogramContext.Provider>
  );
}

export default SpectrogramProvider;
