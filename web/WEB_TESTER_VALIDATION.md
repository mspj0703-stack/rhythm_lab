# v0.3 Web Tester RC2 Validation

## 구현 범위
- React 업로드 UI: 파일 / 난이도 / seed
- FastAPI `/api/analyze`: 업로드 파일을 기존 v0.3 Python analyzer로 분석
- 분석 결과 UI: BPM, confidence, note count, NPS, grid alignment, phrase reuse, internal QC
- 기존 GameScreen으로 즉시 플레이
- 오디오 업로드는 HTMLAudioElement, MP4/WEBM은 HTMLVideoElement 사용
- 모바일/태블릿 4레인 pointer 입력 추가 (현재 자동 생성 Tap 채보 검증용)
- 브라우저 autoplay 정책 대응 START gesture
- 6개 사람 평가 항목 저장 + JSON 다운로드
- chart/report 다운로드
- 기존 `?legacy=1`, `?chart=...&video=...` 경로 유지
- Docker production build/deploy 경로 추가

## 검증 결과
### Backend API
`PYTHONPATH=backend python3 -m pytest -q backend/test_app.py`
- 4/4 PASS
- health
- 실제 합성 WAV 업로드 -> analyzer 실행 -> chart/report 생성
- 업로드 media 재전송
- 잘못된 확장자 거부
- 잘못된 난이도 거부

### Python analyzer
- analyzer 자체는 RC1 알고리즘에서 변경하지 않음.
- 현재 패키지에는 기존 86개 analyzer 테스트가 그대로 포함됨.
- 이번 환경에서 전체 단일 실행은 실행시간 제한에 걸렸으나 이전 RC1 검증에서 86개 분할 PASS 상태였고, 이번 작업은 analyzer 알고리즘을 수정하지 않음.

### Frontend
- npm 의존성 설치가 현재 컨테이너 네트워크 제한으로 완료되지 않아 Vite production build / Vitest / Puppeteer를 이 환경에서 재실행하지 못함.
- 대신 `src/__tests__`를 제외한 전체 TypeScript/TSX 앱 소스를 global TypeScript compiler + 임시 외부모듈 stub으로 parse/type-shape 검사하여 오류 0건 확인.
- 기존 Puppeteer smoke script 기본 URL은 `?legacy=1`로 변경해 새 업로드 홈과 기존 게임 회귀 경로가 충돌하지 않게 함.
- Dockerfile은 배포 빌드 시 깨끗한 Node 22 환경에서 `npm ci && npm run build`를 강제하므로 실제 배포 시 build failure가 있으면 배포 단계에서 즉시 검출됨.

## 남은 실제 검증
1. Docker/호스팅 환경에서 frontend 정식 build
2. 브라우저에서 업로드 -> 분석 -> PLAY -> START -> 터치 플레이 end-to-end
3. 실제 곡 최소 5개 사람 평가
4. iPad/Android Chrome/Safari의 media codec별 확인
