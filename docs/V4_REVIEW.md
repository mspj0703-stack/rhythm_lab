# BEATDASH::Revive v4.0 검수 결과

검수일: 2026-09-29. 사용자 표시 이름: **BEATDASH**.

**판정: 수정된 웹/Library 후보본은 반영 검토 가능. v4.0 정식 완료는 보류.** Docker 실제 빌드, GitHub Actions 서명 APK, 기존 설치본 업데이트 및 실기기 검증이 남았다. 운영 배포나 원격 ZIP 삭제는 수행하지 않았다.

## 1. 현재 복구된 상태

- 제공된 `BEATDASH-v4.0-dev-bundle.zip`과 `BEATDASH-v4-github-clean (1).zip`을 직접 비교했다. 정리본의 `web/`은 dev 웹 소스와 동일했고, Android는 워크플로 위치 차이를 제외한 앱 소스가 동일했다.
- 첨부본에는 `.git`이 없다. 실제 저장소의 git status, 최근 commit, 브랜치/원격 diff는 확인할 수 없었다. 이 검수의 변경 기준은 **첨부한 정리본 ZIP**이며, 원격 저장소의 현재 상태를 추정하지 않았다.
- 전달문과 달리 첨부본에는 전역+곡별 Offset 수정과 관련 추가 테스트가 없었다. 초기 실제 Vitest 결과는 **136/136**, build 성공, lint 경고 4건이었다.
- Library, 기록, FC/PC, v4 UI, 합성 SFX의 기본 구현은 존재했다. 저장/전환/기록 호환에 결함이 있었고, 로드맵 일부 UI 접근과 표시가 빠져 있었다.
- 읽기 전용으로 확인한 운영 `/api/health`는 `version: 3.0.0`, 업로드 80MB, 길이 600초였다. 현재 운영본이 검수 ZIP이라는 증거는 없으며 v4 재배포 성공으로 취급하지 않았다.

입력 SHA-256:

```text
BEATDASH-v4.0-dev-bundle.zip
eccab6c5a9c9d5e5dd80133f4ea3ee7ffc7885f0e47cf20e8f164d6e3434a67b
BEATDASH-v4-github-clean (1).zip
28b962d25a73b3ea7b64c50686dd0328d3b182f61795da8031e87b09df2a4012
```

## 2. 발견한 문제와 수정

