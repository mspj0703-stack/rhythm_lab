# GitHub cleanup plan

The old repository root used layered ZIP overlays. v4 switches to one canonical source tree.

## Keep at repository root

- `.github/`
- `web/`
- `android/`
- `docs/`
- `Dockerfile`
- `.dockerignore`
- `.gitignore`
- `README.md`
- `railway.json`
- `scripts/`

## Deletion gate — do not delete old ZIPs merely after uploading this tree

1. Save the current deployed commit/image reference and verify a rollback copy exists.
2. Run **Verify monorepo container** on the candidate commit. The root Dockerfile must build and its running container must pass `/api/health`, version/revision and UI checks.
3. Confirm Railway service root directory is `/` (repository root), not `web/`, and the new `railway.json` is used. The CLI workflow deploys only `railway-prod`.
4. Deploy the reviewed candidate on `railway-prod`; require the workflow's deployed revision check to match that commit. HTTP 200 from an older deployment is not sufficient.
5. Run the signed APK workflow and verify install/update with the existing signing key.
6. Only then remove the following obsolete inputs in a separate commit. Keep the rollback commit/tag and source backups.

This review did not delete remote ZIPs, run Actions, or deploy Railway. Git history and rollback availability must be verified in the real repository.

## Candidates for later removal

- `BEATDASH-v3.0-android-reviewed-source.zip`
- `DEPLOY_TRIGGER.txt`
- `chart-generation-update-v1-rebased-files.zip`
- `difficulty-level-update-v1-rebased-files.zip`
- `gameplay-feel-fix-v2-rebased-files.zip`
- `gameplay-ux-update-v1-rebased-files.zip`
- `gameplay-visual-media-fix-v3-rebased-web-files.zip`
- `rhythm-analyzer-memory-fix-files.zip`
- `rhythm-core-v0.3.1-youtube-input.zip`
- `rhythm-lab-android-companion-v0.4-mvp.zip`
- `timing-offset-v1-rebased-files.zip`

## Remove old workflows

Keep the following canonical workflows:

- `.github/workflows/build-android.yml`
- `.github/workflows/deploy-railway.yml`
- `.github/workflows/verify-container.yml`

Historical web Dockerfile/render configuration and old validation documents are preserved under `docs/archive/pre-v4/` as inactive reference files.
