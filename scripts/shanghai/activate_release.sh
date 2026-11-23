#!/usr/bin/env bash
set -euo pipefail
umask 077

source_sha=${1:?source commit required}
[[ $source_sha =~ ^[0-9a-f]{40}$ ]]
stage=$(cd "$(dirname "$0")" && pwd)
root=/srv/oneapi-data/oneapi-cutover-q72dymap
production=$root/production
webroot=$root/web-cn
compose=$production/compose.yml
image=oneapi-sh-api:$source_sha
[[ $stage == "$root/releases/"* && -f "$compose" && -f "$webroot/index.html" ]]
[[ $(docker inspect -f '{{.State.Health.Status}}' oneapi-sh-db) == healthy ]]
old_image=$(docker inspect -f '{{.Config.Image}}' oneapi-sh-api)
[[ $old_image == oneapi-sh-api:* ]]

mkdir -p "$stage/web" "$stage/previous-web"
tar -xzf "$stage/web.tgz" -C "$stage/web"
python3 - "$stage/web/release.json" "$source_sha" <<'PY'
import json
import sys

with open(sys.argv[1]) as record:
    release = json.load(record)
assert release["app"] == "oneapi" and release["domain"] == "semifly.cn" and release["source_sha"] == sys.argv[2]
PY

# Reuse the installed production packages when the lock entries are identical.
docker run --rm --pull never --network none -v "$stage/package-lock.json:/candidate-lock.json:ro" \
  --user 0 --entrypoint node "$old_image" -e '
  const compare = require("node:util").isDeepStrictEqual;
  try {
    const current = require("/app/package-lock.json").packages;
    const candidate = require("/candidate-lock.json").packages;
    delete current[""]; delete candidate[""];
    process.exitCode = Number(!compare(current, candidate));
  } catch { process.exitCode = 1; }
' && reuse_dependencies=yes || reuse_dependencies=no
if [[ $reuse_dependencies == yes ]]; then
  docker build -f "$stage/Dockerfile.pilot-runtime" \
    --build-arg "NODE_RUNTIME_DONOR=$old_image" -t "$image" "$stage"
else
  docker build -f "$stage/Dockerfile" -t "$image" "$stage"
fi

docker run --rm --pull never --network none --entrypoint node "$image" \
  --input-type=module -e 'await import("./server/src/app.mjs")'
systemctl start oneapi-sh-backup.service
cp -p "$compose" "$stage/previous-compose.yml"
cp -a "$webroot/." "$stage/previous-web/"

publish_web() {
  python3 - "$1" "$webroot" <<'PY'
import os
from pathlib import Path
import shutil
import sys
import tempfile

source, target = map(Path, sys.argv[1:])
files = [item for item in source.rglob("*") if item.is_file()]
# Publish assets before the pages that link to them, then the release receipts.
files.sort(key=lambda item: (item.name in {"healthz", "release.json"}, item.suffix == ".html"))
for item in files:
    destination = target / item.relative_to(source)
    if not destination.parent.exists():
        destination.parent.mkdir(parents=True, mode=0o755)
        for parent in destination.relative_to(target).parents:
            if parent != Path("."):
                (target / parent).chmod(0o755)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temp:
        temporary = Path(temp.name)
    try:
        shutil.copyfile(item, temporary)
        temporary.chmod(0o644)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
PY
}

rollback() {
  result=$?
  trap - EXIT
  if [[ $result -ne 0 ]]; then
    echo "Release failed. Restoring previous API and web from $stage" >&2
    set +e
    cp -p "$stage/previous-compose.yml" "$production/.compose-rollback"
    mv -f "$production/.compose-rollback" "$compose"
    docker compose -f "$compose" up -d --no-deps --wait --wait-timeout 100 api
    if [[ ${web_started:-no} == yes ]]; then publish_web "$stage/previous-web"; fi
  fi
  exit "$result"
}
trap rollback EXIT
python3 - "$compose" "$image" "$source_sha" <<'PY'
import json
import os
from pathlib import Path
import sys

path = Path(sys.argv[1])
data = json.loads(path.read_text())
api = data["services"]["api"]
assert api["container_name"] == "oneapi-sh-api"
api["image"] = sys.argv[2]
api.setdefault("environment", {})["SOURCE_SHA"] = sys.argv[3]
temporary = path.with_name(".compose-release")
temporary.write_text(json.dumps(data, indent=2) + "\n")
os.replace(temporary, path)
PY
docker compose -f "$compose" run --rm --no-deps api node server/src/migrate.mjs
docker compose -f "$compose" up -d --no-deps --wait --wait-timeout 100 api
probe() {
  curl -fsS --max-time 15 --resolve semifly.cn:443:127.0.0.1 "https://semifly.cn/$1" \
    | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["status"]=="ok" and r["source_sha"]==sys.argv[1], r' "$source_sha"
}
probe api/status
web_started=yes
publish_web "$stage/web"
probe release.json
printf 'Shanghai OneAPI %s verified. Release directory %s\n' "$source_sha" "$stage"
