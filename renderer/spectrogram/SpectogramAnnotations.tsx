import React, { useState, useRef, useCallback } from "react";
import { useSpectrogram } from "./SpectrogramProvider";

const DEFAULT_STROKE_WIDTH = 1;

// Default color for single-experiment mode
const DEFAULT_COLOR = {
  fill: "rgba(255, 165, 0, 0.3)",
  stroke: "rgba(255, 165, 0, 0.6)"
};

interface AnnotationData {
  id: string;
  interval: [number, number, string];
  detection: any;
  experimentId?: string;
  experimentColor?: {
    fill: string;
    stroke: string;
    name: string;
  };
}

interface SpectrogramAnnotationsProps {
  data: AnnotationData[];
  handleDetectionClick?: (detection: any) => void;
  activeDetection?: any;
  selectedExperiments?: string[];
  // Called with the final start/end time after the user finishes dragging
  // a left/right edge handle. The detection passed is the same shape as
  // what handleDetectionClick receives, so callers know which detection.
  onDetectionResize?: (detection: any, newStart: number, newEnd: number) => void;
}

// Fixed height per lane in viewBox units (spectrogram y is 0-100)
const LANE_HEIGHT = 8;

function SpectrogramAnnotations(props: SpectrogramAnnotationsProps) {
  const { data, handleDetectionClick, activeDetection, selectedExperiments = [], onDetectionResize } = props;
  const strokeWidth = DEFAULT_STROKE_WIDTH;

  const { startTime: zoomStartTime, endTime: zoomEndTime } = useSpectrogram();
  const displayRange = zoomEndTime - zoomStartTime;
  const svgStrokeWidth = 0.001 * strokeWidth * displayRange;

  // Active drag state: which edge is being dragged and the in-progress
  // start/end times. Held locally so the rect previews the new bounds before
  // commit; on mouseup we hand the final values off to onDetectionResize.
  const [drag, setDrag] = useState<{ edge: 'start' | 'end'; start: number; end: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  // Lane index for an annotation — selection order determines lane position
  // (index 0 = top). Falls back to lane 0 when the annotation has no source
  // experiment or selectedExperiments is empty.
  const getLaneIndex = (annotation: AnnotationData): number => {
    if (!annotation.experimentId || selectedExperiments.length === 0) {
      return 0;
    }
    const idx = selectedExperiments.indexOf(annotation.experimentId);
    return idx >= 0 ? idx : 0;
  };

  const getAnnotationColor = (annotation: AnnotationData) => {
    // Always honor the per-experiment color when it's been attached. The
    // color is pegged to the experiment in Session.jsx's experimentColorMap
    // (stable per experimentId across selections), so the same experiment
    // reads the same color regardless of how many others are selected.
    // DEFAULT_COLOR is only used for legacy annotations without an attached
    // experimentColor. Selection is indicated via stroke width and shadow,
    // not a separate highlight color.
    if (annotation.experimentColor) {
      return {
        fill: annotation.experimentColor.fill,
        stroke: annotation.experimentColor.stroke
      };
    }

    return DEFAULT_COLOR;
  };

  // Convert a clientX (px) to time (seconds) using the parent SVG's bounding
  // rect. The parent SVG uses a viewBox in seconds, so this maps px → s.
  const clientXToTime = useCallback((clientX: number, svgEl: SVGSVGElement): number => {
    const r = svgEl.getBoundingClientRect();
    const ratio = (clientX - r.left) / Math.max(1, r.width);
    return zoomStartTime + ratio * (zoomEndTime - zoomStartTime);
  }, [zoomStartTime, zoomEndTime]);

  const beginDrag = useCallback((
    e: React.MouseEvent<SVGRectElement, MouseEvent>,
    annotation: AnnotationData,
    edge: 'start' | 'end'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const svgEl = (e.target as SVGRectElement).ownerSVGElement;
    if (!svgEl) return;

    const initialStart = Number(annotation.interval[0]);
    const initialEnd = Number(annotation.interval[1]);
    setDrag({ edge, start: initialStart, end: initialEnd });

    const onMove = (ev: MouseEvent) => {
      const t = clientXToTime(ev.clientX, svgEl);
      setDrag(prev => {
        if (!prev) return prev;
        // Keep at least a small minimum width so the rect never inverts or
        // collapses to zero — 50ms is plenty narrow but still grabbable.
        const minWidth = 0.05;
        if (edge === 'start') {
          const clamped = Math.min(Math.max(0, t), prev.end - minWidth);
          return { ...prev, start: clamped };
        }
        const clamped = Math.max(t, prev.start + minWidth);
        return { ...prev, end: clamped };
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const finalDrag = dragRef.current;
      setDrag(null);
      if (finalDrag && onDetectionResize) {
        if (finalDrag.start !== initialStart || finalDrag.end !== initialEnd) {
          onDetectionResize(annotation.detection, finalDrag.start, finalDrag.end);
        }
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [clientXToTime, onDetectionResize]);

  // Sort annotations so active ones render on top
  const sortedData = [...data].sort((a, b) => {
    const aActive = a.id === activeDetection?.id ? 1 : 0;
    const bActive = b.id === activeDetection?.id ? 1 : 0;
    return aActive - bActive;
  });

  return (
    <g>
      {sortedData.map((annotation, index) => {
        const isActive = annotation.id === activeDetection?.id;
        // While dragging, the active rect uses the in-progress bounds so the
        // user sees a live preview before committing.
        const start = (isActive && drag) ? drag.start : Number(annotation.interval[0]);
        const stop = (isActive && drag) ? drag.end : Number(annotation.interval[1]);
        const width = stop - start;
        const color = getAnnotationColor(annotation);

        // Skip rendering if the rect is entirely outside the visible window.
        // SVG would otherwise emit a clientX hundreds of pixels off-screen,
        // confusing devtools and serving no visual purpose.
        if (stop < zoomStartTime || start > zoomEndTime) {
          return null;
        }

        // Always use the fixed-height lane layout — single-experiment mode
        // claims lane 0 (top) so the spectrogram canvas reserves the same
        // vertical real estate regardless of selection count.
        const laneIndex = getLaneIndex(annotation);
        const y = laneIndex * LANE_HEIGHT;
        const height = LANE_HEIGHT;
        // Edge handles: drawn in time-units, scaled to a thin visible band.
        const handleWidth = displayRange * 0.006;

        return (
          <g key={`annotation-${annotation.id}-${index}-${start}`}>
            <rect
              x={start}
              y={y}
              width={width}
              height={height}
              onClick={(e) => {
                e.stopPropagation();
                if (handleDetectionClick) {
                  handleDetectionClick(annotation.detection);
                }
              }}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={isActive ? svgStrokeWidth * 2 : svgStrokeWidth}
              style={{
                cursor: handleDetectionClick ? "pointer" : "default",
                filter: isActive ? `drop-shadow(0 0 4px ${color.stroke})` : "none",
                transition: drag ? "none" : "fill 0.15s ease, stroke 0.15s ease"
              }}
            />
            {isActive && onDetectionResize && (
              <>
                {/* Left edge drag handle — draggable to refine start_time */}
                <rect
                  x={start - handleWidth / 2}
                  y={y}
                  width={handleWidth}
                  height={height}
                  fill={color.stroke}
                  stroke="white"
                  strokeWidth={svgStrokeWidth * 0.5}
                  style={{ cursor: 'ew-resize' }}
                  onMouseDown={(e) => beginDrag(e, annotation, 'start')}
                />
                {/* Right edge drag handle — draggable to refine end_time */}
                <rect
                  x={stop - handleWidth / 2}
                  y={y}
                  width={handleWidth}
                  height={height}
                  fill={color.stroke}
                  stroke="white"
                  strokeWidth={svgStrokeWidth * 0.5}
                  style={{ cursor: 'ew-resize' }}
                  onMouseDown={(e) => beginDrag(e, annotation, 'end')}
                />
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

export default SpectrogramAnnotations;
