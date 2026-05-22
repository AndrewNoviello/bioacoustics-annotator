# CLAP Desktop — User Guide

A walkthrough of how to actually use the app, with screenshots from a live session. For installation and dev setup, see the [project README](../README.md).

---

## Contents

1. [What CLAP Desktop is](#what-clap-desktop-is)
2. [Quick start (one minute)](#quick-start)
3. [The mental model](#the-mental-model)
4. [Step-by-step walkthrough](#walkthrough)
   - [4.1 Pick a data directory and create a profile](#41-data-dir-and-profile)
   - [4.2 Load the CLAP model](#42-load-the-clap-model)
   - [4.3 Create a session](#43-create-a-session)
   - [4.4 Run a detection experiment](#44-run-a-detection-experiment)
   - [4.5 Read the spectrogram](#45-read-the-spectrogram)
   - [4.6 Annotate and verify detections](#46-annotate-and-verify-detections)
   - [4.7 Compare experiments (multi-overlay)](#47-compare-experiments)
5. [Settings reference](#settings-reference)
6. [Tips, gotchas, and limits](#tips-and-gotchas)
7. [Troubleshooting](#troubleshooting)

---

## What CLAP Desktop is

CLAP Desktop is a desktop tool for **prompt-driven detection** of sounds in audio recordings — useful for bioacoustics work where you want to find every plausible whale call, bird vocalization, or any other event described in natural language, *without* having to train or fine-tune a model first.

Under the hood it runs the [CLAP audio-language model](https://github.com/microsoft/CLAP) (`CLAP_Jan23.pth`, ~1.1 GB) over batches of WAV files. You give it short positive and negative text prompts ("whale song; humpback vocalization" vs. "engine noise; static"), it returns time-stamped detections with confidence scores. You then review them, refine bounds, label species, and verify — all of which lives on disk as CSV files you can hand off to downstream tooling.

There is nothing cloud about this — your audio never leaves the machine.

---

## Quick start

Assuming you've already done [the install steps in the README](../README.md):

1. **Launch:** `npm run dev` (or `npm run dev:debug` if you need DevTools/CDP on port 9222).
2. **First-time setup:** pick a data directory (a folder anywhere on disk), then create a profile inside it. Both happen from the header buttons.
3. **Load the model:** click the red `CLAP Not Loaded` button in the header and pick `CLAP_Jan23`. Wait until it turns blue.
4. **Create a session:** click `Create Session`, browse to a folder of `.wav` files, pick some, hit `Create Session`.
5. **Run a detection:** open the new session, click `New Experiment`, type a positive prompt (e.g. `baby cry`), a negative prompt (e.g. `noise`), pick a threshold, click `Run Detection`.
6. **Review:** click any detection rectangle on the spectrogram to annotate or verify it.

That's the whole loop. Everything below is the long version.

---

## The mental model

There are five nested concepts. They map directly to the filesystem layout under your data directory:

```
<data_dir>/
└── <profile>/                 # one profile = one "workspace" or person
    └── <session_id>/          # one session = one batch of files to analyze
        ├── config.json        # session settings, file list, experiments
        ├── temp.csv           # current unsaved experiment's detections
        └── <experiment_id>.csv  # one CSV per saved experiment
```

- **Data directory** — the root folder. Pick once per machine.
- **Profile** — a workspace under that directory (e.g. one per project, one per teammate).
- **Session** — a batch of audio files you want to analyze together.
- **Experiment** — one (positive prompt, negative prompt, threshold) configuration applied to that session, producing a set of detections. A session can hold many experiments.
- **Detection** — one (file, start_time, end_time, species, verified) row inside an experiment's CSV.

You always work inside one session at a time, and within that session you flip between experiments on a sidebar.

---

## Walkthrough

The screenshots below come from a live run against the bundled CLAP_Jan23 model and two short demo WAVs (`Recording_1_Segment_02.002.wav`, `Recording_1_Segment_02.003.wav`).

### 4.1 Data dir and profile

When the app first opens, you see the Sessions screen. Until you've picked a data directory and an active profile, the *Create Session* button is greyed out and the body says *"You must select a data directory and a profile to view sessions."*

![Main page — sessions list](screenshots/01-main-page-sessions-list.png)

Use the header buttons (right side):

- The **folder button** (showing your data dir name) opens a native folder picker. Pick the parent directory where all your work will live.
- The **profile button** (next to it) opens a dropdown of profiles found under that directory.

Click the profile button to see existing profiles and a *Create Profile* shortcut:

![Profile dropdown](screenshots/02-profile-dropdown.png)

Clicking *Create Profile* opens this modal:

![Create Profile modal](screenshots/03-create-profile-modal.png)

The data directory is shown read-only so you know exactly where the profile will be created. Name validation is **live** — type any of `/ \ : * ? " < > |` and the field turns red, the *Create Profile* button disables, and the error message tells you which character is forbidden:

![Profile name validation](screenshots/04-profile-invalid-chars.png)

Profiles can't be deleted from inside the app — if you need to remove one, delete its folder from your data directory.

### 4.2 Load the CLAP model

The model status badge in the header doubles as a dropdown:

![Model dropdown](screenshots/05-model-dropdown.png)

Clicking `CLAP_Jan23` kicks off the load. Status goes through *Loading…* → *CLAP_Jan23* (blue badge):

![Model loaded](screenshots/07-model-loaded.png)

The model state lives in the main Electron process, **not** in the renderer. That means reloading the page (or accidentally crashing the renderer) doesn't lose it — you don't have to wait ~30 s for the model to re-load. The Python backend is what holds the actual weights; if Python crashes (it'll auto-restart up to 3 times), then the badge correctly flips back to red.

**Only `CLAP_Jan23` is shipped.** The model list is auto-enumerated from `ml/models/*.pth`, so dropping a new checkpoint there will make it show up after a relaunch.

### 4.3 Create a session

With a profile selected and the model loaded, click *Create Session*:

![Create Session modal](screenshots/08-create-session-modal.png)

The modal flow:

1. **Detection Session Name** — optional. If you leave it blank, the session is named with an ISO timestamp like `2026-05-14T11-46-37`. Same invalid-character rules as profile names (live validation).
2. **Select Folder** — *Browse* opens a folder picker. The app remembers which folders you opened during the session, so subsequent file enumeration there is allowed; arbitrary system paths are rejected by the IPC layer.
3. **File Type** — currently WAV only.
4. **Files list** — every WAV in the chosen folder. Tick individual files, or use *Random Select* (with the N counter) to pick a random subset.

The *Create Session* button stays disabled until at least one file is selected. There's also a hard cap of **500 files per session** at the IPC layer — split larger batches across multiple sessions.

Once created, the modal closes after a short "Session created successfully" toast. The session appears at the top of the list (newest first). Hover the trash icon on any session card and confirm twice to delete.

### 4.4 Run a detection experiment

Click a session card to open it:

![Session view](screenshots/09-session-view.png)

You see:

- **Top:** Source folder + one spectrogram block per audio file. Each block shows the filename, an audio playback control, and the spectrogram canvas with detection rectangles laid over the top.
- **Bottom-right:** the experiment / annotation panel. By default it shows *Experiment Details* for the most recent saved experiment.
- **Header:** Settings (per-session), Saved Experiments (sidebar toggle), New Experiment (panel toggle).

To start a fresh experiment, click *New Experiment*:

![New Experiment panel](screenshots/14-new-experiment-panel.png)

Fill in:

- **Positive Prompts** — semicolon-separated phrases describing what you want to find ("baby cry; infant vocalization"). Plain English; CLAP is a text-audio model.
- **Negative Prompts** — phrases describing what you *don't* want ("noise; static; engine"). These compete with the positives during scoring.
- **Detection Threshold (θ)** — a slider from 0.1 to 0.9 (server-side validation accepts the full `[0, 1]` range). Higher θ = fewer, more confident detections. 0.5 is a reasonable starting point.

Then click *Run Detection*. The button morphs into a *Running… M:SS (P%)* state with an elapsed timer and a *Cancel* button next to it. While a run is in flight, the prompts and threshold lock so you can't accidentally change inputs mid-run.

When the run finishes, results land in a **temporary experiment** (internal name `temp`). It's a normal experiment that just hasn't been committed yet — you can review it, click detection rectangles to annotate them, and either:

- Click **Save Experiment** to promote it to a permanent experiment with a UUID (it'll move to the Saved Experiments sidebar).
- Click **Wipe Experiment** to throw it away. The new-experiment form returns.

Detections from `temp` show up on the spectrograms immediately. You don't have to save first to annotate them — clicking a rectangle opens the annotation panel either way.

If the run fails or you cancel mid-flight, the relevant error or cancellation message appears at the bottom of the panel. Cancel-detection now correctly distinguishes "no detection running" from "cancel sent" — you'll get an explicit error message rather than a silent success.

### 4.5 Read the spectrogram

Each audio file in the session gets its own spectrogram. By default the view shows a 15-second window; you can adjust this in Settings (`Window Duration`). Spectrograms are rendered tile-by-tile by a Rust/WASM mel-spectrogram pipeline running in a Web Worker, with an LRU cache so scrolling stays smooth.

What you'll see:

- **Y axis** — mel frequency, log-spaced between `f_min` and `f_max` (Settings).
- **X axis** — time within the visible window.
- **Color** — energy, normalized to the configured dynamic range (`top_db`, `dynamicGain`, `gainPercentile`, `brightness`, `contrast`, `autoGamma`/`gamma`).
- **Detection rectangles** — overlay drawn from CSV-loaded detections. Each experiment has a *fixed color* assigned from a palette; each detection occupies a fixed-height lane (top = lane 0). This is intentional, so the canvas height stays predictable and overlay comparisons line up visually.

Interactions on the spectrogram:

- **Click in the spectrogram** — seek/play audio from that point.
- **Scroll wheel** — pan or zoom (per Settings).
- **Navigator bar below the spectrogram** — drag to jump anywhere in the file. The hit area is wider than the visible slider, so you don't have to be pixel-perfect.
- **Click a detection rectangle** — opens the annotation panel for that detection (covered in 4.6).

If a setting somehow renders the spectrogram blank, Settings validation catches the most common bad combos (non-power-of-2 n_fft, win_length > n_fft, f_max ≤ f_min) before you can save them.

### 4.6 Annotate and verify detections

Click any rectangle to open the *Detection Annotation* panel:

![Detection annotation panel](screenshots/10-detection-annotation-panel.png)

The top half shows read-only metadata:

- **File** — full path of the audio file
- **Time** — start and end in seconds
- **Confidence** — CLAP's score for this detection, 0-100%
- **Species** — your annotation (or *Not annotated*)
- **Status** — *Unverified* (yellow) or *Verified* (green)

The bottom half is the work area. If the species dropdown is empty, you need to add some entries in Settings first ([4.5](#45-read-the-spectrogram) → Settings → *Species List*). Otherwise:

- **Save Annotation** — writes the selected species to the detection's row in the CSV. The detection stays selected so you can also *Verify* it; use *Next* to advance.
- **Verify** — marks the detection green-and-locked. Use this after you've confirmed the call is what you think it is. Verified detections show an *Unverify* button instead, in case you change your mind.
- **Cancel** — deselects the detection without saving any in-progress species change.
- **Previous / Next** — step through every detection in the experiment, sorted by file path then start time. Each step (a) scrolls the target file's spectrogram into view, (b) recenters the 15-second viewport on the detection, (c) seeks the audio playhead to the detection's start time, and (d) pauses playback. *Previous* is disabled at the start of the list, *Next* at the end.
- **Delete** (red trash, top-right) — removes the detection from the CSV. A toast at the bottom of the screen offers a 10-second *Undo*; older deletions are buffered too (last 10).

You can **refine the detection bounds** by hovering near the left or right edge of the rectangle until the cursor turns into a resize handle, then dragging. The minimum width is 50 ms (so you can't accidentally collapse the rect), and the edges are clamped to the audio bounds. The CSV updates on mouseup.

#### Manually adding a detection at the playhead

If CLAP missed something obvious — or you want to label a call before running detection at all — you can drop a detection straight onto a spectrogram from the *Experiment Details* panel:

1. Select a saved experiment in the *Saved Experiments* sidebar (the active one shows the *Experiment Details* panel on the right). Manual additions go into that experiment.
2. Play or seek the spectrogram of the audio file you want to mark. Any interaction past time 0 — playing, clicking to seek, dragging the navigator — counts.
3. A blue **`+ Add Detection at Playhead in <filename>`** button appears in the *Experiment Details* panel underneath the metadata.

   ![Add Detection button](screenshots/15-add-detection-button.png)

4. Click it. A new 1-second detection is created starting at the current playhead, with confidence 1.0 (you're asserting it) and species *Not annotated* until you label it. The annotation panel opens on the new row immediately so you can pick a species, *Verify*, or drag the edges to refine.

   ![Detection annotation panel for the new row](screenshots/16-add-detection-result.png)

A few details worth knowing:

- The button only renders once you've actually played or seeked at least one spectrogram in this session — that's how it knows which file you mean. Before any playback, there's no button.
- It targets the *currently active* experiment. To add detections to a different experiment, switch to it in the sidebar first.
- The temp (unsaved) experiment doesn't support manual additions — save it first if you want to add a row to it. (You'll see the *New Experiment* panel instead of *Experiment Details* while temp is active.)
- The new row is written to the experiment's CSV the moment you click. Confidence is hard-coded to 1.0 — it's not a CLAP score, it's "the human said so."

### 4.7 Compare experiments

Click *Saved Experiments* in the header to open the right sidebar:

![Saved Experiments sidebar](screenshots/13-saved-experiments-sidebar.png)

Each saved experiment shows:

- A **color indicator** (the same color the experiment uses for its rectangles)
- Status: *Editing*, *Visible*, or *Hidden*
- Timestamp + θ + truncated prompts
- A detection count
- A red trash icon for delete (double-confirm)

Tick **up to 3** checkboxes at once — the 4th and beyond is disabled until you uncheck something. Each selected experiment gets its own lane on every spectrogram (lane order = selection order, top to bottom). This is how you compare two prompt formulations side-by-side, or check the overlap between θ=0.4 and θ=0.6 runs on the same data.

Deleting an experiment removes it from the sidebar and from any spectrograms it was on.

---

## Settings reference

Settings are **per-session** — each session keeps its own copy in `config.json`. Open them from the *Settings* button in the header while inside a session.

![Settings modal](screenshots/11-settings-modal.png)

### Spectrogram parameters

| Setting | Range | What it does |
|---|---|---|
| **FFT Size (`n_fft`)** | 128 – 8192, power of 2 | Number of samples per FFT frame. Higher = better frequency resolution, worse time resolution. Validated as a power of 2; non-conformant values show an inline error and disable Save. |
| **Window Length (`win_length`)** | 64 – 8192, ≤ n_fft | Samples used per analysis window. Usually = n_fft. |
| **Hop Length (`hop_length`)** | 1 – 4096, ≤ win_length | Samples between consecutive frames. Smaller = denser X axis. |
| **Min Frequency (`f_min`)** | ≥ 0 Hz | Bottom of the mel filterbank. Crop out subsonic rumble here. |
| **Max Frequency (`f_max`)** | > f_min | Top of the mel filterbank. Usually ≤ sample rate / 2. |
| **Mel Bands (`n_mels`)** | 16 – 512 | Y-axis resolution. 128 is a sane default. |
| **Top dB (`top_db`)** | 20 – 120 | Dynamic range for the normalized magnitude. |
| **Window Duration (sec)** | 1 – 120 | How much audio is visible in one spectrogram view. |

### Visualization toggles

| Setting | What it does |
|---|---|
| **Dynamic Gain** | Auto-normalize each window to the chosen *Gain Percentile* (90–99). Off = use a fixed scale. |
| **Auto Gamma** | Compute a gamma curve from the histogram. Off = use a fixed *Gamma* (0.3–2.0). |
| **Brightness** | −0.5 to 0.5. Additive offset on normalized energy. |
| **Contrast** | 0.5 to 2.0. Multiplicative gain after normalization. |

All ranges are enforced by live validation. Bad combinations (e.g. `win_length > n_fft`) light up inline; Save Settings stays disabled until everything's green.

### Species List

The same modal hosts your annotation vocabulary. Click `+` to type a species name; press Enter or *Save* to add it; hover a row and click the trash to remove. Names must be unique; the input rejects duplicates.

Species you add here populate the dropdown in the [annotation panel](#46-annotate-and-verify-detections). They're saved per-session, so different projects can have different vocabularies in the same data directory.

---

## Tips and gotchas

- **Maximum 500 files per session**, enforced at the IPC layer. Split larger batches.
- **Maximum 3 experiments overlaid at once.** The 4th checkbox in the sidebar is greyed.
- **The `Undo` toast lasts ~10 seconds** after a detection delete; up to 10 deletions are buffered. Past that, deletions are permanent (the CSV is rewritten immediately).
- **Detections store *absolute* audio paths** in the CSV. If you move the data folder to another drive or machine, the session won't find its audio anymore. Keep the data directory stable.
- **Resize requires hitting the edge.** The drag handles are thin — aim at the very left or right of the rectangle. If you grab the middle, the click counts as "select this detection".
- **For batch labeling**, *Save Annotation* keeps the detection selected — click *Next* to step to the following one.
- **Cancel-detection takes a moment** — Python finishes the current file batch before stopping. The button disappears once the cancellation propagates.
- **Settings are per-session.** Changing them in session A doesn't affect session B. The first time you open a new session, settings start at the renderer's defaults.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App opens to a blank window | Vite dev server (port 5173) not running yet | Wait a few seconds, or check the terminal output of `npm run dev`. |
| `CLAP Not Loaded` won't turn blue | Python backend missing or crashed | Check the terminal: the main process logs `Python backend not found` or restart attempts. Make sure `ml/.venv/Scripts/python.exe` exists (re-run `pip install -r ml/requirements.txt`). |
| Detection runs but produces no detections | Prompts too narrow, or θ too high, or the model has trouble with the audio | Lower θ (e.g. 0.3), broaden the prompts ("low frequency calls" vs. "humpback BWHa-3 song"), and double-check the audio actually contains what you described. |
| Spectrogram is blank/white | Bad spectrogram settings | Open Settings — if anything is invalid you'll see red borders. Set `n_fft` to a power of 2, ensure `win_length ≤ n_fft`, `hop_length ≤ win_length`, `f_max > f_min`. |
| Two console errors after opening a session | Worker render attempted before PCM finished loading | Known issue (see `BUGS_FOUND.md`, N-2). Cosmetic — the next render call succeeds. Nothing user-visible breaks. |
| Electron crashes on launch with `cjsPreparseModuleExports` | `ELECTRON_RUN_AS_NODE` env var is set | `Remove-Item env:ELECTRON_RUN_AS_NODE` (PowerShell) or `unset ELECTRON_RUN_AS_NODE` (bash), then relaunch. |
| `Directory not authorized` error when listing files | The folder was never opened via *Browse* | Click *Browse* in the relevant modal first; the app tracks which folders you've opened. |
| Existing experiment shows 0 detections after a code update | CSV column rename or path-format change | Check `<session>/<experiment>.csv` directly. The schema is `id, filename, start_time, end_time, species, detection_conf, verified`. |
