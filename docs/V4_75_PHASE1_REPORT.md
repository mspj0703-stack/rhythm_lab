# BEATDASH v4.75 RC · Phase 1 결과

**판정: Phase 1 구현본 준비. 자동 검증 통과 범위만 승인하며, Phase 1 최종 완료 판정과 Phase 2 진행은 보류한다.**

기준 파일: `BEATDASH-v4.0-RC-hotfix-reviewed-source.zip`
기준 SHA-256: `bca7cb06ee04106934616979c8f4030a1438701b64dae97c224c8f89b3361ef5`
이번 버전: `4.75.0-rc.phase1`, Web Revision: `v4.75-rc-phase1`
작업 범위: Phase 1만. Phase 2~5 및 v5 제외 기능은 구현하지 않았다. 운영 서버 배포·GitHub push·APK 배포도 수행하지 않았다.

## 1. 구현한 기능

### Home / YouTube
- Android 메인: URL 입력, 사용자 버튼으로 붙여넣기, URL 불러오기, 원본 제목·영상 길이·채널·썸네일 Preview, 확인 후 `채보 만들기`.
- Android Library 및 Settings 진입 버튼. URL 입력 완료 시 키보드 닫기. 기존 공유 Intent와 저장곡 목록 유지.
- 웹 Home에도 URL → Preview → 채보 생성 → 기존 분석 결과/플레이 준비 흐름 연결. 파일 업로드 진입과 최근 곡·Library 유지.
- 붙여넣기는 사용자 조작 시에만 읽는다. 붙여넣기 자체는 서버 요청을 하지 않는다.
- 웹 Preview API `/api/youtube-preview`: 메타데이터 전용 요청, 미디어 다운로드 없음, subprocess 45초 제한, 동시 작업 2개, 대기 초과 시 429.
- 웹은 기존 `/api/analyze-youtube`, Android는 기존 기기 다운로드 → `/api/analyze` 경로를 사용한다.
- URL/영상 오류에 원시 exception을 표시하지 않는다. HTTP 실패 시 재시도할 수 있는 안내를 제공한다.
- 계산할 수 없는 전체 진행률을 제거. 실제 관측 가능한 `영상 정보 확인`, `영상·음원 준비`, `업로드·분석·채보 생성`, `완료` 상태를 표시한다. 서버 내부 세부 분석 단계는 아직 스트리밍되지 않으므로 따로 완료되었다고 표시하지 않는다.

### Settings
- Gameplay: 기존 Note Speed·전역 Offset·보정 UI 재사용, 곡별 Offset은 Library의 곡 상세로 접근.
- Judgement: FAST/SLOW와 판정 텍스트 각각 실제 출력에 연결.
- Visual: 배경 영상 표시, 밝기, 이펙트 Low/Normal/High, Combo 표시 연결.
- Audio: 기존 Master/Music/SFX 및 효과음 스위치 재사용.
- Device: Android이며 브라우저가 Vibration API를 노출할 때만 스위치 제공. 사용 동작과 판정 피드백에 연결, Android 진동 권한 선언. 실제 진동 여부는 실기기 미검증.
- Data/Support: 설정만 초기화. 곡·채보·기록·커버·곡별 Offset은 초기화 대상에서 제외.
- 웹 Build Revision, 서버 Version/Revision, Android에서 전달한 실제 설치 버전·versionCode 표시.
- 기존 Note Speed/Offset/Audio 저장 키 유지. 새 표시 옵션은 별도 키 `beatdash.preferences.v475`에 저장하고 유효성 검사.
- **Perfect Streak 효과 스위치는 Phase 2, 피드백 작성·전송 진입은 Phase 3에서 추가한다.** 현재는 예정 안내만 있으며 작동하지 않는 토글/전송 버튼을 넣지 않았다. 이 두 항목은 이번 단계의 완성 기능으로 계산하지 않는다.

### Result
- 마지막 노트 처리와 미디어 종료를 분리. 마지막 노트 후에도 곡의 남은 부분을 재생한다.
- 미디어 종료 후 600ms 마무리 상태를 거쳐 독립 결과 화면으로 전환한다.
- 결과 상태에서는 Canvas·Playfield·터치 레인·audio/video·플레이 MV 설정을 DOM에서 제거한다.
- 제목/난이도/Score/Accuracy/Max Combo/Perfect/Great/Good/Miss/Clear Type 표시.
- 기존 PC > FC > CLEAR 판정 함수와 기록 비교 로직 유지. NEW BEST, 개별 최고 기록, FIRST FC/PC 표시.
- Retry, Song Detail, Library 버튼 연결. Library에서 편집한 곡 제목도 결과에 반영.
- 종료 시 키보드 입력 훅 비활성화, pointer/flick 시작 정보 정리, 기존 입력 포커스 제거. 새 결과 화면에서 시작되지 않은 pointer click 및 반복 keydown 차단.
- 비동기 기록 저장 실패 재시도·늦은 Library 캐시 완료·이전 플레이 기록 응답 차단은 유지.

