import React, { useRef } from "react";
import { useSpectrogram } from "./SpectrogramProvider";

function SpectrogramViewer(props: {
  dataURL: string;
  children: JSX.Element | JSX.Element[] | null;
}) {
  const { children, dataURL } = props;
  const playheadRef = useRef<SVGLineElement>(null);

  const { duration, currentTime, setCurrentTime, startTime, endTime, windowDuration } = useSpectrogram();

  const SPEC_HEIGHT = 300;


  const svgRef = useRef<SVGSVGElement>(null);

  const onClick = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const boundingClientRect = svgRef.current?.getBoundingClientRect();
    if (boundingClientRect && duration) {
      const { left, right } = boundingClientRect;
      let newTime =
        startTime +
        ((endTime - startTime) * (e.clientX - left)) / (right - left);
      if (newTime < 0) {
        newTime = 0;
      }
      if (newTime > duration) {
        newTime = duration;
      }
      setCurrentTime(newTime);
    }
  };

  if (!duration) {
    return <svg width="100%" height={SPEC_HEIGHT} />;
  }

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={SPEC_HEIGHT}
      viewBox={`${startTime},0,${endTime - startTime},100`}
      cursor="pointer"
      preserveAspectRatio="none"
      onClick={onClick}
    >
      <image
        width={windowDuration}
        height={100}
        x={startTime}
        y={0}
        href={dataURL}
        preserveAspectRatio="none"
        pointerEvents="none"
      />

      <line
        ref={playheadRef}
        stroke="red"
        strokeWidth={0.05}
        x1={currentTime}
        x2={currentTime}
        y1={0}
        y2={100}
      />
      {children}
    </svg>
  )
}

export default SpectrogramViewer;
