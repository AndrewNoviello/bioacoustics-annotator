import React, { useEffect } from "react";
import { useSpectrogram } from "./SpectrogramProvider";

const DEFAULT_STROKE_WIDTH = 1;

function SpectrogramAnnotations(props) {
  const { data, handleDetectionClick, activeDetection } = props;
  const strokeWidth = DEFAULT_STROKE_WIDTH;

  const { startTime: zoomStartTime, endTime: zoomEndTime } = useSpectrogram();
  const displayRange = zoomEndTime - zoomStartTime;
  const svgStrokeWidth = 0.001 * strokeWidth * displayRange;

  // Return SVG elements that can be embedded in parent SVG
  return (
    <g>
      {data.map((annotation, index) => {
        const start = Number(annotation.interval[0]);
        const stop = Number(annotation.interval[1]);
        const width = stop - start;
        const isActive = annotation.id === activeDetection?.id;
        return (
          <rect
            key={`annotation-${index}-${start}`}
            x={start}
            onClick={(e) => {
              e.stopPropagation();
              handleDetectionClick(annotation.detection);
            }}
            y={0}
            width={width}
            height={100} // Use full height of the parent SVG viewBox
            fill={isActive ? "rgba(59, 130, 246, 0.4)" : "rgba(255, 165, 0, 0.3)"}
            stroke={isActive ? "rgba(59, 130, 246, 0.8)" : "rgba(255, 165, 0, 0.6)"}
            strokeWidth={isActive ? svgStrokeWidth * 2 : svgStrokeWidth}
            style={{
              filter: isActive ? "drop-shadow(0 0 4px rgba(59, 130, 246, 0.6))" : "none"
            }}
          />
        );
      })}
    </g>
  );
}

export default SpectrogramAnnotations;
