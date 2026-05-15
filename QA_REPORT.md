# CLAP Desktop — Comprehensive QA Review

**Date**: 2026-05-12
**Branch**: main
**Method**: Wiped data + electron-store, simulated new user from scratch, exercised every IPC channel and UI flow via Playwright MCP (renderer drive) + direct IPC bridge calls, inspected on-disk artifacts after each operation, and probed edge cases at both the UI and IPC layer.
**Result**: 30 distinct issues found, ~10 of them user-visible bugs, two of them blocking real users. The core engine — Python detection pipeline, CSV persistence, safePathJoin sandbox — is solid. Most issues are in renderer state-handling, validation gates, and visual representation of detections.

---

## 1. Executive summary

The app **works end-to-end for the happy path**: new user → set data dir → create profile → create session → load model → run detection → save experiment → annotate → verify → save → repeat. CSVs are atomically written, detections persist correctly, path-traversal attempts are rejected, and the Python crash-recovery path is wired up.

However, the **annotation flow is broken in the most common path a real user will hit**: immediately after a fresh detection, the temp experiment exists but the right-panel logic at [Session.jsx:621](renderer/src/components/Session.jsx#L621) hard-codes that `activeExperiment === 'temp'` always shows the new-experiment form and never falls through to the detection-annotation panel. Users can click detection rectangles but nothing happens until they hit Save Experiment first — and the UI gives no hint about this. This is the #1 finding.

The second-biggest finding is that the **WASM spectrogram pipeline silently corrupts when settings contain values it can't handle** (n_fft=0 produces `RuntimeError: unreachable` and a blank white spectrogram with no error banner). The settings modal has zero range validation, so the user can save garbage and break visualization.

The third-biggest is **persistent CLAP-loaded-state across reloads**: [App.jsx:17](renderer/src/App.jsx#L17) calls a non-existent `window.electronAPI.getState()` (the real method is `getAppState()` and it doesn't return `model_loaded`). The error is swallowed in a catch, so the model status indicator always says "Not Loaded" after every reload even when Python still has the model in memory.

Everything else is medium-to-low severity: state staleness, missing validation gates, UX gaps, dead code, and a handful of design questions.

---

## 2. Bugs by severity

### Critical (blocks core flow or causes silent data/UX corruption)

| # | Location | Description |
|---|---|---|
| **B-1** | [Session.jsx:621](renderer/src/components/Session.jsx#L621) | The right-panel renderer is `if (activeExperiment === 'temp' \|\| activeExperiment === null) → NewExperimentPanel; else if (activeDetection) → DetectionAnnotation`. The `else if` is **unreachable for the temp experiment**. After running detection, the user sees colored detection rectangles in the spectrogram, clicks them, and nothing happens. Confirmed with both real and synthetic click events. The user must hit "Save Experiment" first, which is undocumented in the UI. **Severity: blocks new-user onboarding.** |
| **B-2** | [wasm/src/lib.rs](wasm/src/lib.rs) + [SettingsModal.jsx:65-272](renderer/src/components/SettingsModal.jsx#L65-L272) + [spectrogramWorker.ts](renderer/spectrogram/worker/spectrogramWorker.ts) | Settings modal saves any number the user types — including n_fft=0, f_min=-100, f_max=999999. WASM `mel_spectrogram_db` panics with `RuntimeError: unreachable` (likely the power-of-2 FFT assertion in [wasm/src/lib.rs:105](wasm/src/lib.rs#L105) or a slice-out-of-bounds). The worker catches the throw and logs `worker render error` to console but never tells the renderer or the user, so spectrograms render blank-white and there's no banner explaining why. |
| **B-3** | [App.jsx:17](renderer/src/App.jsx#L17) | `window.electronAPI.getState()` — this method does not exist. The real method is `getAppState()` which returns `{success, dataDir, activeProfile}`, not `{model_loaded, current_model}`. Every page load fires this error in a try/catch that just `console.error`s, with two visible consequences: (1) "Failed to load CLAP state" appears in console on every load, (2) the header CLAP badge always reverts to "CLAP Not Loaded" after a reload even when the Python backend still has the model loaded. This is also dead code — there is no IPC to ask Python whether a model is currently loaded. |

### High (degrades core feature visibly)

| # | Location | Description |
|---|---|---|
| **B-4** | [SpectogramAnnotations.tsx:91-93](renderer/spectrogram/SpectogramAnnotations.tsx#L91-L93) | Detection rectangles always use `laneIndex * LANE_HEIGHT = 8` in a 100-tall viewBox, even in single-experiment mode. So a detection appears as an 8px-tall blue strip stuck to the top of the spectrogram instead of a vertical band that the user can locate on the time axis. Visually this looks like decoration, not annotation. |
| **B-5** | [Session.jsx:514-518](renderer/src/components/Session.jsx#L514-L518) + [SpectogramAnnotations.tsx:64](renderer/spectrogram/SpectogramAnnotations.tsx#L64) | Every detection always has `experimentColor` attached (Session unconditionally assigns one from `EXPERIMENT_COLORS`), and `getAnnotationColor` says "use experiment color if available". So the orange `DEFAULT_COLOR` is **never** used. Single-experiment detections are blue (palette[0]) instead of orange. Code reads like the intent was orange-on-single, palette-on-multi. |
| **B-6** | [SpectogramAnnotations.tsx](renderer/spectrogram/SpectogramAnnotations.tsx) | Detections whose `start_time > window end` still render — at clientX off-screen (confirmed: rect at clientX=4406 on a 1568-wide viewport). No clipping, no indicator, no way for the user to know there's a detection past the visible window. Combined with the wheel-zoom only changing 10%/tick, finding detections in long files is painful. |
| **B-7** | [Header.jsx](renderer/src/components/Header.jsx) + [App.jsx](renderer/src/App.jsx) | Direct consequence of B-3 — model state is treated as renderer-owned in `SessionContext.clapLoaded`. After reload, that boolean resets to `false`, so the user sees "CLAP Not Loaded" and the new-experiment form blocks them with "Please load a model first". They re-click the model button, Python receives a duplicate `load_model` (and reloads, ~30s wasted) and the badge turns green again. |
| **B-8** | [Session.jsx:172-181](renderer/src/components/Session.jsx#L172-L181) | After `detection_completed`, `errorMessage` is only cleared when `message.data.success`. But the error from the *pre-detection* check ("Please load a model first") was already cleared at handleRunDetection start. The issue surfaces differently: when CLAP gets loaded, `clapLoaded` flips true but the `errorMessage` reading "Please load a model first" stays in state because the model-load path lives in Header.jsx and there's no shared listener clearing the NewExperimentPanel's local message. Reproduced live. |
| **B-9** | [SettingsModal.jsx](renderer/src/components/SettingsModal.jsx) | Settings inputs have HTML `min`/`max` attributes but those only fire on arrow-stepping; typing or pasting bypasses them. There's no submit-time validation. Combined with B-2 this lets the user wedge spectrogram rendering. |

### Medium (state, validation, dead-code, redundant work)

| # | Location | Description |
|---|---|---|
| **B-10** | [package.json](package.json) | No `"type": "module"`. Electron logs `MODULE_TYPELESS_PACKAGE_JSON` warning and *reparses* `electron-main.js` as ESM on every cold start ("This incurs a performance overhead"). |
| **B-11** | [App.jsx:29](renderer/src/App.jsx#L29) | React Router v6 future-flag warnings (`v7_startTransition`, `v7_relativeSplatPath`) emitted on every load. Trivial to silence. |
| **B-12** | [MainPage.jsx:104-110](renderer/src/components/MainPage.jsx#L104-L110) | "Create Session" button is always clickable, even when no dataDir/profile is set. Opening the modal then shows a Browse button that's functional but a (also-)disabled Create Session button at the bottom and no explanation of why. Top-level button should be `disabled`. |
| **B-13** | [CreateProfileModal.jsx](renderer/src/components/CreateProfileModal.jsx) + [CreateSessionModal.jsx](renderer/src/components/CreateSessionModal.jsx) | Invalid-character validation runs on submit, not on input. Typing `Bad/Name` keeps the Create button enabled; only after clicking does the red error show. Should disable + show inline error as the user types. |
| **B-14** | [main/sessions.js:9](main/sessions.js#L9) | `if (!sessionName)` rejects empty strings at IPC. The renderer modal generates an ISO-timestamp default to compensate, but anything else calling the IPC directly (future automation, scripts) hits a confusing error. Either the backend should accept '' as "auto-generate" or the contract should be documented. |
| **B-15** | [main/sessions.js:8](main/sessions.js#L8) | `createSession(name, [])` succeeds and creates an empty session folder. Empty sessions are listed on the homepage with "0 files" and can never do anything useful. Reject `files.length === 0`. |
| **B-16** | [main/sessions.js:18-22](main/sessions.js#L18-L22) | "Normalize" path code says: if a file path is relative, resolve it against `{dataDir}/{profile}/{sessionId}/`. That's nonsense — relative audio paths should be relative to the user's CWD or the originally-browsed folder, not a yet-to-exist session dir. The modal never sends relative paths so this is dead code, but it's actively misleading. |
| **B-17** | [spectrogramWorker.ts:213](renderer/spectrogram/worker/spectrogramWorker.ts#L213) | Reproducible on cold load: `worker render error: Error: PCM not loaded for fileId`. The worker is asked to render a window before the PCM fetch+decode finishes. A waitForPCM promise would eliminate this. |
| **B-18** | [Session.jsx:795](renderer/src/components/Session.jsx#L795) | "Next" button on the last detection in sorted order is a no-op. Button stays enabled and gives no feedback. Should either wrap, disable, or toast "End of list". |
| **B-19** | [ml/main.py:92-99](ml/main.py#L92-L99) | Theta validation in Python silently coerces out-of-range values to 0.5 with no `error` message back to the renderer. Caller (`startDetection`) returns `{success: true, message: "Detection started"}` whether or not theta was sane. Confirmed: passing `theta=-0.5` and `theta=5.0` both report success. |
| **B-20** | [electron-main.js:281-291](electron-main.js#L281-L291) | `cancel-detection` returns `{success: true}` even when no Python process exists / no detection running. Should distinguish "cancel sent" from "nothing to cancel". |
| **B-21** | [main/sessions.js:8](main/sessions.js#L8) | No upper bound on `files.length`. Confirmed creating a session with 1000 file entries (all identical) succeeds. With real files this would block Python in `Batch_Inference_DS.__init__` for an extended time, and the UI would be unresponsive. Cap at a reasonable max (e.g. 500) or warn. |

### Low / UX / cosmetic

| # | Location | Description |
|---|---|---|
| **B-22** | [electron-main.js](electron-main.js) sandbox config | Console emits three Electron security warnings on dev: webSecurity disabled, allowRunningInsecureContent, no Content-Security-Policy. Worth a security review pass before packaging. |
| **B-23** | [Header.jsx](renderer/src/components/Header.jsx) | At narrow viewport widths (≤900px or so), the Saved-Experiments / New-Experiment buttons overflow off the right edge of the header with no horizontal scroll, wrap, or hamburger fallback. |
| **B-24** | [Header.jsx:341-401](renderer/src/components/Header.jsx#L341-L401) | After CreateProfileModal opens, the profile dropdown stays open behind it. After successful profile creation, the dropdown still shows "Create Profile" as a CTA (now with the profile present) — confusing affordance. |
| **B-25** | [SpectrogramNavigator.tsx](renderer/spectrogram/SpectrogramNavigator.tsx) | Navigator slider is rendered 5px tall — borderline impossible to grab without pixel-perfect aim. Increase hit area (e.g. invisible 12-16px padding around the visible bar). |
| **B-26** | [Spectrogram.jsx](renderer/src/components/Spectrogram.jsx) | The native HTML5 `<audio>` element shown below each spectrogram and the spectrogram playhead are *not synchronized in either direction*. Clicking the spectrogram moves the playhead (the visual one in the SpectrogramProvider) but the `<audio>` element's currentTime is unchanged. So if the user presses Play on the HTML audio control, playback starts from wherever the audio element last left off (not where the spectrogram playhead is). Inverse is also true. |
| **B-27** | [SettingsModal.jsx:73-84](renderer/src/components/SettingsModal.jsx#L73-L84) | Sample-rate input is commented out, and `sampleRate: 32000` is hardcoded in the context default. But the audio files in the demo (and most real bioacoustic data) are 44.1kHz — the loaded WAVs run at the actual file's SR via WAV-header parse in SpectrogramProvider, so the setting is effectively unused but still surfaced as a future-vestige in the schema. Either fully delete or fully wire up. |
| **B-28** | [SettingsModal.jsx](renderer/src/components/SettingsModal.jsx) | No cross-field validation. The user can set `win_length=1024, n_fft=128, hop_length=256` (win_length > n_fft → invalid FFT input). The WASM panic case in B-2 is one outcome; subtler cases just produce wrong spectrograms. |
| **B-29** | [main/general.js](main/general.js) + [ml/main.py:31](ml/main.py#L31) | Model allowlist `{'CLAP_Jan23'}` is hardcoded in TWO places that must be kept in sync. Should be enumerated by listing `.pth` files in `models/`. |
| **B-30** | [main/general.js](main/general.js) `listFilesOfExtension` | Accepts any absolute directory path from the renderer without sandbox. Confirmed enumerated `C:\Windows\System32` and got 616 .exe entries. Not exploitable from a normal user perspective (the renderer is trusted), but if XSS ever lands via a malicious audio filename rendered in the DOM, this is a confused-deputy that could exfiltrate the filesystem. Worth scoping to the user's data dir or a session-opened folder. |

---

## 3. Design / architecture concerns (not bugs)

- **No global model-loaded state shared between Python and renderer.** Python knows whether a model is in memory; the renderer guesses based on its own boolean. The fix is either (a) Python should emit a `model_state` message on connect (and Electron should persist it), or (b) renderer should ask Python directly. Currently load_model is sent every time the renderer reload because the renderer assumes it isn't loaded.
- **Two-step delete confirmation inline** (click trash → click confirm) is inconsistent with the modal-style confirmations used elsewhere. Consider either one or the other across the app.
- **`species === 'null'` sentinel** appears throughout the renderer ([Session.jsx:689](renderer/src/components/Session.jsx#L689), [main/sessions.js:76](main/sessions.js#L76)) and the CSV writes the literal string `"null"`. CSV null handling should be a single empty field, not the string `"null"`, with the parser doing the conversion in one place.
- **CSV stores absolute audio file paths.** Moving the data folder to another drive or another machine breaks every detection. Either store paths relative to the session dir or to the originally-browsed source folder, with a re-link UI when files are missing.
- **`addDetection` IPC is exposed in preload.js:26 but never called by the renderer.** Dead surface. Either ship a "manual add" UI or remove the IPC.
- **Settings updates only propagate to the React context that performs the update.** If a setting changes via direct IPC (an unlikely scenario, but it's the model my QA agent used), other React subtrees don't see it until reload. Not a bug for current real users but worth flagging if more code-paths bypass `updateSettings`.

---

## 4. Visual observations

- Spectrograms render correctly when settings are sane. Color scale is viridis. Files in the demo set (Recording_1_Segment_02.002.wav, .003.wav) look very noise-dominated — hard to tell if there's signal, but that's the data, not the renderer. See `qa-06-spectrograms-wide.png`.
- Detection rectangles render in a thin top strip (Bug B-4). They're easy to miss because they're only 8/100 of the spectrogram height.
- Multi-experiment overlay with two experiments showed a blue lane and a pink lane stacked at the top — visually clear once you know what you're looking at, but unintuitive at first glance. See `qa-07-multi-experiment.png`.
- WASM-broken state shows blank white spectrograms with no user-facing error. See `qa-08-wasm-crash-bad-settings.png`.

---

## 5. Working well (worth keeping)

- safePathJoin path-traversal rejection is solid; `../../../config.json` was correctly blocked.
- atomicWriteFile pattern (`write to .tmp → rename`) for CSV/config writes — never observed partial writes.
- Python crash-recovery (3 restarts within 60s, then fatal_error) — wired correctly per code inspection.
- CSV schema with named columns + csv-parse/csv-stringify — robust against column reordering and special chars.
- Two-step session/experiment delete confirmation — protects from accidents.
- Spectrogram tile cache with LRU eviction — keeps memory bounded on long scrolls.
- Profile/session name sanitization via `sanitizeName` — Windows-illegal chars are correctly rejected, both IPC-direct and via UI.
