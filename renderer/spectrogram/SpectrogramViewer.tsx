import React, { useRef } from "react";
import { useSpectrogram } from "./SpectrogramProvider";

function SpectrogramViewer(props: {
  dataURL: string;
  children: JSX.Element | JSX.Element[] | null;
}) {
  const { children, dataURL } = props;
  const playheadRef = useRef<SVGLineElement>(null);

  const { duration, currentTime, setCurrentTime, startTime, endTime, scroll, windowDuration, isLoading } = useSpectrogram();

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

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const deltaSeconds = (e.deltaY > 0 ? 1 : -1) * windowDuration * 0.1;
    scroll(deltaSeconds);
  };

  if (!duration) {
    return <svg width="100%" height={SPEC_HEIGHT} />;
  }

  // Actual loader
  if (isLoading) {
    return (
      <div style={{ height: SPEC_HEIGHT }} className="w-full flex items-center justify-center">
        <svg
          width="60"
          height="60"
          viewBox="0 0 50 50"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            cx="25"
            cy="25"
            r="20"
            stroke="#3B82F6"
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
            strokeDasharray="90 150"
            strokeDashoffset="0"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 25 25"
              to="360 25 25"
              dur="1s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="stroke-dashoffset"
              values="0;-240"
              dur="1.2s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      </div>
    );
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
      onWheel={onWheel}
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
