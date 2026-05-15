import { useState } from 'react'
import { X, Trash2, Check, Eye } from 'lucide-react'
import React from 'react';

interface ExperimentColor {
  fill: string;
  stroke: string;
  name: string;
}

interface SessionHistoryProps {
  setShowHistory: (show: boolean) => void;
  sessionData: any;
  activeExperiment: string | null;
  setActiveExperiment: (id: string | null) => void;
  selectedExperiments: string[];
  toggleExperimentSelection: (id: string) => void;
  experimentColorMap: Record<string, ExperimentColor>;
  handleDeleteExperiment: (id: string) => void;
  maxExperiments: number;
}

const SessionHistory: React.FC<SessionHistoryProps> = ({
  setShowHistory,
  sessionData,
  activeExperiment,
  setActiveExperiment,
  selectedExperiments,
  toggleExperimentSelection,
  experimentColorMap,
  handleDeleteExperiment,
  maxExperiments
}) => {
  const isSelected = (expId: string) => selectedExperiments.includes(expId);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, experimentId: string) => {
    e.stopPropagation();
    if (confirmDeleteId === experimentId) {
      handleDeleteExperiment(experimentId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(experimentId);
    }
  };

  return (
    <div className="w-80 bg-white p-4 h-[calc(100%-1rem)] overflow-y-auto z-10 border-l border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Saved Experiments</h3>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setShowHistory(false)}
            className="p-1 hover:bg-gray-100 rounded text-xs font-medium"
          >
            <X className="h-3 w-3 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Multi-select info banner */}
      <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
        <div className="flex items-center gap-1.5 mb-1">
          <Eye className="h-3 w-3" />
          <span className="font-medium">Multi-Select Mode</span>
        </div>
        <p className="text-blue-600">
          Use checkboxes to overlay multiple experiments. Selected: {selectedExperiments.length}/{maxExperiments}
        </p>
      </div>

      <div className="space-y-2">
        {Object.keys(sessionData?.experiments || {}).length === 0 ? (
          <p className="text-gray-500 text-xs">No saved experiments yet</p>
        ) : (
          Object.entries(sessionData.experiments)
            .sort(([, a], [, b]) => {
              const timeA = new Date((a as any).time || (a as any).timestamp || 0).getTime()
              const timeB = new Date((b as any).time || (b as any).timestamp || 0).getTime()
              return timeB - timeA
            })
            .map(([experimentId, exp]: [string, any]) => {
              const selected = isSelected(experimentId);
              const colorInfo = experimentColorMap[experimentId];
              const isActive = activeExperiment === experimentId;
              const isPendingDelete = confirmDeleteId === experimentId;
              // Block selecting more than maxExperiments at once. Disabling
              // here gives visual feedback; the underlying toggle in
              // Session.jsx also no-ops past the cap as a defense in depth.
              const atCap = !selected && selectedExperiments.length >= maxExperiments;

              return (
                <div
                  key={experimentId}
                  className={`p-3 border rounded text-xs space-y-2 transition-all relative ${isActive
                      ? 'border-blue-500 bg-blue-50 shadow-sm'
                      : selected
                        ? 'border-gray-300 bg-gray-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                >
                  {/* Selection checkbox and color indicator */}
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (atCap) return;
                        toggleExperimentSelection(experimentId);
                      }}
                      disabled={atCap}
                      className={`flex items-center justify-center w-5 h-5 rounded border-2 transition-all ${selected
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : atCap
                            ? 'border-gray-200 opacity-40 cursor-not-allowed'
                            : 'border-gray-300 hover:border-blue-400'
                        }`}
                      title={
                        selected
                          ? 'Remove from overlay'
                          : atCap
                            ? `Max ${maxExperiments} experiments at a time — deselect one to add another`
                            : 'Add to overlay'
                      }
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </button>

                    {selected && colorInfo && (
                      <span
                        className="w-4 h-4 rounded border-2"
                        style={{
                          backgroundColor: colorInfo.fill,
                          borderColor: colorInfo.stroke
                        }}
                        title={`Color: ${colorInfo.name}`}
                      />
                    )}

                    <span className={`text-xs ${selected ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                      {selected ? (isActive ? 'Editing' : 'Visible') : 'Hidden'}
                    </span>
                  </div>

                  <div
                    className={atCap ? 'cursor-not-allowed' : 'cursor-pointer'}
                    onClick={() => {
                      if (atCap) return;
                      if (!selected) {
                        toggleExperimentSelection(experimentId);
                      }
                      setActiveExperiment(experimentId);
                      setConfirmDeleteId(null);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-gray-900">
                        {experimentId === 'temp' ? 'Temporary' : new Date(exp.time || exp.timestamp).toLocaleString()}
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          θ={exp.theta || 0.5}
                        </span>
                        {experimentId !== 'temp' && (
                          isPendingDelete ? (
                            <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={(e) => handleDeleteClick(e, experimentId)}
                                className="px-2 py-0.5 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                                className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => handleDeleteClick(e, experimentId)}
                              className="p-1 hover:bg-red-100 rounded text-red-600 hover:text-red-700 transition-colors"
                              title="Delete experiment"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    <div className="text-gray-600 mt-1">
                      <div className="font-medium">Positive:</div>
                      <div className="text-gray-500 truncate">{exp.posPrompts || exp.positive_prompts || 'None'}</div>
                    </div>
                    <div className="text-gray-600">
                      <div className="font-medium">Negative:</div>
                      <div className="text-gray-500 truncate">{exp.negPrompts || exp.negative_prompts || 'None'}</div>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <span className="text-gray-600">
                        {Object.values(exp.detections || {}).flat().length} detections
                      </span>
                      <span className="text-gray-400">
                        {Object.keys(exp.detections || {}).length} files
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  )
}

export default SessionHistory;
