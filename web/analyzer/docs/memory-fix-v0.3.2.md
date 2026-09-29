# Analyzer 메모리 최적화 (v0.3.2) — 기술 노트

`chartgen/config.py`, `chartgen/features.py`의 여러 주석이 이 문서를 가리킨다.
"왜 이렇게 계산하는가"에 대한 근거와 실측치를 여기 모아둔다. 상위 수준 인계
내용(테스트 결과, 커밋 메시지 제안 등)은 리포지토리 루트의
`HANDOFF_MEMORY_FIX.md`를 참고할 것.

## 배경

Railway(메모리 제한 약 1GB) 위에서 `/api/analyze`가 실제 곡 분석 중
`Killed`(OOM으로 추정)되고 Uvicorn이 재시작하며 클라이언트에는 502가
내려가는 문제가 있었다. 원인은 AI/LLM이나 인프라가 아니라, analyzer 내부의
특정 계산 3곳이 곡 길이에 비례해 매우 큰 임시 배열을 만드는 것이었다.

측정은 `mem_bench_subprocess.py`로 수행했다: 각 케이스를 별도 서브프로세스로
실행하고 그 프로세스 자신의 `/proc/self/status`의 `VmHWM`(커널이 기록하는
진짜 peak resident set size)을 읽는다. 부모 프로세스의 누적치가 섞이지 않게
서브프로세스 단위로 격리했다.

## 원인 1 (가장 큼): 전역 BPM 추정의 autocorrelation tempogram

`librosa.beat.beat_track(bpm=None)`이 내부적으로 호출하는 tempo 추정기
(`librosa.feature.tempo`)는 `(win_length, n_frames)` 크기의 dense float64
windowed-autocorrelation 배열을 만들고 시간축으로 평균낸다. `win_length`는
`ac_size`(기본 8초) 분량의 프레임 수, `n_frames`는 곡 길이에 비례한다.
6분 곡(HOP_LENGTH=256) 기준 이 배열 하나가 약 **715MB**였다.

여러 짧은 윈도우의 자기상관을 평균하는 것은, 템포가 일정한 신호에서는
전체 신호를 한 번 전역 자기상관한 것과 근사적으로 같은 결과를 준다. 그래서
`estimate_initial_bpm_light()`은 onset envelope 전체를 한 번만
자기상관(1차원, O(n_frames))해서 같은 로그정규 사전분포로 최적 BPM을 고른다.
해상도(HOP_LENGTH)는 그대로 유지하므로 정밀도 저하가 없다 — 처음에
hop을 성기게(2048, 512) 낮추는 방식을 시도했으나 `hat_storm_140`,
`kick_120` 같은 정밀 BPM 스트레스 테스트가 깨져서 폐기하고, 해상도를 유지하는
전역 자기상관 방식으로 교체했다.

- 자기상관 결과는 `librosa.util.normalize(ac, norm=np.inf)`로 정규화해야 한다.
  정규화하지 않으면 `log1p(1e6 * ac)`에 큰 음수가 들어가 도메인 오류(NaN)가
  발생한다.
- 이 초기값을 `beat_track(..., bpm=coarse_bpm)`에 넘기면 내부의 비싼
  tempo() 재계산을 건너뛴다. 실제 beat 위치는 여전히 HOP_LENGTH=256
  onset envelope 그대로 정렬한다.

측정: 715MB → 0MB 증가.

## 원인 2: 전체곡 RMS의 8배 오버랩 프레이밍

`librosa.feature.rms(y=y, frame_length=2048, hop_length=256)`는
`(frame_length, n_frames)` 크기(8배 오버랩)의 조밀한 배열을 만든 뒤 평균
축약한다. 6분 곡 기준 약 220MB.

`rms_from_signal()`은 제곱값의 누적합(O(len(y)) 하나) 슬라이딩 윈도우로
동일한 결과를 낸다(검증: librosa 대비 최대오차 7.45e-9, float32 정밀도
수준). `center=True, pad_mode='constant'` 컨벤션까지 동일하게 재현했다.

