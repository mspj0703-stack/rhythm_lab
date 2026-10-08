# BEATDASH v4.8 — Windows Desktop Test Build Report

Baseline verified against GitHub `main` commit `9ed6ebc744f61a76f9a4f2968bee4694ac097322` (`web/VERSION = 4.8.0-rc.1`).

## 1. Existing structure analysis

The v4.8 codebase already separates the React/Vite gameplay core (`web/`) from the Android companion (`android/`). Gameplay, Library, Records, settings, timing, SFX, artwork, and Chart AI-facing UI are in the shared Web Core. Android mainly prepares YouTube media, persists native song files, and opens the Web Core in a WebView. That makes a thin Desktop platform layer preferable to copying game logic.

## 2. Desktop technology decision

**Tauri 2** was selected.

Reasons:
- reuses the current React/Vite/WebView gameplay core instead of forking it;
- produces a normal Windows executable and NSIS installer;
- much smaller platform shell than bundling a second Chromium runtime;
- WebView2 provides IndexedDB, localStorage, media, Blob URL, keyboard, audio, and normal browser APIs used by BEATDASH;
- the shell can later evolve into the v5 PC platform layer.

For v4.8 the shell deliberately loads the currently deployed BEATDASH Web Core. Embedding the whole frontend locally would also require moving `/api` routing, media Range handling, and backend-origin behavior in the same stabilization patch. That risk is deferred to the planned offline/backend migration rather than being hidden inside this test build.

## 3. Added/modified files

Added:
- `desktop/package.json`
- `desktop/README.md`
- `desktop/scripts/write-version-config.mjs`
- `desktop/fallback/index.html`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/build.rs`
- `desktop/src-tauri/src/main.rs`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/capabilities/default.json`
- `.github/workflows/build-desktop-windows.yml`
- `web/SERVICE_URL`
- `web/src/platform/runtime.ts`
- `scripts/tests/test_desktop_source.py`
- this report

Modified:
- `android/app/build.gradle.kts`
- `android/app/src/main/java/com/rhythmlab/companion/RhythmApi.kt`
- `.gitignore`

No gameplay/chart/judgement code is duplicated into Desktop.

## 4. Desktop execution structure

`BEATDASH Desktop.exe` -> Tauri 2 -> Windows WebView2 -> current BEATDASH Web Core -> existing Backend API.

The Desktop URL includes:
- `platform=desktop`
- `desktopVersion=<web/VERSION>`

`web/src/platform/runtime.ts` provides the future-safe platform vocabulary `WEB | ANDROID | DESKTOP` without changing v4.8 gameplay rules.

The normal WebView2 profile is persistent, so IndexedDB/localStorage data survives normal app restarts. Desktop data is isolated from the user's normal browser profile.

## 5. Windows build method

From Windows:

```powershell
cd desktop
npm install
npm run dev
```

Production:

```powershell
npm run build
```

Expected outputs:
- `desktop/src-tauri/target/release/beatdash-desktop.exe`
- `desktop/src-tauri/target/release/bundle/nsis/*.exe`

The build sync script reads `web/VERSION` and creates an ignored Tauri version override. Desktop does not own a second release version string.

## 6. GitHub Actions build

Run **Build BEATDASH Windows Desktop** manually, or allow it to run when Desktop/version/service URL files change on `main`.

Artifact name:
- `beatdash-windows-desktop`

The artifact contains the raw executable and NSIS installer when the Windows runner build succeeds.

## 7. Test result

Automated in this environment:
- Desktop source-structure tests: 5/5 PASS
- combined low-cost Python source/deployment tests: 16/16 PASS
- JSON parse for Tauri/package/capability configs: PASS
- Windows workflow YAML parse: PASS
- version sync script tested with `4.8.0-rc.1`: PASS
- Android service URL source wiring check: PASS

Attempted but NOT VERIFIED in this container:
- Web Vitest / Vite production build: local dependency executables were unavailable (`vitest: not found`); no PASS is claimed.
- Rust/Tauri compile: Rust/Cargo toolchain is not installed in this container; no PASS is claimed.

Not claimed here unless executed on Windows CI:
- actual Tauri Windows compilation
- `.exe` launch
- WebView2 runtime playback
- Windows audio latency
- NSIS install/uninstall

Those are Windows/CI verification gates, not inferred PASS items.

## 8. Web/Android regression impact

Gameplay Web Core is not copied or altered for Desktop behavior. Android keeps the same service endpoint, but it now receives that endpoint from `web/SERVICE_URL` through generated `BuildConfig`. This removes one duplicate hardcoded endpoint while preserving the existing network path.

Existing Android APK workflow remains separate from the new Windows workflow.

## 9. Known limitations

- v4.8 Desktop Test Build is **not offline**. It loads the deployed Web Core and uses the existing backend.
- It is unsigned unless Windows code-signing is configured later; Windows SmartScreen may warn on the test installer/executable.
- Clipboard behavior depends on WebView2/browser permissions; manual paste remains the fallback.
- Desktop-specific chart rules, PC Flick removal, EXTREME, Maker, cloud, and offline backend are intentionally not included.
- An application update strategy is not added in v4.8.

## 10. Android items to re-check later

Because service endpoint plumbing changed, one Android regression pass should verify:
- app launch and WebView open;
- YouTube preview/generation;
- queue/background job;
- saved-song playback;
- Library media interception;
- update install preserves Library/Records/settings.

No Android UI/gameplay behavior is intentionally changed by this Desktop patch.

## 11. Reuse for v5 PC

Reusable pieces:
- `desktop/` Tauri project and Windows workflow;
- shared `web/VERSION` bundle version flow;
- shared `web/SERVICE_URL` endpoint source;
- `WEB | ANDROID | DESKTOP` platform boundary;
- persistent Desktop WebView profile;
- separate Desktop CI artifact path.

For the v5 formal PC build, platform-specific input/chart UX can branch at the platform layer while the common judgement/gameplay engine remains shared. For the later offline-player milestone, the same Tauri shell can switch from deployed Web Core to bundled `web/dist` without replacing the Desktop project.
