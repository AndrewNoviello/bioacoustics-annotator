import React, { useState, useMemo, useEffect } from "react";

export const SessionContext = React.createContext(null);

export function SessionProvider({ children }) {

  // Profile used for rendering in the ui, only getter is exposed
  const [activeProfile, setActiveProfile] = useState(null);

  // Data directory used for rendering in the ui, only getter is exposed
  const [activeDataDir, setActiveDataDir] = useState(null);

  // Whether the clap model is loaded
  const [clapLoaded, setClapLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);

  // Title of the page, used by the header for the ui
  const [pageTitle, setPageTitle] = useState("");

  // Function to run on the 'New Experiment' button click
  const [handleNewExperimentClick, setHandleNewExperimentClick] = useState(null);

  // Function to run on the 'Saved Experiments' button click
  const [handleSavedExperimentsClick, setHandleSavedExperimentsClick] = useState(null);

  /* ---------- load saved state on mount ---------- */
  useEffect(() => {
    const loadSavedState = async () => {
      try {
        const state = await window.electronAPI.getAppState();
        if (state.success) {
          if (state.dataDir) {
            setActiveDataDir(state.dataDir);
          }
          if (state.activeProfile && state.activeProfile !== "No Profile Selected") {
            setActiveProfile(state.activeProfile);
          }
        }
      } catch (err) {
        console.error('Error loading saved state:', err);
      }
    };

    loadSavedState();
  }, []);

  /* ---------- save state when it changes ---------- */
  const setDataDirectory = async (dataDir) => {
    try {
      const result = await window.electronAPI.setDataDirectory(dataDir);
      if (result.success) {
        setActiveDataDir(dataDir);
      }
    } catch (err) {
      console.error('Error setting data directory:', err);
    }
  }

  const setProfile = async (profile) => {
    try {
      const result = await window.electronAPI.setProfile(profile);
      if (result.success) {
        setActiveProfile(profile);
      }
    } catch (err) {
      console.error('Error setting profile:', err);
    }
  }

  /* ---------- memoised context value ---------- */
  const value = useMemo(
    () => ({
      /* data */
      activeProfile,
      activeDataDir,
      clapLoaded,
      selectedModel,
      pageTitle,
      handleNewExperimentClick,
      handleSavedExperimentsClick,

      /* setters */
      setProfile,
      setDataDirectory,
      setClapLoaded,
      setSelectedModel,
      setPageTitle,
      setHandleNewExperimentClick,
      setHandleSavedExperimentsClick,
    }),
    [
      activeProfile,
      activeDataDir,
      clapLoaded,
      selectedModel,
      pageTitle,
      handleNewExperimentClick,
      handleSavedExperimentsClick,
    ]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}