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
    id: "v5-phase1-test",
    title: "v5.0 Phase 1 테스트 안내",
    body: "모바일·PC 채보 분리, Hold 지속 점수, EXTREME 난이도가 추가되었습니다. 새 PC 채보는 D F J K로 플레이합니다. 기존 Flick 채보는 레인 키+Space 입력을 사용합니다. 기존 저장곡과 기록은 유지됩니다.",
    createdAt: "2026-10-09T00:00:00+09:00",
    version: "5.0.0-phase1",
    priority: "important",
  },
];
