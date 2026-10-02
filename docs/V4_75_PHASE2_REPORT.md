# BEATDASH v4.75 RC · Phase 2 구현 보고

Status: IMPLEMENTATION CANDIDATE / MERGE READY AFTER CI + DEVICE VERIFICATION
Version source: `web/VERSION` = `4.75.0-rc.phase2`
Base: v4.75 Phase 1

## 1. Phase 2 구현 범위

### Gameplay Feel
- PLAY/Retry 이후 별도 START 버튼 제거.
- 준비 → 3·2·1 → 자동 시작. 준비/카운트다운 중 판정 시계는 시작하지 않는다.
- Perfect Streak 상태를 일반 Combo와 분리하고 설정과 표시를 연결.
- 판정 후보 동률 시 시간/인덱스 기준 deterministic ordering 추가.
- Pause Continue/Restart 버튼을 모바일 최소 64 CSS px / 18px로 확대하고 작은 화면에서는 세로 배치.
- 기존 FAST/SLOW, Hold/Flick, Timing Offset, media recovery 구조는 유지.

### Multi-link Queue / Android Background Work
- 여러 YouTube URL을 줄바꿈으로 한 번에 등록 가능.
- 실행 중에도 새 링크를 추가할 수 있다.
- `ChartJobStore`가 `chart_jobs.json`에 job id/url/video id/difficulty/seed/status/title/retry/cancel/song id를 영속화.
- 동일 video+difficulty+seed의 비종료 중복 job을 차단.
- 상태: queued → previewing → preparing → analyzing → saving → completed / failed / canceled / needs_retry.
- `ChartJobService` foreground service가 single-thread executor로 무거운 작업을 한 곡씩 처리.
- 완료된 job은 Library에 저장하지만 화면을 강제로 Play 화면으로 전환하지 않는다.
- 작업별 취소/실패 재시도 UI 제공.
- Activity 재생성 시 디스크 queue를 다시 읽어 기존 작업 상태에 연결.
- 프로세스/서비스 중단 복구 시 local preview/download 단계는 재대기 가능.
- 서버 분석/저장 도중 중단된 작업은 서버가 이미 요청을 받았을 수 있으므로 자동 재전송하지 않고 `needs_retry`로 전환해 명시적 재시도를 요구.
- ytdlp 임시 폴더를 고정 `rhythm_media_extract` 대신 job별 `rhythm_media_extract-<job id>`로 분리.
- Android foreground service notification에서 현재 상태 및 완료/대기 수를 표시하고 현재 작업 취소 action 제공.
- Android 15 targetSdk 35 dataSync FGS timeout callback 구현.
- 앱 강제 종료/OS 종료 이후 무조건 계속 실행된다고 보장하지 않으며, 다음 앱 실행에서 안전한 상태 복구/재시도 구조를 사용.

### Version / Deployment Verification Single Source of Truth
- release version 단일 소스: `web/VERSION`.
- Backend FastAPI version 및 `/api/health` version이 `web/VERSION`에서 로드됨.
- Web Settings build/version 표시가 `VERSION?raw`를 사용.
- Android `versionName`과 derived `versionCode`가 `../web/VERSION`에서 생성됨.
- `scripts/verify_container.sh`가 `web/VERSION`과 `web/BUILD_REVISION`을 읽고 공용 verifier를 호출.
- Railway deploy workflow가 `web/VERSION`에서 expected version을 읽어 output으로 전달.
- 배포 후 revision 검증은 GitHub `GITHUB_SHA`와 `/api/health.revision` 비교를 그대로 유지.
- `scripts/verify_deployment.py`가 container/Railway health 검증을 공용 처리.
- build-android workflow의 `android-actions/setup-android`는 이전 실제 실패를 되풀이하지 않도록 v4 유지.

## 2. 배포 검증 진단

매 attempt에 다음을 출력한다.
- Health endpoint
- Expected version
- Actual version
- Expected revision
- Actual revision
- Health OK
- Status / failure class

구분 가능한 실패:
- endpoint connection failure
- HTTP error
- JSON response error
- ok != true
- Version mismatch
- Revision mismatch
- deployment propagation timeout

새 revision이 이미 live이고 health OK이며 version만 동일하게 불일치하는 경우 `stable-mismatch-limit` 후 조기 실패한다. 이전 deployment/revision이 아직 제공되는 경우에는 Railway propagation 가능성이 있으므로 재시도를 유지한다.

## 3. 단일 버전 소스와 하드코딩 제거

Single Source of Truth: `web/VERSION`

검증/실행 코드에서 release literal 비교를 제거한 영역:
- `web/backend/app.py`
- `.github/workflows/deploy-railway.yml`
- `scripts/verify_container.sh`
- `android/app/build.gradle.kts`
- Web Settings version display

