#!/bin/sh
set -eu
export PATH="/Users/m5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export npm_config_cache=/private/tmp/oneapi-skill-tests-20261117/npm-cache
npx --offline bun .agents/skills/baoyu-markdown-to-html/scripts/main.ts input.md --theme simple --color red --font-size 16px --keep-title --cite --no-mermaid > conversion.json 2> conversion.stderr.log
