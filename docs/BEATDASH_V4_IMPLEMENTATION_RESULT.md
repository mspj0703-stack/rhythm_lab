# BEATDASH::Revive v4.0 구현 결과

기준 소스: `BEATDASH-v3.0-web-reviewed-source.zip` / `BEATDASH-v3.0-android-reviewed-source.zip`

상태: **원본 개발 시점의 기록. 최신 검수 결과는 [V4_REVIEW.md](V4_REVIEW.md)를 참조.**

## 구현 완료

### Library
- Home / Library / Song Detail / Settings 흐름 추가
- `BEATDASH_DB` IndexedDB 추가
  - `songs`
  - `charts`
  - `playRecords`
  - `settings`(향후 마이그레이션 예약)
- 분석 완료 곡 자동 Library 등록
- 가능한 경우 미디어 Blob 로컬 캐시
- 곡 제목 수정 + `originalTitle` 보존
- 검색 / 최근 플레이 / 추가일 / 제목 정렬
- 곡 삭제
- 같은 미디어에서 다른 난이도 채보 추가 생성

### Records
- 난이도/채보별 플레이 기록 저장
- Score / Accuracy / Max Combo / Perfect / Great / Good / Miss 저장
- 최근 플레이 기록 표시
- 최고 점수/정확도/콤보를 항목별로 독립 저장/집계
- 플레이 횟수 및 마지막 플레이 시간 갱신

### FC / PC
- FULL COMBO = Miss 0 (Great/Good 허용)
- PERFECT COMBO = Great/Good/Miss 모두 0이며 Perfect 존재
- 우선순위 PC > FC > CLEAR
- 결과 화면 FC/PC 전용 배너
- NEW HIGH SCORE / NEW ACCURACY BEST / NEW COMBO BEST
- FIRST FULL COMBO / FIRST PERFECT COMBO
- Library / Song Detail 난이도별 FC/PC 상태

### Timing Offset
- 기존 전역 Offset 유지
- Library 곡별 Offset 추가
- 검수 후: 전역 + 곡별 Offset 합산 (최종 ±300ms 제한)

### UI v4
- 홈 화면 신설
- Library 화면 신설
- 곡 상세 화면 신설
- Settings 화면 신설
- 기존 분석/게임 화면과 v4 화면 연결
- 모바일/태블릿 대응 CSS 추가

### SFX
- Web Audio 기반 임시 SFX 시스템
- UI 버튼 피드백
- START
- Perfect / Great / Good / Miss
- Flick / Hold
- Full Combo / Perfect Combo
- Master / Music / SFX 볼륨 및 SFX ON/OFF
- 외부 사운드 에셋 없이 동작하며 추후 실제 에셋으로 교체 가능

### Android
- 기능 코드는 v3 Companion 구조 유지
- versionName `4.0.0`
- versionCode 기준 `400000 + GITHUB_RUN_NUMBER`
- applicationId / 서명 구조 유지

## 주요 신규 파일

- `src/library/types.ts`
- `src/library/model.ts`
- `src/library/db.ts`
- `src/audio/sfx.ts`
- `src/components/v4/HomeScreen.tsx`
- `src/components/v4/LibraryScreen.tsx`
- `src/components/v4/SongDetailScreen.tsx`
- `src/components/v4/SettingsScreen.tsx`
- `src/__tests__/libraryModel.test.ts`
- `docs/V4_IMPLEMENTATION.md`

## 기존 주요 수정 파일

- `src/App.tsx`
- `src/App.css`
- `src/components/GameScreen.tsx`
- `src/components/ResultScreen.tsx`
- `src/web/UploadScreen.tsx`
- `backend/app.py`
- `package.json`
- `package-lock.json`
- `docs/VERSION_POLICY.md`

## 검증 결과

- TS/TSX syntax parse: **45 files / 0 syntax error files**
- 내부 소스 semantic type pass(로컬 React/Vite shim): **PASS**
- v4 record model runtime checks: **PASS**
- Backend pytest: **4/4 PASS**
- `npm ci`: 현재 컨테이너에서 dependency install이 장시간 정지하여 완료하지 못함
- 따라서 실제 `npm test`, `npm run build`, `npm run lint`, browser smoke는 이 세션에서 최종 재실행하지 못함
- Android APK compile: 미실행. 기존 GitHub Actions signed APK 환경에서 검증 필요

## 다음 검수에서 반드시 실행

```bash
npm ci
npm test
npm run lint
npm run build
npm run smoke
npm run smoke:v3
```

그리고 v4 신규 브라우저 검증:
- Library 저장 후 새로고침/앱 재시작
- 큰 MP4 저장 시 WebView IndexedDB quota
- 기존 v3 저장 데이터와 noteSpeed/global Offset 유지
- 곡별 Offset
- FC/PC 기록 및 NEW BEST 중복 처리
- 같은 곡에 4난이도 추가 생성
- Library 삭제
- Android WebView에서 Blob media 재생/seek
- 앱 업데이트 후 IndexedDB 유지
- UI/SFX 체감 확인

## 전달물

- `BEATDASH-v4.0-web-dev-source.zip`: v4 웹 전체 소스
- `BEATDASH-v4.0-android-dev-source.zip`: v4 Android Companion 전체 소스
- `BEATDASH-v3-to-v4-web.patch`: v3 검수본 대비 웹 변경분
- `BEATDASH-v3-to-v4-android.patch`: v3 Android 검수본 대비 변경분
- `BEATDASH-v4-changed-files.txt`: 변경 파일 목록

