# AI Rhythm Lab Web Tester (v0.3-RC2)

## 목적
실제 곡 파일을 웹에서 업로드하고 현재 Python v0.3 자동채보 생성기를 그대로 실행한 뒤, 기존 4키 게임 엔진에서 즉시 플레이하고 사람 평가를 남기는 테스트 UI입니다.

## 로컬 실행
### 1) Python 설치
```bash
python3 -m pip install -r backend/requirements.txt
```

### 2) 프론트 개발 서버
```bash
npm install
npm run dev
```

### 3) API 서버 (다른 터미널)
```bash
npm run api:dev
```

브라우저에서 Vite가 표시한 주소(기본 `http://localhost:5173`)를 엽니다.

## 프로덕션/배포
```bash
npm install
npm run build
python3 -m pip install -r backend/requirements.txt
npm run api
```

`dist/`가 존재하면 FastAPI가 React SPA도 함께 서비스합니다. 이 경우 `http://localhost:8000` 하나만 열면 됩니다.

## 태블릿 테스트 흐름
1. 노래 업로드 (최대 80MB)
2. Easy/Normal/Hard/Expert 선택
3. AI 채보 생성
4. BPM / 노트수 / Grid / Phrase reuse / 내부 QC 확인
5. PLAY
6. START를 탭해 오디오와 게임을 사용자 제스처로 동시에 시작
7. 아래 4개 레인을 터치해 플레이
8. 결과 아래에서 Timing/Musicality/Pattern/Density/Repetition/Fun 1~5점 평가
9. 평가 저장 또는 JSON 다운로드

## 참고
- 자동 생성은 현재 Tap 노트만 생성합니다. 모바일 Flick/Hold 테스트는 다음 단계입니다.
- `internalQualityScore`는 재미 점수가 아니라 회귀 탐지용 내부 지표입니다.
- 업로드 파일/분석 결과는 `.runtime/` 아래에 저장됩니다. 공개 배포 시 영구 저장소가 아닌 임시 데이터로 취급하세요.
- 실제 상용 음원을 공개 서버에 올릴 때는 해당 음원의 이용권한/저작권 조건을 확인하세요.
