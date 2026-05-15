import React, { useRef, useState, useCallback, useEffect } from "react";
import { useSpectrogram } from "./SpectrogramProvider";

// Total clickable area in pixels. The visible bar is rendered at the bottom of
// this area, leaving the upper portion as a transparent hit zone so the user
// can grab/scrub anywhere on the strip without needing pixel-perfect aim.
const NAV_HEIGHT = 28;
const BAR_HEIGHT_PERCENT = 50; // visible bar occupies bottom 50% of viewBox

interface NavigatorAnnotation {
  id?: string | number;
  interval: [number, number, string?];
  experimentId?: string;
  experimentColor?: {
    fill: string;
    stroke: string;
    name?: string;
  };
}

interface SpectrogramNavigatorProps {
  annotations?: NavigatorAnnotation[];
  // Lane y/height for each marker is computed from selectedExperiments
  // (selection order = lane order, with index 0 at the top). maxLanes pins
  // the lane height to a fixed slice of the marker area regardless of how
  // many experiments are currently selected — empty slots are left empty.
  selectedExperiments?: string[];
  maxLanes?: number;
}

function SpectrogramNavigator({
  annotations = [],
  selectedExperiments = [],
  maxLanes = 3,
}: SpectrogramNavigatorProps) {
  const { duration, startTime, endTime, setStartTime, setCurrentTime, windowDuration } = useSpectrogram();

  const svgRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sliderStartTime, setSliderStartTime] = useState(startTime);
  const [sliderEndTime, setSliderEndTime] = useState(endTime);

  useEffect(() => {
    if (!isDragging) {
      setSliderStartTime(startTime);
      setSliderEndTime(endTime);
    }
  }, [startTime, endTime, isDragging]);

  // Optimized: Single calculation function with no side effects
  const getTimeFromPosition = useCallback((clientX: number): number => {
    const boundingClientRect = svgRef.current?.getBoundingClientRect();
    if (boundingClientRect && duration) {
      const { left, right } = boundingClientRect;
      let newTime = (duration * (clientX - left)) / (right - left);
      if (newTime < 0) newTime = 0;
      if (newTime > duration) newTime = duration;
      return newTime;
    }
    return 0;
  }, [duration]);

  // Fast: Only visual slider update (immediate feedback)
  const updateSliderVisual = useCallback((clientX: number) => {
    const newTime = getTimeFromPosition(clientX);
    const newStartTime = newTime - windowDuration / 2;
    const newEndTime = newTime + windowDuration / 2;
    setSliderStartTime(newStartTime);
    setSliderEndTime(newEndTime);
  }, [getTimeFromPosition, windowDuration]);

  // Full: Complete update with playback position (expensive)
  const updateComplete = useCallback((clientX: number) => {
    const newTime = getTimeFromPosition(clientX);
    const newStartTime = newTime - windowDuration / 2;
    setStartTime(newStartTime);
    setCurrentTime(newTime);
  }, [getTimeFromPosition, setStartTime, setCurrentTime, windowDuration]);

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    setIsDragging(true);

    // Initial positioning (complete update)
    updateComplete(e.clientX);

    const handleMove = (e: MouseEvent) => {
      // During drag: ONLY visual updates (60+ fps smooth)
      updateSliderVisual(e.clientX);
      e.preventDefault();
    };

    const handleUp = (e: MouseEvent) => {
      setIsDragging(false);

      // Final positioning: Complete update with playback (once)
      updateComplete(e.clientX);

      // Cleanup
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    // Immediate listener attachment
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);

    e.preventDefault();
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!isDragging) {
      // Click: Complete update (not frequent)
      updateComplete(e.clientX);
    }
  };

  // Early return for loading state
  if (!duration) {
    return <svg width="100%" height={NAV_HEIGHT} />;
  }

  // Optimized calculations (only when needed)
  const startPercent = (sliderStartTime / duration) * 100;
  const endPercent = (sliderEndTime / duration) * 100;
  const activeWidth = endPercent - startPercent;

  // Vertical layout in viewBox units (0..100): track at the bottom, detection
  // markers stacked above it, transparent hit zone fills the rest.
  const barY = 100 - BAR_HEIGHT_PERCENT;
  const markerHeight = 30;
  const markerY = barY - markerHeight - 2;

  // Grip handle width in viewBox units. Kept narrow so the handle reads as a
  // tab on the active-window border without obscuring the underlying time.
  const gripWidth = 0.6;
  // Clamp the grip to stay inside [0, 100] visually even if the active window
  // sits flush against the edge of the strip.
  const leftGripX = Math.max(0, startPercent - gripWidth / 2);
  const rightGripX = Math.min(100 - gripWidth, startPercent + activeWidth - gripWidth / 2);

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={NAV_HEIGHT}
      viewBox="0 0 100 100"
      cursor={isDragging ? "grabbing" : "pointer"}
      preserveAspectRatio="none"
      onMouseDown={onMouseDown}
      onClick={onClick}
      style={{ userSelect: 'none' }}
      className="my-2"
    >
      {/* Transparent hit area covering the full SVG so clicks/drags anywhere
          on the navigator strip register, not just on the thin visible bar. */}
      <rect x="0" y="0" width="100" height="100" fill="transparent" />

      {/* Detection markers: a thin tick per detection at its position in the
          full file. Color-coded by source experiment when present so the
          navigator reads as a faithful mini-map of the main-view overlays;
          falls back to a neutral orange for single-experiment mode.

          In multi-experiment mode with 2+ experiments selected, markers are
          stacked into one horizontal lane per experiment so detections that
          coincide in time don't paint over each other. Lane ordering matches
          the main view's SpectogramAnnotations.tsx exactly via
          selectedExperiments.indexOf(...). */}
      {annotations && annotations.length > 0 && annotations.map((annotation, i) => {
        const start = Number(annotation.interval?.[0] ?? 0);
        const end = Number(annotation.interval?.[1] ?? start);
        if (!isFinite(start) || start < 0 || start > duration) return null;
        const x = (start / duration) * 100;
        const width = Math.max(0.3, ((end - start) / duration) * 100);
        const markerFill = annotation.experimentColor?.stroke ?? "#F97316";

        // Fixed-height lane: each selected experiment claims one slot out of
        // maxLanes regardless of how many are currently selected. Lane
        // position is by selection order (index 0 at the top), matching the
        // main view's SpectogramAnnotations.tsx layout. Markers without a
        // selectable experimentId fall back to the full-height bar.
        const laneIndex = annotation.experimentId
          ? selectedExperiments.indexOf(annotation.experimentId)
          : -1;
        const useLanes = laneIndex >= 0 && maxLanes > 0;
        const rectHeight = useLanes ? markerHeight / maxLanes : markerHeight;
        const rectY = useLanes ? markerY + laneIndex * rectHeight : markerY;

        return (
          <rect
            key={`nav-marker-${annotation.id ?? i}-${i}`}
            x={x}
            y={rectY}
            width={width}
            height={rectHeight}
            fill={markerFill}
            opacity={0.85}
          />
        );
      })}

      {/* Track: recessed light-gray channel that the active window sits in. */}
      <rect
        x="0"
        y={barY}
        width="100"
        height={BAR_HEIGHT_PERCENT}
        fill="#E5E7EB"
        stroke="#D1D5DB"
        strokeWidth={0.6}
      />

      {/* Active window: translucent blue with a stronger border so the user
          can read both the position (filled region) and the precise bounds
          (border). Drag state thickens the border and adds a soft shadow so
          it visibly lifts off the track. */}
      <rect
        x={startPercent}
        y={barY}
        width={activeWidth}
        height={BAR_HEIGHT_PERCENT}
        fill={isDragging ? 'rgba(59, 130, 246, 0.38)' : 'rgba(59, 130, 246, 0.28)'}
        stroke="#3B82F6"
        strokeWidth={isDragging ? 2.4 : 1.5}
        style={{
          filter: isDragging ? 'drop-shadow(0 1px 2px rgba(59,130,246,0.55))' : 'none',
          transition: isDragging ? 'none' : 'x 0.15s ease-out, width 0.15s ease-out, stroke-width 0.15s ease-out, fill 0.15s ease-out'
        }}
      />

      {/* Edge grip handles: thin solid-blue tabs at the left and right edges
          of the active window to hint that it's draggable. Pointer-events
          disabled so they don't intercept the outer onMouseDown handler that
          does the scrub. */}
      {activeWidth > gripWidth * 1.5 && (
        <>
          <rect
            x={leftGripX}
            y={barY + 2}
            width={gripWidth}
            height={BAR_HEIGHT_PERCENT - 4}
            fill="#3B82F6"
            style={{ pointerEvents: 'none' }}
          />
          <rect
            x={rightGripX}
            y={barY + 2}
            width={gripWidth}
            height={BAR_HEIGHT_PERCENT - 4}
            fill="#3B82F6"
            style={{ pointerEvents: 'none' }}
          />
        </>
      )}
    </svg>
  );
}

export default SpectrogramNavigator;
