# BEATDASH v4.0 RC hotfix 재검수

검수일: 2026-09-30

**판정: 발견한 결함 수정 후 자동 검증 통과. Android 실기기 승인 전 RC 유지.**

## 현재 복구된 상태

- 검수 입력: `BEATDASH-v4.0-RC-hotfix-source.zip`.
- SHA-256: `c4ca0a533219ec70c4d0ecdd76db4290beb5a740dc81016e46763dcd39986540`.
- 이전 `BEATDASH-v4-github-clean-reviewed.zip` 대비 17개 파일 경로가 추가/변경됐다. 재생 복구, 원본 제목/썸네일, 사용자 커버, IndexedDB v2가 이번 범위다.
- 입력 ZIP에는 `.git`이 없다. 실제 git status/commit/원격 브랜치는 확인할 수 없으며, 첨부 ZIP을 수정 기준으로 사용했다.
- 원본을 먼저 실행했을 때 Vitest **155/155 PASS**, lint **0 errors/0 warnings**였지만, **TypeScript 빌드는 실패**했다. 기존 테스트가 실제 v1→v2 마이그레이션과 새 복구 코드를 충분히 검증하지 못했다.

## 발견한 문제 및 수정

| 중요도 | 발견한 문제 | 수정 |
|---|---|---|
| BLOCKER | `IDBOpenDBRequest.oldVersion`은 존재하지 않아 TypeScript 빌드 실패. 런타임에서도 `undefined < 2`로 기존 데이터 보정이 건너뛰어짐 | `onupgradeneeded` 이벤트의 `oldVersion` 사용. 실제 v1 스키마/행/Blob/채보/기록을 넣고 v2로 올리는 테스트 추가 |
| HIGH | 미디어 error가 START 이전/일시정지 중에도 복구 재생을 시작할 수 있음 | 시작 전과 일시정지 상태에서는 사용자 재시도만 허용 |
| HIGH | 복구 작업이 Pause·Restart·화면 이탈 이후에도 완료되어 다시 재생하거나 이전 위치로 돌아갈 수 있음 | AbortController와 실행 세대 검사, 예약 타이머/리스너 정리. 백그라운드 이벤트도 복구 취소 |
| HIGH | `load()` 직후 metadata 이전에 seek, 그동안 게임 시계/입력은 계속 진행. 반복 오류가 재로딩 루프를 만들 수 있음 | 복구 중 판정 일시정지, metadata→seeked→play 순서. 체크포인트 유지, 자동 시도 2회 제한, 단계별 10초 제한. 끝나지 않는 play Promise도 오류/재시도로 전환 |
| HIGH | 커버 변경 input은 있지만 Android WebView에 `onShowFileChooser` 구현이 없어 기기에서 파일 선택 불가 | Activity Result 기반 선택창 연결, 취소/종료 callback 정리, 서비스 origin 및 읽기 권한 있는 외부 content URI 확인 |
| MEDIUM | 실제 YouTube 제목을 session.originalTitle에만 넣고 Android 곡 목록과 chart.title에는 생성기 제목을 계속 사용 | 신규 저장 시 원본 제목을 목록·세션·채보 제목에 일관되게 적용 |
| MEDIUM | PNG/WebP도 찾아 `thumbnail.jpg`로 저장하고 image/jpeg로 제공할 수 있음 | 변환에 성공한 JPG/JPEG만 native 원본 썸네일로 채택 |
| MEDIUM | 썸네일의 존재 확인과 쓰기가 다른 트랜잭션이어서 늦게 완료된 캡처가 다른 artwork 쓰기와 경합 | 조회·존재 검사·쓰기 하나의 readwrite 트랜잭션으로 처리 |
| LOW | 같은 커버 파일을 복원 후 다시 고르면 change가 발생하지 않을 수 있음. 처리 도중 중복 변경 가능 | input 값을 선택 후 비움, 변환 중 버튼/입력 잠금 |
| LOW | Android 공급자가 MIME을 비워 전달하면 정상 JPG/PNG/WebP도 거절 | MIME이 없을 때만 확장자 확인. 투명 이미지는 어두운 배경에 합성 후 JPEG 저장. 버튼 스타일 정리 |

## 수정된 파일

전체 경로는 `HOTFIX_REVIEW_CHANGED_FILES.txt` 참조. 주요 파일:

- `web/src/components/GameScreen.tsx`, 신규 `web/src/engine/mediaRecovery.ts`
- `web/src/library/db.ts`, `web/src/library/cover.ts`
- `web/src/components/v4/SongDetailScreen.tsx`, `web/src/App.css`
- `web/src/__tests__/libraryDb.test.ts`, `mediaLifecycle.test.tsx`, 신규 `cover.test.ts`
- 신규 `web/scripts/hotfix_browser_review.cjs`, `hotfix_media_pipeline_review.py`, `web/package.json`
- `android/.../PlayActivity.kt`, `SavedSongStore.kt`, `YoutubeEngine.kt`
- 검수 문서, `web/BUILD_REVISION` (`v4-rc-hotfix-reviewed`)

기존 Tap/Hold/Flick 판정 범위와 채보 생성 로직, 음향 디자인은 변경하지 않았다. v5 모바일/PC 분리와 Hold Tick도 이번 범위에 넣지 않았다.

## 테스트 결과

