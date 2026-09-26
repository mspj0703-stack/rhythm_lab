FROM node:22-bookworm-slim AS source
WORKDIR /work

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

COPY rhythm-core-v0.3.1-youtube-input.zip /tmp/app.zip
COPY rhythm-analyzer-memory-fix-files.zip /tmp/analyzer-memory-fix-files.zip

RUN unzip -q /tmp/app.zip -d /work \
    && test -f /work/rhythm-core/package.json \
    && test -f /work/rhythm-core/backend/requirements.txt \
    && unzip -qo /tmp/analyzer-memory-fix-files.zip -d /work/rhythm-core \
    && test -f /work/rhythm-core/analyzer/chartgen/config.py \
    && test -f /work/rhythm-core/analyzer/chartgen/features.py \
    && test -f /work/rhythm-core/analyzer/docs/memory-fix-v0.3.2.md \
    && test -f /work/rhythm-core/analyzer/mem_bench_subprocess.py


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
