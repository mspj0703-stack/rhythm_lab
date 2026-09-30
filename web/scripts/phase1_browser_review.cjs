const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const checks = [];
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS', name); }
(async () => {
  const out = 'review-output/phase1'; fs.mkdirSync(out, {recursive:true});
  const { preview } = await import('vite');
  const server = await preview({preview:{host:'127.0.0.1',port:4185,strictPort:true}});
  const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const errors=[];
  try {
    const page = await browser.newPage(); await page.setViewport({width:390,height:844});
    page.on('pageerror', e=>errors.push(e.message));
    const calls=[]; let previewFails=false;
    const payload={id:'phase1',originalName:'Original Song',originalTitle:'Original Song',mediaKind:'video',mediaUrl:'/test-video.mp4',chart:{title:'Original Song',artist:'QA',bpm:120,offset:0,difficulty:'Hard',level:2,notes:[{time:1,lane:0,type:'tap'},{time:2,lane:1,type:'tap'}]},report:{duration:12,bpm:120,generatorVersion:'phase1-fixture',seed:42,finalNoteCount:2,notesPerSecond:1,warnings:[],tempoCandidates:[],quality:{}}};
    await page.setRequestInterception(true);
    page.on('request', async request=>{
      const u=new URL(request.url());
      if (!u.pathname.startsWith('/api/')) return request.continue();
      calls.push({path:u.pathname,body:request.postData()});
      if(u.pathname==='/api/youtube-preview') {
        await new Promise(r=>setTimeout(r,180));
        return request.respond({status:previewFails?422:200,contentType:'application/json',body:JSON.stringify(previewFails?{detail:'SECRET /backend/private exception'}:{title:'Original Song',channel:'Artist',duration:125,thumbnail:'/favicon.svg'})});
      }
      if(u.pathname==='/api/analyze-youtube') {
        await new Promise(r=>setTimeout(r,250));
        return request.respond({status:200,contentType:'application/json',body:JSON.stringify(payload)});
      }
      if(u.pathname==='/api/health') return request.respond({status:200,contentType:'application/json',body:JSON.stringify({version:'4.75.0-rc.phase1',revision:'fixture-server'})});
      return request.respond({status:404,contentType:'application/json',body:'{}'});
    });
    const goto=()=>page.goto('http://127.0.0.1:4185/');
    const click=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes(t)),{},text);await page.evaluate(t=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(t)).click(),text);};
    const db=()=>page.evaluate(async()=>{
      const d=await new Promise(r=>{const q=indexedDB.open('BEATDASH_DB');q.onsuccess=()=>r(q.result);});
      const read=name=>new Promise(r=>{const q=d.transaction(name).objectStore(name).getAll();q.onsuccess=()=>r(q.result);});
      const songs=await read('songs'), charts=await read('charts'),records=await read('playRecords');d.close();return {songs,charts,records};
    });
    await goto();
    await page.evaluate(()=>{window.__clipboardReads=0;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{window.__clipboardReads++;return 'https://youtu.be/abcdefghijk';}}});});
    check('Home does not read clipboard automatically',await page.evaluate(()=>window.__clipboardReads===0));
    check('Home exposes URL, Paste, Load and Library',await page.evaluate(()=>!!document.querySelector('#youtube-url')&&['붙여넣기','URL 불러오기','Library 열기'].every(t=>document.body.textContent.includes(t))));
    await click('붙여넣기');
    check('Paste is local only',calls.length===0 && await page.$eval('#youtube-url',e=>e.value==='https://youtu.be/abcdefghijk'));
    await click('URL 불러오기');await page.waitForSelector('.video-preview');
    check('Preview includes original title, channel, thumbnail, duration',await page.$eval('.video-preview',e=>!!e.querySelector('img')&&['Original Song','Artist','2:05'].every(t=>e.textContent.includes(t))));
    await page.screenshot({path:path.join(out,'home-preview-mobile.png'),fullPage:true});
    await click('채보 만들기');
    check('Generation shows honest stage with no percentages',await page.$eval('.stage-status',e=>e.textContent.includes('생성 중')&&!e.textContent.includes('%')));
    await page.waitForSelector('.play-action');
    check('Preview and analysis use separate backend endpoints',calls.filter(c=>c.path==='/api/youtube-preview').length===1&&calls.filter(c=>c.path==='/api/analyze-youtube').length===1);
    await page.waitForFunction(async()=>{const q=indexedDB.open('BEATDASH_DB');return new Promise(r=>{q.onsuccess=()=>{const d=q.result;const t=d.transaction('songs').objectStore('songs').count();t.onsuccess=()=>{d.close();r(t.result===1);};};});});
    await page.click('.play-action'); await page.waitForSelector('.start-card'); await click('START');
    await page.waitForFunction(()=>window.__RHYTHM_DEBUG__.gameStarted&&!window.__RHYTHM_DEBUG__.paused);
    const advance=async t=>{await page.evaluate(t=>{const v=document.querySelector('video');v.pause();v.currentTime=t;},t);await page.waitForFunction(t=>Math.abs(window.__RHYTHM_DEBUG__.currentTimeSec-t)<.01,{},t);};
    await advance(1);await page.keyboard.press('d');await advance(2);await page.keyboard.press('f');await advance(4);
    check('Final note alone does not open result or remove video',await page.evaluate(()=>!!document.querySelector('video')&&!document.querySelector('.result-screen')));
    await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('ended')));
    check('600ms finishing transition exists',!(await page.$('.result-screen')));
    await page.waitForSelector('.result-screen');
    check('Independent result removes playfield and media',!(await page.$('.stage,canvas,video,audio,.touch-lanes')));
    check('PC result includes metrics/title/difficulty and first records',await page.$eval('.result-screen',e=>['Original Song','Hard','PERFECT COMBO','NEW BEST','FIRST FULL COMBO','FIRST PERFECT COMBO','Accuracy','Max Combo','Perfect','Great','Good','Miss'].every(t=>e.textContent.includes(t))));
    check('Exactly one play record saved',(await db()).records.length===1);
    await page.screenshot({path:path.join(out,'result-mobile.png'),fullPage:true});
    await page.evaluate(()=>document.querySelector('.primary-result-action').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1})));
    check('Orphan click cannot trigger retry',!!(await page.$('.result-screen')));
    await click('RETRY');await page.waitForSelector('.start-card');
    check('Retry clears score and requires a fresh start gesture',await page.evaluate(()=>window.__RHYTHM_DEBUG__.state.totalJudged===0&&!window.__RHYTHM_DEBUG__.gameStarted));
    await click('START');await advance(4);await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('ended')));await page.waitForSelector('.result-screen');
    await click('Song Detail');await page.waitForSelector('.big-play');
    check('Song Detail navigates to actual stored song',await page.$eval('.detail-hero',e=>e.textContent.includes('Original Song')));
    const before=await db();
    await goto();await page.click('[aria-label="설정"]');await page.waitForSelector('.settings-page');
    check('Settings categories present',await page.$eval('.settings-page',e=>['Gameplay','Judgement','Visual','Audio','Device','Data / Support'].every(t=>e.textContent.includes(t))));
    await page.evaluate(()=>{for(const label of document.querySelectorAll('.settings-toggle')) {if(['FAST / SLOW 표시','판정 텍스트','배경 영상','Combo 표시'].includes(label.querySelector('span')?.textContent))label.querySelector('input').click();}});
    await page.select('select[aria-label="타격 이펙트 강도"]','high');
    await page.reload();await page.click('[aria-label="설정"]');
    check('Visual/Judgement settings persist after reload',await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('beatdash.preferences.v475'));return !p.fastSlow&&!p.judgementText&&!p.backgroundVideo&&!p.combo&&p.effects==='high';}));
    await page.screenshot({path:path.join(out,'settings-mobile.png'),fullPage:true});
    await click('Song Timing Offset');await page.waitForSelector('.library-page');
    check('Song Offset access opens Library',!!(await page.$('.library-page')));
    await goto();await page.click('[aria-label="설정"]');
    page.once('dialog',d=>d.accept());await click('설정 초기화');
    const after=await db();
    check('Reset retains songs, charts and records',before.songs.length===after.songs.length&&before.charts.length===after.charts.length&&before.records.length===after.records.length);
    check('Reset restores preferences only',await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('beatdash.preferences.v475'));return p.combo&&p.backgroundVideo&&p.effects==='normal';}));
    await goto();previewFails=true;await page.type('#youtube-url','https://youtu.be/abcdefghijk');await click('URL 불러오기');await page.waitForSelector('[role=alert]');
    check('Preview errors never expose raw backend exception',await page.$eval('[role=alert]',e=>e.textContent.includes('영상을 불러올 수 없습니다')&&!e.textContent.includes('SECRET')));
    for(const [width,height] of [[390,844],[768,1024],[1440,900]]) {
      await page.setViewport({width,height});await goto();
      check(`${width}px Home no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(out,`home-${width}.png`),fullPage:true});
    }
    check('No browser runtime errors',errors.length===0);
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors,api:'mocked fixtures; real Chromium, IndexedDB, media and input'},null,2));
  } finally {await browser.close();await server.httpServer.close();}
})().catch(e=>{console.error(e);process.exit(1);});
