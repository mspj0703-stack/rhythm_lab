import { NoteSpeedControl } from "../../web/NoteSpeedControl";
import { TimingOffsetControl } from "../../web/TimingOffsetControl";
import type { AudioSettings } from "../../audio/sfx";

interface Props { noteSpeed: number; onNoteSpeedChange: (value: number) => void; timingOffsetMs: number; onTimingOffsetChange: (value: number) => void; settings: AudioSettings; onChange: (settings: AudioSettings) => void; onBack: () => void; }

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="settings-slider"><span>{label}<b>{Math.round(value * 100)}%</b></span><input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))}/></label>;
}

export function SettingsScreen({ settings, onChange, onBack, noteSpeed, onNoteSpeedChange, timingOffsetMs, onTimingOffsetChange }: Props) {
  return <main className="v4-shell settings-page"><header className="v4-topbar"><button className="text-back" onClick={onBack}>← HOME</button><div className="brand-lockup compact"><span className="brand-mark">B</span><strong>SETTINGS</strong></div><span/></header><section className="settings-title"><span className="eyebrow">AUDIO & FEEDBACK</span><h1>Settings</h1></section><section className="settings-card"><Slider label="Master" value={settings.masterVolume} onChange={(value) => onChange({ ...settings, masterVolume: value })}/><Slider label="Music" value={settings.musicVolume} onChange={(value) => onChange({ ...settings, musicVolume: value })}/><Slider label="SFX" value={settings.sfxVolume} onChange={(value) => onChange({ ...settings, sfxVolume: value })}/><label className="settings-toggle"><span><strong>효과음</strong><small>버튼, 판정, FC/PC 피드백</small></span><input type="checkbox" checked={settings.sfxEnabled} onChange={(e) => onChange({ ...settings, sfxEnabled: e.target.checked })}/></label></section><section className="settings-card"><NoteSpeedControl value={noteSpeed} onChange={onNoteSpeedChange}/><TimingOffsetControl value={timingOffsetMs} onChange={onTimingOffsetChange}/></section><section className="settings-note"><strong>v4.0 SFX</strong><p>현재 빌드는 외부 음원 파일 없이 동작하도록 Web Audio 기반 효과음을 사용합니다. 이후 최종 사운드 에셋으로 교체할 수 있습니다.</p></section></main>;
}