`package.json`의 package-manager용 private package version은 release identity로 사용하지 않는다.

앞으로 release version 변경 시 의도적으로 수정해야 하는 위치는 `web/VERSION` 한 곳이다.
`web/BUILD_REVISION`은 release version이 아니라 배포 대상 source revision이므로 CI가 GitHub SHA로 stamp한다.

## 4. 주요 신규/변경 파일

Phase 2 핵심:
- `web/VERSION`
- `scripts/verify_deployment.py`
- `scripts/verify_container.sh`
- `scripts/tests/test_verify_deployment.py`
- `scripts/tests/test_version_source.py`
- `scripts/tests/test_android_queue_source.py`
- `.github/workflows/deploy-railway.yml`
- `.github/workflows/build-android.yml`
- `android/app/src/main/java/com/rhythmlab/companion/ChartJobStore.kt`
- `android/app/src/main/java/com/rhythmlab/companion/ChartJobService.kt`
- `android/app/src/main/java/com/rhythmlab/companion/MainActivity.kt`
- `android/app/src/main/java/com/rhythmlab/companion/YoutubeEngine.kt`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/layout/activity_main.xml`
- `android/app/build.gradle.kts`
- `web/src/components/GameScreen.tsx`
- `web/src/engine/gameState.ts`
- `web/src/engine/judgementEngine.ts`
- `web/src/components/v4/SettingsScreen.tsx`
- `web/src/settings/preferences.ts`
- `web/src/App.css`
- 관련 unit/browser regression tests

## 5. 실행한 검증

PASS:
- deployment/version/Android queue source regression: 11/11 PASS
- backend pytest: 8/8 PASS
- analyzer/chart generator pytest: 103/103 PASS
- changed TS/TSX syntax transpile: 16 files / 0 syntax errors
- `git diff --check`: PASS
- Android Manifest XML parse: PASS (source regression test에 포함)
- Kotlin parser invocation에서 syntax-level `expecting` 오류 없음. Android SDK/classpath가 없어 unresolved Android symbols가 발생하므로 APK compile PASS로 간주하지 않음.

환경 때문에 미검증:
- Vitest / Vite build / oxlint: `npm ci`가 registry DNS `EAI_AGAIN`으로 dependency 설치를 끝내지 못함. 실패를 앱 코드 오류로 간주하지 않음.
- Analyzer ruff: 현재 Python 환경에 ruff module 없음.
- Docker build: 이 실행 환경에 Docker CLI 없음.
- Android Gradle/APK build: Android SDK/Gradle 환경 없음.
- Android 실제 background/notification/screen-off/device test: 실기기 없음.

따라서 Phase 2는 구현 후보이며 CI/실기기 검증 전 `COMPLETE`로 표시하지 않는다.

## 6. CI / 실기기 완료 체크

CI:
- npm ci
- npm test
- npm run build
- npm run lint
- analyzer pytest + ruff
- backend pytest
- scripts unittest
- Docker `scripts/verify_container.sh`
- signed Android APK build
- Railway deploy + health/version/revision verification

Android device:
- 기존 앱 삭제 없이 update install
- 기존 Library/Records/Settings/Offset 보존
- 5개 이상 URL batch 등록
- 처리 중 추가 URL 등록
- 다른 앱 전환 / 화면 off 후 작업 지속 확인
- notification 상태/취소
- 실패/재시도
- Activity recreate 후 queue 상태 유지
- process 종료 후 분석 중 job이 자동 중복 전송되지 않고 needs_retry가 되는지
- 완료 job이 현재 화면을 강제로 바꾸지 않는지
- PLAY → countdown → 자동 시작
- Pause 버튼 크기/오입력
- 멀티터치 Tap+Tap, Tap+Hold, Hold+Hold, Hold 중 Tap/Flick
- Perfect Streak 표시/종료 규칙

## 7. Phase 3 병합 주의

Phase 3은 병렬 작업이므로 전체 ZIP 덮어쓰기를 금지한다.
Phase 1 → Phase 2 patch를 기준으로 통합한다.

충돌 가능성이 높은 파일:
- `android/app/src/main/java/com/rhythmlab/companion/MainActivity.kt`
- `android/app/src/main/java/com/rhythmlab/companion/YoutubeEngine.kt`
- `android/app/src/main/AndroidManifest.xml`
- `web/src/components/GameScreen.tsx`
- `web/src/App.css`
- `web/src/components/v4/SettingsScreen.tsx`
- `web/backend/app.py`

Phase 3의 artwork/SFX/Chart AI 변경을 보존하면서 Phase 2 queue/version/gameplay 변경을 수동 merge해야 한다.
