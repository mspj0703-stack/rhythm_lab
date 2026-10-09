# BEATDASH v5.0 Phase 2 Report

- Branch: `v5-phase2` (base `main` 56eb0e9)
- **이 문서는 Final Fix 이전 상태 보고서이며, 최종 판정과 수정 내역은 `BEATDASH_V5_PHASE2_FINAL_FIX_REPORT.md`가 대신한다.**
- Version: `5.0.0-rc.phase2`
- 범위: 2A Maker v1 → 2B Community → 2C 화면/방향 최적화 + 통합 추가 요구사항(P0/P1)

## 0. 결론 (Phase 2 Release Readiness)

| 항목 | 상태 |
| --- | --- |
| 코드 구현 (Maker / Community / 화면 / P0 / P1) | 완료 |
| 웹 빌드, tsc, lint(0 warnings), Vitest 353, 백엔드 53, 분석기 127, 소스 계약 36 | 통과 |
| Chromium E2E (Playwright, 실제 CDP 멀티터치 포함) 200 checks | 통과, 오류 0 |
| **Android 실기기 검증** | **미수행** |
| **Android Kotlin 컴파일 / APK 빌드** | **미수행** (SDK·Gradle 의존성 네트워크 차단) |
| **Desktop(Tauri) 빌드** | **미수행** (crates.io 차단). Desktop 소스는 변경하지 않음; 웹 번들만 공유 |
| Railway 배포 | 미수행 |

판정: **RC 가능 / 릴리스 불가.** 실기기 체크리스트(`docs/V5_PHASE2_ANDROID_DEVICE_CHECKLIST.md`)와 Kotlin 컴파일, Railway 볼륨 설정이 끝나기 전에는 Phase 2 완료로 선언하지 않는다.

## 1. 구현 요약

### 2A Maker v1 (`web/src/maker/`)
- 기능: 노트 추가/삭제/이동/레인 변경/시간 변경/Tap↔Hold/Hold 길이 조절/모바일 Flick, Snap 1/4·1/8·1/16·1/32·OFF, Undo/Redo, 저장, TEST PLAY(기록 저장 안 함, 라벨 표시).
- Playability Validator(`validator.ts`): ERROR는 공유를 막고, WARNING은 안내만 한다. 서버가 동일 규칙을 다시 검증한다.
- 저장: AI 원본은 덮어쓰지 않는다. 편집본은 `origin: MANUAL_EDITED`, `parentChartId`, slotKey `variantKey:edit:<id>`로 별도 저장. 변경이 없는 사본은 저장/공유 불가(ms 단위 노트 키 비교, `chartDiff.ts`).

### 2B Community
- 백엔드 `web/backend/community.py` (`/api/community`): POST 업로드, GET 목록, GET 상세, 소유자 한정 수정/삭제, 다운로드 카운트(POST).
- 서버 검증: ERROR 규칙 전부 재검증, 알려진 필드만 재직렬화, payload 512 KB 제한, 업로드 rate limit, 내용 해시 중복 409, authorSecret 해시로 소유권(403).
- 사람이 편집한 채보만 업로드(AI 원본·COMMUNITY 사본 제외). 익명 영속 authorId는 localStorage.
- 검색/최신/다운로드순/난이도/플랫폼 필터. 다운로드는 Library에 확실히 일치하는 곡이 있을 때만 연결(`matchSong.ts`), 기록은 chartId 별로 분리.
- **배포 주의:** DB는 SQLite(`COMMUNITY_DB_PATH`, 기본 `web/.runtime/community.sqlite3`). Railway에서 **영속 Volume에 마운트하지 않으면 재배포 때 초기화된다.** `/api/health`의 `communityPersistentStorage`로 확인.

### 2C 화면/방향
- 플레이필드 ResizeObserver 기반 실제 크기 캔버스, 판정선 비율 유지, `100dvh` + safe-area, `viewport-fit=cover`.
- Android `OrientationBridge`(잠금 + 시스템 바 숨김), 웹은 Screen Orientation API 베스트에포트, Desktop은 no-op.

