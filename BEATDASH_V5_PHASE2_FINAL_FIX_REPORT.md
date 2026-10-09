# BEATDASH v5.0 Phase 2 — Final Fix Report

- Branch: `v5-phase2` · base `main` 56eb0e9 · Version `5.0.0-rc.phase2`
- 상태: **Automated Final RC / Android device verification pending**

## 0. 판정

**FINAL RC READY — device verification pending**

자동 검증은 모두 통과했다. Android 실기기 검증은 하지 않았고(태블릿 사용 불가), Android APK는 이 환경에서 빌드되지 않았다. 따라서 Release Ready가 아니다.

## 1. 수정한 결함

| # | 항목 | 결과 |
| --- | --- | --- |
| P0-1 | Community `content_hash`에 곡 identity 없음 → 다른 곡의 같은 노트 배열이 409 | 수정 |
| P0-2 | 터치 Hold가 Pause에서 포인터 상태를 지워 "계속 누르고 있으면 유지"가 성립하지 않음 | 수정 |
| P1-1 | Maker에 "빈 채보로 시작"이 없었음 (AI 채보 복제 편집만 가능) | 추가 |
| P1-2 | `/api/health`의 `communityPersistentStorage`가 환경변수 존재 여부만 확인 | 수정 |
| P2 | JSON Export/Import | 후속 버전으로 연기 (6절) |

## 2. content_hash 변경 방식

`web/backend/community.py`

해시 입력: `[2(규칙 버전), songIdentity, platformProfile, difficulty, notes]`

`songIdentity`:
1. fingerprint가 있으면 `["fp", fingerprint(소문자)]`
2. 없으면 `["meta", 정규화한 originalTitle(없으면 title), duration(0.1초 반올림), bpm(0.1 반올림)]`
   - 정규화: Unicode NFKC → casefold → 공백 접기

결과: 같은 곡 + 같은 채보 = 409 유지. 다른 곡(다른 fingerprint, 또는 fingerprint 없이 제목/길이/BPM이 다른 곡) + 우연히 같은 노트 = 정상 업로드. 공개 API 계약(요청/응답/상태코드)은 변경 없음.

호환성 주의: 해시 규칙이 바뀌어 이전 빌드로 쌓인 테스트 데이터와는 중복 판정이 이어지지 않는다. Phase 2는 미출시이므로 영향 없음.

테스트(`test_community.py`): 서로 다른 fingerprint + 동일 notes 둘 다 성공 / 동일 fingerprint + 동일 notes 409 / fingerprint 없는 다른 곡(제목·길이·BPM 각각 다름) 모두 성공 / fingerprint 없는 같은 곡(공백·대소문자·0.1초 미만 차이) 409.

## 3. Pause / Touch Hold 처리 방식

### 분석
- 기존 코드는 `pauseGame()`에서 `PointerLaneTracker.reset()`을 호출했다. 그 결과 Pause 중 손가락을 대고 있어도 재개 시점의 `heldLanes()`가 비어 있어, 터치 Hold는 항상 "뗀 것"으로 취급되어 400ms 재잡기에만 의존했다. 키보드는 Pause 중에도 추적되어 동작이 달랐다.
- 브라우저가 Pause 오버레이 전환 중 포인터 상태를 유지하는가? 레인 버튼은 Pause 중에도 마운트되어 있고, 각 터치는 `setPointerCapture`로 해당 레인 버튼에 캡처된다. 캡처된 포인터의 `pointerup/pointercancel`은 위에 오버레이가 있어도 레인 버튼으로 전달된다. **실제 Chromium CDP 터치로 확인했다**(E2E: 손가락을 대고 Pause → 오버레이 아래에서도 눌림 유지 / 뗌 / cancel 모두 정확히 반영).

### 구조 (`GameScreen.tsx`)
- 사용자 Pause(UI, 키, Android Back)는 포인터를 **지우지 않는다.** 판정은 `inputLive()`로 막고(Pause·카운트다운 중 판정 없음), 포인터 bookkeeping만 계속한다.
- 재개 직전 reconcile: 캡처를 잃었는데 end 이벤트가 오지 않은 포인터(유령)는 제거한다. 그 뒤 `heldLanes()`(터치+키)로 `resumeHolds`를 호출한다 — 누르고 있는 레인은 Hold 유지, 뗀 레인은 기존 400ms 재잡기 창.
- 창 포커스 상실/페이지 숨김(blur, visibility, `beatdash:pause`)은 포인터 이벤트를 신뢰할 수 없으므로 모든 터치를 지운다(`dropPhysicalPointers`). 이 경우에는 재개 후 다시 눌러야 Hold가 이어진다(400ms 창).
- 다시 시작/나가기/종료에서는 기존처럼 초기화(유령 포인터 없음).
- 키보드와 터치는 같은 `heldLanes()` 경로를 쓴다.

