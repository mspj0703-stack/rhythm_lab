# Render 배포 (태블릿 기준)

이 프로젝트는 `render.yaml` + `Dockerfile`이 준비되어 있어 GitHub 저장소만 만들면 Render에서 바로 배포할 수 있습니다.

## 1. GitHub 저장소 준비
1. GitHub에서 새 저장소를 만듭니다. 예: `ai-rhythm-lab`.
2. 이 ZIP의 `rhythm-core` 폴더 안 파일을 저장소 루트에 업로드합니다.
3. `Dockerfile`, `render.yaml`, `backend/`, `analyzer/`, `src/`, `package.json`이 저장소 최상단에 보이면 됩니다.

## 2. Render에서 배포
1. Render에 로그인하고 GitHub를 연결합니다.
2. **New > Blueprint**를 선택합니다.
3. 방금 만든 GitHub 저장소를 선택합니다.
4. Render가 루트의 `render.yaml`을 읽으면 `ai-rhythm-lab` 웹 서비스가 표시됩니다.
5. Apply/Deploy를 누릅니다.
6. 빌드 성공 후 `https://...onrender.com` 주소가 생깁니다.

## 3. 첫 접속
무료 Render Web Service는 15분 동안 요청이 없으면 잠들 수 있습니다. 첫 접속 때 깨어나는 동안 잠깐 지연될 수 있습니다.

## 4. 테스트
- MP3/WAV/FLAC/OGG/M4A/AAC/MP4/WEBM
- 최대 업로드: 80MB
- 배포 프로필 최대 재생시간: 8분
- 동시 분석: 1개
- 업로드/분석 파일은 2시간 뒤 자동 정리됩니다.

실제 곡 5곡 정도로 Hard부터 테스트하고 Timing/Musicality/Pattern/Density/Repetition/Fun 점수를 저장하세요.

## 무료 서버 주의
Render 무료 인스턴스는 512MB RAM / 0.1 CPU이므로 긴 무손실 음원이나 큰 영상은 분석이 느리거나 메모리가 부족할 수 있습니다. 처음에는 3~5분 길이 MP3/M4A 음원으로 테스트하는 것을 권장합니다.
