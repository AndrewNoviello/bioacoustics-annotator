import React from "react";
import SpectrogramGraphics from "./SpectrogramGraphics";
import SpectrogramProvider from "./SpectrogramProvider";
import SpectrogramNavigator from "./SpectrogramNavigator";
import { useSettings } from "../src/stores/SettingsContext";

interface SpectrogramPlayerProps {
  fileId?: string;
  src: string;
  sampleRate?: number;
  annotations?: any[];
  handleDetectionClick?: (detection: any) => void;
  activeDetection?: any;
}

const SpectrogramPlayer = (props: SpectrogramPlayerProps) => {

  const { settings } = useSettings() as any;

  const {
    src,
    sampleRate = settings?.sampleRate ?? 16000,
    annotations = [],
    handleDetectionClick = null,
    activeDetection = null,
  } = props;

  return (
    <div style={{ width: "100%" }}>
      <SpectrogramProvider
        src={src}
        sampleRate={sampleRate}
      >
        <SpectrogramGraphics
          fileId={props.fileId ?? props.src}
          annotations={annotations}
          activeDetection={activeDetection}
          handleDetectionClick={handleDetectionClick ?? undefined}
        />
        <SpectrogramNavigator />
      </SpectrogramProvider>
    </div>
  );
};

export default SpectrogramPlayer;
