import { useEffect } from "react";
import SpectrogramGraphics from "./SpectrogramGraphics";
import SpectrogramProvider, { useSpectrogram } from "./SpectrogramProvider";
import SpectrogramNavigator from "./SpectrogramNavigator";

export interface NavRequest {
  filePath: string;
  seekTime: number;
  detectionStart: number;
  detectionEnd: number;
  seq: number;
}

interface SpectrogramPlayerProps {
  fileId?: string;
  src: string;
  annotations?: any[];
  handleDetectionClick?: (detection: any) => void;
  activeDetection?: any;
  selectedExperiments?: string[];
  maxLanes?: number;
  onDetectionResize?: (detection: any, newStart: number, newEnd: number) => void;
  onTimeUpdate?: (time: number) => void;
  navRequest?: NavRequest | null;
}

// Bridges the per-provider currentTime out to a parent callback. Lives inside
// SpectrogramProvider so it can read the context; effect is keyed on
// currentTime so the callback fires for every playhead change (including the
// initial mount with currentTime=0). Consumers that need to distinguish user
// interaction from the mount fire should gate on `time > 0` themselves.
const TimeUpdateBridge = ({
  onTimeUpdate,
}: {
  onTimeUpdate?: (t: number) => void;
}) => {
  const { currentTime } = useSpectrogram();
  useEffect(() => {
    if (onTimeUpdate) onTimeUpdate(currentTime);
  }, [currentTime, onTimeUpdate]);
  return <></>;
};

// Reacts to a Session-level navigation request: re-centers the viewport on the
// detection, seeks the playhead to its start, and pauses. Gated on
// `duration != null` so it runs after the provider's duration-init effect
// (which resets startTime/currentTime to 0). Effect key uses `seq` so
// consecutive same-file navigations re-fire.
const NavigationBridge = ({
  navRequest,
  fileId,
}: {
  navRequest?: NavRequest | null;
  fileId?: string;
}) => {
  const { duration, windowDuration, setStartTime, setCurrentTime, pause } = useSpectrogram();
  useEffect(() => {
    if (!navRequest || navRequest.filePath !== fileId || duration == null) return;
    const mid = (navRequest.detectionStart + navRequest.detectionEnd) / 2;
    setStartTime(mid - windowDuration / 2);
    setCurrentTime(navRequest.seekTime);
    pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.seq, fileId, duration]);
  return <></>;
};

const SpectrogramPlayer = (props: SpectrogramPlayerProps) => {
  const {
    src,
    annotations = [],
    handleDetectionClick = null,
    activeDetection = null,
    selectedExperiments = [],
    maxLanes = 3,
    onDetectionResize,
    onTimeUpdate,
    navRequest,
  } = props;
  const fileId = props.fileId ?? props.src;

  return (
    <div style={{ width: "100%" }}>
      <SpectrogramProvider src={src}>
        <SpectrogramGraphics
          fileId={fileId}
          annotations={annotations}
          activeDetection={activeDetection}
          handleDetectionClick={handleDetectionClick ?? undefined}
          selectedExperiments={selectedExperiments}
          onDetectionResize={onDetectionResize}
        />
        <SpectrogramNavigator
          annotations={annotations}
          selectedExperiments={selectedExperiments}
          maxLanes={maxLanes}
        />
        <TimeUpdateBridge onTimeUpdate={onTimeUpdate} />
        <NavigationBridge navRequest={navRequest} fileId={fileId} />
      </SpectrogramProvider>
    </div>
  );
};

export default SpectrogramPlayer;