측정: 220MB → 약 70~150MB(곡 길이에 비례하는 O(n) 비용만 남음).

## 원인 3 (가장 오래 남아있던 것): 전체곡 mel 스펙트로그램 기반 onset

`librosa.onset.onset_strength(y=y, ...)`는 내부적으로
`melspectrogram(y=y, ...)`을 호출해 전체곡 길이의 선형 STFT
`(n_fft/2+1=1025, n_frames)`를 만든 뒤 128개 mel 필터로 축약한다. 문제는
"축약되기 전" 선형 스펙트로그램 자체가 곡 전체 길이로 메모리에 존재한다는
점이다. 8분 dense 곡 기준 이 호출 하나가 약 627MB 오버헤드였다.

`onset_envelope_chunked()`는 다음을 이용한다:
1. `onset_strength`의 공식은 `mean_f max(0, db[t+lag]-db[t])` (lag=1
   기본값) — 이웃 프레임 1개만 있으면 청크 경계를 넘길 수 있다.
2. mel 스펙트로그램은 선형 스펙트로그램보다 8배 이상 작다(128 vs 1025행).
3. `power_to_db(mel, ref=1.0)`의 `ref`가 **고정 상수**라서(band 계산과
   달리) 청크마다 달라지지 않는다.

그래서 비싼 선형 STFT만 시간축 청크(기본 20초)로 나눠 처리하고, 즉시 훨씬
작은 mel 스펙트로그램으로 축약해 이어붙인다. 다 이어붙인 뒤에는 mel
스펙트로그램 자체가 이미 작으므로(8분 곡 기준 약 21MB), db 변환/차분/패딩은
한 번에 계산해도 문제없다 — 2-pass가 필요 없다.

검증: 4개 합성곡(accent, kick_120, 6분, 8분)에서 **원본 대비 최대오차 0.0**
(bit-for-bit 동일).

측정: 8분 dense 곡 기준 약 627MB 오버헤드 → 약 291MB.

## 원인 4: band별 onset의 `ref=np.max` / `top_db` 전역 의존성

`librosa.power_to_db(Sb**2, ref=np.max)`의 `ref=np.max`는 **배열 전체의
최댓값**을 기준(0dB)으로 삼는다. `top_db` 클리핑(`log_spec.max() - top_db`)도
마찬가지로 배열 전체 기준이다. 이 두 값 모두 "청크 하나만 보고는" 알 수 없는
전역(곡 전체) 정보다.

`compute_spectral_band_features_chunked()`는 2-pass로 처리한다:
- **Pass 1**: 청크마다 `Sb.sum(axis=0)`(band_energy, 그대로 채택)과
  대역별 `(Sb**2).max()`의 러닝 최댓값(band_power_max)을 구한다.
- **Pass 2**: 확정된 전역 `band_power_max`를 고정 `ref`로 다시 STFT를
  계산해 `power_to_db(Sb**2, ref=band_power_max, top_db=None)` 후
  **수동으로 `-80.0`(top_db 기본값) 플로어를 적용**한다.

⚠️ 처음 구현에서 `power_to_db(..., top_db=80.0)`를 그대로 썼다가, 전역
최댓값이 포함되지 않은 청크에서는 `top_db` 플로어가 "그 청크만의" 최댓값
기준으로 다시 계산되어 원본과 다른 값이 나오는 버그가 있었다(`accent.wav`
high band에서 diff 최대 0.039 관찰). `ref`를 전역값으로 고정하면
`log_spec.max()`가 항상 정확히 0이 되므로 전역 플로어는 항상 정확히
`-80.0`이라는 점을 이용해 수동 적용으로 고쳤다. 수정 후 최대오차는
float32 정밀도 수준(~1e-7)이다.

onset 자기상관 lag=1 경계는, 청크 간 마지막 1개 컬럼(`carry_last_col`)을
다음 청크 앞에 붙였다가 결과에서 버리는 방식으로 이어붙였다.

