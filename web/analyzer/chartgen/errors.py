class ChartGenError(Exception):
    """채보 생성 파이프라인의 기본 예외."""


class AudioLoadError(ChartGenError):
    """오디오 파일이 없거나, 디코딩할 수 없거나, 형식이 잘못된 경우."""


class InvalidOptionError(ChartGenError):
    """잘못된 난이도 이름 등 옵션 오류."""
