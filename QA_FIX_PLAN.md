# CLAP Desktop — Fix Plan

A prioritized roadmap derived from [QA_REPORT.md](QA_REPORT.md). Items are batched into milestones so they can ship without coupling unrelated work. Each item lists the bug IDs it resolves, the files to touch, and the specific change.

---

## Milestone 1 — Unblock the broken annotation flow (1–2 hours)

The single most important fix. Without this, new users can't annotate without learning the undocumented "save first" workaround.

### M1.1 — Make detection annotation work for the temp experiment (B-1, B-17 partial)
**Files**: [renderer/src/components/Session.jsx](renderer/src/components/Session.jsx) (lines 619-643).

**Change**: Reorder the right-panel render. `activeDetection` should take priority over the "show new experiment form" branch:

```jsx
const renderExperimentPanel = () => {
  // 1. If a detection is selected, show the annotation panel
  //    regardless of whether the active experiment is temp or saved
  if (activeDetection) {
    return /* existing DetectionAnnotation JSX */
  }
  // 2. Otherwise show the new-experiment form for temp/null
  if (activeExperiment === 'temp' || activeExperiment === null) {
    return /* existing NewExperimentPanel JSX */
  }
  // 3. Saved experiment with no detection selected: show ExperimentDetails
  return /* existing 'Click on any detection' panel */
}
```

This single edit unblocks B-1. Verify by: run detection, click rectangle, confirm panel shows file/time/species dropdown.

### M1.2 — Fix the persistent "Please load a model first" message (B-8)
**Files**: [renderer/src/components/Session.jsx](renderer/src/components/Session.jsx) Python-message listener, or pass `clapLoaded` into NewExperimentPanel and clear local errorMessage on the transition false→true.

Simplest fix: a `useEffect([clapLoaded])` in Session.jsx that clears `errorMessage` when `clapLoaded` becomes true.

---

## Milestone 2 — Make the renderer survive page reload (2-3 hours)

After this, the user can refresh the page without losing app state visually.

### M2.1 — Get CLAP-loaded state from the source of truth (B-3, B-7)
**Files**: [electron-main.js](electron-main.js), [preload.js](preload.js), [ml/main.py](ml/main.py), [renderer/src/App.jsx](renderer/src/App.jsx).

Two options:
- **(a) Renderer asks main; main caches Python state.** Add `appState.modelLoaded` and `appState.currentModel`; update them in the `model_loading_completed` handler in electron-main; expose via `getAppState` (already returns dataDir + activeProfile, just append). Renderer reads in App.jsx on mount.
- **(b) Python emits a `model_state` event on backend connect.** Requires a tiny addition to `ml/main.py` to emit `{type: 'model_state', data: {model_loaded, model_name}}` once on startup, and the renderer subscribes.

**Recommend (a)** — fewer moving parts, doesn't require Python restart for the renderer to know what's loaded.

Also: **delete the broken `loadClapState` in App.jsx** that calls `window.electronAPI.getState()`. That code is dead and emits a misleading console error.

### M2.2 — Remove the package.json ESM warning (B-10)
**Files**: [package.json](package.json).

Add `"type": "module"` (electron-main.js is already ESM via `import`). One-line fix that eliminates the cold-start performance penalty and the console warning.

### M2.3 — Silence React Router v7 future flag warnings (B-11)
**Files**: [renderer/src/App.jsx](renderer/src/App.jsx).

```jsx
<Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
```

---

## Milestone 3 — Make detection rectangles useful (2-3 hours)

The visual annotation layer needs to convey "where" in both time and (eventually) frequency.

### M3.1 — Full-height rectangles in single-experiment mode (B-4, B-5)
**Files**: [renderer/spectrogram/SpectogramAnnotations.tsx](renderer/spectrogram/SpectogramAnnotations.tsx) lines 49-72, 90-93.

Distinguish single vs multi:
- Single-experiment: rect spans full vertical (`y=0, height=100`), `DEFAULT_COLOR` (orange) wins
- Multi-experiment: keep the existing top-stack lane layout

Practical implementation:
```ts
const height = multiExperiment ? LANE_HEIGHT : 100;
const y = multiExperiment ? laneIndex * LANE_HEIGHT : 0;
const color = isActive
  ? ACTIVE_COLOR
  : (multiExperiment && annotation.experimentColor) ? annotation.experimentColor : DEFAULT_COLOR;
```

