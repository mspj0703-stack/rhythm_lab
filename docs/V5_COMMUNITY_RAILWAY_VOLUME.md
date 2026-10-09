# Community DB — Railway Volume 설정

Community 채보는 SQLite 파일(`COMMUNITY_DB_PATH`)에 저장된다. 컨테이너 파일시스템은 재배포 때 초기화되므로 **반드시 Railway Volume 안에 둬야** 한다.

## 설정
1. Railway 서비스 → **Volumes** → 새 Volume 추가, Mount path 예: `/data`.
2. Variables에 `COMMUNITY_DB_PATH=/data/community.sqlite3` 추가.
   (Railway는 Volume을 붙이면 `RAILWAY_VOLUME_MOUNT_PATH`도 자동 설정한다. 서버는 이 값과 마운트 장치로 판별한다.)
3. 재배포 후 `GET /api/health` 확인:

| 필드 | 의미 |
| --- | --- |
| `communityDbConfigured` | `COMMUNITY_DB_PATH`가 설정되어 있는가 (설정 여부만) |
| `communityDbPathType` | `volume` / `default` / `tmp` / `custom-unmounted` |
| `communityDbWritable` | DB 위치가 쓰기 가능한가 |
| `communityPersistentStorage` | **`volume`이고 쓰기 가능**할 때만 `true` |

`communityPersistentStorage: false`면 지금 올린 공유 채보는 다음 재배포 때 사라질 수 있다.
- `default`: 환경변수 없음 → `web/.runtime` (임시)
- `tmp`: `/tmp` 등 임시 영역
- `custom-unmounted`: 경로는 지정했지만 Volume 마운트 안이 아님 (경로 오타 가능성)

실제 경로는 응답에 노출하지 않는다.

## 주의
- Volume은 서비스당 하나의 인스턴스에만 붙는다. 다중 인스턴스로 확장하면 SQLite 파일 공유가 안 되므로 그 시점에 DB를 교체해야 한다.
- 업로드 rate limit은 프로세스 메모리 기준이다.
- 백업이 필요하면 Volume 스냅샷 또는 `sqlite3 .backup`을 사용한다.
- 중복 판정 해시 규칙(곡 identity 포함)이 바뀌었으므로, Phase 2 이전 빌드로 쌓인 테스트 데이터는 새 규칙과 호환되지 않는다(출시 전 테스트 DB는 비워도 된다).
