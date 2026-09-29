#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
image="beatdash-review:${GITHUB_SHA:-local}"
docker build --tag "$image" .
container=$(docker run --detach --publish 127.0.0.1::8000 "$image")
trap 'docker logs "$container"; docker rm --force "$container" >/dev/null' EXIT
port=$(docker port "$container" 8000/tcp | sed 's/.*://')
for attempt in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:$port/api/health" > /tmp/beatdash-container-health.json; then break; fi
  sleep 2
done
python3 - <<'CHECK'
import json
from pathlib import Path
health = json.loads(Path("/tmp/beatdash-container-health.json").read_text())
assert health["ok"] is True and health["version"] == "4.0.0", health
assert health["revision"] == Path("web/BUILD_REVISION").read_text().strip(), health
print("PASS container health/version/revision", health)
CHECK
curl --fail --silent "http://127.0.0.1:$port/" | grep -q '<title>BEATDASH</title>'
echo 'PASS container serves BEATDASH UI'
