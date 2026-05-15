# Ke Chen
# knutchen@ucsd.edu
# HTS-AT: A HIERARCHICAL TOKEN-SEMANTIC AUDIO TRANSFORMER FOR SOUND CLASSIFICATION AND DETECTION
# The configuration for training the model
#
# NOTE: This config has been modified for inference-only use in CLAP Desktop.
# Hardcoded paths have been removed. Training-specific settings are kept for
# compatibility but are not used during inference.

import os

# Get the directory containing this config file
_config_dir = os.path.dirname(os.path.abspath(__file__))
_ml_dir = os.path.dirname(_config_dir)

# Experiment settings (kept for compatibility, not used in inference)
exp_name = "exp_htsat_pretrain"

# Paths are now relative to the project directory
# These can be overridden via environment variables if needed
workspace = os.environ.get('CLAP_WORKSPACE', _ml_dir)
dataset_path = os.environ.get('CLAP_DATASET_PATH', os.path.join(_ml_dir, 'data'))
desed_folder = os.environ.get('CLAP_DESED_FOLDER', os.path.join(_ml_dir, 'data', 'desed'))

dataset_type = "audioset"  # "audioset" "esc-50" "scv2"
index_type = "full_train"  # only works for audioset
balanced_data = True  # only works for audioset

loss_type = "clip_bce"
# AudioSet & SCV2: "clip_bce" |  ESC-50: "clip_ce"

# Checkpoint paths (relative to ml directory or absolute)
resume_checkpoint = None

esc_fold = 0  # just for esc dataset

debug = False

# Training hyperparameters (not used in inference)
random_seed = 970131
batch_size = 32 * 4
learning_rate = 1e-3
max_epoch = 100
num_workers = 3

lr_scheduler_epoch = [10, 20, 30]
lr_rate = [0.02, 0.05, 0.1]

# Data preparation settings (deprecated but kept for compatibility)
enable_token_label = False
class_map_path = "class_hier_map.npy"
class_filter = None
retrieval_index = [15382, 9202, 130, 17618, 17157, 17516, 16356, 6165, 13992, 9238, 5550, 5733, 1914, 1600, 3450, 13735, 11108, 3762,
    9840, 11318, 8131, 4429, 16748, 4992, 16783, 12691, 4945, 8779, 2805, 9418, 2797, 14357, 5603, 212, 3852, 12666, 1338, 10269, 2388, 8260, 4293, 14454, 7677, 11253, 5060, 14938, 8840, 4542, 2627, 16336, 8992, 15496, 11140, 446, 6126, 10691, 8624, 10127, 9068, 16710, 10155, 14358, 7567, 5695, 2354, 8057, 17635, 133, 16183, 14535, 7248, 4560, 14429, 2463, 10773, 113, 2462, 9223, 4929, 14274, 4716, 17307, 4617, 2132, 11083, 1039, 1403, 9621, 13936, 2229, 2875, 17840, 9359, 13311, 9790, 13288, 4750, 17052, 8260, 14900]
token_label_range = [0.2, 0.6]
enable_time_shift = False
enable_label_enhance = False
enable_repeat_mode = False

# Model design settings
enable_tscam = True  # enable the token-semantic layer

# Signal processing parameters (IMPORTANT for inference)
sample_rate = 32000  # 16000 for scv2, 32000 for audioset and esc-50
clip_samples = sample_rate * 10  # audio_set 10-sec clip
window_size = 1024
hop_size = 320  # 160 for scv2, 320 for audioset and esc-50
mel_bins = 64
fmin = 50
fmax = 14000
shift_max = int(clip_samples * 0.5)

# Data collection settings
classes_num = 527  # esc: 50 | audioset: 527 | scv2: 35
patch_size = (25, 4)  # deprecated
crop_size = None  # deprecated

# HTSAT hyperparameters
htsat_window_size = 8
htsat_spec_size = 256
htsat_patch_size = 4
htsat_stride = (4, 4)
htsat_num_head = [4, 8, 16, 32]
htsat_dim = 96
htsat_depth = [2, 2, 6, 2]

# Pretrained model path (relative paths supported)
swin_pretrain_path = None

# Model behavior settings
htsat_attn_heatmap = False
htsat_hier_output = False
htsat_use_max = False

# Ensemble settings (not used in inference)
ensemble_checkpoints = []
ensemble_strides = []

# Weight averaging settings (relative paths)
wa_folder = os.path.join(_ml_dir, 'checkpoints')
wa_model_path = "HTSAT_AudioSet_Saved_x.ckpt"

# Model paths for ensemble (not used in current inference)
esm_model_pathes = []

# Framewise localization settings
heatmap_dir = os.path.join(_ml_dir, 'output', 'heatmaps')
test_file = "htsat-test-ensemble"
fl_local = False
fl_dataset = None
fl_class_num = [
    "Speech", "Frying", "Dishes", "Running_water",
    "Blender", "Electric_shaver_toothbrush", "Alarm_bell_ringing",
    "Cat", "Dog", "Vacuum_cleaner"
]

# Map 527 classes into 10 classes
fl_audioset_mapping = [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [366, 367, 368],
    [364],
    [288, 289, 290, 291, 292, 293, 294, 295, 296, 297],
    [369],
    [382],
    [310, 388, 389, 390, 391, 392, 393, 394, 395, 396, 397, 398, 399, 400, 401, 402],
    [81, 82, 83, 84, 85],
    [74, 75, 76, 77, 78, 79],
    [377]
]