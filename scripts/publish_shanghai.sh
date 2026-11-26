#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain -- server web prototypes/skills scripts package.json package-lock.json 'Dockerfile*')" ]]; then
  echo 'Commit the OneAPI source, dependencies and release scripts before publishing.' >&2
  exit 1
fi

source_sha=$(git rev-parse HEAD)
expected_web=${ONEAPI_EXPECT_WEB_SHA:-}
expected_api=${ONEAPI_EXPECT_API_SHA:-}
reuse_node=${ONEAPI_USE_EXISTING_NODE:-0}
[[ $reuse_node == 0 || $reuse_node == 1 ]]
[[ -z $expected_web || $expected_web =~ ^[0-9a-f]{40}$ ]]
[[ -z $expected_api || $expected_api =~ ^[0-9a-f]{40}$ ]]
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git archive "$source_sha" Dockerfile Dockerfile.pilot-runtime Dockerfile.dependency-runtime package.json package-lock.json server | tar -xf - -C "$work"
python3 scripts/build_static.py --domain semifly.cn --out "$work/web.tgz" > "$work/static-manifest.json"
cp scripts/shanghai/activate_release.sh "$work/activate_release.sh"
mkdir -p "$work/release-npm"
if [[ $reuse_node == 1 ]]; then
  # Bootstrap from the installed npm tool, not application dependencies from this computer.
  npm_cli=$(node -p 'require("fs").realpathSync(process.argv[1])' "$(command -v npm)")
  npm_root=$(dirname "$(dirname "$npm_cli")")
  node -e 'if(require(process.argv[1]+"/package.json").name!=="npm")process.exit(1)' "$npm_root"
  cp -R "$npm_root/." "$work/release-npm/"
fi
tar -czf "$work/bundle.tgz" -C "$work" Dockerfile Dockerfile.pilot-runtime Dockerfile.dependency-runtime package.json package-lock.json server web.tgz activate_release.sh release-npm
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
  flock /run/oneapi-shanghai-release.lock bash \"\$stage/activate_release.sh\" '$source_sha' '$expected_web' '$expected_api' '$reuse_node'
" < "$work/bundle.tgz"