| 중요도 | 문제 | 수정/검증 |
|---|---|---|
| HIGH | Library 곡별 기본 Offset 0이 기기 보정값을 덮어씀 | 전역+곡별 합산, 최종 ±300ms 제한. 저장 기록에도 실제 적용값 보존. 브라우저 +72, +72+10=+82 확인 |
| HIGH | Library 재생 상태가 남아 새 분석 대신 이전 곡을 재생 | 화면 전환 시 선택 재생 상태 정리, 곡/채보별 GameScreen key, 비동기 분석 결과 세대 구분 |
| HIGH | 파일명+길이+BPM 충돌로 다른 미디어/채보를 덮어씀 | 웹 미디어 SHA-256 식별, Companion은 저장된 native ID 사용. 기존 v4 항목은 실제 Blob 일치 시 ID/기록 보존 |
| HIGH | 채보 재생성 후 이전 노트 구성의 기록이 새 채보 최고 기록으로 표시 | 동일 채보 재등록은 버전 유지, 변경 시 버전 증가. 기록에 chartVersion 저장, 현재 버전만 집계. 기존 버전 없는 기록은 1로 해석 |
| HIGH | 미디어 다운로드 실패를 무시하고 임시 URL만 저장해 '저장됨'으로 표시 | 영구 저장 실패를 오류로 전달. Quota/쓰기 실패 시 songs/charts 트랜잭션 전체 rollback. 저장 실패 후 즉시 플레이는 가능하나 Library 저장 성공으로 표시하지 않음 |
| HIGH | Companion WebView는 Activity를 열 때 선택한 곡만 로컬에서 제공 | 유효한 32자리 저장 ID의 session/audio/video를 제공. HTTPS·호스트·메서드·ID 검증 유지. 다른 저장곡 선택 경로 보완 |
| MEDIUM | Native MP4를 IndexedDB에 중복 저장해 용량/메모리 부담 | Companion 저장 세션은 metadata/chart/record만 저장하고 앱 내부 영상 파일 직접 제공. 웹 업로드는 Blob 캐시 유지 |
| MEDIUM | 난이도 추가 때 BPM/파일명 변경으로 새 곡 생성, 영상이 source.wav 이름으로 재업로드 | 명시적 songId로 원본 곡에 추가. 기존 미디어/제목 보존. 영상 MIME에 맞는 확장자 사용 |
| MEDIUM | 저장이 플레이 종료보다 늦으면 기록 누락, 저장 실패 unhandled rejection, 이전 결과가 Retry 후 표시 | 저장 콜백 준비 후 결과 전달, 실패 표시 및 기록 저장 재시도, 이전 실행의 비동기 결과 차단 |
| MEDIUM | 병렬 저장/삭제/기록 쓰기에서 중복·고아 데이터 가능 | 관련 조회/수정을 같은 IDB 트랜잭션으로 묶음. DB 연결 finally 정리. 삭제된 곡/변경된 채보 기록 쓰기 거절 |
| MEDIUM | 전역 보정/Speed는 새 분석 화면을 거쳐야 조절 가능 | Settings에 기존 컨트롤 및 보정 도구 연결. 플레이 직전 최신 곡 보정값 조회 |
| LOW | Effect 상태 갱신 경고 4건, 곡 제목 편집 중 refresh가 입력 덮어씀 | 키 기반 초기화, 비동기 조회 수명주기 정리, 경고 0건 |
| LOW | 빈 채보를 FC로 표시, 손상된 오디오 설정으로 NaN 볼륨, Retry 첫 SFX 누락 가능 | 빈 결과 CLEAR, 볼륨/boolean 검증, SFX sequence 초기화 |
| 범위 누락 | 썸네일·생성일·현재 난이도 재생성·일부 상태 SFX 미완성 | 영상 첫 프레임 썸네일과 생성일 표시, 재생성 버튼, 분석 완료/오류·결과·NEW BEST SFX 보완. 썸네일 실패/음악 파일은 기존 아이콘으로 대체 |
| 배포 위험 | 구 Render 설정·Dockerfile 혼재, CLI 종료만으로 배포 성공 판단, 정리 직후 ZIP 삭제 안내 | 과거 문서를 docs/archive/pre-v4로 이동. root Docker 검증 → 배포 → 실제 revision 확인 순서 추가. 삭제 조건 문서 수정 |

## 3. 수정된 파일

전체 목록은 `V4_CHANGED_FILES.txt`에 있다. 주요 경로:

- `web/src/App.tsx`, `library/{db,model,types,thumbnail}.ts`, `settings/timingOffset.ts`
- `web/src/components/GameScreen.tsx`, `components/v4/*.tsx`, `web/UploadScreen.tsx`, `audio/sfx.ts`, `App.css`
- `web/src/__tests__/{libraryDb,libraryModel,mediaLifecycle}.test.*`, `web/scripts/v4_browser_review.cjs`, `web/package*.json`
- `android/app/src/main/java/com/rhythmlab/companion/PlayActivity.kt`
- root `Dockerfile`, `.dockerignore`, `.gitignore`, `railway.json`, `scripts/verify_container.sh`
- `.github/workflows/{build-android,deploy-railway,verify-container}.yml`, `web/backend/app.py`, `web/BUILD_REVISION`
- 운영/검수 문서와 이전 설정 보관 위치. 기존 앱 package ID와 저장소 키는 변경하지 않았다.

## 4. 테스트 결과

