const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const checks = [];
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS', name); }
const out = process.env.REVIEW_OUTPUT || 'review-output/hotfix';
const payload = (id, title, difficulty = 'normal') => ({ id, originalName:'source.wav', mediaKind:'video', mediaUrl:`/api/video/${id}`,
  chart:{title,artist:'QA',bpm:120,offset:0,difficulty,level:2,notes:[{time:1,lane:0,type:'tap'},{time:2,lane:1,type:'tap'}]},
  report:{duration:5,bpm:120,generatorVersion:'review',seed:42,notesPerSecond:1,finalNoteCount:2,peakNotesIn1s:1,warnings:[],tempoCandidates:[],quality:{}}
});
(async () => {
  fs.mkdirSync(out, {recursive:true});
  const { preview } = await import('vite');
  const server = await preview({preview:{host:'127.0.0.1',port:4182,strictPort:true}});
  const browser = await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const first = payload('a'.repeat(32),'Native First');
  const second = payload('b'.repeat(32),'Uploaded Second');
  let mode = 'upload';
  const media = fs.readFileSync('public/test-video.mp4');
  try {
    await page.evaluateOnNewDocument(() => {
      const original=window.fetch;
      window.__REVIEW_UPLOADS__=[];
      window.fetch=function(input,options){
        if(String(input)==='/api/analyze' && options?.body instanceof FormData) window.__REVIEW_UPLOADS__.push(options.body.get('file')?.name);
        return original.apply(this,arguments);
      };
    });
    await page.setViewport({width:390,height:844});
    await page.setRequestInterception(true);
    page.on('request', async request => {
      try {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/session/')) return request.respond({status:200,contentType:'application/json',body:JSON.stringify(first)});
        if (url.pathname.startsWith('/api/video/')) {
          const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || '');
          const start=range?Number(range[1]):0, end=range&&range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
          return request.respond({status:range?206:200,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})},body:media.subarray(start,end+1)});
        }
        if (url.pathname === '/api/analyze') {
          const data = mode==='upload' ? second : {...first, chart:{...first.chart,difficulty:'hard',bpm:121}, mediaUrl:'/api/video/temporary'};
          return request.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
        }
        return request.continue();
      } catch(error) { errors.push(error.message); }
    });
    const goto = suffix => page.goto(`http://127.0.0.1:4182/${suffix||''}`);
    const clickText = async text => {
      await page.waitForFunction(t=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes(t)), {}, text);
      await page.evaluate(t=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(t)).click(),text);
      if(text==='START') await page.waitForFunction(()=>window.__RHYTHM_DEBUG__?.gameStarted && !window.__RHYTHM_DEBUG__.paused);
    };
    const stores = () => page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('BEATDASH_DB');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try { const read=name=>new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        const songs=await read('songs'),charts=await read('charts'),records=await read('playRecords');
        return {songs:songs.map(s=>({...s,mediaBlob:s.mediaBlob?{size:s.mediaBlob.size}:null})),charts,records};
      } finally { db.close(); }
    });
    await goto();
    await page.evaluate(()=>{localStorage.setItem('rhythm-lab.note-speed.v1','12');localStorage.setItem('rhythm-lab.timing-offset.v1','72');});
    await goto('?session='+first.id+'&saved=1'); await page.waitForSelector('.play-action');
    await page.waitForFunction(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('BEATDASH_DB');q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=db.transaction('songs').objectStore('songs').getAll();q.onsuccess=()=>{db.close();r(q.result.length===1&&Boolean(q.result[0].thumbnailUrl));};});});
    check('Companion metadata cached without duplicate MP4 Blob', (await stores()).songs[0].mediaBlob===null);
    await goto(); await page.waitForSelector('.song-card'); await page.click('.song-card'); await page.waitForSelector('.big-play');
    await page.click('.big-play'); await page.waitForSelector('.start-card');
    check('v3 note speed and global offset applied in Library', await page.evaluate(()=>window.__RHYTHM_DEBUG__.noteSpeed===12 && window.__RHYTHM_DEBUG__.timingOffsetMs===72));
    await clickText('START');
    await page.waitForFunction(()=>document.querySelector('video').currentTime>0);
    const advance = async time=>{
      await page.evaluate(t=>{const v=document.querySelector('video');v.pause();v.currentTime=t;},time);
      await page.waitForFunction(t=>Math.abs(window.__RHYTHM_DEBUG__.currentTimeSec-(t-.072))<.01,{},time);
    };
    await advance(1.072); await page.keyboard.press('d'); await advance(2.072); await page.keyboard.press('f'); await advance(4);
    await page.waitForSelector('.result-achievements');
    check('Perfect Combo and new score feedback', await page.$eval('.result-screen',e=>e.textContent.includes('PERFECT COMBO')&&e.textContent.includes('NEW HIGH SCORE')));
    let db=await stores(); check('record persisted with effective +72 and chart version',db.records.length===1&&db.records[0].offsetMs===72&&db.records[0].chartVersion===1);
    await page.screenshot({path:path.join(out,'mobile-perfect-combo.png'),fullPage:true});
    await clickText('RETRY'); await clickText('START'); await advance(4);
    await page.waitForSelector('.result-screen');
    await page.waitForFunction(()=>!document.querySelector('.result-achievements'));
    check('miss run does not show new high score',!(await page.$('.result-achievements')));
    await clickText('곡 상세'); await page.waitForSelector('.big-play');
    await page.reload(); await page.waitForSelector('.song-card'); await page.click('.song-card'); await page.waitForSelector('.big-play');
    db=await stores(); check('reload retains both plays and best Perfect Combo',db.records.length===2 && await page.$eval('.record-status',e=>e.textContent.includes('PERFECT COMBO')));
    await page.$eval('input[aria-label="곡 제목"]',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'Custom Title');e.dispatchEvent(new Event('input',{bubbles:true}));});
    await clickText('SAVE'); await page.waitForFunction(()=>document.querySelector('input[aria-label="곡 제목"]').value==='Custom Title');
    mode='regenerate'; await clickText('＋ HARD'); await page.waitForFunction(()=>document.querySelectorAll('.difficulty-select button').length===2);
    db=await stores(); check('difficulty regeneration preserves song identity and original title',db.songs.length===1&&db.charts.length===2&&db.songs[0].title==='Custom Title'&&db.songs[0].originalTitle==='Native First');
    check('video regeneration uploads MP4 filename, not source.wav',await page.evaluate(()=>window.__REVIEW_UPLOADS__.at(-1)==='source.mp4'));
    check('video thumbnail and creation date are displayed', await page.$eval('.detail-hero',e=>Boolean(e.querySelector('img')?.src.startsWith('data:image/jpeg'))&&e.textContent.includes('추가:')));
    const originalArtwork = await page.$eval('.detail-art img',img=>img.src);
    for (const [type,extension,color] of [['image/jpeg','jpg','#ff0000'],['image/png','png','#00ff00'],['image/webp','webp','#0000ff']]) {
      const data=await page.evaluate(({type,color})=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1200,800);return c.toDataURL(type);},{type,color});
      const file=path.join(out,`cover.${extension}`);fs.writeFileSync(file,Buffer.from(data.split(',')[1],'base64'));
      const prior = await page.$eval('.detail-art img',img=>img.src);
      await (await page.$('.cover-actions input[type=file]')).uploadFile(path.resolve(file));
      await page.waitForFunction(previous=>document.querySelector('.detail-art img').src!==previous,{},prior);
      const dimensions=await page.$eval('.detail-art img',img=>[img.naturalWidth,img.naturalHeight]);
      check(`custom ${extension} resized and displayed`,dimensions[0]===960&&dimensions[1]===640);
      db=await stores();check(`custom ${extension} preserves original artwork`,db.songs[0].originalThumbnail===originalArtwork&&Boolean(db.songs[0].customCover));
    }
    await page.screenshot({path:path.join(out,'mobile-custom-cover.png'),fullPage:true});
    check('cover controls fit mobile detail layout',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const customArtwork=await page.$eval('.detail-art img',img=>img.src);
    await page.reload();await page.waitForSelector('.song-card');await page.click('.song-card');await page.waitForSelector('.detail-art img');
    check('custom cover survives page reload',await page.$eval('.detail-art img',(img,expected)=>img.src===expected,customArtwork));
    await clickText('원본 썸네일로 되돌리기');
    await page.waitForFunction(original=>document.querySelector('.detail-art img').src===original,{},originalArtwork);
    check('restore clears only custom artwork',!(await stores()).songs[0].customCover);
    await (await page.$('.cover-actions input[type=file]')).uploadFile(path.resolve(path.join(out,'cover.webp')));
    await page.waitForFunction(original=>document.querySelector('.detail-art img').src!==original,{},originalArtwork);
    check('same file can be selected again after restore',await page.$eval('.detail-art img',img=>img.src.startsWith('data:image/jpeg')));
    await page.screenshot({path:path.join(out,'mobile-song-detail.png'),fullPage:true});
    await clickText('+10');
    await page.click('.big-play'); await page.waitForSelector('.start-card');
    check('latest song +10 combines with device +72 on immediate play',await page.evaluate(()=>window.__RHYTHM_DEBUG__.timingOffsetMs===82));
    await clickText('곡 상세');
    await clickText('← LIBRARY'); await clickText('← HOME'); await page.click('.hero-add');
    await page.waitForSelector('input[type=file]'); const input=await page.$('input[type=file]'); await input.uploadFile(path.resolve('public/test-video.mp4'));
    mode='upload'; await page.click('.primary-action'); await page.waitForSelector('.play-action'); await page.click('.play-action'); await page.waitForSelector('.start-card');
    check('new analysis plays new chart after leaving Library playback',await page.evaluate(()=>window.__RHYTHM_DEBUG__.state.chart.title==='Uploaded Second'));
    await page.waitForFunction(()=>document.querySelector('.play-toolbar').textContent.includes('LIBRARY SAVED'));
    db=await stores(); check('web import caches real MP4 Blob',db.songs.some(s=>s.originalTitle==='Uploaded Second'&&s.mediaBlob?.size>0));
    await goto(); await page.waitForFunction(()=>document.querySelectorAll('.song-card').length===2);
    await page.evaluate(()=>Array.from(document.querySelectorAll('.song-card')).find(e=>e.textContent.includes('Uploaded Second')).click()); await page.waitForSelector('.big-play'); await page.click('.big-play'); await page.waitForSelector('video');
    check('web Library plays Blob URL',await page.$eval('video',v=>v.src.startsWith('blob:')));
    await clickText('START'); await page.waitForFunction(()=>document.querySelector('video').currentTime>0); await advance(1.5);
    check('Blob video seek uses the same judgement clock',await page.evaluate(()=>Math.abs(window.__RHYTHM_DEBUG__.currentTimeSec-1.428)<.02));
    const clockBefore = await page.$eval('video',v=>v.currentTime);
    await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('error')));
    await page.waitForFunction(()=>window.__RHYTHM_DEBUG__.paused);
    await page.waitForFunction(()=>!window.__RHYTHM_DEBUG__.paused && !document.querySelector('video').paused);
    check('real Blob reload restores playback position',await page.$eval('video',(v,t)=>v.currentTime>=t&&v.currentTime<t+1,clockBefore));
    await page.evaluate(()=>{document.querySelector('video').dispatchEvent(new Event('error'));window.dispatchEvent(new Event('beatdash:pause'));});
    await page.waitForFunction(()=>window.__RHYTHM_DEBUG__.paused&&document.querySelector('video').paused);
    check('background event keeps recovery paused',await page.evaluate(()=>window.__RHYTHM_DEBUG__.paused));
    await clickText('곡 상세'); await page.waitForSelector('.big-play'); await clickText('← LIBRARY');
    for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
      await page.setViewport({width,height}); await page.screenshot({path:path.join(out,`library-${width}.png`),fullPage:true});
      check(`${width}: Library has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    await page.evaluate(()=>Array.from(document.querySelectorAll('.library-row')).find(e=>e.textContent.includes('Custom Title')).click()); await page.waitForSelector('.big-play');
    page.once('dialog',dialog=>dialog.accept()); await clickText('이 곡을 Library에서 삭제'); await page.waitForSelector('.library-list');
    db=await stores(); check('deleting native Library song cascades charts and records',db.songs.length===1&&db.charts.length===1&&db.records.length===0);
    await clickText('← HOME'); await page.click('button[aria-label=설정]');
    await page.waitForSelector('input[aria-label="타이밍 오프셋"]');
    await page.click('button[aria-label="타이밍 오프셋 1ms 높이기"]');
    check('Settings exposes global timing offset and note speed without new analysis', await page.evaluate(()=>localStorage.getItem('rhythm-lab.timing-offset.v1')==='73'&&Boolean(document.querySelector('input[aria-label="노트 속도"]'))));
    await page.setViewport({width:390,height:844}); await page.screenshot({path:path.join(out,'mobile-settings.png'),fullPage:true});
    check('mobile Settings has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    check('no browser runtime errors',errors.length===0);
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
  } catch(error) { await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}); console.error('BROWSER ERRORS',errors, await page.evaluate(()=>({debug:window.__RHYTHM_DEBUG__, media:document.querySelector('video')?.currentTime})));  throw error; }
  finally {await browser.close(); await server.httpServer.close();}
})().catch(error=>{console.error(error);process.exit(1);});
