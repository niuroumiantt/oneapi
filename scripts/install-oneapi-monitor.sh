#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
runtime=/srv/oneapi-data/oneapi-cutover-q72dymap
if [[ ! -f "$runtime/production/compose.yml" ]] || ! docker container inspect oneapi-sh-api >/dev/null 2>&1; then
  echo 'Run this installer on the Shanghai OneAPI ECS.' >&2
  exit 1
fi
install -d -m 0755 "$runtime/metrics"
install -d -m 0700 /var/lib/oneapi-sh-monitor
install -m 0644 "$here/collect-oneapi-metrics.py" "$runtime/collect-shanghai-metrics.py"
for unit in oneapi-sh-monitor.service oneapi-sh-monitor.timer; do
  install -m 0644 "$here/shanghai/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now oneapi-sh-monitor.timer
systemctl start oneapi-sh-monitor.service