| 검증 | 결과 | 범위/주의 |
|---|---|---|
| Vitest | **153/153 PASS** | 원본 136 + 신규 17. IDB 충돌/동시 저장/버전/구 기록/삭제/Quota rollback, Offset/설정 보존, 비동기 결과 실패·재시도·Restart |
| TypeScript + Vite | **PASS** | `tsc -b && vite build` |
| frontend lint | **0 errors / 0 warnings** | 원본 경고 4건 제거 |
| analyzer pytest | **103/103 PASS** | malformed input 시 오디오 라이브러리 경고 5건 |
| analyzer ruff | **PASS** | 0건 |
| backend pytest | **4/4 PASS** | TestClient 의존성 deprecated 경고 1건 |
| 기존 browser smoke | **42/42 PASS** | Tap/Hold/Flick, Pause/Resume/Restart, 생성 채보 완주 |
| v3 browser 회귀 | **44/44 PASS** | Speed 1/8/12/20, 390/768/1440 폭, 판정선/터치/이펙트, 스와이프 Flick |
| v4 Library browser | **21/21 PASS** | 실제 Chromium + IndexedDB/Blob/video. API 분석 응답은 fixture; 실제 분석은 별도 Python 테스트 |
| ByteRange Java | **14/14 PASS** | Java 17 런타임 + ECJ로 컴파일/실행. 전체 Android APK 검증은 아님 |
| 미디어 파이프라인 | **PASS** | 합성 480초 MP4 유지, WAV 480.0029초 / mono / 22050Hz. 실제 YouTube/Android 다운로드는 미검증 |
| production ASGI | **PASS** | `web/`에서 실제 backend가 `/api/health` v4.0.0/revision 및 빌드 UI 제공 |
| 배포 설정 정적 확인 | **PASS** | YAML/JSON parse, shell syntax, Docker COPY 입력이 web/만 사용. Actions 실행 성공을 뜻하지 않음 |

v4 브라우저 검증에서 전역 보정과 Speed 유지, PC와 NEW BEST, Miss 플레이가 최고 기록을 덮어쓰지 않는 것, 새로고침 후 기록, 원본 제목, 다른 난이도, 영상 확장자, 곡 전환, Blob 재생/seek, 삭제 cascade, Settings 접근을 확인했다. 런타임 오류 0건. 모바일 Library/곡 상세/결과/Settings 스크린샷을 눈으로 확인했고 가로 넘침은 없었다.

Perfect ±35ms / Great ±75ms / Good ±120ms, 하향 판정선, 원근 하이웨이, Flick 구분, Hold 재입력 및 단일 미디어 시계는 유지됐다. 변경된 사양에 맞춰 검증했으며 판정 범위를 이전 값으로 되돌리지 않았다.

## 5. 빌드와 배포

- 웹 빌드는 성공했다. `node_modules`, `dist`, `.runtime`, 캐시, 사용자 미디어는 전달 ZIP에 포함하지 않았다.
- **Docker 실제 build/run은 미실행**: Docker/Podman/BuildKit 실행 환경이 없다. npm/ASGI 검증을 Docker 성공으로 대신 기재하지 않는다.
- **Android release APK/서명 검증은 미실행**: Android SDK/Gradle/기존 서명키가 없다. Actions YAML 검토와 ByteRange 테스트까지만 수행했다.
- `railway-prod` push/manual 흐름은 파일상 유지하고 manual 실행도 해당 브랜치로 제한했다. 배포 전 root 컨테이너 검증과 배포 후 `GITHUB_SHA` revision 일치를 요구한다. 실제 브랜치 내용·Railway 대시보드 root 설정·Actions 권한/Secret은 확인하지 못했다.
- `railway.json`은 root Dockerfile과 `/api/health`를 지정한다. Railway 서비스 root directory는 저장소 루트여야 한다. 기존 다른 설정이 이를 덮어쓰는지 운영에서 확인해야 한다.
- **기존 overlay ZIP은 지금 삭제하지 말 것.** 후보 commit의 컨테이너 검증, 실제 배포 revision/health, 롤백 소스 보존을 확인한 후 별도 commit에서 삭제한다. 자세한 순서는 `GITHUB_CLEANUP.md`.

