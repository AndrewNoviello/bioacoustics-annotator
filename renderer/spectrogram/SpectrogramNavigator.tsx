import React, { useRef, useState, useCallback, useEffect } from "react";
import { useSpectrogram } from "./SpectrogramProvider";

const SLIDER_HEIGHT = 5;

function SpectrogramNavigator() {
  const { duration, startTime, endTime, setStartTime, setCurrentTime, windowDuration, isLoading } = useSpectrogram();

  const svgRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sliderStartTime, setSliderStartTime] = useState(startTime);
  const [sliderEndTime, setSliderEndTime] = useState(endTime);

  useEffect(() => {
    if (!isDragging && !isLoading) {
      setSliderStartTime(startTime);
      setSliderEndTime(endTime);
    }
  }, [startTime, endTime, isDragging, isLoading]);

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
    return <svg width="100%" height={SLIDER_HEIGHT} />;
  }

  // Optimized calculations (only when needed)
  const startPercent = (sliderStartTime / duration) * 100;
  const endPercent = (sliderEndTime / duration) * 100;
  const activeWidth = endPercent - startPercent;

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={SLIDER_HEIGHT}
      viewBox="0 0 100 100"
      cursor={isDragging ? "grabbing" : "pointer"}
      preserveAspectRatio="none"
      onMouseDown={onMouseDown}
      onClick={onClick}
      style={{ backgroundColor: '#000000', userSelect: 'none' }}
      className="my-2"
    >
      {/* Background */}
      <rect
        x="0"
        y="0"
        width="100"
        height="100"
        fill="#9CA3AF"
        rx="0"
      />

      {/* Active section with optimized transitions */}
      <rect
        x={startPercent}
        y="0"
        width={activeWidth}
        height="100"
        fill="#3B82F6"
        rx="0"
        style={{
          transition: isDragging ? 'none' : 'x 0.15s ease-out, width 0.15s ease-out'
        }}
      />
    </svg>
  );
}

export default SpectrogramNavigator;
