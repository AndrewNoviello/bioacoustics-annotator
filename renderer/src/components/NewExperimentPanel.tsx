import { Play, Save, RotateCcw, X, Loader2, ChevronDown } from 'lucide-react'
import React from 'react';

const NewExperimentPanel = ({ showExperimentPanel, setShowExperimentPanel, setPositivePrompt, setNegativePrompt, setTheta, errorMessage, isRunningDetection, activeExperiment, handleRunDetection, handleSaveExperiment, wipeTemp, positivePrompt, negativePrompt, theta, setErrorMessage }) => {
  return (
    <div className="bg-white border-t border-gray-200">
      <div className="px-3 py-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">New Experiment</h3>
        <button
          onClick={() => setShowExperimentPanel(!showExperimentPanel)}
          className="p-1 hover:bg-gray-100 rounded text-xs"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pb-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-1">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Positive Prompts</label>
            <textarea
              value={positivePrompt}
              onChange={(e) => { setPositivePrompt(e.target.value); if (errorMessage) setErrorMessage('') }}
              placeholder="e.g., whale song; humpback vocalization; low frequency calls"
              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none text-xs"
              rows={2}
              disabled={isRunningDetection}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Negative Prompts</label>
            <textarea
              value={negativePrompt}
              onChange={(e) => { setNegativePrompt(e.target.value); if (errorMessage) setErrorMessage('') }}
              placeholder="e.g., background noise; boat engine; human activity"
              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none text-xs"
              rows={2}
              disabled={isRunningDetection}
            />
          </div>
        </div>

        <div className="mb-1">
          <label className="block text-xs font-medium text-gray-700 mb-0.5">Detection Threshold (θ = {theta})</label>
          <input
            type="range"
            min="0.1"
            max="0.9"
            step="0.1"
            value={theta}
            onChange={(e) => setTheta(parseFloat(e.target.value))}
            className="w-full"
            disabled={isRunningDetection}
          />
        </div>

        {errorMessage && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded">
            <p className="text-xs text-red-700">{errorMessage}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex flex-row items-center space-x-2">
            <button
              onClick={handleRunDetection}
              disabled={isRunningDetection}
              className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center space-x-1 text-xs font-medium"
            >
              {isRunningDetection ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              <span>{isRunningDetection ? 'Running Detection...' : 'Run Detection'}</span>
            </button>
            <button
              onClick={handleSaveExperiment}
              disabled={isRunningDetection || activeExperiment !== 'temp'}
              className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center space-x-1 text-xs font-medium"
            >
              <Save className="h-3 w-3" />
              <span>Save Experiment</span>
            </button>
            <button
              onClick={() => { setPositivePrompt(''); setNegativePrompt(''); setTheta(0.5) }}
              disabled={isRunningDetection}
              className="px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center space-x-1 text-xs font-medium"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Wipe Prompt</span>
            </button>
            <button
              onClick={wipeTemp}
              disabled={isRunningDetection}
              className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center space-x-1 text-xs font-medium"
            >
              <X className="h-3 w-3" />
              <span>Wipe Experiment</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

export default NewExperimentPanel;