공식 설정 참고: [Railway Config as Code](https://docs.railway.com/config-as-code/reference), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Healthchecks](https://docs.railway.com/deployments/healthchecks).

## 6. 알려진 문제와 한계

- 이번 자동 검증 범위에서 미해결 중대 오류는 재현되지 않았다. 실기기 회귀가 없다는 보증은 아니다.
- IndexedDB는 앱/브라우저 데이터 삭제, origin 변경, OS 저장소 정리의 영향을 받는다. 백업/내보내기나 클라우드 동기화는 이 버전에 없다. 큰 웹 업로드를 hash/Blob으로 다룰 때의 저메모리 WebView 성능은 미검증이다.
- Companion 저장곡은 여전히 앱 내부 파일이 원본이다. 웹 Library에서 항목을 삭제해도 Android 파일은 삭제하지 않는다. 반대로 Android에서 원본 파일을 삭제하면 해당 웹 항목은 재생할 수 없다. 다시 저장/분석해야 한다.
- 이전 v4에서 이미 잘못 합쳐진 곡/기록은 원본 미디어 없이는 분리 복구할 수 없다. 기존 chartVersion이 증가해 버린 기록의 근거 없는 재배정도 하지 않는다.
- 기존 v3 웹 설정 키는 그대로 유지하며 native ID/저장 경로와 package ID도 유지한다. 실제 업그레이드 시 서명·origin이 유지되는지는 APK 업데이트 시험이 필요하다.
- SFX는 Web Audio 합성음이다. 라우팅/설정/호출 및 브라우저 오류는 확인했지만 실제 청감, 블루투스 지연, 기기별 볼륨 밸런스는 판단하지 않았다.

## 7. 실제 기기에서 확인할 항목

1. 기존 서명키로 Actions release APK 빌드와 apksigner 검증. 기존 v3 앱을 삭제하지 않고 업데이트 설치. BEATDASH/4.0.0 표시 및 package ID 확인.
2. v3 저장곡/오디오 전용 곡, Speed, 전역 Offset 보존. v4 DB를 만든 기기에서도 다음 업데이트 후 곡·제목·곡별 Offset·기록 유지.
3. 서로 다른 native 저장곡 두 개를 같은 WebView Library에서 번갈아 재생. MP4 시작/중간/끝 seek, 새 분석 후 올바른 곡 재생.
4. 80MB에 가까운 웹 MP4 저장과 재실행, 저장 공간 부족 시 명확한 실패/재시도. Native 영상이 IndexedDB에 중복 저장되지 않는 것 확인.
5. 실제 YouTube 세 곡 이상 다운로드 → 같은 MP4에서 WAV 분석 → <video> 플레이. 곡 초반/중간/후반과 seek 후 A/V·채보 싱크 비교.
6. Tap 동시치기, Hold 해제·재입력, Flick 스와이프/키보드, 멀티터치. ±35/75/120ms 경계 체감과 기기/곡별 보정 합산 확인.
7. Pause/Resume/Restart, 홈/잠금/전화 후 복귀, 빠른 재시도, 재생 오류 재시도. 중복 소리나 이전 기록 배너가 남지 않는지 확인.
8. 휴대폰/태블릿 화면과 안전영역, 키보드로 제목 수정, 썸네일, 스크롤, 손가락으로 조작하기 쉬운지 확인.
9. Master/Music/SFX/음소거, 분석 성공·실패, 일반 결과/NEW BEST/FC/PC 소리, 블루투스 출력 체감 확인.
10. 실제 Docker/Actions 성공 후 Railway 재배포. `/api/health`의 version=4.0.0 및 revision=배포 commit 일치, 새 UI/분석 API 확인 후에만 옛 ZIP 정리.

## 8. v4.0 완료 여부

| 완료 조건 | 판정 |
|---|---|
| 계획 기능 구현 | 소스 수준 반영. 위 수정/로드맵 보완 포함 |
| 주요 버그 없음 | 자동 검증 범위 내 확인; Android 실제 동작 미확인 |
| 전체 테스트 통과 | 실행 가능한 테스트 통과. APK/기기 항목은 미실행 |
| 빌드 성공 | 웹 성공. Docker·Android 대기 |
| 기존 기능 회귀 없음 | 자동 회귀 테스트 통과. 실제 업데이트/기기 검증 대기 |
| 실제 기기 플레이테스트 가능한 상태 | 서명 APK 생성 절차 제공. 이번 검수에서 설치용 APK는 생성하지 못함 |

**따라서 v4.0은 검수 수정 후보본(RC)이며, 정식 완료 판정은 아직 아니다.** 남은 검증을 통과한 후 v4.0 완료를 기록하고 다음 기능 묶음을 v4.1로 진행한다. 내부 개발명은 `BEATDASH::Revive`, 사용자 노출 이름은 `BEATDASH`로 유지한다.
