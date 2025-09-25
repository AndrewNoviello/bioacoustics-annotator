import { X, Trash2 } from 'lucide-react'
import React from 'react';

const SessionHistory = ({ setShowHistory, sessionData, activeExperiment, setActiveExperiment, handleDeleteExperiment }) => {
  return (
    <div className="w-80 bg-white p-4 h-[calc(100%-1rem)] overflow-y-auto z-10">
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

      <div className="space-y-2">
        {Object.keys(sessionData.experiments).length === 0 ? (
          <p className="text-gray-500 text-xs">No saved experiments yet</p>
        ) : (
          Object.entries(sessionData.experiments)
            .sort(([, a], [, b]) => {
              // Sort by time (most recent first)
              const timeA = new Date((a as any).time || (a as any).timestamp || 0).getTime()
              const timeB = new Date((b as any).time || (b as any).timestamp || 0).getTime()
              return timeB - timeA
            })
            .map(([experimentId, exp]: [string, any]) => (
              <div
                key={experimentId}
                className={`p-3 border rounded text-xs space-y-2 transition-colors relative ${activeExperiment === experimentId
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
              >
                <div
                  className="cursor-pointer"
                  onClick={() => setActiveExperiment(experimentId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-gray-900">{new Date(exp.time || exp.timestamp).toLocaleString()}</div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        θ={exp.theta || 0.5}
                      </span>
                      {experimentId !== 'temp' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteExperiment(experimentId)
                          }}
                          className="p-1 hover:bg-red-100 rounded text-red-600 hover:text-red-700 transition-colors"
                          title="Delete experiment"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-gray-600">
                    <div className="font-medium">Positive:</div>
                    <div className="text-gray-500 truncate">{exp.posPrompts || exp.positive_prompts || 'None'}</div>
                  </div>
                  <div className="text-gray-600">
                    <div className="font-medium">Negative:</div>
                    <div className="text-gray-500 truncate">{exp.negPrompts || exp.negative_prompts || 'None'}</div>
                  </div>
                  <div className="text-gray-600 mt-1">{`Saved: ${Object.values(exp.detections || {}).flat().length} detections in ${Object.keys(exp.detections || {}).length} files`}</div>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  )
}

export default SessionHistory;