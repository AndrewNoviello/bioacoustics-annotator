# CLAP Desktop - Bioacoustics Annotation Tool

A desktop application for bioacoustic analysis and annotation using CLAP (Contrastive Language-Audio Pretraining) models.

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
- **Rust** (for building WASM module)
- **wasm-pack** (`cargo install wasm-pack`)

### Python Dependencies

```bash
cd ml
pip install -r requirements.txt
```

### Model Weights

Download the CLAP model weights and place them in `ml/models/`:
- `CLAP_Jan23.pth` - Required for the default CLAP model

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd clap-desktop
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

4. **Set up Python environment** (recommended)
   ```bash
   cd ml
   python -m venv .venv
   # Windows
   .venv\Scripts\activate
   # macOS/Linux
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

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

## Building for Production

### Build the application
```bash
npm run build
```

### Create distributable packages
```bash
# Create unpacked directory
npm run pack

# Create installer packages
npm run dist
```

Build artifacts will be in the `dist/` directory.

## Project Structure

```
clap-desktop/
├── electron-main.js      # Electron main process
├── preload.js            # Electron preload script
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
│   ├── requirements.txt  # Python dependencies
│   ├── models/           # Model weights directory
│   └── clap/             # CLAP model implementation
├── renderer/             # React frontend
│   ├── src/              # React components and stores
│   ├── spectrogram/      # Spectrogram viewer components
│   └── vite.config.js    # Vite configuration
└── wasm/                 # Rust WASM module
    ├── Cargo.toml
    └── src/lib.rs
```

## Configuration

### Environment Variables

- `CLAP_MODELS_DIR` - Override the models directory path
- `CLAP_WORKSPACE` - Override the workspace directory
- `NODE_ENV` - Set to `development` for dev mode

### Settings

User settings are stored using `electron-store` and persist between sessions.

## Troubleshooting

### Python backend not starting
- Ensure Python is in your PATH or create a virtual environment in `ml/.venv`
- Check that all Python dependencies are installed

### WASM module not loading
- Rebuild with `npm run build:wasm`
- Ensure `wasm-pack` is installed

### Model not loading
- Verify model weights exist in `ml/models/`
- Check console for specific error messages

## License

ISC
