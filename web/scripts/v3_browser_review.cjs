const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = process.env.REVIEW_OUTPUT || 'review-output';
const checks = [];
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS', name); }
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const { preview } = await import('vite');
  const server = await preview({ preview: { host: '127.0.0.1', port: 4180, strictPort: true } });
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, headless: true, args: ['--no-sandbox','--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const [width, height] of [[390,844],[768,1024],[1440,900]]) {
      const page = await browser.newPage(); await page.setViewport({width,height});
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (request.url().includes('/api/session/review')) return request.respond({ status:200, contentType:'application/json', body:JSON.stringify({
          id:'review', originalName:'V3 local video', mediaKind:'video', mediaUrl:'/test-video.mp4',
          chart:{title:'BEATDASH Review',artist:'QA',bpm:120,offset:0,difficulty:'Hard',level:5,notes:[{time:2,lane:0,type:'tap'},{time:2.2,lane:1,type:'hold',duration:4},{time:2.4,lane:2,type:'flick'},{time:2.8,lane:3,type:'tap'},{time:8,lane:0,type:'tap'}]},
          report:{bpm:120,notesPerSecond:1,finalNoteCount:5,peakNotesIn1s:4,warnings:[]}
        }) });
        request.continue();
      });
      await page.goto('http://127.0.0.1:4180/?session=review&saved=1');
      await page.waitForSelector('.play-action');
      check(`${width}: saved session hides AI/report UI`, !(await page.$('.metric-grid,.candidate-strip,.link-button')));
      for (const speed of [1,8,12,20]) {
        // Select persisted value before mounting the app, as a real saved setting would.
        await page.evaluate(s => localStorage.setItem('rhythm-lab.note-speed.v1', String(s)), speed);
        await page.reload(); await page.waitForSelector('.play-action'); await page.click('.play-action'); await page.waitForSelector('.start-card button');
        await page.click('.start-card button');
        await page.waitForFunction(() => document.querySelector('video').currentTime > 0.15);
        await page.evaluate(() => { const v=document.querySelector('video'); v.pause(); v.currentTime=1.4; });
        await page.waitForFunction(() => Math.abs(window.__RHYTHM_DEBUG__.currentTimeSec-1.4)<0.02);
        await page.screenshot({path:path.join(out,`highway-${width}-speed-${speed}.png`),fullPage:true});
        const geometry = await page.evaluate(() => {
          const c=document.querySelector('canvas').getBoundingClientRect();
          const b=document.querySelector('.touch-lanes').getBoundingClientRect();
          return {diff:Math.abs(b.top-(c.top+c.height*498/560)), overflow:document.documentElement.scrollWidth>innerWidth+1};
        });
        check(`${width}/Speed ${speed}: line/touch alignment`,geometry.diff<1);
        check(`${width}/Speed ${speed}: no horizontal overflow`,!geometry.overflow);
        check(`${width}/Speed ${speed}: no iframe`,!(await page.$('iframe')));
        await page.reload(); await page.waitForSelector('.play-action');
      }
      check(`${width}: no runtime errors`,errors.length===0);
      await page.close();
    }
    // A real upward pointer gesture against a saved MP4 session.
    const page=await browser.newPage(); await page.setViewport({width:390,height:844});
    await page.goto('http://127.0.0.1:4180/?legacy=1');
    await page.waitForFunction(()=>window.__RHYTHM_DEBUG__ && document.querySelector('video').currentTime > 0.1); 
    await page.evaluate(()=>{const v=document.querySelector('video'); v.pause(); v.currentTime=5;});
    await page.waitForFunction(()=>window.__RHYTHM_DEBUG__.currentTimeSec>=4.999);
    const lane=await page.$('.touch-lane.lane-2'); const box=await lane.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2-40,{steps:3}); await page.mouse.up();
    check('upward pointer Flick',await page.evaluate(()=>window.__RHYTHM_DEBUG__.state.notes[8].status==='hit'));
    check('hit effect sits on judge line',await page.evaluate(()=>{
      const c=document.querySelector('canvas').getBoundingClientRect(); const e=document.querySelector('.lane-hit-effect').getBoundingClientRect();
      return Math.abs(e.bottom-(c.top+c.height*498/560))<2 && Math.abs(e.left-(c.left+c.width*(.02+2.5*.24)))<2;
    }));
    await page.close();
    fs.writeFileSync(path.join(out,'browser-review.json'),JSON.stringify({passed:checks.length,checks},null,2));
  } finally { await browser.close(); await server.httpServer.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
