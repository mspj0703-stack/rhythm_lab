# BEATDASH::Revive

웹 4키 리듬게임 코어(v0.1) + 오디오 기반 자동 채보 생성기(v0.3-RC1).

## 게임 (React + Vite + TypeScript)

```bash
npm install
npm run dev
```

- 기본: 내장 테스트 채보 + `public/test-video.mp4`
- 외부 채보: `/?chart=/generated/accent.expert.json&video=/generated/accent.mp4`
- 조작: D F J K, Flick = 레인키 + Space, Esc = 일시정지

v0.3-RC1에서는 프론트 게임 코어를 변경하지 않았다.

## 자동 채보 생성기 (Python, `analyzer/`)

```bash
pip install -r analyzer/requirements.txt
python analyzer/generate_chart.py song.wav --difficulty hard --output chart.json --seed 42 \
  --report report.json --dump-analysis analysis.json
```

난이도: easy / normal / hard / expert. 같은 입력 + 같은 seed는 같은 채보를 만든다.

### v0.3-RC1 파이프라인

```text
Audio Analysis
  ├─ BPM 후보 + confidence
  ├─ beat / onset / RMS / spectral bands
  ↓
Musical Events
  ├─ local contrast
  ├─ 가까운 split onset clustering
  ↓
Event Selection
  ↓
Pattern Generator
  ├─ alternate / stair / bounce / zigzag / anchor
  ├─ fuzzy phrase similarity + 반복 phrase 재사용
  ↓
Playability Pass
  ↓
Quality Report + v0.1 호환 chart JSON
```

모든 튜닝 값은 `analyzer/chartgen/config.py`에 있다.

### 품질 리포트

v0.3 report에는 다음과 같은 회귀 비교용 지표가 추가된다.

- BPM confidence / tempo candidates
- grid alignment / off-grid ratio
- onset cluster suppression
- average / peak NPS
- lane balance / left-hand ratio
- same-lane repetition / extreme jump
- average lane movement / max same-hand run
- phrase reuse ratio / phrase family count
- internal quality score (버전 비교용이며 사용자 난이도 점수가 아님)


## v0.3 RC 스트레스 검증

실제곡 투입 전, 실제 믹스에서 자주 생기는 실패 조건을 합성 오디오로 때려본다.

```bash
python analyzer/stress_benchmark.py --out stress-output
```

현재 RC baseline은 `analyzer/stress-baseline/`에 있으며, 리버브/고밀도 하이햇/지속음/
겹친 타격/템포 변화/느린 어택/swing × 4난이도 28조합을 검사한다. 이 과정에서 발견된
150 BPM→75 BPM half-tempo 오류와 120 BPM swing→180 BPM 오류를 strong-beat accent 기반
tempo 선택으로 수정했다.

태블릿에서는 `colab_v03_validation.ipynb`를 사용하면 RC ZIP과 실제 곡만 업로드해
manifest 생성 → 분석 → 결과 ZIP 다운로드까지 진행할 수 있다. 자세한 절차는 `docs/TESTING.md` 참고.

## 실제 곡 평가

음원을 프로젝트에 복사하지 않고 로컬 경로 manifest로 평가한다.

```bash
cp analyzer/real_songs.manifest.example.json my-songs.json
python analyzer/evaluate_real_songs.py my-songs.json --difficulty hard --seed 42 --out evaluation-output
```

생성물:

- `summary.json`, `summary.csv`
- 곡별 chart/report JSON
- `manual-evaluation.csv`

수동 평가는 각 1~5점으로 기록한다.

- Timing
- Musicality
- PatternNaturalness
- Density
- Repetition
- OverallFun

두 버전의 report 폴더가 있으면:

```bash
python analyzer/compare_reports.py old/reports new/reports -o comparison.json --csv comparison.csv
```

으로 A/B 비교할 수 있다.

## 검증

```bash
npm test
npm run lint
npm run build
npm run test:py
npm run lint:py
npm run gen:fixtures
npm run smoke
python analyzer/stress_benchmark.py --out stress-output
```

v0.3 Python 분석기 테스트에는 기존 v0.2 회귀 테스트와 함께 BPM 후보, onset clustering,
fuzzy phrase similarity, quality report 검증이 포함되어 있다.

## 현재 범위

자동 생성 노트는 아직 Tap만 지원한다. Hold/Flick/Chord 자동 생성, 곡 구조(Verse/Chorus) 기반 Chart Planner,
FastAPI/YouTube 연결은 후속 버전 범위다.

---

## v0.3 Web Tester RC2

Colab 없이 실제 곡을 테스트하려면 웹 테스터를 사용할 수 있습니다.

```bash
# API
python3 -m pip install -r backend/requirements.txt
npm run api:dev

# frontend (별도 터미널)
npm install
npm run dev
```

프로덕션은 `Dockerfile`로 빌드하면 React + FastAPI + analyzer가 하나의 웹 서비스로 실행됩니다. 자세한 흐름은 `WEB_TESTER.md`, 검증 상태는 `WEB_TESTER_VALIDATION.md`를 참고하세요.

## v0.3.1 YouTube Input
The web tester now accepts a public YouTube URL as an experimental test input in addition to local uploads. The backend validates YouTube hosts, fetches a single item with yt-dlp into ephemeral runtime storage, enforces the existing duration/size limits, runs the same chart generator, and serves the temporary media to the existing 4-key player. Availability depends on YouTube-side access restrictions; local file upload remains the fallback.

---

## v4.0 development candidate

The v4 candidate adds the local Library, records, FC/PC tracking, per-song Offset, UI overhaul and SFX foundation. See `docs/V4_IMPLEMENTATION.md` for the exact scope and current validation status.
