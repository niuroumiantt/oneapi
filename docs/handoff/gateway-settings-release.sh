#!/usr/bin/env bash
# OneAPI production release used by the gateway-settings work (2026-11-12). Copy to a scratch folder, set SHA,
# and point the cd line at a clean worktree. Only run after the owner says 合并并发布 for that change.
set -euo pipefail
cd "$HOME/.worktrees/oneapi/output-guard"
srv(){ ssh -i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=10 -o ServerAliveCountMax=30 aliyun "$@"; }
git -C "$HOME/code/infra" fetch -q origin
RELEASE_DRIFT=$(git -C "$HOME/code/infra" diff --stat HEAD origin/main -- release hosts/apps.json scripts/push_static_candidate.sh)
if [ -n "$RELEASE_DRIFT" ]; then echo "infra release tooling differs from origin/main:"; echo "$RELEASE_DRIFT"; exit 3; fi
SHA=<合并后 origin/main 的完整 SHA>; S=${SHA:0:7}; echo "merged $SHA"
git fetch -q origin; test -z "$(git status --short)"; git checkout -q --detach "$SHA"
OLD=$(srv "docker inspect oneapi-api-1 --format '{{.Config.Image}}'" | sed 's/.*://'); echo "live was $OLD"
git log --oneline "$OLD..$SHA" | cut -c1-80
git archive HEAD server | srv "sudo -n rm -rf /srv/oneapi-runtime/source-$S && sudo -n install -d -o deploy -g deploy /srv/oneapi-runtime/source-$S && tar -xf - -C /srv/oneapi-runtime/source-$S"
REMOTE=$(mktemp)
cat > "$REMOTE" <<EOF
set -euo pipefail
cd /srv/oneapi-runtime
sudo -n ./backup.sh </dev/null
sudo -n cp -p pilot.override.yml pilot.override.before-$S.yml
printf 'FROM oneapi-identity:$OLD\nCOPY --chown=1000:1000 server /app/server\nLABEL org.opencontainers.image.revision=$SHA\n' > source-$S/Dockerfile
docker build -q -t oneapi-identity:$S source-$S 2>/dev/null </dev/null | cut -c1-30
python3 - <<'P'
import re
s=open('pilot.override.yml').read()
s2=s.replace('image: oneapi-identity:$OLD','image: oneapi-identity:$S')
s2,n=re.subn(r'SOURCE_SHA: [0-9a-f]{40}','SOURCE_SHA: $SHA',s2); assert n==1 and 'oneapi-identity:$S' in s2
open('/tmp/oneapi-override-$S.yml','w').write(s2)
P
sudo -n install -m 0644 /tmp/oneapi-override-$S.yml pilot.override.yml; rm -f /tmp/oneapi-override-$S.yml
DC="sudo -n docker compose -f compose.yml -f pilot.override.yml --env-file /srv/oneapi-config/compose.env"
restore(){ echo RESTORING; sudo -n cp -p pilot.override.before-$S.yml pilot.override.yml; \$DC up -d --no-deps api </dev/null; }
\$DC config -q </dev/null; echo config-ok
\$DC run --rm --no-deps -T api node server/src/migrate.mjs </dev/null || { restore; exit 1; }
\$DC up -d --no-deps api </dev/null 2>&1 | tail -1
st=starting; for i in \$(seq 1 30); do st=\$(docker inspect oneapi-api-1 --format '{{.State.Health.Status}}'); [ "\$st" = healthy ] && break; sleep 3; done
echo "api health: \$st"; [ "\$st" = healthy ] || { restore; exit 1; }
docker inspect oneapi-api-1 --format '{{.Config.Image}}'
echo "backup: \$(sudo -n ls -t /srv/oneapi-backups | sed -n 1p)"
echo remote-done
EOF
srv 'bash -s' < "$REMOTE" 2>&1 | cut -c1-200; rm -f "$REMOTE"
ST=$(mktemp -d); PY=/Users/m5/.local/bin/python3.12
$PY -I scripts/build_static.py --out "$ST/oneapi.tar.gz" >/dev/null
MAINLAND_SSH_IDENTITY="$HOME/.ssh/id_ed25519" STATIC_PYTHON=$PY "$HOME/code/infra/scripts/push_static_candidate.sh" oneapi "$ST/oneapi.tar.gz" "$SHA" 2>&1 | grep -E '"status"|rror' | cut -c1-160
rm -rf "$ST"
echo release-script-done