### DB 마이그레이션 (v3/v4 → v5)
- Additive. `slotKey` 백필, `songChartVariant`는 비유니크, `songChartSlot`이 유니크. 차트 ID·기록·blob 유지. v3/v4에서 v5 마이그레이션 테스트 통과(`libraryDb`, `v5MakerDb`).
- Phase 1 필드(`platformProfile`, `scoringVersion`, `variantKey`, `chartVersion`, `origin`, `authorId`, `cloudPublished`) 유지.

## 2. Difficulty / MASTER
- 내부 값 `"extreme"` 유지, 표시는 모든 곳에서 MASTER (`constants/difficulty.ts` 단일 테이블).
- 반영: Upload, YouTube, 곡 상세(＋MASTER), Library(MAS), Result, Maker, Community(필터 value는 extreme), Android Companion 스피너(`Difficulty.kt`), 백엔드(`master` 별칭 허용), CLI(`generate_chart.py`).
- 기존 extreme 채보·기록은 그대로 로드되며 MASTER로 표시(테스트 `v5Master`).

## 3. Multitouch Fix
- 원인 구조: 레인 하나를 단일 상태로 다뤄 다른 손가락의 up/cancel이 Hold를 끊을 수 있었다.
- 수정: `PointerLaneTracker` — pointerId 단위 추적, 레인 소유자는 첫 pointer, 비소유자의 up/cancel은 해제 안 함, 소유자가 떼도 다른 손가락이 있으면 소유권 이양, pointer별 Flick(위로 28px 이상 / 400ms 이내, 1회). Touch Events 리스너 없음(이중 처리 방지). 키보드 레인과 터치 레인은 하나의 press로 합산.
- 길게 누르기 컨텍스트 메뉴/텍스트 선택은 `.gameplay-surface` CSS와 contextmenu 차단, Android는 플레이 중에만 long click 억제.

## 4. Hold+Tap/Flick Verification
- 단위: `PointerLaneTracker` 4건, 통합(GameScreen+엔진) 5건 — 시나리오 A~L: Hold+Tap, Hold+Flick, Hold+Hold(+Tap/Flick), 다른 pointer의 up/cancel, 소유자 조기 해제 시 해당 Hold만 broken, 4 pointer 동시, 빠른 연타/연속 Flick, 이중 입력 없음.
- E2E: Chromium CDP 실제 터치 이벤트로 2손가락, 다른 레인 Flick, 길게 누르기, 4손가락, cancel 확인.
- **실기기 확인은 하지 않았다.**

## 5. Media Preload
- `isMediaReady`: readyState 4, 또는 앞으로 15초 이상(또는 곡 끝까지) 버퍼. `canplaythrough` 이후 시작, 준비 진행 표시.
- MV 실패 → "다시 시도 / MV 없이 플레이". MV 20초 지연 → "계속 기다리기 / MV 없이 플레이".
- 재시작/재개 시 재다운로드 없음(같은 미디어 요소 유지; 결과 화면 RETRY는 새로 준비).

## 6. Slow Network / Buffer Handling
- 버퍼링(waiting/stalled)이 발생하면 판정을 중단(`inputLive()` 게이트)하고 `playing` 복귀 시 재개. 정지된 클럭에 대한 판정 오염 방지.
- 한계: 실제 저속망 조건은 Chromium 시뮬레이션/이벤트 주입으로만 확인. 실기기 느린 Wi-Fi 확인 필요.

## 7. Audio/MV Sync
- 단일 미디어 클럭 사용(오디오·MV 동일 요소). MV 설정 변경은 오디오 위치를 움직이지 않음(테스트). 카운트다운 동안 미디어/클럭/노트/입력/틱/점수/콤보 모두 정지, 같은 위치에서 재개.
- 체감 싱크(지연 보정, 블루투스 등)는 실기기 미검증.

## 8. Pause UX
- 메뉴: 계속하기 / 다시 시작 / MV 설정 / 곡 리스트로 돌아가기. 버튼 크기·터치 영역은 E2E에서 확인(폰/태블릿/데스크탑).
- Pause 중 Hold 정책: 키보드는 Pause 중에도 누른 상태를 추적했지만, **터치는 Pause에서 포인터 상태를 지워 "계속 누르고 있어도 유지"가 성립하지 않았다.** Final Fix에서 수정(Final Fix 보고서 3절 참조).

