"""
분석/생성에 쓰이는 모든 조절 가능한 값. 튜닝은 이 파일에서만 한다.
"""
from dataclasses import dataclass

# ---------------- Audio Analysis ----------------
SAMPLE_RATE = 22050
HOP_LENGTH = 256  # 약 11.6ms 해상도
N_FFT = 2048

FREQUENCY_BANDS = {
    "low": (20.0, 250.0),
    "mid": (250.0, 2000.0),
    "high": (2000.0, 11025.0),
}

MIN_AUDIO_DURATION_SEC = 1.0
SILENCE_RMS_THRESHOLD = 1e-4

# 실제 곡에서는 전역 정규화만 쓰면 하이햇/치찰음이 과대평가되기 쉬워
# 이벤트 주변의 로컬 대비를 같이 본다.
LOCAL_FEATURE_WINDOW_SEC = 0.80
LOCAL_PERCENTILE = 70.0
LOCAL_CONTRAST_CLIP = 2.0

# ---------------- Tempo estimation memory ----------------
# librosa's default tempo estimator builds a full autocorrelation tempogram of shape
# (win_length, n_frames) across the ENTIRE track at whatever hop_length the onset
# envelope was computed with. At HOP_LENGTH=256 (~11.6ms) a several-minute song makes
# that array hundreds of MB (see analyzer/docs/memory-fix-v0.3.2.md for measurements).
# Global tempo (a single BPM number) does not need 11.6ms resolution, so the *initial*
# tempo guess is estimated from a much coarser onset envelope; the fine-resolution
# envelope is still used for beat tracking, grid alignment and note timing exactly as
# before. TEMPO_ESTIMATION_HOP_LENGTH must stay a multiple of HOP_LENGTH.
TEMPO_ESTIMATION_HOP_LENGTH = 512
TEMPO_ESTIMATION_AC_SIZE_SEC = 8.0

# ---------------- Chunked spectral analysis (memory) ----------------
# S = np.abs(librosa.stft(y, ...))를 곡 전체에 대해 한 번에 만들면 (n_fft/2+1, n_frames)
# 크기의 배열이 곡 길이에 비례해 커진다. band 별 feature(centroid/energy/onset)는
# 전부 "각 시간 프레임에서 얼마씩 축약되는" 계산이라 시간축을 청크로 나눠 처리해도
# 정확히 같은 값을 낼 수 있다 (memory-fix-v0.3.2.md 참고). 이 값은 한 청크가
# 담당하는 시간(초)이며, 메모리/속도 트레이드오프용 튜닝 지점이다.
SPECTRAL_CHUNK_SECONDS = 20.0

# ---------------- Beat Grid ----------------
GRID_SUBDIVISIONS_PER_BEAT = 4
QUANTIZE_THRESHOLD_SEC = 0.035
QUANTIZE_MAX_FRACTION_OF_16TH = 0.3

# ---------------- Musical Event ----------------
SALIENCE_W_STRENGTH = 0.32
SALIENCE_W_LOUDNESS = 0.28
SALIENCE_W_LOCAL_CONTRAST = 0.40
SALIENCE_BONUS_ON_BEAT = 0.10
SALIENCE_BONUS_ON_8TH = 0.05

# 같은 타격이 리버브/스펙트럼 변화 때문에 여러 onset으로 쪼개지는 것을 억제.
# 180BPM 16분(약 83ms)보다 충분히 작게 유지한다.
EVENT_MERGE_WINDOW_SEC = 0.045
EVENT_CLUSTER_MAX_WINDOW_SEC = 0.060


@dataclass(frozen=True)
class DifficultyConfig:
    name: str
    level: int
    max_division: int
    min_salience: float
    min_interval_sec: float
    same_lane_min_interval_sec: float
    max_notes_per_second: int
    allow_unquantized: bool
    max_sixteenth_ratio: float


DIFFICULTIES = {
    "easy": DifficultyConfig("Easy", 3, 4, 0.43, 0.28, 0.55, 3, False, 0.0),
    "normal": DifficultyConfig("Normal", 6, 8, 0.30, 0.16, 0.32, 5, False, 0.0),
    "hard": DifficultyConfig("Hard", 10, 16, 0.20, 0.10, 0.20, 8, True, 0.25),
    "expert": DifficultyConfig("Expert", 14, 16, 0.12, 0.07, 0.14, 12, True, 1.0),
    "extreme": DifficultyConfig("Extreme", 18, 32, 0.09, 0.055, 0.12, 14, True, 1.0),
}

# ---------------- Pattern Generator ----------------
LEFT_HAND = (0, 1)
RIGHT_HAND = (2, 3)
MAX_SAME_LANE_RUN = 2
BIG_JUMP_MIN_INTERVAL_SEC = 0.30
BIG_JUMP_SOFT_INTERVAL_SEC = 0.70
STREAM_INTERVAL_SEC = 0.20

