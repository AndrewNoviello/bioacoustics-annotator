# Bioacoustics Annotation Tool

A desktop application for bioacoustic analysis and annotation using CLAP (Contrastive Language-Audio Pretraining) models.

> **Platform:** Windows only (x64). There is no Mac or Linux build.
>
> **Using the app:** see the [User Guide](docs/USER_GUIDE.md) for a walkthrough of the data-dir → profile → session → detection → annotation workflow, with screenshots. This README covers install and development only.

## Features

- **Audio Detection**: Detect acoustic events using CLAP model embeddings with text prompts
- **Spectrogram Visualization**: Interactive spectrogram viewer with customizable settings
- **Annotation Management**: Create, verify, and organize annotations by species
- **Session Management**: Organize work into profiles and sessions
- **WASM-powered Spectrograms**: Fast mel-spectrogram generation using WebAssembly

## Prerequisites

### Required Software

- **Node.js** (v18 or higher)
- **Python** (3.10 or higher)
- **Rust** (for building the WASM module)
- **wasm-pack** (`cargo install wasm-pack`)

For creating installer packages (`npm run build:all` / `npm run dist`), you also need a working Python environment with PyInstaller installed (included in `ml/requirements.txt`).

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/AndrewNoviello/bioacoustics-annotator.git
   cd bioacoustics-annotator
   ```

2. **Install Node dependencies**
   ```bash
   npm install
   cd renderer && npm install && cd ..
   ```

3. **Build the WASM module**
   ```bash
   npm run build:wasm
   ```

4. **Set up the Python backend**
   ```bash
   cd ml
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   cd ..
   ```

   In development, Electron launches `ml/.venv/Scripts/python.exe ml/main.py`. A virtual environment in `ml/.venv` is strongly recommended.

5. **Download model files** (see [Model Weights](#model-weights) below)

## Model Weights

Model files are not checked into git. Place them in `ml/models/`:

| Path | Purpose |
|------|---------|
| `CLAP_Jan23.pth` | CLAP checkpoint (required) |
| `clip-vit-base-patch16/` | Local Hugging Face snapshot of `openai/clip-vit-base-patch16` (config + tokenizer; required, loaded offline) |

Download the CLIP tokenizer/config snapshot once:

```bash
cd ml
.venv\Scripts\activate
pip install huggingface_hub
huggingface-cli download openai/clip-vit-base-patch16 --local-dir models/clip-vit-base-patch16
cd ..
```

Obtain `CLAP_Jan23.pth` from your model source and copy it to `ml/models/`.

## Development

Start the development server with hot reload:

```bash
npm run dev
```

Or start Electron and the renderer separately:

```bash
# Terminal 1: Start Vite dev server
cd renderer && npm run dev

# Terminal 2: Start Electron
npm start
```

Other useful scripts:

- `npm run dev:debug` — dev mode with Electron remote debugging on port 9222
- `npm run start:prod` — run Electron against a production renderer build

## Building for Production

| Script | What it builds |
|--------|----------------|
| `npm run build` | WASM module + renderer (`wasm/pkg`, `renderer/dist`) |
| `npm run build:backend` | PyInstaller bundle of the Python backend (`ml/dist/clap_backend/`) |
| `npm run pack` | `npm run build`, then an unpacked Electron app in `dist/` |
| `npm run dist` | `npm run build`, then platform installers in `dist/` |
| `npm run build:all` | Full Windows release: backend freeze + frontend/WASM + NSIS installer |

Typical release build on Windows:

```bash
npm run build:all
```

Build artifacts land in `dist/`. The installer bundles the frozen Python backend and any model files present under `ml/models/` at build time.

## Project Structure

```
bioacoustics-annotator/
├── electron-main.js      # Electron main process
├── preload.cjs           # Electron preload script
├── main/                 # Main process modules
│   ├── index.js          # API exports
│   ├── annotation.js     # Annotation operations
│   ├── detection.js      # Detection operations
│   ├── general.js        # Profile/directory operations
│   ├── sessions.js       # Session management
│   ├── utils.js          # Utility functions
│   └── verification.js   # Verification operations
├── ml/                   # Python ML backend
│   ├── main.py           # Entry point
│   ├── utils.py          # ML utilities
│   ├── build_backend.spec# PyInstaller spec
│   ├── requirements.txt  # Python dependencies
│   ├── models/           # Model weights (user-managed, not in git)
│   └── clap/             # CLAP model implementation
├── renderer/             # React frontend
│   ├── src/              # React components and stores
│   ├── spectrogram/      # Spectrogram viewer components
│   └── vite.config.js    # Vite configuration
├── wasm/                 # Rust WASM module
│   ├── Cargo.toml
│   └── src/lib.rs
├── docs/                 # User guide and screenshots
└── build/                # App icons for electron-builder
```

## Configuration

### Environment Variables

- `CLAP_MODELS_DIR` — Override the models directory path
- `CLAP_WORKSPACE` — Override the workspace directory (Python backend)
- `NODE_ENV` — Set to `development` for dev mode
- `ELECTRON_DEBUG=1` — Enable remote debugging (used by `npm run dev:debug`)

The Python backend also sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`, so all Hugging Face assets must be present locally under `ml/models/`.

### Settings

User settings are stored using `electron-store` and persist between sessions.

## Troubleshooting

### Python backend not starting
- Ensure `ml/.venv` exists and dependencies are installed (`pip install -r ml/requirements.txt`)
- Check the Electron console for the spawned command (`ml/.venv/Scripts/python.exe ml/main.py`)

### WASM module not loading
- Rebuild with `npm run build:wasm`
- Ensure `wasm-pack` is installed

### Model not loading / stuck on "Loading…"
- Verify `ml/models/CLAP_Jan23.pth` exists
- Verify `ml/models/clip-vit-base-patch16/` contains the Hugging Face config and tokenizer files
- Check the console for specific error messages

### Production build missing detection
- Run `npm run build:backend` (or use `npm run build:all`) before packaging so `ml/dist/clap_backend/` exists

## License

ISC
