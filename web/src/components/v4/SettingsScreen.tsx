import { useEffect, useState } from "react";
import { NoteSpeedControl } from "../../web/NoteSpeedControl";
import { TimingOffsetControl } from "../../web/TimingOffsetControl";
import type { AudioSettings } from "../../audio/sfx";
import { supportsVibration, type Preferences } from "../../settings/preferences";
import revision from "../../../BUILD_REVISION?raw";

interface Props { noteSpeed: number; onNoteSpeedChange: (value: number) => void; timingOffsetMs: number; onTimingOffsetChange: (value: number) => void; settings: AudioSettings; onChange: (settings: AudioSettings) => void; onBack: () => void; preferences: Preferences; onPreferences: (value: Preferences) => void; onSongSettings: () => void; onReset: () => void; }
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="settings-slider"><span>{label}<b>{Math.round(value * 100)}%</b></span><input aria-label={label} type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))}/></label>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></label>;
}
export function SettingsScreen({ settings, onChange, onBack, noteSpeed, onNoteSpeedChange, timingOffsetMs, onTimingOffsetChange, preferences, onPreferences, onSongSettings, onReset }: Props) {
  const nativeVersion = new URLSearchParams(window.location.search).get("nativeVersion");
  const nativeBuild = new URLSearchParams(window.location.search).get("nativeBuild");
  const [server, setServer] = useState("확인 중…");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject()).then(data => {
      if (!controller.signal.aborted) setServer(`${data.version ?? "미확인"} / ${data.revision ?? "미확인"}`);
    }).catch(() => { if (!controller.signal.aborted) setServer("서버 정보 확인 불가"); });
    return () => controller.abort();
  }, []);
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => onPreferences({ ...preferences, [key]: value });
  return <main className="v4-shell settings-page">
    <header className="v4-topbar"><button className="text-back" onClick={onBack}>← HOME</button><strong>SETTINGS</strong></header>
    <h1>설정</h1>
    <section className="settings-card"><h2>Gameplay</h2><NoteSpeedControl value={noteSpeed} onChange={onNoteSpeedChange}/><TimingOffsetControl value={timingOffsetMs} onChange={onTimingOffsetChange}/><button onClick={onSongSettings}>Song Timing Offset · Library에서 곡 선택</button><p>Note Speed는 플레이 중 변경할 수 없습니다.</p></section>
    <section className="settings-card"><h2>Judgement</h2><Toggle label="FAST / SLOW 표시" checked={preferences.fastSlow} onChange={v => set("fastSlow", v)}/><Toggle label="판정 텍스트" checked={preferences.judgementText} onChange={v => set("judgementText", v)}/><p>Perfect Streak 효과 · 다음 업데이트 예정</p></section>
    <section className="settings-card"><h2>Visual</h2><Toggle label="배경 영상" checked={preferences.backgroundVideo} onChange={v => set("backgroundVideo", v)}/><Slider label="배경 영상 밝기" value={preferences.backgroundBrightness} onChange={v => set("backgroundBrightness", v)}/><label className="settings-toggle"><span>타격 이펙트 강도</span><select aria-label="타격 이펙트 강도" value={preferences.effects} onChange={e => set("effects", e.target.value as Preferences["effects"])}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label><Toggle label="Combo 표시" checked={preferences.combo} onChange={v => set("combo", v)}/></section>
    <section className="settings-card"><h2>Audio</h2><Slider label="Master Volume" value={settings.masterVolume} onChange={v => onChange({ ...settings, masterVolume: v })}/><Slider label="Music Volume" value={settings.musicVolume} onChange={v => onChange({ ...settings, musicVolume: v })}/><Slider label="SFX Volume" value={settings.sfxVolume} onChange={v => onChange({ ...settings, sfxVolume: v })}/><Toggle label="효과음" checked={settings.sfxEnabled} onChange={v => onChange({ ...settings, sfxEnabled: v })}/></section>
    <section className="settings-card"><h2>Device</h2>{supportsVibration() ? <Toggle label="Android 진동" checked={preferences.vibration} onChange={v => { set("vibration", v); if (v) navigator.vibrate(12); }}/> : <p>이 환경은 진동 API를 지원하지 않습니다.</p>}</section>
    <section className="settings-card"><h2>Data / Support</h2><button onClick={() => { if (window.confirm("설정만 초기화할까요? 저장곡·채보·기록·곡별 Offset은 유지됩니다.")) onReset(); }}>설정 초기화</button><p>피드백 보내기 · 다음 업데이트 예정</p><dl><dt>앱 버전</dt><dd>{nativeVersion ? `${nativeVersion} (${nativeBuild ?? "미확인"})` : "Web 4.75 RC · Phase 1"}</dd><dt>Web Build</dt><dd>{revision.trim()}</dd><dt>서버 Version / Revision</dt><dd>{server}</dd></dl></section>
  </main>;
}