## 2. 변경한 파일

전체 목록: `docs/V4_75_PHASE1_CHANGED_FILES.txt`.

| 영역 | 주요 파일 |
|---|---|
| Android Home / Preview | `MainActivity.kt`, `YoutubeEngine.kt`, `activity_main.xml` |
| Android 진입·버전·권한 | `PlayActivity.kt`, `AndroidManifest.xml`, `app/build.gradle.kts` |
| 웹 진입 / 상태 연결 | `App.tsx`, `HomeScreen.tsx`, 신규 `YouTubeEntry.tsx`, `youtubeUrl.ts` |
| 설정 | `SettingsScreen.tsx`, 신규 `settings/preferences.ts` |
| 결과 / 미디어 | `GameScreen.tsx`, `ResultScreen.tsx` |
| 스타일 / 파일 업로드 | `App.css`, `UploadScreen.tsx` |
| 서버 | `backend/app.py`, `backend/test_app.py` |
| 자동 검증 | `mediaLifecycle.test.tsx`, 신규 `preferences.test.ts`, `phase1Ui.test.tsx`, 신규 `phase1_browser_review.cjs`, 기존 브라우저 스크립트 3개 |
| 버전 | `package.json`, `package-lock.json`, `BUILD_REVISION` |

Library DB 스키마/마이그레이션, Chart Generator, 판정 엔진, 기존 커버 처리, 저장곡 미디어 경로는 변경하지 않았다.

## 3. 기존 코드에서 발견한 문제

1. 마지막 노트가 끝나면 미디어를 정지해 긴 Outro가 잘렸다.
2. Result를 Playfield 아래에 추가해 플레이 화면과 결과가 함께 남았다.
3. Android에서 미디어 준비 후 분석 서버 업로드를 시작할 때 전체 진행률처럼 100%를 표시했다.
4. 영상 정보 확인 없이 곧바로 다운로드/생성을 시작했다.
5. Android 실패 UI와 웹 파일 분석 UI가 기술적 exception 문자열을 그대로 표시했다.
6. Settings에 Audio·Speed·Offset만 있고 표시 설정은 플레이 화면의 임시 값이었다.
7. Android PlayActivity가 곡 ID 없이는 종료되어 Library·Settings 직접 진입이 불가능했다.
8. 곡 제목을 편집한 경우 Library 플레이에서 내부 chart의 이전 제목을 표시할 수 있었다.

## 4. 설계상 변경

- 기존 React view 분기, GameScreen 기록 저장 로직, IndexedDB와 native 파일 재생 구조를 재사용했다.
- Result는 GameScreen 내부의 독립 렌더 분기로 구현했다. URL 라우터나 DB 구조를 재작성하지 않았으며, 결과 모드에 Playfield는 존재하지 않는다.
- 엔진의 `finished`는 판정 완료, `songEnded`는 실제 미디어 종료, `showResult`는 전환 완료 상태로 구분했다. 남은 곡도 Pause/Resume 및 미디어 복구 대상이다.
- 기존 저장소를 삭제하거나 재설치할 필요가 없다. APK는 동일 applicationId와 기존 서명키로 업데이트하며 versionCode 기준을 상향했다.
- Preview만 새로운 API이며 분석기는 기존 blocking API다. 세부 단계 텔레메트리 없이 가짜 진행률을 만들지 않았다.
- Perfect Streak/Feedback는 각 지정 Phase에서 기능과 설정을 함께 연결한다.

## 5. 신규 테스트

웹 **22개 추가**:
- 설정 기본값·손상값 처리·정규화·저장/재로드·기존 Speed/Offset 호환, URL 허용/거절: 11개.
- 실제 media end + 600ms 전환·Playfield 제거·Retry 새 입력·종료 후 중복 기록 방지·orphan click·실제 표시/음량 연결: 3개.
- 사용자 동작으로만 Clipboard 읽기, Preview/생성 요청 분리, URL 변경 시 Preview 무효화, exception 비노출, 화면 이탈 시 요청 결과 무시, 실제 App 분석/Library 캐시 흐름, 설정 초기화 데이터 보존, 설정 재마운트 유지, Android 진입 분기: 8개.

백엔드 **4개 추가**:
- 다운로드 없이 메타데이터 반환.
- 원시 예외 비노출.
- 외부 host/인증정보/비표준 포트 거절.
- live/길이 제한 거절.