| 항목 | 결과 |
|---|---|
| Vitest | **173/173 PASS**, 입력본 155개 대비 18개 추가 |
| TypeScript/Vite 빌드 | **PASS** |
| frontend lint | **0 errors / 0 warnings** |
| Analyzer pytest | **103/103 PASS**, 기존 라이브러리 경고 5건 |
| Backend pytest | **4/4 PASS**, TestClient 의존성 경고 1건 |
| Analyzer ruff | **PASS** |
| 기존 browser smoke | **42/42 PASS** |
| v3 browser 회귀 | **44/44 PASS** |
| hotfix browser E2E | **33/33 PASS**, 기존 v4 Library 항목 포함 |
| ByteRange Java | **14/14 PASS** (ECJ + Java 17) |
| 제목/썸네일/미디어 파이프라인 | **PASS** (로컬 fixture, desktop yt-dlp/FFmpeg) |

브라우저 E2E는 실제 Chromium·IndexedDB·Canvas·Blob·video를 사용했다. 분석 API 응답은 fixture이며, 실제 분석기는 별도 pytest로 확인했다. JPG/PNG/WebP 모두 960×640 변환, 원본 artwork 보존, reload 후 커버 유지, 원본 복원, 같은 파일 재선택을 확인했다. 실제 Blob video를 reload/seek하여 재생 위치가 복원되는 것과 background 이벤트 후 pause 유지도 확인했다. 런타임 오류 0건.

추가 미디어 검증에서는 합성 480초 영상의 원본 제목을 `source.info.json`에서 보존하고 PNG 썸네일을 실제 JPEG로 변환했다. MP4는 원본과 일치했고 파생 WAV는 22050Hz/mono, 길이 480.0029초였다. 실제 YouTube 네트워크 또는 Android의 yt-dlp 패키지를 실행한 결과는 아니다.

단위 테스트는 preload 오류, 복구 중 판정 정지, metadata 이후 seek, Pause/Restart/화면 종료 취소, 영구 오류 루프 방지, 3초 buffering 기준, 자동 재시도 상한, 복구 및 play 응답 시간 초과를 포함한다.

## 빌드 결과와 미검증 범위

- **웹 빌드 성공.** 원본의 TypeScript 오류를 수정했다.
- **Android 전체 Kotlin/APK 빌드·서명: 미실행.** Android SDK/Gradle/서명키가 없다. Java ByteRange 테스트는 APK 검증을 대신하지 않는다.
- **실제 Docker build/run: 미실행.** Docker 실행 환경이 없다. 이번 hotfix에서는 기존 배포 workflow/Dockerfile을 바꾸지 않았다.
- 운영 배포, GitHub push, 옛 ZIP 삭제는 하지 않았다.

## 알려진 문제

- 실제 기기에서 보고된 자발적 재생 중단의 정확한 원인은 아직 재현하지 못했다. 코드에서 확인한 복구 결함과 브라우저 회귀를 수정했지만 **기기 현상이 완전히 해결됐다고 단정하지 않는다**.
- 오래된 곡에 원본 제목/썸네일이 저장되지 않았다면 오프라인에서 복원할 수 없다. 신규 다운로드부터 원본 정보를 보존하며 기존 곡은 이전 정보로 표시한다.
- 커버/기록은 해당 origin의 IndexedDB에 저장한다. 앱 데이터 삭제/저장소 정리/원본 native 파일 삭제 이후 복구나 클라우드 동기화 기능은 없다.
- 큰 MP4와 고해상도 이미지의 저메모리 WebView 성능, 공간 부족, 파일 선택 취소/권한, APK 업데이트 데이터 보존은 기기 확인이 필요하다.
- SFX의 청감 개선은 이 hotfix에 포함되지 않았다.

## 실제 기기 확인 순서

1. 기존 서명키로 hotfix APK를 빌드·검증하고 기존 앱 삭제 없이 업데이트한다.
2. 곡·채보·기록·편집 제목·커버, Speed·전역/곡별 Offset이 유지되는지 확인한다.
3. 긴 native MP4와 큰 웹 Blob 곡을 완주하고, 서로 다른 두 곡을 연속 재생한다.
4. 정상 Pause/Resume/Restart와 홈·잠금·복귀, 복구 도중에도 같은 조작을 시험한다. 임의 자동 재개/이전 위치 복원/잔여 소리가 없어야 한다.
5. 새 YouTube 곡에서 앱 목록·곡 상세·게임 제목과 원본 썸네일을 확인한다.
6. JPG/PNG/WebP 선택, 선택 취소, 같은 파일 다시 선택, 앱 재시작, 원본 복원을 확인한다.
7. Tap·Hold 재입력·Flick·멀티터치와 영상 초반/중간/후반 싱크를 확인한다. 자동 복구 후 Hold 재입력도 확인한다.

## 완료 여부

**검수 수정본은 준비 완료. v4.0 정식 완료는 보류.** 서명 APK와 실제 기기 중단 재현/해결 확인이 남아 있다.

기존 원본 파일과 패치를 동시에 덮어쓸 필요는 없다. 전체 수정 ZIP을 사용하거나, 검수 입력 ZIP과 같은 소스에 첨부 수정 patch를 적용하면 된다. 다른 최신 소스가 있는 저장소에 전체 덮어쓰기는 하지 않는다.

참고: [Android WebChromeClient](https://developer.android.com/reference/android/webkit/WebChromeClient), [FileChooserParams](https://developer.android.com/reference/android/webkit/WebChromeClient.FileChooserParams).
