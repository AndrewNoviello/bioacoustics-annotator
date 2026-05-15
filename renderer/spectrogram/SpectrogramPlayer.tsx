import { useEffect } from "react";
import SpectrogramGraphics from "./SpectrogramGraphics";
import SpectrogramProvider, { useSpectrogram } from "./SpectrogramProvider";
import SpectrogramNavigator from "./SpectrogramNavigator";

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
  } = props;

  return (
    <div style={{ width: "100%" }}>
      <SpectrogramProvider src={src}>
        <SpectrogramGraphics
          fileId={props.fileId ?? props.src}
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
      </SpectrogramProvider>
    </div>
  );
};

export default SpectrogramPlayer;