기존 테스트는 삭제하지 않았다. 기존 비동기 기록 응답 테스트 1개에서 Retry 전에 media ended + 600ms를 기다리도록 수정했다. 기존 브라우저 테스트도 동일 변경에 맞춰 종료 이벤트/화면 전환 대기를 보완했으며, 해당 브라우저 스크립트 자체는 이 환경에서 실행 완료하지 못했다.

## 6. 전체 테스트 결과

| 검증 | 결과 | 범위/제한 |
|---|---|---|
| 원본 기준 Vitest | 173/173 PASS | 수정 전 실행 |
| 최종 Vitest | **195/195 PASS · 13개 파일** | jsdom, React 통합, fake-indexeddb 포함 |
| Analyzer / Chart Generator pytest | **103/103 PASS** | 기존 회귀, 라이브러리 경고 5개 |
| Backend pytest | **8/8 PASS** | 실제 합성 WAV 분석 + Preview subprocess 모의검증, 의존성 경고 1개 |
| 합계 | **306/306 PASS** | 위 세 테스트 계층의 합계, 실기기 수치 아님 |
| v3/v4 자동 회귀 | PASS 범위 유지 | 기존 Vitest 포함. 브라우저 회귀와 구분 |
| Browser E2E / 시각 검증 | **미검증** | Phase 1·hotfix·v3 스크립트 실행 시 Chromium 필수 socket 생성이 `Operation not permitted`로 차단되어 페이지를 열지 못함 |
| 실제 YouTube Preview/다운로드/생성 | **미검증** | 통합 테스트 API fixture 및 메타데이터 mock은 실제 YouTube 검증이 아님 |
| Android 전체 빌드·서명 | **미검증** | Android SDK/Gradle·서명키 없음 |
| Android 실기기 | **미검증** | 실제 기기 접근 없음 |

브라우저 실패는 앱 assertion 실패로 간주하지 않지만 PASS로도 계산하지 않는다. 스크린샷 및 실제 Canvas/WebView 레이아웃 검증 결과는 없다.

## 7. Build / Typecheck / Lint

| 항목 | 결과 |
|---|---|
| `npm run build` (`tsc -b && vite build`) | **PASS** |
| TypeScript | **PASS** |
| `npm run lint` (oxlint) | **PASS · 코드 경고/오류 없음** |
| Analyzer `python3 -m ruff check .` | **PASS** |
| Backend Python 구문 검사 | **PASS** |
| Android XML 파싱 | **PASS** — Kotlin/APK 빌드를 대신하지 않음 |
| `git diff --check` | **PASS** |
| 기준 ZIP에 patch 적용 및 전체 소스 비교 | **PASS · 193개 파일 바이트 일치** |
| 실제 Docker build | 미검증 |

## 8. 회귀 발생 여부

- 실행한 자동 테스트에서 회귀는 발견되지 않았다.
- 기존 Library 데이터 마이그레이션·기록 버전·커버 보존·미디어 복구·Tap/Hold/Flick·Timing Offset 테스트를 유지했다.
- 설정 초기화는 실제 App UI를 눌러 확인했고, DB의 곡·채보·Play Record·사용자 커버·곡별 Offset이 보존됐다.
- 브라우저/Android/실제 영상의 회귀 여부는 미검증이다. `회귀 없음`을 전체 환경에 확정하지 않는다.

## 9. Android 실기기 체크리스트 — 모두 미검증

### 업데이트 / 보존
- [ ] 기존 서명키로 빌드·서명 확인, 기존 앱 삭제 없이 APK 업데이트.
- [ ] 기존 곡·채보·기록·편집 제목·원본 썸네일·사용자 커버 유지.
- [ ] Note Speed·전역 및 곡별 Offset·기존 Audio 값 유지.

### Home / Preview
- [ ] 앱 실행 후 URL/붙여넣기/URL 불러오기/Library/설정 확인.
- [ ] 붙여넣기 버튼 전 Clipboard 접근 없음, 붙여넣기만으로 서버 요청 없음.
- [ ] 일반 URL·짧은 URL·공유 Intent·잘못된 링크·비공개·live·8분 초과 영상.
- [ ] 원본 썸네일/제목/길이/채널 확인 후 채보 만들기.
- [ ] URL 변경 후 이전 Preview로 생성되지 않음.
- [ ] 키보드 완료 버튼, 긴 제목, 모바일·태블릿 화면, 회전/앱 전환.
- [ ] 다운로드·업로드/분석 중 전체 100% 오표시 없음.
- [ ] 실제 분석 완료 후 저장·플레이 성공, 실패 후 재시도.

