# v0.3 Web Tester RC3 — deployment status

## Verified in this environment
- Backend integration tests: 4/4 PASS
- Analyzer regression tests: 86/86 PASS
- TypeScript/TSX syntax parse: 26 files, 0 syntax errors
- `render.yaml`: YAML parse successful
- Python `backend/app.py`: py_compile successful

## Not re-run here
`npm ci` could not complete because package download timed out in this execution environment, so the full Vite production build, Vitest, oxlint, and Puppeteer suite were not re-run for RC3. RC3 only changes deployment/backend cleanup controls plus the upload-screen version label and best-effort session deletion; rhythm gameplay code was not modified.

The Docker deployment intentionally runs `npm ci` and `npm run build`, so a real deployment will fail during build rather than publish a broken frontend if an npm/typecheck/build regression exists.

## RC3 deployment hardening
- Render Blueprint (`render.yaml`), Singapore free web service
- `/api/health` health check
- streamed upload size guard
- ffprobe duration guard before librosa analysis
- single-analysis concurrency guard by default
- automatic ephemeral runtime cleanup
- `Cache-Control: no-store, private` for uploaded media/results
- best-effort server session deletion when choosing another song