### 테스트
- Vitest `v5TouchHoldPause.test.tsx` 14건: 계속 누름 → Pause → Resume 유지(재잡기 불필요, 400ms 이후에도 유지) / Pause 중 판정 없음·카운트다운 중 판정 없음 / Pause 중 뗌 → 재잡기 창, 재잡기 없으면 hold_broken / 카운트다운 중 뗌 / 2 Hold 중 하나만 뗌 / 2 Hold 모두 유지 / Hold + 다른 손가락 Tap/Flick + Pause / 다른 레인 손가락 영향 없음 / pointercancel / 캡처 유실 유령 제거 / 포커스 상실 / 키보드 Hold / 재시작 후 stuck 없음. 이전 동작(reset)으로 되돌리면 5건이 실패함을 확인했다.
- Playwright CDP 실제 터치 E2E 6항목 추가(위 분석의 실증 포함).
- **실기기(Android WebView)는 미검증.**

## 4. 빈 Maker Chart 지원

지원함. 이미 Library에 저장된 곡에서만 시작한다(새 MP3 불러오기는 범위 밖).
- Song Detail → "빈 채보로 새로 만들기": 플랫폼(Mobile/Desktop) + 난이도(EASY…MASTER) 선택 → "빈 채보로 Maker 시작".
- `maker/blank.ts`의 메모리 초안: 곡의 BPM/offset/메타 재사용(같은 플랫폼 AI 채보 우선), 노트 0개. **저장 전에는 DB에 아무것도 쓰지 않는다.**
- 저장(`saveEditedChart({draft})`): 노트 1개 이상 필요, 새 chart ID, `origin: MANUAL_EDITED`, `parentChartId` 없음, slot `variantKey:edit:<id>`. AI 원본 불변. 이후 저장은 같은 채보를 갱신(중복 생성 없음).
- Desktop 초안은 Flick 배치 불가, 검증/TEST PLAY(기록 없음)/Community 공유 조건과 동일 경로. 부모가 없으면 편집 요약이 `added = 노트 수`로 계산되어 공유 가능.
- 시작 레벨은 난이도별 고정값(3/6/10/14/18)이며 Maker에서 레벨 편집 UI는 없다(알려진 한계).
- 테스트 `v5MakerBlank.test.tsx` 8건 + E2E 3항목: 초안 생성/DB 미기록, 빈 상태에서 SAVE 비활성, 노트 추가 후 저장, 재저장 시 중복 없음, 앱 재실행 후 재오픈, 빈 상태 TEST PLAY 차단·노트 후 가능, 공유 조건 통과 + 업로드 payload, Desktop Flick 비활성, 상세 화면 선택 UI, AI 원본 불변.

## 5. Railway Persistence 상태

`/api/health`는 이제 실제 DB 위치를 판별한다(`community.describe_storage`, 경로 자체는 노출 안 함).

| 필드 | 의미 |
| --- | --- |
| `communityDbConfigured` | 환경변수 설정 여부(참고용) |
| `communityDbPathType` | `volume` / `default` / `tmp` / `custom-unmounted` |
| `communityDbWritable` | 쓰기 가능 여부 |
| `communityPersistentStorage` | `volume`이고 쓰기 가능할 때만 `true` |

`volume` 판정: 경로가 `RAILWAY_VOLUME_MOUNT_PATH` 안이거나, 컨테이너 루트와 다른 장치(마운트)에 있을 때. 환경변수만 있고 임시 경로면 `false`. 기존 키 `communityPersistentStorage`는 유지(의미만 정확해짐). 테스트 4건 추가.

Volume 설정 방법: `docs/V5_COMMUNITY_RAILWAY_VOLUME.md` (Mount path `/data`, `COMMUNITY_DB_PATH=/data/community.sqlite3`, health 확인).

**실제 Railway 배포·Volume 마운트는 수행하지 않았다.** 배포 후 `/api/health`에서 `communityPersistentStorage: true`를 확인해야 한다.

## 6. JSON Export / Import 판단

**이번에는 구현하지 않고 후속 버전으로 연기한다.** Phase 2 Final을 막는 항목이 아니다.
- 이유: (1) 가져온 채보의 origin/저작권 정책(MANUAL_EDITED로 두면 남의 채보를 공유할 수 있고, COMMUNITY로 두면 편집 이력이 끊김)을 먼저 정해야 한다. (2) 서버 검증과 동일한 검증·곡 매칭을 클라이언트에 재사용해야 한다. (3) Android WebView는 Blob 다운로드/파일 선택에 네이티브 처리가 필요해 Companion 변경과 실기기 검증이 따라온다.
- 대안: 공유는 Community Cloud로 이미 가능.

## 7. 테스트 결과 (이 환경, 최종 코드 기준)

