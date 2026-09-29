"""
chartgen - 오디오 파일에서 4키 Tap 채보를 자동 생성하는 분석 파이프라인 (v0.2).

모듈 경계 (향후 Chart Planner / AI 모델 삽입 지점을 명확히 하기 위해 분리):

    features.py     Audio Analysis     오디오 -> AudioFeatures
    beatgrid.py     Beat Grid          beat 타임스탬프 -> 1/4, 1/8, 1/16 grid
    events.py       Musical Events     AudioFeatures + BeatGrid -> MusicalEvent[]
    filtering.py    Event Selection    MusicalEvent[] -> 난이도별로 선별된 이벤트
    patterns.py     Pattern Generator  선별 이벤트 -> 레인 배치 (state machine)
    playability.py  Playability Pass   레인 배치 결과 후처리
    chart.py        Output             v0.1 호환 chart JSON + 리포트
    pipeline.py     위 단계를 순서대로 호출하는 오케스트레이터
"""
from .errors import AudioLoadError, ChartGenError  # noqa: F401
from .pipeline import GenerationResult, generate_chart  # noqa: F401
