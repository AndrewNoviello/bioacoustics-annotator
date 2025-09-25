#!/usr/bin/env python3
"""
Minimal Python ML backend for Bioacoustics Annotation Tool
Synchronous version for simple operations
"""

import json
import sys
import os
from typing import Dict, Any
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

original_stdout = sys.stdout

# Add the backend directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from utils import load_models, batch_audio_detection

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
        if not model_name:
            self.send_message("error", {"success": False, "error": "Missing model_name"})
            return {"success": False, "error": "Missing model_name"}
        
        if model_name != 'CLAP_Jan23':
            self.send_message("error", {"success": False, "error": f"Unknown model: {model_name}. Only CLAP_Jan23 is supported."})
            return {"success": False, "error": f"Unknown model: {model_name}. Only CLAP_Jan23 is supported."}
        
        try:
            # Send start message
            self.send_message("model_loading_started", {"model_name": model_name})
            
            # Run model loading in thread pool
            self.model = self.executor.submit(load_models, model_name, self.send_message).result()
            
            # Send completion message
            self.send_message("model_loading_completed", {
                "model_name": model_name,
                "success": True
            })
            
            return {"success": True, "message": f"Model {model_name} loaded successfully"}
        except Exception as e:
            # Send error message
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
        try:
            # Check if model is loaded
            if self.model is None:
                return {"success": False, "error": "Model not loaded. Please load a model first."}
            
            # Send start message
            self.send_message("detection_started", {
                "save_dir": save_dir,
                "files_count": len(files),
                "pos_prompts": pos_prompts,
                "neg_prompts": neg_prompts,
                "theta": theta
            })
            
            # Set up paths
            temp_filename = "temp.csv"
            temp_path = os.path.join(save_dir, temp_filename)
                        
            # Run batch detection in thread pool
            self.executor.submit(
                batch_audio_detection,
                files,
                neg_prompts,
                pos_prompts,
                theta,
                temp_path
            ).result()
            
            # Check if results file was created
            if not os.path.exists(temp_path):
                self.send_message("error", {
                    "success": False,
                    "error": "Detection results file was not created"
                })
                return {"success": False, "error": "Detection results file was not created"}
            
            else:
                # Update config.json with temp experiment data
                config_path = os.path.join(save_dir, "config.json")
                
                try:
                    with open(config_path, 'r') as f:
                        config_data = json.load(f)
                    
                    # Ensure experiments object exists
                    if 'experiments' not in config_data:
                        config_data['experiments'] = {}
                    
                    # Add temp experiment
                    config_data['experiments']['temp'] = {
                        'posPrompts': pos_prompts,
                        'negPrompts': neg_prompts,
                        'theta': theta,
                        'time': datetime.now().isoformat()
                    }
                    
                    with open(config_path, 'w') as f:
                        json.dump(config_data, f, indent=2)
                        
                except Exception as e:
                    self.send_message("error", {
                        "save_dir": save_dir,
                        "success": False,
                        "error": str(e)
                    })
                    return {"success": False, "error": str(e)}

                self.send_message("detection_completed", {
                    "success": True,
                    "message": f"Detection completed."
                })
                return {"success": True, "message": f"Detection completed."}

        except Exception as e:
            # Send error message
            self.send_message("error", {
                "save_dir": save_dir,
                "success": False,
                "error": str(e)
            })
            return {"success": False, "error": str(e)}

def main():
    backend = MLBackend()
    
    while True:
        try:
            line = sys.stdin.readline()
            
            if not line:
                break
                
            command = json.loads(line.strip())
            backend.send_message("command", command)
            action = command.get("action")
            
            # Route commands to appropriate methods
            if action == "load_model":
                backend.load_model(command.get("modelName"))
            elif action == "run_batch_detection":
                backend.run_batch_detection(
                    save_dir=command.get("saveDir"),
                    files=command.get("files"),
                    pos_prompts=command.get("posPrompts"),
                    neg_prompts=command.get("negPrompts"),
                    theta=command.get("theta", 0.5)
                )
            else:
                raise Exception(f"Unknown action: {action}")

        except Exception as e:
            backend.send_message("error", {"success": False, "error": str(e)})

if __name__ == "__main__":
    main() 