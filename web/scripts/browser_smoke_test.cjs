const puppeteer = require("puppeteer");

const fs = require("fs");

// 이 컨테이너에 이미 설치된 크로미움 경로. 없으면 puppeteer 기본 경로를 사용한다
// (npm install 시 puppeteer가 자체적으로 크로미움을 내려받는 표준 경로).
const FALLBACK_CHROME_PATH = "/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome";
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || (fs.existsSync(FALLBACK_CHROME_PATH) ? FALLBACK_CHROME_PATH : undefined);
const URL = process.env.SMOKE_URL || "http://127.0.0.1:4173/";
const LEGACY_URL = URL + "?legacy=1";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
}

/** 페이지 내부에서 rAF로 video.currentTime을 폴링하다가 목표 시각에 도달하면 콜백을 실행 */
async function dispatchAtTime(page, targetTime, fn) {
  return page.evaluate(
    (targetTime, fnStr) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Media did not reach ${targetTime}s`)), 20000);
        const runner = new Function("return (" + fnStr + ")")();
        function loop() {
          const v = document.querySelector("video");
          if (v && v.currentTime >= targetTime) {
            clearTimeout(timeout);
            resolve(runner(v.currentTime));
            return;
          }
          requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
      });
    },
    targetTime,
    fn.toString()
  );
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getDebug(page) {
  return page.evaluate(() => {
    const d = window.__RHYTHM_DEBUG__;
    if (!d) return null;
    return {
      score: d.state.score,
      combo: d.state.combo,
      maxCombo: d.state.maxCombo,
      gauge: d.state.gauge,
      finished: d.state.finished,
      failed: d.state.failed,
      judgementCounts: d.state.judgementCounts,
      totalJudged: d.state.totalJudged,
      notes: d.state.notes.map((n) => ({ time: n.note.time, lane: n.note.lane, type: n.note.type, status: n.status, judgement: n.judgement })),
      currentTimeSec: d.currentTimeSec,
      paused: d.paused,
    };
  });
}

async function main() {
  if (!process.env.SMOKE_URL) {
    const { preview } = await import("vite");
    await preview({ preview: { host: "127.0.0.1", port: 4173, strictPort: true } });
  }
  const browser = await puppeteer.launch({
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
    headless: "new",
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  // ============================================================
  // TEST GROUP A: 기본 로드 / 콘솔 에러 / 영상 재생 / Canvas 렌더링
  // ============================================================
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(LEGACY_URL, { waitUntil: "networkidle0" });

    const hasCanvas = await page.evaluate(() => !!document.querySelector("canvas"));
    const hasVideo = await page.evaluate(() => !!document.querySelector("video"));
    record("A1. 페이지 정상 로드 (canvas+video 존재)", hasCanvas && hasVideo);

    await wait(1000);
    const videoState = await page.evaluate(() => {
      const v = document.querySelector("video");
      return { paused: v.paused, currentTime: v.currentTime, readyState: v.readyState };
    });
    record("A2. 테스트 영상 자동 재생", !videoState.paused && videoState.currentTime > 0.3, JSON.stringify(videoState));

    const canvasHasContent = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      const ctx = c.getContext("2d");
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return true;
      }
      return false;
    });
    record("A3. Canvas에 실제 픽셀이 그려짐 (노트/판정선 렌더링)", canvasHasContent);

    await wait(2000);
    record(
      "A4. 콘솔 error / pageerror 없음",
      consoleErrors.length === 0 && pageErrors.length === 0,
      `console:${consoleErrors.length}, page:${pageErrors.length}` +
        (consoleErrors.length ? " | " + consoleErrors.join(" / ") : "") +
        (pageErrors.length ? " | " + pageErrors.join(" / ") : "")
    );

    await page.close();
  }

  // ============================================================
  // TEST GROUP B: 전체 채보 플레이 (Tap/Hold/Flick/동시치기/Miss)
  // ============================================================
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text()));
    await page.goto(LEGACY_URL, { waitUntil: "networkidle0" });

    await dispatchAtTime(page, 1.0, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" })), 30);
    });
    await wait(150);
    let d = await getDebug(page);
    const n0 = d.notes[0];
    record("B1. 단일 Tap 판정", n0.status === "hit" && ["Perfect", "Great", "Good"].includes(n0.judgement), JSON.stringify(n0));

    for (const t of [1.25, 1.5, 1.75]) {
      await dispatchAtTime(page, t, () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
        setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "f" })), 25);
      });
      await wait(60);
    }
    await wait(150);
    d = await getDebug(page);
    const fastTaps = d.notes.slice(1, 4);
    record(
      "B2. 빠른 연속 Tap 3개 모두 정상 판정",
      fastTaps.every((n) => n.status === "hit"),
      JSON.stringify(fastTaps.map((n) => n.judgement))
    );

    await dispatchAtTime(page, 2.5, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
      setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "j" }));
      }, 30);
    });
    await wait(150);
    d = await getDebug(page);
    const simul = [d.notes[4], d.notes[5]];
    record(
      "B3. 동시치기(같은 시각, 다른 레인) 각각 정상 판정",
      simul.every((n) => n.status === "hit"),
      JSON.stringify(simul.map((n) => `${n.lane}:${n.judgement}`))
    );

    await dispatchAtTime(page, 3.0, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    });
    await wait(50);
    d = await getDebug(page);
    const holdNoteStart = d.notes[6];
    record("B4a. Hold 시작 -> holding 상태 전환", holdNoteStart.status === "holding", JSON.stringify(holdNoteStart));

    await dispatchAtTime(page, 3.6, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "k" })), 25);
    });
    await wait(100);
    d = await getDebug(page);
    const oppositeHandTap = d.notes[7];
    const holdStillHolding = d.notes[6];
    record(
      "B4b. Hold 유지 중 반대손 Tap이 Hold를 깨지 않고 독립적으로 판정됨",
      oppositeHandTap.status === "hit" && holdStillHolding.status === "holding",
      JSON.stringify({ oppositeHandTap, holdStillHolding })
    );

    await dispatchAtTime(page, 4.2, () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "f" }));
    });
    await wait(150);
    d = await getDebug(page);
    record("B4c. Hold 정상 종료 -> hit 처리", d.notes[6].status === "hit", JSON.stringify(d.notes[6]));

    await dispatchAtTime(page, 5.0, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
      setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent("keyup", { key: "j" }));
          window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
        }, 20);
      }, 20);
    });
    await wait(150);
    d = await getDebug(page);
    record("B5. Flick(레인키+Space 조합) 정상 판정", d.notes[8].status === "hit", JSON.stringify(d.notes[8]));

    await dispatchAtTime(page, 6.0, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
      setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "k" }));
      }, 25);
    });
    await wait(150);
    d = await getDebug(page);
    const twoLane = [d.notes[9], d.notes[10]];
    record(
      "B6. 두 레인 동시 입력 각각 정상 판정",
      twoLane.every((n) => n.status === "hit"),
      JSON.stringify(twoLane.map((n) => `${n.lane}:${n.judgement}`))
    );

    await dispatchAtTime(page, 7.6, () => {});
    await wait(200);
    d = await getDebug(page);
    const skipped = [d.notes[11], d.notes[12]];
    record(
      "B7. 입력하지 않은 노트가 자동으로 Miss 집계됨",
      skipped.every((n) => n.status === "missed" && n.judgement === "Miss"),
      JSON.stringify(skipped)
    );

    await page.waitForFunction(() => window.__RHYTHM_DEBUG__ && window.__RHYTHM_DEBUG__.state.finished, { timeout: 8000 }).catch(() => {});
    await page.waitForSelector(".result-screen", { timeout: 20000 });
    d = await getDebug(page);
    const resultVisible = await page.evaluate(() => !!document.querySelector(".result-screen"));
    record("B8. 곡 종료 후 finished=true & ResultScreen 표시", d.finished === true && resultVisible, `finished=${d.finished}, resultVisible=${resultVisible}`);

    record(
      "B9. 최종 판정 집계 (참고용)",
      true,
      JSON.stringify({ judgementCounts: d.judgementCounts, combo: d.combo, maxCombo: d.maxCombo, score: Math.round(d.score) })
    );

    const scoreBeforeExtraInput = d.score;
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" }));
    });
    await wait(200);
    const d2 = await getDebug(page);
    record("B10. ResultScreen 이후 입력이 score/combo에 영향 없음", d2.score === scoreBeforeExtraInput, `before=${scoreBeforeExtraInput}, after=${d2.score}`);

    record("B11. 이 시퀀스 동안 콘솔 error 없음", consoleErrors.length === 0, `count=${consoleErrors.length}` + (consoleErrors.length ? " | " + consoleErrors.join(" / ") : ""));

    await page.close();
  }

  // ============================================================
  // TEST GROUP C: Pause/Resume 싱크
  // ============================================================
  {
    const page = await browser.newPage();
    await page.goto(LEGACY_URL, { waitUntil: "networkidle0" });

    await dispatchAtTime(page, 0.5, () => {});
    const beforePause = await getDebug(page);
    await page.keyboard.press("Escape");
    await wait(50);
    const justPaused = await page.evaluate(() => ({
      videoPaused: document.querySelector("video").paused,
      overlay: !!document.querySelector(".pause-overlay"),
      chartTime: window.__RHYTHM_DEBUG__.currentTimeSec,
    }));
    await wait(800);
    const afterWaitWhilePaused = await getDebug(page);
    record("C1a. Pause 시 video.paused=true, 오버레이 표시", justPaused.videoPaused && justPaused.overlay);
    record(
      "C1b. Pause 중 currentTimeSec/게임 상태가 멈춰있음 (싱크 유지)",
      Math.abs(afterWaitWhilePaused.currentTimeSec - justPaused.chartTime) < 0.001,
      `before=${beforePause.currentTimeSec.toFixed(3)}, afterWait=${afterWaitWhilePaused.currentTimeSec.toFixed(3)}`
    );

    await page.keyboard.press("Escape");
    await wait(50);
    const resumed = await page.evaluate(() => ({
      videoPaused: document.querySelector("video").paused,
      overlay: !!document.querySelector(".pause-overlay"),
    }));
    await wait(300);
    const afterResume = await getDebug(page);
    record("C1c. Resume 시 video 재생 재개, 오버레이 사라짐", !resumed.videoPaused && !resumed.overlay);
    record(
      "C1d. Resume 후 노트 위치가 튀지 않고 자연스럽게 이어짐",
      afterResume.currentTimeSec > afterWaitWhilePaused.currentTimeSec &&
        afterResume.currentTimeSec - afterWaitWhilePaused.currentTimeSec < 0.6,
      `paused=${afterWaitWhilePaused.currentTimeSec.toFixed(3)}, afterResume=${afterResume.currentTimeSec.toFixed(3)}`
    );

    await page.close();
  }

  // ============================================================
  // TEST GROUP D: keydown repeat / Space 단독 / 사전 홀드
  // ============================================================
  {
    const page = await browser.newPage();
    await page.goto(LEGACY_URL, { waitUntil: "networkidle0" });

    await dispatchAtTime(page, 1.0, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" })), 30);
    });
    await wait(150);
    let d = await getDebug(page);
    record("D1. keydown 반복 입력에도 판정은 1회만 발생 (totalJudged=1)", d.totalJudged === 1 && d.notes[0].status === "hit", `totalJudged=${d.totalJudged}`);

    const beforeSpace = await getDebug(page);
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    });
    await wait(100);
    const afterSpace = await getDebug(page);
    record(
      "D2. Space 단독 입력은 게임 상태를 바꾸지 않음",
      JSON.stringify(beforeSpace.judgementCounts) === JSON.stringify(afterSpace.judgementCounts) && beforeSpace.totalJudged === afterSpace.totalJudged
    );

    await page.close();
  }

  {
    const page = await browser.newPage();
    await page.goto(LEGACY_URL, { waitUntil: "networkidle0" });

    await dispatchAtTime(page, 1.0, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" })); // keyup 없이 계속 유지
    });
    await wait(100);
    let d = await getDebug(page);
    const firstDNote = d.notes[0];

    await dispatchAtTime(page, 2.9, () => {});
    await wait(100);
    d = await getDebug(page);
    const secondDNote = d.notes[4]; // time 2.5, lane 0

    record(
      "D3. 사전에 눌러둔 키는 첫 노트만 판정하고, 계속 누르고 있어도 이후 노트를 자동 판정하지 않음",
      firstDNote.status === "hit" && secondDNote.status === "missed",
      JSON.stringify({ firstDNote, secondDNote })
    );

    const consoleErrors = [];
    page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text()));
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" })));
    await wait(100);
    record("D3b. 오래 눌렀던 tap 키를 떼도 에러/부작용 없음", consoleErrors.length === 0);

    await page.close();
  }

  // ============================================================
  // TEST GROUP E: Restart
  // ============================================================
  {
    const page = await browser.newPage();
    await page.goto(LEGACY_URL, { waitUntil: "networkidle0" });

    await dispatchAtTime(page, 1.0, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" })), 30);
    });
    await wait(150);
    const beforeRestart = await getDebug(page);

    await page.keyboard.press("Escape");
    await wait(100);
    const restartClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll(".pause-overlay button"));
      const btn = buttons.find((b) => b.textContent.includes("Restart"));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    await wait(200);
    const afterRestart = await getDebug(page);

    record("E1. Restart 버튼 클릭 가능", restartClicked);
    record(
      "E2. Restart 후 score/combo/gauge/notes 초기화",
      afterRestart.score === 0 &&
        afterRestart.combo === 0 &&
        afterRestart.maxCombo === 0 &&
        afterRestart.gauge === 100 &&
        afterRestart.finished === false &&
        afterRestart.notes.every((n) => n.status === "pending"),
      JSON.stringify({ before: { score: beforeRestart.score, combo: beforeRestart.combo }, after: afterRestart })
    );
    record("E3. Restart 후 video.currentTime이 0 근처로 재설정됨", afterRestart.currentTimeSec < 0.3, `currentTimeSec=${afterRestart.currentTimeSec}`);

    await page.close();
  }

  // ============================================================
  // TEST GROUP F (v0.2): 자동 생성 채보 로드 / 렌더링 / 자동 플레이 완주
  // ============================================================
  const GENERATED = [
    { chart: "/generated/accent.expert.json", video: "/generated/accent.mp4", label: "accent Expert" },
    { chart: "/generated/fast_180.hard.json", video: "/generated/fast_180.mp4", label: "fast_180 Hard" },
  ];
  for (const g of GENERATED) {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
    page.on("pageerror", (err) => errors.push("pageerror: " + err.message));

    const expected = await (await fetch(URL.replace(/\/$/, "") + g.chart)).json();
    await page.goto(`${URL}?chart=${encodeURIComponent(g.chart)}&video=${encodeURIComponent(g.video)}`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => !!window.__RHYTHM_DEBUG__, { timeout: 5000 }).catch(() => {});

    let d = await getDebug(page);
    record(`F1. [${g.label}] 생성 JSON 로딩 성공 (노트 ${expected.notes.length}개)`,
      !!d && d.notes.length === expected.notes.length && (await page.evaluate(() => !!document.querySelector("canvas"))),
      d ? `loaded=${d.notes.length}` : "debug state 없음");

    const times = d.notes.map((n) => n.time);
    record(`F2. [${g.label}] 노트 시간 순서 정상`, times.every((t, i) => i === 0 || t >= times[i - 1]));

    // 같은 레인 노트가 화면에서 겹치는지: 노트 높이 18px, 낙하 속도 = 판정선 400px / 1.6s = 250px/s
    // 노트 속도는 시각 전용 설정이므로 실제 게임이 쓰는 값(debug.noteSpeed)으로 낙하 시간을 구한다.
    // src/settings/noteSpeed.ts SPEED_CURVE와 동일한 구간 선형 보간.
    const speed = await page.evaluate(() => window.__RHYTHM_DEBUG__.noteSpeed ?? 6);
    const CURVE = [[1, 3.0], [6, 1.6], [8, 1.2], [10, 0.9], [12, 0.7], [15, 0.5], [20, 0.35]];
    let FALL_SEC = CURVE[CURVE.length - 1][1];
    for (let i = 0; i < CURVE.length - 1; i++) {
      const [s0, t0] = CURVE[i], [s1, t1] = CURVE[i + 1];
      if (speed <= s1) { FALL_SEC = t0 + (t1 - t0) * (speed - s0) / (s1 - s0); break; }
    }
    const PX_PER_SEC = 498 * 1.62 / (FALL_SEC * 1.6);
    let minSameLaneGapPx = Infinity;
    const lastByLane = {};
    for (const n of d.notes) {
      if (lastByLane[n.lane] !== undefined) minSameLaneGapPx = Math.min(minSameLaneGapPx, (n.time - lastByLane[n.lane]) * PX_PER_SEC);
      lastByLane[n.lane] = n.time;
    }
    record(`F3. [${g.label}] 같은 레인 노트의 판정선 접근 간격 (최소 간격 ${minSameLaneGapPx.toFixed(1)}px > 18px)`, minSameLaneGapPx > 18);

    // 노트가 화면에 들어온 시점에 실제로 canvas에 그려지는지 (첫 노트 직전 판정선 위쪽 레인 픽셀 확인)
    const first = d.notes[0];
    const rendered = await page.evaluate((first, PX_PER_SEC) => new Promise((resolve) => {
      function loop() {
        const v = document.querySelector("video");
        if (v && v.currentTime >= first.time - 0.4) {
          const c = document.querySelector("canvas");
          const ctx = c.getContext("2d");
          const horizon = (498 * 1.62 / PX_PER_SEC);
          const progress = Math.max(0, 1 - (first.time - window.__RHYTHM_DEBUG__.currentTimeSec) / horizon);
          const depth = progress ** 1.62;
          const roadWidth = c.width * (0.4 + 0.56 * Math.min(1, depth));
          const x = (c.width - roadWidth) / 2 + (first.lane + 0.5) * roadWidth / 4;
          const y = Math.round(depth * 498);
          const data = ctx.getImageData(Math.round(x), Math.max(0, y - 20), 1, 40).data;
          let colored = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200 && (data[i] > 80 || data[i + 1] > 80 || data[i + 2] > 80)) colored++;
          resolve(colored > 3);
          return;
        }
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    }), first, PX_PER_SEC);
    record(`F4. [${g.label}] 생성 노트가 Canvas에 실제로 렌더링됨`, rendered);

    // 자동 플레이 봇: 렌더링 rAF와 독립적으로 실제 media clock을 폴링한다.
    // Tap은 즉시 keyup해 지연된 timeout이 다음 입력을 막지 않도록 한다.
    await page.evaluate(() => {
      const KEYS = ["d", "f", "j", "k"];
      const notes = window.__RHYTHM_DEBUG__.state.notes.map((n) => n.note);
      let i = 0;
      function loop() {
        const v = document.querySelector("video");
        while (v && i < notes.length && v.currentTime >= notes[i].time - 0.004) {
          const key = KEYS[notes[i].lane];
          window.dispatchEvent(new KeyboardEvent("keydown", { key }));
          window.dispatchEvent(new KeyboardEvent("keyup", { key }));
          i++;
        }
        if (i >= notes.length) clearInterval(timer);
      }
      const timer = setInterval(loop, 4);
    });
    await page.waitForFunction(() => window.__RHYTHM_DEBUG__ && window.__RHYTHM_DEBUG__.state.finished, { timeout: 25000 }).catch(() => {});
    await page.waitForSelector(".result-screen", { timeout: 20000 });
    d = await getDebug(page);
    const resultVisible = await page.evaluate(() => !!document.querySelector(".result-screen"));
    const c = d.judgementCounts;
    record(`F5. [${g.label}] 곡 끝까지 crash 없이 완주, ResultScreen 표시`, d.finished && resultVisible, JSON.stringify(c));
    record(`F6. [${g.label}] 자동 플레이 판정 (Miss 0, 전 노트 판정)`,
      c.Miss === 0 && c.Perfect + c.Great + c.Good === expected.notes.length,
      `maxCombo=${d.maxCombo}, acc=${((c.Perfect + 0.8 * c.Great + 0.5 * c.Good) / expected.notes.length * 100).toFixed(1)}%`);
    record(`F7. [${g.label}] 콘솔 error 없음`, errors.length === 0, errors.join(" / "));
    await page.close();
  }

  await browser.close();

  console.log("\n=== 요약 ===");
  const failed = results.filter((r) => !r.pass);
  console.log(`총 ${results.length}개 중 ${results.length - failed.length}개 PASS, ${failed.length}개 FAIL`);
  if (failed.length) {
    console.log("실패 항목:");
    failed.forEach((f) => console.log(" -", f.name, f.detail || ""));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("스크립트 실행 중 오류:", e);
  process.exit(1);
});