## 9. Resume/Restart Countdown
- 3-2-1 (`COUNTDOWN_STEP_MS`=1000, 단일 타이머). 재개/다시 시작 공통. 카운트다운 중 입력 무시, 방향 잠금 유지.

## 10. MV Settings
- 플레이 화면 상단 옵션 제거, Pause 메뉴의 MV 설정으로 이동. 즉시 적용, 오디오 위치 불변.

## 11. Song List Exit
- 곡 리스트로 돌아가기: 확인창 → 오디오/MV/타이머/RAF/입력 정리(`handleQuit`) → 방향 잠금 해제. 중단된 플레이는 Record 저장 없음(테스트 + E2E Pause→Library).

## 12. Gameplay Navigation
- 왼쪽 "메뉴로 가기"/뒤로 버튼 제거. Android 시스템 Back → `window.__beatdashBack()` → Pause. 이미 Pause이면 동작은 체크리스트 4항 확인 필요.
- Maker TEST PLAY는 자체 종료 버튼(`onQuit`)과 Back → Maker 복귀.

## 13. Orientation Lifecycle
- 잠금: 플레이 진입 시. 유지: Pause / 카운트다운 / Restart. 해제: 곡 리스트 이동, 결과 종료, `onPageStarted`, Activity `onDestroy`.
- 소스 계약 테스트로 전역 방향 고정 금지(매니페스트), `PlayActivity` configChanges 확인. 실제 회전 동작은 미검증.

## 14. Android Real-device Verification
**수행하지 않았다.** 다음은 모두 "미검증"이다: 멀티터치, Back 동작, 방향 잠금/해제, 시스템 바·노치, 느린 네트워크 프리로드, MASTER 스피너, Maker/Community 터치 조작. 항목별 체크리스트: `docs/V5_PHASE2_ANDROID_DEVICE_CHECKLIST.md`.
또한 Kotlin 변경(`Difficulty.kt`, `MainActivity.kt`, `PlayActivity.kt`, `RhythmApi.kt`, 매니페스트)은 컴파일하지 못했고, 소스 문자열 계약 테스트만 통과했다.

## 15. 테스트 결과 (이 환경)

| 항목 | 결과 |
| --- | --- |
| `tsc -b` | 통과 |
| `oxlint` | 0 warnings |
| Vitest | 28 files / 353 tests 통과 (순서 실행 + shuffle seed 1/7/42 모두 통과) |
| `npm run build` | 통과 |
| `pytest web/backend` | 53 통과 |
| `pytest web/analyzer` | 127 통과 |
| `pytest scripts/tests` | 36 통과 |
| `git diff --check` | 이상 없음 |
| Playwright Chromium E2E (`web/scripts/phase2_browser_review.py`) | 200 checks / 오류 0 |

E2E 범위: 360×800 ~ 2560×1440 세로/가로 레이아웃, Maker 저장→TEST PLAY→공유→다른 사용자 다운로드→플레이, CDP 멀티터치, Pause/Resume 미디어 정지, Back→Pause, Pause→Library 정리. 샌드박스 Chromium에는 H.264가 없어 실제 MV 코덱 재생은 확인하지 못했다.

## 16. Known Gameplay Issues / 남은 위험
1. Android 실기기·Kotlin 컴파일 미검증 (최대 위험).
2. Hold 재그랩 400ms, 15초 버퍼 기준, 28px/400ms Flick 임계값은 경험적 값 — 실기기에서 조정 가능성.
3. Community SQLite는 Railway Volume 없이 영속되지 않음. 익명 authorSecret은 localStorage 삭제 시 소유권을 잃음(복구 수단 없음).
4. Community rate limit은 프로세스 메모리 기준(다중 인스턴스 시 분산되지 않음).
5. Desktop: 새 Flick 없음(요구사항 준수), Tauri 빌드는 이 환경에서 불가했고 소스는 변경 없음.
6. 범위 외로 제외: PvP, 협동, Maker v2, Railway 제거, 오프라인 플레이어, 네이티브 엔진 재작성.

## 17. 변경 파일
`git diff --stat` 기준 수정 33개 + 신규(Maker, Community, 미디어/포인터 엔진, 마이그레이션, 테스트, 문서). 전체 목록은 패치 참조.
