import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";

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

  // Number of experiments currently overlaid in the spectrogram view (0 or 1 = no overlay)
  const [overlayCount, setOverlayCount] = useState(0);

  // List of profiles available under the active data directory. Owned by
  // context (not Header) so that any consumer — Header, CreateProfileModal,
  // future surfaces — sees a consistent, eagerly-refreshed list.
  const [profiles, setProfiles] = useState([]);
  // Generation counter for in-flight listProfiles calls so we can discard
  // late responses from a previous data dir / refresh cycle.
  const profilesRequestIdRef = useRef(0);

  /* ---------- load saved state on mount ---------- */
  useEffect(() => {
    const loadSavedState = async () => {
      try {
        const state = await window.electronAPI.getAppState();
        if (state.success) {
          if (state.dataDir) {
            setActiveDataDir(state.dataDir);
          }
          if (state.activeProfile) {
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
        // The server-side handler already cleared activeProfile (the old name
        // is meaningless under a new workspace); mirror that in renderer state
        // so downstream effects (loadSessions, loadProfiles) re-evaluate
        // against null instead of the stale value.
        setActiveProfile(null);
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

  // Re-fetch the profiles list for the active data dir. Tracks a request
  // generation so that if the data dir changes (or another refresh fires)
  // while a previous IPC is still in flight, the stale response is
  // discarded instead of overwriting fresh state.
  const refreshProfiles = useCallback(async () => {
    const requestId = ++profilesRequestIdRef.current;
    if (!activeDataDir) {
      if (profilesRequestIdRef.current === requestId) setProfiles([]);
      return [];
    }
    try {
      const res = await window.electronAPI.listProfiles();
      if (profilesRequestIdRef.current !== requestId) return [];
      const list = res?.success ? (res.dirs || []) : [];
      setProfiles(list);
      // If the active profile no longer exists in the workspace, clear it
      // (both client + server). Covers: stale electron-store entries on
      // launch, profile dirs deleted externally, and any other path that
      // could leave us pointing at a non-existent profile.
      if (activeProfile && !list.includes(activeProfile)) {
        try {
          await window.electronAPI.setProfile(null);
        } catch (err) {
          console.error('Error clearing stale activeProfile:', err);
        }
        setActiveProfile(null);
      }
      return list;
    } catch (err) {
      console.error('Error listing profiles:', err);
      if (profilesRequestIdRef.current === requestId) setProfiles([]);
      return [];
    }
  }, [activeDataDir, activeProfile]);

  // Re-fetch whenever the data dir changes (and on mount after the saved
  // state hydrates). The stale-profile clear inside refreshProfiles makes
  // this the single recovery point for activeProfile validity.
  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

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
      overlayCount,
      profiles,

      /* setters */
      setProfile,
      setDataDirectory,
      setClapLoaded,
      setSelectedModel,
      setPageTitle,
      setHandleNewExperimentClick,
      setHandleSavedExperimentsClick,
      setOverlayCount,
      refreshProfiles,
    }),
    [
      activeProfile,
      activeDataDir,
      clapLoaded,
      selectedModel,
      pageTitle,
      handleNewExperimentClick,
      handleSavedExperimentsClick,
      overlayCount,
      profiles,
      refreshProfiles,
    ]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}