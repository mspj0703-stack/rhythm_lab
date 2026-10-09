export interface Notice {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  version?: string;
  priority?: "normal" | "important";
}

/** Bundled notices remain available without a separate service. Edit this feed per release. */
export const NOTICES: readonly Notice[] = [
  {
    id: "v5-phase2-test",
    title: "v5.0 Phase 2 테스트 안내 · MASTER / 플레이 화면 / Maker",
    body: "최고 난이도 이름이 MASTER로 바뀌었습니다(기존 채보·기록은 그대로). 플레이 화면이 화면 전체를 쓰고, 왼쪽 메뉴 버튼 대신 일시정지 메뉴에서 계속하기·다시 시작·MV 설정·곡 리스트로 돌아가기를 선택합니다. 계속하기/다시 시작은 3·2·1 후 재생됩니다. Hold 중 다른 손가락 Tap/Flick 입력을 개선했고, 곡과 MV가 준비된 뒤에 시작합니다. 곡 상세의 EDIT로 Maker를 열어 채보를 고칠 수 있으며(AI 원본은 보존), 사람이 수정한 편집본만 COMMUNITY에 공유됩니다.",
    createdAt: "2026-10-09T12:00:00+09:00",
    version: "5.0.0-phase2",
    priority: "important",
  },
  {
    id: "v5-phase1-test",
    title: "v5.0 Phase 1 테스트 안내",
    body: "모바일·PC 채보 분리, Hold 지속 점수, MASTER 난이도가 추가되었습니다. 새 PC 채보는 D F J K로 플레이합니다. 기존 Flick 채보는 레인 키+Space 입력을 사용합니다. 기존 저장곡과 기록은 유지됩니다.",
    createdAt: "2026-10-09T00:00:00+09:00",
    version: "5.0.0-phase1",
    priority: "important",
  },
];
