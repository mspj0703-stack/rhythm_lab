# BEATDASH

Internal project codename: **BEATDASH::Revive**

## Repository layout

- `web/` — React/Vite frontend + FastAPI/analyzer backend
- `android/` — Android Companion app
- `docs/` — roadmap and implementation/review notes
- `.github/workflows/build-android.yml` — signed APK build
- `.github/workflows/deploy-railway.yml` — Railway production deploy
- `Dockerfile` — Railway/web production build from `web/`

## Web

```bash
cd web
npm ci
npm test
npm run lint
npm run build
```

## Android

Use GitHub Actions → **Build BEATDASH Android signed APK**.
Required repository secrets:

- `COMPANION_KEYSTORE_BASE64`
- `COMPANION_KEYSTORE_PASSWORD`

## Deployment

Railway production deployment keeps the existing `railway-prod` branch workflow.

Before removing overlay ZIPs, run **Verify monorepo container** and follow [GITHUB_CLEANUP.md](GITHUB_CLEANUP.md). Production deployment now verifies the root image before upload and checks the deployed commit revision afterward. The service root must be the repository root.

Review status and device checklist: [docs/V4_REVIEW.md](docs/V4_REVIEW.md).

Internal development name: `BEATDASH::Revive`; all user-facing names: `BEATDASH`. Work is grouped by version; v4.1 starts only after the v4.0 release gates are complete.