측정(band 계산 전체, 8분 dense 곡 기준): 약 97~340MB → 수십 MB.

## 원인 5: `librosa.load()`의 불필요한 오버헤드 (WAV/FLAC/OGG)

`librosa.load()`는 비압축 포맷(soundfile/libsndfile이 직접 읽을 수 있는
WAV/FLAC/OGG/AIFF)에서도 순수 `soundfile.read()` 대비 5배 이상 큰 임시
버퍼를 만든다(8분 곡 기준 42MB 결과물에 216MB 소요, 순수 soundfile은
41MB). Android Companion이 실제로 보내는 22.05kHz mono WAV가 정확히 이
경로에 해당한다.

`_load_via_soundfile()`은 WAV/FLAC/OGG/AIFF 확장자에서 soundfile로 직접
읽고 필요시(다른 샘플레이트일 때만) `librosa.resample`을 적용한다. 그
외 포맷(mp3/m4a/aac/webm/mp4, 압축 해제가 필요한 것들)은 기존
`librosa.load()`(내부적으로 audioread/ffmpeg 사용) 경로를 그대로 둔다 —
이 포맷들은 애초에 soundfile이 못 읽으므로 손대지 않았다.

측정: 8분 곡 기준 216MB → 약 50MB.

## STFT 청크 슬라이싱의 정확성 근거

`librosa.stft(y, n_fft, hop_length, center=True, pad_mode='constant')`는
내부적으로 `y`를 `n_fft//2`만큼 앞뒤로 zero-padding한 뒤 `center=False`와
동일하게 프레임을 자른다. 따라서:

```python
y_padded = np.pad(y, (n_fft // 2, n_fft // 2), mode="constant")
# 프레임 [f0, f1) 구간은 아래와 정확히 같다 (실측 최대오차 0.0):
chunk = y_padded[f0 * hop : (f1 - 1) * hop + n_fft]
S_chunk = np.abs(librosa.stft(chunk, n_fft=n_fft, hop_length=hop, center=False))
```

이 성질이 이번 청크화 전체의 기반이다. 이웃 청크 사이에 추가 오버랩이나
근사가 전혀 필요 없다 — 청크 경계에서 잘라도 그 프레임 자체의 값은 항상
정확하다(달라지는 건 그 프레임을 "누구와 비교하느냐"뿐이고, 그건 onset
diff의 lag=1 캐리 전달로 해결했다).

## 측정 요약 (VmHWM, subprocess 격리, expert/seed 42, 174BPM dense 합성곡)

저장소가 고정한 librosa==0.11.0 기준 (배포 환경과 동일):

| 케이스 | v0.3.1 원본 | main 18d8a55 자체 수정 | v0.3.2 (이 오버레이) |
|---|---|---|---|
| 6분 WAV | ~1436MB | 605MB | 454MB |
| 8분 WAV | 700MB 초과 | 709MB | **480MB** |
| 10분 WAV | ~2168MB | 812MB | 511MB |
| 10분 mp3 | - | - | 513MB |
| 10분 m4a(스테레오 44.1k) | - | - | 702MB |

librosa 1.0.0 환경에서는 8분 395MB로 더 낮게 측정된다 (라이브러리 내부 구현 차이).
m4a/mp4 등 압축 포맷은 soundfile 직접 로딩 대상이 아니라 `librosa.load`(audioread/ffmpeg)
경로를 쓰므로 디코딩/리샘플 오버헤드가 추가된다.

## 튜닝 지점

- `config.TEMPO_ESTIMATION_AC_SIZE_SEC` (기본 8.0초): 전역 BPM 자기상관 윈도우 길이.
- `config.SPECTRAL_CHUNK_SECONDS` (기본 20.0초): band/centroid, 전체곡 onset
  계산의 청크 크기. 작을수록 peak 메모리는 줄고 STFT 호출 횟수(오버헤드)는 늘어난다.
