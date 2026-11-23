#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain -- server web prototypes/skills scripts package.json package-lock.json 'Dockerfile*')" ]]; then
  echo 'Commit the OneAPI source, dependencies and release scripts before publishing.' >&2
  exit 1
fi

source_sha=$(git rev-parse HEAD)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git archive "$source_sha" Dockerfile Dockerfile.pilot-runtime package.json package-lock.json server | tar -xf - -C "$work"
python3 scripts/build_static.py --domain semifly.cn --out "$work/web.tgz" > "$work/static-manifest.json"
cp scripts/shanghai/activate_release.sh "$work/activate_release.sh"
tar -czf "$work/bundle.tgz" -C "$work" Dockerfile Dockerfile.pilot-runtime package.json package-lock.json server web.tgz activate_release.sh
bundle_sha=$(shasum -a 256 "$work/bundle.tgz" | awk '{print $1}')

# An SSH wrapper can relay through m4, with the normal known-hosts checks.
ssh_client=${ONEAPI_SHANGHAI_SSH:-ssh}
"$ssh_client" -T root@47.101.153.99 "
  set -eu
  umask 077
  root=/srv/oneapi-data/oneapi-cutover-q72dymap
  test -f \"\$root/production/compose.yml\"
  mkdir -p \"\$root/releases\"
  stage=\$(mktemp -d \"\$root/releases/${source_sha:0:12}.XXXXXX\")
  cat > \"\$stage/bundle.tgz\"
  printf '%s  %s\\n' '$bundle_sha' \"\$stage/bundle.tgz\" | sha256sum -c
  tar -xzf \"\$stage/bundle.tgz\" -C \"\$stage\"
  flock /run/oneapi-shanghai-release.lock bash \"\$stage/activate_release.sh\" '$source_sha'
" < "$work/bundle.tgz"