### Settings
- [ ] 카테고리별 옵션 변경 후 앱 완전 종료/재실행에도 유지.
- [ ] Note Speed 1자리 소수, 플레이 중 변경 불가.
- [ ] 전역/곡별 Offset, 보정 화면 실제 입력.
- [ ] FAST/SLOW와 판정 텍스트가 독립 적용.
- [ ] 배경 OFF에서도 음악 유지, 밝기 및 효과 3단계·Combo 표시 적용.
- [ ] Master/Music/SFX 음량 조합 적용, Retry 후에도 동일 음량.
- [ ] 진동 지원 환경에서 ON/OFF 실제 동작. 미지원 시 스위치 비노출.
- [ ] 설정 초기화 후 Library/Chart/Record/커버/곡별 Offset 보존.
- [ ] 실제 설치 APK 버전과 build, 웹 revision, 서버 revision 확인.

### Result / 회귀
- [ ] 마지막 노트 후 남은 음악 재생, 실제 곡 종료 + 약 0.6초 뒤 결과 이동.
- [ ] 결과 화면에 Playfield·영상·터치 레인 없음.
- [ ] 마지막 Tap/Hold/Flick/누른 키가 Retry/Library 버튼을 오작동시키지 않음.
- [ ] Retry 첫 프레임/음량/START/입력 상태 정상.
- [ ] Song Detail·Library 이동, 편집 제목 표시.
- [ ] CLEAR / FC / PC 우선순위, NEW BEST / FIRST FC / FIRST PC, 중복 기록 없음.
- [ ] 기록 저장 실패 재시도.
- [ ] Tap/Hold/Flick/멀티터치 기존 동작, 영상 중단 복구, Pause/Resume, 앱 백그라운드.
- [ ] 긴 Outro 중 Pause/Resume 및 미디어 재생 복구.

## 10. 알려진 문제 및 제한

- 실제 YouTube는 지역/공개 여부/차단에 따라 실패할 수 있다. 이번 테스트는 이를 해결했다고 증명하지 않는다.
- Android Preview/썸네일 새 코드와 설치 업데이트는 실제 빌드·기기로 확인해야 한다.
- Android Library 버튼은 같은 서비스 origin의 기존 웹 Library를 연다. native 파일만 존재하고 한 번도 웹 플레이어에 불러온 적 없는 옛 곡은 메인 저장곡 목록에서 한 번 열어야 웹 Library에 등록되는 기존 구조를 유지한다.
- 서버의 BPM·구조·하이라이트·QC 개별 완료 시각은 아직 받지 않는다. 생성 중 문구는 묶음 상태이며 각 단계 완료를 주장하지 않는다.
- Perfect Streak 효과/설정은 Phase 2, 피드백 작성·전송/실제 수신은 Phase 3에서 구현한다.
- 기존 플레이 화면의 MV 임시 조절은 해당 플레이 세션에 적용된다. 지속 적용값은 Settings에서 변경한다.
- 브라우저 실측 레이아웃/터치 크기/키보드/Android 진동·Clipboard 권한 UX는 미검증이다.
- Chart AI v2 및 Benchmark는 시작하지 않았으며 채보 품질 향상을 주장하지 않는다.

## 11. 다음 Phase 진행 가능 여부

**보류. Phase 2는 시작하지 않았다.** 실행한 자동 테스트는 통과했지만 Browser E2E 및 Android 빌드·실기기 검증이 남았다. 이 항목을 확인하고 치명적 회귀가 없음을 확인한 뒤 다음 Phase를 진행해야 한다.

## 적용 / 재검증

- 전체 소스 ZIP 또는 동일 기준 소스용 patch 중 하나만 사용한다.
- patch 기준은 맨 위의 reviewed ZIP이다. 원래 hotfix-source ZIP이나 다른 최신 변경분에 무조건 덮어쓰지 않는다.
- 기준 소스 루트에서 `git apply --check BEATDASH-v4.75-RC-phase1.patch`, 성공 후 `git apply BEATDASH-v4.75-RC-phase1.patch`.
- 웹: `cd web`, `npm ci`, `npm test`, `npm run build`, `npm run lint`.
- 분석기: `cd web/analyzer`, `python3 -m pytest -q`, `python3 -m ruff check .`.
- 서버: `cd web/backend`, `python3 -m pytest -q`.
- Chromium 가능 환경: `cd web`, `npx puppeteer browsers install chrome`, `npm run smoke:phase1`, `npm run smoke:v3`, `npm run smoke:v4`, `npm run smoke:hotfix`. 기존 smoke는 별도 4173 preview 서버 실행 후 `npm run smoke`.
- Android: 기존 `.github/workflows/build-android.yml`의 SDK 35 / Gradle 8.9 / Java 17 및 기존 서명 secret으로 빌드·검증. 앱 제거 금지.
- 웹 UI/서버 API도 새 버전을 함께 배포해야 새로운 웹 Preview API가 동작한다. 이번 산출물 제공은 운영 배포가 아니다.
