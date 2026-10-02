#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
expected_version="$(tr -d '\r\n' < web/VERSION)"
expected_revision="$(tr -d '\r\n' < web/BUILD_REVISION)"
test -n "$expected_version"
test -n "$expected_revision"
image="beatdash-review:${GITHUB_SHA:-local}"
docker build --tag "$image" .
container=$(docker run --detach --publish 127.0.0.1::8000 "$image")
trap 'docker logs "$container"; docker rm --force "$container" >/dev/null' EXIT
port=$(docker port "$container" 8000/tcp | sed 's/.*://')
health_url="http://127.0.0.1:$port/api/health"
python3 scripts/verify_deployment.py \
  --url "$health_url" \
  --expected-version "$expected_version" \
  --expected-revision "$expected_revision" \
  --attempts 60 \
  --interval 2 \
  --stable-mismatch-limit 3
curl --fail --silent "http://127.0.0.1:$port/" | grep -q '<title>BEATDASH</title>'
echo 'PASS container serves BEATDASH UI'
