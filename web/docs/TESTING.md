# v0.3 RC 테스트 방법

## 목표

v0.3 RC는 **실제 곡 5곡 검증 전 단계**다. 자동 테스트는 기능/회귀를 검증하지만,
`재미`, `음악을 따라가는 느낌`, `패턴 자연스러움`은 실제 플레이로 확인해야 한다.

## 1. 합성 스트레스 테스트

```bash
python analyzer/stress_benchmark.py --out stress-output
```

대상: 리버브 꼬리, 16분 하이햇 과밀, 지속음, kick+bass+hat 중첩, 템포 변화,
느린 어택, swing. 4난이도 전체를 검사한다.

## 2. 실제 곡 5곡 일괄 분석

`analyzer/real_songs.manifest.example.json`을 복사하고 로컬 음원 경로를 적는다.
음원 자체는 프로젝트에 넣지 않는다.

```bash
python analyzer/evaluate_real_songs.py my-songs.json --difficulty hard --seed 42 --out evaluation-output
```

생성물:

- `charts/`: 자동 채보
- `reports/`: 곡별 분석/품질 지표
- `summary.csv`, `summary.json`: 일괄 요약
- `manual-evaluation.csv`: 사람이 직접 입력하는 1~5점 평가표

권장 평가곡은 서로 성격이 다른 5곡 이상이다: 일정한 4/4, 빠른 J-POP, 밴드/록,
전자음악, 보컬/잔잔한 곡.

## 3. 직접 플레이 평가

`manual-evaluation.csv`에 각 1~5점으로 입력한다.

- Timing
- Musicality
- PatternNaturalness
- Density
- Repetition
- OverallFun

집계:

```bash
python analyzer/score_manual_evaluation.py evaluation-output/manual-evaluation.csv \
  -o evaluation-output/manual-summary.json
```

## 4. v0.2 / v0.3 A/B

같은 곡/난이도/seed로 만든 report 폴더가 있을 때:

```bash
python analyzer/compare_reports.py v02/reports v03/reports \
  -o comparison.json --csv comparison.csv
```

내부 `internalQualityScore`는 **재미 점수나 품질 보증이 아니라 회귀 탐지용**이다.
실제 사람이 준 1~5점 평가를 우선한다.

## 5. 태블릿/Google Colab

프로젝트 루트의 `colab_v03_validation.ipynb`를 Colab에서 연다.
노트북 순서대로 RC ZIP과 테스트 음원들을 업로드하면 manifest 생성, 분석, 결과 ZIP 다운로드까지 진행된다.
