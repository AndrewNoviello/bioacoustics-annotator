import React, {
  createContext,
  useState,
  useEffect,
  useRef,
  useContext,
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
  isLoading: boolean;

  // Audio playback methods
  setDuration: Dispatch<SetStateAction<number | null>>;
  setCurrentTime: (newTime: number) => void;
  setPlaybackRate: (newRate: number) => void;
  pause: () => void;

  // Viewport/zoom methods
  setStartTime: (newStartTime: number) => void;
  scroll: (deltaSeconds: number) => void;
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
  isLoading: false,


  // Viewport/zoom methods
  setStartTime: () => { },
  scroll: () => { },
});

export function useSpectrogram() {
  return useContext(SpectrogramContext);
}

export type SpectrogramProviderProps = {
  children: JSX.Element | JSX.Element[];
  src: string;
  sampleRate: number;
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
  const [isLoading, setIsLoading] = useState(false);

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
    const fetchAudioData = async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const view = new DataView(arrayBuffer);
        const sampleRateFetch = view.getUint32(24, true); // little-endian

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const samples = audioBuffer.getChannelData(0);

        setAudioSamples(samples);
        setSampleRate(sampleRateFetch);
      } catch (error) {
        console.error('Error loading audio:', error);
      }
    };

    fetchAudioData();
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
  const enforceBoundaries = (start: number) => {
    if (!duration) return start;

    let boundedStart = Math.max(0, start);
    const boundedEnd = boundedStart + windowDuration;

    // If the window would extend beyond duration, adjust start
    if (boundedEnd > duration) {
      boundedStart = Math.max(0, duration - windowDuration);
    }

    return boundedStart;
  };

  // Audio playback methods
  const setCurrentTime = (newTime: number) => {
    if (audioRef.current !== null) {
      audioRef.current.currentTime = newTime;
    }
    _setCurrentTime(newTime);
  };

  const setPlaybackRate = (newRate: number) => {
    if (audioRef.current !== null) {
      audioRef.current.playbackRate = newRate;
    }
    _setPlaybackRate(newRate);
  };

  const pause = () => {
    if (audioRef.current !== null) {
      audioRef.current.pause();
    }
  };

  // Viewport/zoom methods
  const setStartTime = (newStartTime: number) => {
    const boundedStart = enforceBoundaries(newStartTime);
    setStartTimeState(boundedStart);
  };

  const scroll = (deltaSeconds: number) => {
    const newStartTime = startTime + deltaSeconds;
    const boundedStart = enforceBoundaries(newStartTime);
    setStartTimeState(boundedStart);
  };

  // Auto-scroll effect (from original ZoomProvider)
  useEffect(() => {
    // Don't auto-scroll during loading to avoid interfering with user interaction
    if (isLoading) return;

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
  }, [currentTime, startTime, endTime, windowDuration, duration, isLoading]);

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

  return (
    <SpectrogramContext.Provider
      value={{
        // Audio playback state
        duration,
        currentTime,
        playbackRate,
        sampleRate,
        audioSamples,

        // Viewport/zoom state
        startTime,
        endTime,
        windowDuration,
        isZoomed,
        isLoading,

        // Audio playback methods
        setDuration,
        setCurrentTime,
        setPlaybackRate,
        pause,

        // Viewport/zoom methods
        setStartTime,
        scroll,
      }}
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
