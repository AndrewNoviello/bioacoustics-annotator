#!/usr/bin/env python3
"""
Minimal Python ML backend for Bioacoustics Annotation Tool
Synchronous version for simple operations

This script serves as the entry point for the Python ML backend.
It communicates with the Electron main process via stdin/stdout JSON messages.
"""

import json
import sys
import os
from typing import Dict, Any
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

original_stdout = sys.stdout
sys.stdout = sys.stderr  # Redirect print() to stderr so IPC (JSON on stdout) stays clean

# Get the directory containing this script
_script_dir = os.path.dirname(os.path.abspath(__file__))

# Add the parent directory to Python path to support relative imports
# This is needed because this script runs as __main__
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

# Import utilities - these will use relative imports internally
from utils import load_models, batch_audio_detection, get_models_dir

ALLOWED_ACTIONS = {'load_model', 'run_batch_detection', 'cancel'}


def _allowed_models():
    """Discover available model checkpoints (.pth) at the models directory.

    Enumerated on every load_model call so we don't have to hand-sync a
    hardcoded list between JS and Python when a new model checkpoint is
    added. The JS side does the same.
    """
    try:
        models_dir = get_models_dir()
        if not os.path.isdir(models_dir):
            return set()
        return {
            os.path.splitext(name)[0]
            for name in os.listdir(models_dir)
            if name.lower().endswith('.pth')
        }
    except Exception:
        return set()


class MLBackend:
    def __init__(self):
        self.model = None
        # Thread pool for CPU-bound operations (model loading, batch detection)
        self.executor = ThreadPoolExecutor(max_workers=4)

    def send_message(self, message_type: str, data: Dict[str, Any]):
        """Send a message directly to JavaScript"""
        message = {
            "type": message_type,
            "data": data,
            "timestamp": datetime.now().isoformat()
        }
        original_stdout.write(json.dumps(message) + "\n")
        original_stdout.flush()

    def load_model(self, model_name: str) -> Dict[str, Any]:
        """Load the specified model"""
        allowed = _allowed_models()
        if not model_name or model_name not in allowed:
            msg = f"Unknown model: {model_name}. Allowed: {', '.join(sorted(allowed)) or '(none found)'}"
            self.send_message("error", {"success": False, "error": msg})
            return {"success": False, "error": msg}

        try:
            self.send_message("model_loading_started", {"model_name": model_name})

            self.model = self.executor.submit(load_models, model_name, self.send_message).result()

            self.send_message("model_loading_completed", {
                "model_name": model_name,
                "success": True
            })
            return {"success": True, "message": f"Model {model_name} loaded successfully"}
        except Exception as e:
            self.send_message("model_loading_completed", {
                "model_name": model_name,
                "success": False,
                "error": str(e)
            })
            return {"success": False, "error": str(e)}

    def run_batch_detection(self, save_dir: str,
                            files: list, pos_prompts: str, neg_prompts: str,
                            theta: float = 0.5) -> Dict[str, Any]:
        """Run batch detection on audio files (saves to temp.csv)"""
        # Validate files
        if not isinstance(files, list) or len(files) == 0:
            err = "files must be a non-empty list"
            self.send_message("error", {"success": False, "error": err})
            return {"success": False, "error": err}
        for f in files:
            if not isinstance(f, str) or not f.lower().endswith('.wav'):
                err = f"Invalid file: {f!r}. Only .wav files are supported."
                self.send_message("error", {"success": False, "error": err})
                return {"success": False, "error": err}

        # Validate theta
        try:
            theta = float(theta)
        except (TypeError, ValueError):
            theta = 0.5
        if not (0.0 <= theta <= 1.0):
            err = f"theta must be in [0, 1], got {theta}"
            self.send_message("error", {"success": False, "error": err})
            return {"success": False, "error": err}

        if self.model is None:
            err = "Model not loaded. Please load a model first."
            self.send_message("error", {"success": False, "error": err})
            return {"success": False, "error": err}

        try:
            self.send_message("detection_started", {
                "save_dir": save_dir,
                "files_count": len(files),
                "pos_prompts": pos_prompts,
                "neg_prompts": neg_prompts,
                "theta": theta
            })

            temp_path = os.path.join(save_dir, "temp.csv")

            # Forward batch progress to the renderer so it can show a
            # percentage. Runs on the worker thread; send_message writes to
            # stdout which is async-safe enough since Python stdout has its
            # own lock around writes.
            def _emit_progress(data):
                self.send_message("detection_progress", data)

            self.executor.submit(
                batch_audio_detection,
                files,
                neg_prompts,
                pos_prompts,
                theta,
                temp_path,
                _emit_progress,
            ).result()

            if not os.path.exists(temp_path):
                err = "Detection results file was not created"
                self.send_message("error", {"success": False, "error": err})
                return {"success": False, "error": err}

            # Update config.json with temp experiment data
            config_path = os.path.join(save_dir, "config.json")
            tmp_config = config_path + ".tmp"
            try:
                with open(config_path, 'r') as f:
                    config_data = json.load(f)

                if 'experiments' not in config_data:
                    config_data['experiments'] = {}

                config_data['experiments']['temp'] = {
                    'posPrompts': pos_prompts,
                    'negPrompts': neg_prompts,
                    'theta': theta,
                    'time': datetime.now().isoformat()
                }

                with open(tmp_config, 'w') as f:
                    json.dump(config_data, f, indent=2)
                os.replace(tmp_config, config_path)

            except Exception as e:
                self.send_message("error", {"save_dir": save_dir, "success": False, "error": str(e)})
                return {"success": False, "error": str(e)}

            self.send_message("detection_completed", {"success": True, "message": "Detection completed."})
            return {"success": True, "message": "Detection completed."}

        except Exception as e:
            self.send_message("error", {"save_dir": save_dir, "success": False, "error": str(e)})
            return {"success": False, "error": str(e)}


def main():
    backend = MLBackend()

    # Signal to the Electron host that the backend is ready
    backend.send_message("ready", {})

    while True:
        try:
            line = sys.stdin.readline()

            if not line:
                break

            command = json.loads(line.strip())
            action = command.get("action")

            if action not in ALLOWED_ACTIONS:
                raise ValueError(f"Unknown action: {action!r}")

            if action == "cancel":
                # Cancel is a no-op for now (detection runs synchronously)
                pass
            elif action == "load_model":
                backend.load_model(command.get("modelName"))
            elif action == "run_batch_detection":
                backend.run_batch_detection(
                    save_dir=command.get("saveDir"),
                    files=command.get("files"),
                    pos_prompts=command.get("posPrompts"),
                    neg_prompts=command.get("negPrompts"),
                    theta=command.get("theta", 0.5)
                )

        except Exception as e:
            backend.send_message("error", {"success": False, "error": str(e)})


if __name__ == "__main__":
    main()