BAND_LANE_PREFERENCE = {
    "low": (1.0, 0.6, 0.3, 0.35),
    "mid": (0.3, 1.0, 1.0, 0.3),
    "high": (0.35, 0.3, 0.6, 1.0),
}

PATTERN_NAMES = ("alternate", "stair", "bounce", "zigzag", "anchor", "repeat")

# phrase fuzzy matching. 같은 마디가 약간 다르게 편곡되어도 재사용 후보로 본다.
PHRASE_SIMILARITY_THRESHOLD = 0.72
PHRASE_TIMING_WEIGHT = 0.65
PHRASE_BAND_WEIGHT = 0.35
PHRASE_MAX_COUNT_DELTA = 1


# ---------------- Note Type Planner ----------------
@dataclass(frozen=True)
class NoteTypeConfig:
    hold_max_ratio: float
    flick_max_ratio: float
    hold_min_beats: float
    hold_max_beats: float
    flick_min_salience: float
    flick_min_local_contrast: float
    max_same_hand_notes_during_hold: int
    max_total_notes_during_hold: int


NOTE_TYPE_CONFIGS = {
    # Easy는 읽기 쉬운 Tap 전용. Normal부터 단순 Hold, Hard/Expert에서만 Flick을 허용한다.
    "Easy": NoteTypeConfig(0.00, 0.00, 1.0, 1.0, 1.0, 1.0, 0, 0),
    "Normal": NoteTypeConfig(0.05, 0.00, 1.0, 1.5, 1.0, 1.0, 0, 0),
    "Hard": NoteTypeConfig(0.09, 0.04, 0.5, 2.0, 0.66, 0.62, 0, 3),
    "Expert": NoteTypeConfig(0.12, 0.08, 0.5, 2.0, 0.58, 0.54, 1, 5),
    "Extreme": NoteTypeConfig(0.14, 0.08, 0.5, 3.0, 0.58, 0.54, 1, 6),
}

HOLD_MIN_SALIENCE = 0.34
HOLD_MIN_DURATION_SEC = 0.30
HOLD_MAX_DURATION_SEC = 2.00
HOLD_SAME_LANE_CLEARANCE_SEC = 0.10
HOLD_MIN_START_RMS = 0.22
HOLD_MIN_START_BAND_ENERGY = 0.18
HOLD_RMS_RETAIN_RATIO = 0.52
HOLD_BAND_RETAIN_RATIO = 0.48
HOLD_RMS_FLOOR = 0.16
HOLD_BAND_FLOOR = 0.13
HOLD_MAX_DIP_FRAMES = 3

FLICK_HIGH_DOMINANCE_RATIO = 1.30
FLICK_MIN_INTERVAL_SEC = 0.34
FLICK_MIN_NEIGHBOR_GAP_SEC = 0.12
FLICK_PHRASE_END_GAP_SEC = 0.24
FLICK_PHRASE_END_BEAT_FRACTION = 0.45
# Flick 후보는 앞/뒤 간격이 주변 리듬(국소 중앙 간격)의 이 배수 이상일 때만 '구절 끝/고립 강세'로 본다.
FLICK_CONTEXT_GAP_RATIO = 1.5

# ---------------- Tempo refinement ----------------
TEMPO_REFINE_GOOD_ENOUGH = 0.08
TEMPO_REFINE_RATIOS = (1.5, 2 / 3, 2.0, 0.5, 4 / 3, 0.75)
TEMPO_REFINE_MIN_IMPROVEMENT = 0.05
TEMPO_REFINE_MAX_ACCENT_DROP = 0.04
TEMPO_MIN_BPM = 60.0
TEMPO_MAX_BPM = 240.0
PHASE_REFINE_MIN_GAIN = 1.2
ACCENT_W_STRENGTH = 0.3
ACCENT_W_LOUDNESS = 0.7
ONSET_LATENCY_COMP_SEC = 0.010
GRID_ALIGN_MAX_SHIFT_SEC = 0.04

# tempo 후보 confidence. 완전한 확률이 아니라 A/B 회귀 비교용 신뢰 지표다.
TEMPO_CANDIDATE_LIMIT = 5
TEMPO_CONFIDENCE_SCALE = 8.0
TEMPO_BEAT_ACCENT_TOLERANCE_SEC = 0.055
TEMPO_BEAT_ACCENT_TOLERANCE_FRACTION = 0.14
TEMPO_OCTAVE_ACCENT_GAIN = 0.25
TEMPO_OCTAVE_SELECTION_GAIN = 0.008
TEMPO_BEAT_ACCENT_WEIGHT = 0.16

# ---------------- Quality report ----------------
QUALITY_TARGET_LANE_MIN = 0.15
QUALITY_TARGET_LANE_MAX = 0.35
QUALITY_EXTREME_JUMP_WARN = 0.08
QUALITY_OFFGRID_WARN = 0.25
QUALITY_SAME_LANE_WARN = 0.20
