import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import App from '../App';
import { YouTubeEntry } from '../web/YouTubeEntry';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from '../settings/preferences';
import { saveNoteSpeed, loadNoteSpeed } from '../settings/noteSpeed';
import { saveTimingOffsetMs, loadTimingOffsetMs } from '../settings/timingOffset';
import { saveAudioSettings, loadAudioSettings, DEFAULT_AUDIO_SETTINGS } from '../audio/sfx';
import { saveAnalysisToLibrary, savePlayResult, updateSongOffset, updateSongCustomCover, getLibrarySong, getRecordsForChart, listLibrary } from '../library/db';
import type { AnalysisResponse } from '../web/types';
vi.mock('../components/NoteFieldCanvas', () => ({ NoteFieldCanvas: () => <canvas/> }));
vi.mock('../library/thumbnail', () => ({ captureThumbnail: async () => null }));
let container: HTMLDivElement, root: Root;
let fetcher: ReturnType<typeof vi.fn>;
const payload = { id: 'a'.repeat(32), originalName: 'original.wav', originalTitle: 'Original Song', mediaUrl: '/media', mediaKind: 'audio',
  chart: {title:'Original Song',artist:'Artist',offset:0,bpm:120,difficulty:'Hard',level:2,notes:[{time:1,lane:0,type:'tap'}]},
  report: {generatorVersion:'fixture',difficulty:'hard',seed:42,bpmConfidence:1,rawOnsetCount:1,musicalEventCount:1,filteredEventCount:1,peakNotesIn1s:1,duration:4,bpm:120,finalNoteCount:1,notesPerSecond:.25,warnings:[],tempoCandidates:[],quality:{}} } as AnalysisResponse;
