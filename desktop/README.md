# BEATDASH v4.8 Desktop Test Build

This is a thin Tauri 2 Windows shell for the existing BEATDASH Web Core. It is **not** an Android emulator and it does not fork gameplay logic.

## Requirements (local Windows build)

- Windows 10/11 with WebView2
- Node.js 22+
- Rust stable toolchain
- Microsoft C++ Build Tools required by Tauri/Rust

## Development run

```powershell
cd desktop
npm install
npm run dev
```

The window loads the service URL in `../web/SERVICE_URL` and identifies itself with `?platform=desktop&desktopVersion=<web/VERSION>`.

## Production build

```powershell
cd desktop
npm install
npm run build
```

Expected outputs:

- executable: `desktop/src-tauri/target/release/beatdash-desktop.exe`
- NSIS installer: `desktop/src-tauri/target/release/bundle/nsis/*.exe`

`npm run build` generates `src-tauri/tauri.version.conf.json` from `web/VERSION`, so Desktop does not maintain an independent BEATDASH release version.

## Data persistence

The v4.8 test shell uses the normal persistent WebView2 profile. The existing IndexedDB/localStorage-backed Library, Records, settings, offsets, covers, and cached chart/media data remain in the Desktop app profile across normal app restarts.

## Current limitation

This v4.8 Desktop Test Build intentionally loads the deployed Web Core and therefore needs network access to open the UI and use the current backend. It is groundwork for the v5 PC build, not the planned v5.5 offline player. Do not treat it as an offline build.

### Optional local Web Core development

Run the existing Vite app in one terminal:

```powershell
cd web
npm install
npm run dev
```

Then in a second PowerShell:

```powershell
$env:BEATDASH_DESKTOP_URL="http://127.0.0.1:5173"
cd desktop
npm run dev
```

Vite's existing `/api` proxy remains responsible for Backend API calls in this local-development mode. Production Desktop builds do not set this override and load `web/SERVICE_URL`.