| 항목 | 결과 |
| --- | --- |
| `tsc -b` | 통과 |
| `oxlint` | 0 warnings |
| Vitest | 30 files / **375** tests 통과 (이전 353; 순서 실행 + shuffle seed 1/7/42 모두 통과) |
| `npm run build` | 통과 |
| `pytest web/backend` | **61** 통과 (이전 53) |
| `pytest web/analyzer` | 127 통과 |
| `pytest scripts/tests` (소스 계약) | 36 통과 |
| Playwright Chromium E2E | **209** checks 통과, 오류 0 (이전 200) |
| `git diff --check` | 이상 없음 |

샌드박스 Chromium에는 H.264가 없어 MV 코덱 재생은 확인하지 못했다.

## 8. Android build 결과

**실패 — 미검증.** `./gradlew assembleDebug`는 실행할 수 없었다.
- 저장소에 Gradle Wrapper(`gradlew`)가 없다(`android/`에 `build.gradle.kts`만 존재).
- 대체로 시스템 `gradle assembleDebug`(8.14.3, JDK 21)를 시도했으나 `com.android.application:8.7.3` 플러그인을 해석하지 못해 `BUILD FAILED`. Google Maven / Maven Central / Gradle Plugin Portal에 이 환경에서 접근할 수 없다(직접 연결 시도도 실패). `ANDROID_HOME`/Android SDK도 없다.
- 소스 계약 테스트(36건)는 문자열 검사일 뿐이며 **컴파일 통과로 취급하지 않는다.**

## 9. Desktop build 결과

**통과(Rust 컴파일 + 릴리스 바이너리).** 이 환경에서 crates.io 접근과 GTK/WebKit 개발 패키지(apt) 설치가 가능했다.
- `cargo check`: 통과.
- `npm run build -- --no-bundle` (tauri build, 설치 패키지 번들 제외): 통과, 릴리스 바이너리 `beatdash-desktop` 생성.
- 설치 패키지(deb/AppImage/MSI) 번들과 실행(GUI)은 확인하지 않았다. Desktop 소스는 이번 작업에서 변경하지 않았고(웹 번들만 공유), Desktop에 새 Flick은 없다.
- 빌드 부산물(lock 파일, `gen/`, `target/`)은 저장소에서 제외했다.

## 10. 미검증 실기기 항목

전부 미검증이다 — `docs/V5_PHASE2_ANDROID_DEVICE_CHECKLIST.md`(Final Fix 항목 추가됨). 특히:
- Android WebView에서 Hold 유지 중 Pause→Resume, Hold + Tap/Flick 멀티터치
- Back → Pause, 방향 잠금/해제, 시스템 바·노치
- 느린 네트워크 프리로드, MV 실패 선택, 체감 싱크
- MASTER 스피너(Companion), Maker/Community 터치 조작
- Kotlin 컴파일

## 11. Commit / Branch / Push

- Branch: `v5-phase2` (base `main` 56eb0e9), 커밋 2개:
  1. `v5 Phase 2: Maker v1, Community chart sharing, …` (Final Fix 이전 Phase 2 전체)
  2. `v5 Phase 2 Final Fix: community dedupe identity, …` (이번 수정)
- 정확한 SHA는 전달 메시지와 번들(`git bundle verify`)에 기록한다(문서가 자기 SHA를 포함할 수 없음).
- **Push: 실패(403).** `git push origin v5-phase2`가 "Claude doesn't have GitHub access to mspj0703-stack/rhythm_lab for your organization"로 거부되었다. 세션에 저장소를 추가(add_repo)해도 읽기만 되고 push는 거부된다. `main`에는 어떤 경로로도 push하지 않았다.
- 해결: 조직 관리자가 Claude GitHub App(https://github.com/apps/claude/installations/select_target)을 설치하거나 claude.ai 설정에서 GitHub를 재연결하면 같은 세션에서 push할 수 있다.
- 수동 적용(로컬 저장소에서):
  ```
  git fetch origin && git checkout -b v5-phase2 origin/main      # 56eb0e9
  git fetch /경로/beatdash-v5-phase2.bundle v5-phase2:v5-phase2-import
  git checkout v5-phase2 && git merge --ff-only v5-phase2-import
  git push origin v5-phase2
  ```
  번들이 어렵다면 `git am beatdash-v5-phase2-mbox/*.patch`(커밋 2개)로도 동일한 결과가 나온다.

## 12. 알려진 한계

1. 레벨은 빈 채보에서 고정값(편집 UI 없음).
2. 앱이 포커스를 잃고 돌아온 경우 터치 Hold는 다시 눌러야 이어진다(재잡기 400ms).
3. Community: authorSecret은 localStorage 삭제 시 복구 불가, rate limit은 프로세스 메모리 기준, 단일 인스턴스 SQLite 전제.
4. 판정 임계값(재잡기 400ms, Flick 28px/400ms, 15초 버퍼)은 실기기에서 조정이 필요할 수 있다.