const result={perfect:1,great:0,good:0,miss:0,score:1000000,accuracyPercent:100,maxCombo:1,rank:'SSS' as const};
async function click(text: string) {
  const b=[...container.querySelectorAll('button')].find(e=>e.textContent?.includes(text));
  expect(b, text).toBeDefined();await act(async()=>b!.click());
}
async function enter(value: string) {
  const input=container.querySelector('#youtube-url') as HTMLInputElement;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
}
async function mountApp() { await act(async()=>root.render(<App/>)); }
async function settle(predicate:()=>boolean|Promise<boolean>) {
  for(let i=0;i<30;i++) { if(await predicate()) return; await act(async()=>{await new Promise(r=>setTimeout(r,10));}); }
  expect(await predicate()).toBe(true);
}
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  localStorage.clear();window.history.replaceState({},'', '/');
  vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('crypto',webcrypto);
  fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/health'?{version:'4.75',revision:'test'}:url==='/api/youtube-preview'?{title:'Original Song',channel:'Artist',duration:125,thumbnail:'https://i.ytimg.com/vi/id/hqdefault.jpg'}:payload,blob:async()=>new NodeBlob(['audio'],{type:'audio/wav'})}));
  vi.stubGlobal('fetch',fetcher);
  vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  vi.spyOn(window,'confirm').mockReturnValue(true);
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('reads clipboard only on Paste, requests preview only on Load, and generates only on CTA',async()=>{
  const read=vi.fn().mockResolvedValue('https://youtu.be/abcdefghijk');
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:read}});
  const complete=vi.fn();await act(async()=>root.render(<YouTubeEntry onComplete={complete}/>));
  expect(read).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  await click('붙여넣기');expect(read).toHaveBeenCalledTimes(1);expect(fetcher).not.toHaveBeenCalled();
  await click('URL 불러오기');expect(fetcher.mock.calls[0][0]).toBe('/api/youtube-preview');
  expect(container.querySelector('.video-preview')!.textContent).toContain('2:05 · Artist');
  expect(container.querySelector('.video-preview img')!.getAttribute('src')).toContain('i.ytimg.com');
  await click('채보 만들기');expect(fetcher.mock.calls[1][0]).toBe('/api/analyze-youtube');expect(complete).toHaveBeenCalledWith(payload);
});
it('clears stale preview when the URL changes',async()=>{
  await act(async()=>root.render(<YouTubeEntry onComplete={()=>{}}/>));
  await enter('https://youtu.be/abcdefghijk');await click('URL 불러오기');
  expect(container.querySelector('.video-preview')).not.toBeNull();
  await enter('https://youtu.be/other123456');expect(container.querySelector('.video-preview')).toBeNull();
});
it('never displays backend exception strings on preview failure',async()=>{
  fetcher.mockResolvedValue({ok:false,json:async()=>({detail:'SECRET /private/exception'})});
  await act(async()=>root.render(<YouTubeEntry onComplete={()=>{}}/>));
  await enter('https://youtu.be/abcdefghijk');await click('URL 불러오기');
  expect(container.querySelector('[role=alert]')!.textContent).toContain('영상을 불러올 수 없습니다');
  expect(container.textContent).not.toContain('SECRET');
});
it('shows only a stage while generating and aborts delivery after leaving Home',async()=>{
  let resolve!: (value: unknown)=>void;
  const complete=vi.fn();
  await act(async()=>root.render(<YouTubeEntry onComplete={complete}/>));
  await enter('https://youtu.be/abcdefghijk');await click('URL 불러오기');
  fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await click('채보 만들기');
  expect(container.querySelector('[role=status]')!.textContent).toContain('채보 생성 중');
  expect(container.querySelector('[role=status]')!.textContent).not.toContain('%');
  await act(async()=>root.render(null));
  await act(async()=>resolve({ok:true,json:async()=>payload}));expect(complete).not.toHaveBeenCalled();
});
it('completes Home → preview → analysis → play with the real Library cache',async()=>{
  await mountApp();await enter('https://youtu.be/abcdefghijk');await click('URL 불러오기');await click('채보 만들기');
  await settle(()=>!!container.querySelector('.play-action'));
  await settle(async()=>(await listLibrary()).length===1);
  await act(async()=>container.querySelector<HTMLButtonElement>('.play-action')!.click());
  expect(container.querySelector('.start-card')).not.toBeNull();expect(container.textContent).toContain('Original Song');
});
it('settings reset through the UI preserves library, chart, records, custom cover and song offset',async()=>{
  const saved=await saveAnalysisToLibrary(payload,{nativeMedia:true});
  await updateSongOffset(saved.song.id,48);await updateSongCustomCover(saved.song.id,'data:image/jpeg;base64,custom');
  await savePlayResult({songId:saved.song.id,chartId:saved.charts[0].id,difficulty:'hard',result,offsetMs:48});
  saveNoteSpeed(12.3);saveTimingOffsetMs(-65);savePreferences({...DEFAULT_PREFERENCES,combo:false});saveAudioSettings({...DEFAULT_AUDIO_SETTINGS,masterVolume:.1});
  await mountApp();await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label=설정]')!.click());
  expect(container.textContent).toContain('Gameplay');expect(container.textContent).toContain('Judgement');
  await click('설정 초기화');
  expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);expect(loadNoteSpeed()).toBe(8);expect(loadTimingOffsetMs()).toBe(0);expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
  const after=await getLibrarySong(saved.song.id);expect(after!.song.timingOffsetMs).toBe(48);expect(after!.song.customCover).toContain('custom');expect(after!.charts).toHaveLength(1);expect(await getRecordsForChart(saved.charts[0].id)).toHaveLength(1);
  await click('Song Timing Offset');expect(container.querySelector('.library-page')).not.toBeNull();
});
it('visual and judgement toggles survive a fresh App mount',async()=>{
  await mountApp();await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label=설정]')!.click());
  const toggle=[...container.querySelectorAll('.settings-toggle')].find(e=>e.textContent?.includes('Combo 표시'))!.querySelector<HTMLInputElement>('input')!;
  await act(async()=>toggle.click());expect(loadPreferences().combo).toBe(false);
  await act(async()=>root.render(null));await mountApp();await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label=설정]')!.click());
  expect([...container.querySelectorAll('.settings-toggle')].find(e=>e.textContent?.includes('Combo 표시'))!.querySelector<HTMLInputElement>('input')!.checked).toBe(false);
});
it('supports Android library/settings entry without requiring a song session',async()=>{
  window.history.replaceState({},'', '/?view=settings');await mountApp();expect(container.querySelector('.settings-page')).not.toBeNull();
  await act(async()=>root.render(null));window.history.replaceState({},'', '/?view=library');await mountApp();expect(container.querySelector('.library-page')).not.toBeNull();
});
