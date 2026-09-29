FROM node:22-bookworm-slim AS source
WORKDIR /work

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

COPY rhythm-core-v0.3.1-youtube-input.zip /tmp/app.zip
COPY rhythm-analyzer-memory-fix-files.zip /tmp/analyzer-memory-fix-files.zip
COPY chart-generation-update-v1-rebased-files.zip /tmp/chart-gen-v1-files.zip
COPY difficulty-level-update-v1-rebased-files.zip /tmp/difficulty-level-v1-files.zip
COPY gameplay-ux-update-v1-rebased-files.zip /tmp/gameplay-ux-files.zip
COPY gameplay-feel-fix-v2-rebased-files.zip /tmp/gameplay-feel-v2-files.zip
COPY gameplay-visual-media-fix-v3-rebased-web-files.zip /tmp/gameplay-v3-web-files.zip

RUN unzip -q /tmp/app.zip -d /work \
    && test -f /work/rhythm-core/package.json \
    && test -f /work/rhythm-core/backend/requirements.txt \
    && unzip -qo /tmp/analyzer-memory-fix-files.zip -d /work/rhythm-core \
    && test -f /work/rhythm-core/analyzer/chartgen/config.py \
    && test -f /work/rhythm-core/analyzer/chartgen/features.py \
    && test -f /work/rhythm-core/analyzer/docs/memory-fix-v0.3.2.md \
    && test -f /work/rhythm-core/analyzer/mem_bench_subprocess.py \
    && unzip -qo /tmp/chart-gen-v1-files.zip -d /work/rhythm-core \
    && test -f /work/rhythm-core/analyzer/chartgen/note_types.py \
    && test -f /work/rhythm-core/analyzer/tests/test_note_types.py \
    && unzip -qo /tmp/difficulty-level-v1-files.zip -d /work/rhythm-core \
    && test -f /work/rhythm-core/analyzer/chartgen/level_estimator.py \
    && test -f /work/rhythm-core/analyzer/tests/test_level_estimator.py \
    && unzip -qo /tmp/gameplay-ux-files.zip -d /work/rhythm-core \
    && test -f /work/rhythm-core/src/settings/noteSpeed.ts \
    && test -f /work/rhythm-core/src/web/NoteSpeedControl.tsx \
    && test -f /work/rhythm-core/src/__tests__/noteSpeed.test.ts \
    && unzip -qo /tmp/gameplay-feel-v2-files.zip -d /work/rhythm-core \
    && grep -q 'HOLD_REGRAB_GRACE_MS' /work/rhythm-core/src/constants/config.ts \
    && grep -q 'NOTE_SPEED_MAX = 20.0' /work/rhythm-core/src/settings/noteSpeed.ts \
    && grep -q 'max_same_hand_notes_during_hold' /work/rhythm-core/analyzer/chartgen/config.py \
    && test -f /work/rhythm-core/src/engine/gameState.ts \
    && test -f /work/rhythm-core/scripts/browser_smoke_test.cjs \
    && unzip -qo /tmp/gameplay-v3-web-files.zip -d /work/rhythm-core \
    && test -f /work/rhythm-core/src/engine/highway.ts \
    && test -f /work/rhythm-core/src/__tests__/v3Regression.test.ts \
    && test -f /work/rhythm-core/src/__tests__/mediaLifecycle.test.tsx \
    && grep -q 'BEATDASH' /work/rhythm-core/index.html \
    && grep -q '35' /work/rhythm-core/src/constants/config.ts

FROM node:22-bookworm-slim AS web-build
WORKDIR /app

COPY --from=source /work/rhythm-core/package.json /work/rhythm-core/package-lock.json ./
RUN npm ci
COPY --from=source /work/rhythm-core/ /app/
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=source /work/rhythm-core/backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY --from=source /work/rhythm-core/ /app/
COPY --from=web-build /app/dist /app/dist

ENV PYTHONUNBUFFERED=1
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "python -m uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