And in [Session.jsx:514-518](renderer/src/components/Session.jsx#L514-L518), only attach `experimentColor` when `selectedExperiments.length > 1`, so the annotations component's "fallback to default" actually fires.

### M3.2 — Indicate detections outside the visible window (B-6)
**Files**: [renderer/spectrogram/SpectogramAnnotations.tsx](renderer/spectrogram/SpectogramAnnotations.tsx), [renderer/spectrogram/SpectrogramNavigator.tsx](renderer/spectrogram/SpectrogramNavigator.tsx).

Two complementary changes:
1. Filter out off-screen rects in the annotations layer (skip rendering if `end < startTime` or `start > endTime`).
2. Tag the navigator slider with little markers for each detection's position in the overall file, so the user can scrub to it. Compute against `duration`, not the window.

### M3.3 — Larger navigator hit area (B-25)
**Files**: [renderer/spectrogram/SpectrogramNavigator.tsx](renderer/spectrogram/SpectrogramNavigator.tsx).

Wrap the visible 5px slider in a 16-20px transparent container that captures clicks/drag. CSS-only fix.

---

## Milestone 4 — Validate settings before they break things (2 hours)

### M4.1 — Range and cross-field validation in SettingsModal (B-2, B-9, B-28)
**Files**: [renderer/src/components/SettingsModal.jsx](renderer/src/components/SettingsModal.jsx).

Before calling `updateSettings`, validate:
- `n_fft` is a power of 2, ≥ 128, ≤ 8192
- `win_length` ≤ `n_fft`
- `hop_length` > 0 and < `win_length`
- `f_min` ≥ 0
- `f_max` ≤ sampleRate / 2 (Nyquist)
- `n_mels`, `top_db`, `windowDuration` within their min/max attributes

Show inline errors below each field, disable Save until all green. Apply the same `value` clamping logic for spinbuttons on blur (paste/typed values).

### M4.2 — Surface WASM errors to the user (B-2)
**Files**: [renderer/spectrogram/worker/spectrogramWorker.ts](renderer/spectrogram/worker/spectrogramWorker.ts), [renderer/spectrogram/SpectrogramGraphics.tsx](renderer/spectrogram/SpectrogramGraphics.tsx).

In the worker's catch around `mel_spectrogram_db`, post an `error` message back to the parent thread with a friendly description; the component should render an inline error block (red banner over the spectrogram area) instead of going blank.

### M4.3 — Decide on the sample-rate setting (B-27)
**Files**: [renderer/src/components/SettingsModal.jsx](renderer/src/components/SettingsModal.jsx) lines 73-84, [renderer/src/stores/SettingsContext.jsx](renderer/src/stores/SettingsContext.jsx) line 8.

The spectrogram already pulls sample rate from the WAV header, so the setting is unused. Either remove `sampleRate` from defaults entirely, or wire it up as "force resample to this rate" before WASM (rare use case; probably remove).

---

## Milestone 5 — Tighten validation gates and IPC contracts (3-4 hours)

### M5.1 — Frontend input validation on submit AND change (B-13)
**Files**: [renderer/src/components/CreateProfileModal.jsx](renderer/src/components/CreateProfileModal.jsx), [renderer/src/components/CreateSessionModal.jsx](renderer/src/components/CreateSessionModal.jsx).

Run the invalid-character regex in an `onChange`. Show the red error message and disable the Create button as soon as the input contains a banned char.

### M5.2 — Disable entry-point buttons when prerequisites are missing (B-12)
**Files**: [renderer/src/components/MainPage.jsx](renderer/src/components/MainPage.jsx) line 104.

```jsx
<button
  onClick={() => setShowCreateModal(true)}
  disabled={!activeDataDir || !activeProfile}
  className="...disabled:opacity-50 disabled:cursor-not-allowed"
  title={!activeDataDir ? 'Select a data directory first' : !activeProfile ? 'Select a profile first' : ''}
>
  Create Session
</button>
```

### M5.3 — Validate session creation at the IPC layer (B-14, B-15, B-21)
**Files**: [main/sessions.js:8-15](main/sessions.js#L8-L15).

```js
if (!state.dataDir || !state.activeProfile) {
  return { success: false, error: 'Missing dataDir or profile' }
}
const trimmedName = (sessionName || '').trim()
const finalName = trimmedName || new Date().toISOString()  // auto-name on empty
if (!Array.isArray(files) || files.length === 0) {
  return { success: false, error: 'A session must include at least one audio file' }
}
if (files.length > 500) {
  return { success: false, error: 'Too many files (max 500). Split into multiple sessions.' }
}
```

### M5.4 — Validate theta server-side with feedback (B-19)
**Files**: [main/detection.js](main/detection.js) (renderer-facing IPC) and/or [ml/main.py:92-99](ml/main.py#L92-L99).

If theta is out of [0,1], return `{success: false, error: 'theta must be between 0 and 1'}` rather than silently clamping. The renderer's slider already constrains to 0.1-0.9, but the API contract should be defensive.

### M5.5 — Cancel detection should say if there's nothing to cancel (B-20)
**Files**: [electron-main.js:281-291](electron-main.js#L281-L291).

```js
if (!pythonProcess || !pythonProcess.stdin) {
  return { success: false, error: 'No active backend process' }
}
const isDetectionRunning = /* track this in state */
if (!isDetectionRunning) {
  return { success: false, error: 'No detection currently running' }
}
```

### M5.6 — Remove dead path-normalization code (B-16)
**Files**: [main/sessions.js:17-22](main/sessions.js#L17-L22).

Replace the conditional resolve with a simple `path.isAbsolute(f) ? f : null` and reject the whole call if any file is not absolute. This matches what the modal actually sends and removes confusing dead branches.

---

## Milestone 6 — UX polish (2-3 hours)

### M6.1 — Next-button end-of-list feedback (B-18)
**Files**: [renderer/src/components/Session.jsx:795-801](renderer/src/components/Session.jsx#L795-L801).

When `currentIndex === allDetections.length - 1`, either disable the button or toast "No more detections in this experiment." Probably both: disable + tooltip.

### M6.2 — Responsive header (B-23)
**Files**: [renderer/src/components/Header.jsx](renderer/src/components/Header.jsx).

At narrow widths, collapse Settings/Saved-Experiments/New-Experiment into a hamburger or stack them. Tailwind `flex-wrap` + reasonable `min-w-0` on each button group is the easiest fix.

### M6.3 — Close profile dropdown on selection / modal open (B-24)
**Files**: [renderer/src/components/Header.jsx](renderer/src/components/Header.jsx).

In the click handler for "Create Profile" in the dropdown, also call `setShowProfileDropdown(false)`. Same for selecting a profile.

### M6.4 — Synchronize HTML5 audio playback with spectrogram playhead (B-26)
**Files**: [renderer/src/components/Spectrogram.jsx](renderer/src/components/Spectrogram.jsx), [renderer/spectrogram/SpectrogramProvider.tsx](renderer/spectrogram/SpectrogramProvider.tsx), [renderer/spectrogram/SpectrogramViewer.tsx](renderer/spectrogram/SpectrogramViewer.tsx).

Either:
- (preferred) Drop the native `<audio>` element entirely. Use the AudioContext for both playback and analysis. Build a small custom play/pause/scrubber UI that the spectrogram playhead drives.
- Or: bidirectional sync — `currentTime` changes from either source update the other; clicks on the spectrogram update the audio element; audio playback drives playhead movement.

---

## Milestone 7 — Security & packaging hygiene (1-2 hours)

### M7.1 — Electron security warnings (B-22)
**Files**: [electron-main.js](electron-main.js) BrowserWindow webPreferences.

- Enable `webSecurity: true` for production; if dev needs file:// loading, gate behind `if (process.env.NODE_ENV !== 'development')`.
- Set a Content-Security-Policy meta tag in [renderer/index.html](renderer/index.html).
- Remove `allowRunningInsecureContent` if set.

### M7.2 — Scope `listFilesOfExtension` (B-30)
**Files**: [main/general.js](main/general.js).

Either:
- Track allowed roots in `appState` (the user's data dir, plus any folder explicitly opened via `openDirectory`) and reject anything outside.
- Or accept the design choice and document it (the renderer is trusted, so anyone with code-injection capability already has IPC access). If keeping as-is, add the rationale in a code comment.

### M7.3 — Dedupe model allowlist (B-29)
**Files**: [main/general.js](main/general.js), [ml/main.py:31](ml/main.py#L31).

Better: enumerate `.pth` files in the resolved models dir at startup and use that as the allowlist. Removes the dual-source-of-truth foot-gun and makes adding a new model a drop-in.

---

## Milestone 8 — Quality improvements (worth doing once milestones 1-5 ship)

These aren't bugs but they materially improve the product.

| # | Feature | Files | Effort |
|---|---|---|---|
| **F-1** | Progress percentage during detection (current: only elapsed timer). Have Python emit `{type: 'detection_progress', data: {file_idx, total_files, current_file}}` per batch. | [ml/utils.py](ml/utils.py), [ml/main.py](ml/main.py), [NewExperimentPanel.tsx](renderer/src/components/NewExperimentPanel.tsx) | Medium |
| **F-2** | Keyboard shortcuts: Space=play/pause, ←/→=scroll, J/K=prev/next detection, V=verify, D=delete, S=save annotation. | [Session.jsx](renderer/src/components/Session.jsx) (global useEffect with keydown listener) | Small |
| **F-3** | Export annotated detections as CSV/Excel for downstream analysis. Add an export-session menu item that bundles all experiments' verified+annotated detections into a single sheet. | New file `main/export.js` + IPC + UI button on session header | Medium |
| **F-4** | Filter detections by confidence range / species / verified. Top-of-spectrogram filter bar. | [Session.jsx](renderer/src/components/Session.jsx), [SpectogramAnnotations.tsx](renderer/spectrogram/SpectogramAnnotations.tsx) | Medium |
| **F-5** | Confidence-as-opacity: opacity scales linearly with `detection_conf` so low-conf detections are visually de-emphasized. One-liner in SpectogramAnnotations. | [SpectogramAnnotations.tsx](renderer/spectrogram/SpectogramAnnotations.tsx) | Trivial |
| **F-6** | Undo for accidentally-deleted detections. Keep an undo stack in Session.jsx (last 10 deletions); show "Undo" toast for ~10s after each delete. | [Session.jsx](renderer/src/components/Session.jsx) | Small-Medium |
| **F-7** | File-relink dialog when session files no longer exist (e.g. moved drives). Detect ENOENT during getSession and offer a "Locate files" UI. | [main/sessions.js](main/sessions.js) (don't fail silently on missing audio) + new modal | Medium |
| **F-8** | Settings presets: "Marine Mammals (10–8kHz)", "Birds (1–16kHz)", "Vocal recordings (50–8kHz)". Saved as named profiles in electron-store. | [SettingsModal.jsx](renderer/src/components/SettingsModal.jsx) | Small |
| **F-9** | Session sort/filter on MainPage (by date / name / experiment count). | [MainPage.jsx](renderer/src/components/MainPage.jsx) | Small |
| **F-10** | Adjustable detection rectangle (drag handles on left/right edges to refine start/end time). Updates CSV via existing IPC. | [SpectogramAnnotations.tsx](renderer/spectrogram/SpectogramAnnotations.tsx), [Session.jsx](renderer/src/components/Session.jsx) | Medium-Large |
| **F-11** | Bulk operations: shift-click range-select detections; bulk verify / bulk delete. | [Session.jsx](renderer/src/components/Session.jsx) | Medium |
| **F-12** | Session export/import as zip (config.json + CSVs) so users can share or back up sessions. | New `main/sessions.js` exports | Medium |

---

## Suggested execution order

If only one PR ships this week, ship **Milestone 1** (M1.1 + M1.2). It's a 1-hour code change that fixes the single worst user experience.

If two PRs ship, add **Milestone 2** (M2.1 model state) — it eliminates an entire class of "did my model unload?" confusion.

If three PRs ship, add **Milestone 4.2** (M4.2 surface WASM errors). This isn't fixing a bug per se, but it makes Milestone 4.1 unnecessary as a hard blocker — the user gets an error message instead of a blank canvas, and can recover.

After that, the remaining work is high-value polish and feature work; pick what fits the release cadence.
