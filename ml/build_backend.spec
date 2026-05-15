# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the CLAP Desktop Python backend.
# Build with:  cd ml && python -m PyInstaller build_backend.spec
#
# Output: ml/dist/clap_backend/  (a directory, not a single file, for faster start)

import sys
from pathlib import Path

block_cipher = None

# ── Hidden imports required by torch / torchaudio / transformers / maad ──────
hidden_imports = [
    # PyTorch internals
    'torch',
    'torch.nn',
    'torch.nn.functional',
    'torch.utils.data',
    'torchaudio',
    'torchaudio.functional',
    'torchaudio.transforms',
    # Transformers / tokenisers
    'transformers',
    'transformers.models.auto',
    'transformers.models.roberta',
    'transformers.models.clip',
    'transformers.tokenization_utils',
    # timm (vision backbone used by htsat)
    'timm',
    'timm.models',
    # Audio / signal processing
    'maad',
    'maad.sound',
    'maad.util',
    'soundfile',
    # Numeric
    'numpy',
    'scipy',
    'scipy.signal',
    # Misc
    'tqdm',
    'matplotlib',
    'matplotlib.backends.backend_agg',
    'PIL',
    'uuid',
    'concurrent.futures',
]

# ── Collected data files (transformers tokeniser vocab, etc.) ─────────────────
datas = []

# Include transformers data (sentencepiece / tokenizer files)
try:
    import transformers
    transformers_path = Path(transformers.__file__).parent
    datas.append((str(transformers_path), 'transformers'))
except ImportError:
    pass

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy unused packages to keep bundle smaller
        'tkinter',
        '_tkinter',
        'matplotlib.backends.backend_tk',
        'matplotlib.backends.backend_wxagg',
        'matplotlib.backends.backend_qt5agg',
        'IPython',
        'jupyter',
        'notebook',
        'pytest',
        'unittest',
        'test',
        'tests',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='clap_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # Keep UPX off; it can corrupt some PyTorch binaries
    console=True,       # Console mode: stdout/stderr must be visible for IPC
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='clap_backend',
)
