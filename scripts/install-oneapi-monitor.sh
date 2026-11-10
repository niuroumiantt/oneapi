#!/usr/bin/env bash
set -euo pipefail
# Run on the host after copying the reviewed collector to this runtime directory.
install -d -m 0755 /srv/oneapi-runtime/metrics
install -d -m 0700 /var/lib/oneapi-monitor
cat > /etc/systemd/system/oneapi-monitor.service <<'UNIT'
[Unit]
Description=OneAPI read-only host observation
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /srv/oneapi-runtime/collect-oneapi-metrics.py
TimeoutStartSec=35
User=root
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/srv/oneapi-runtime/metrics /var/lib/oneapi-monitor
UNIT
cat > /etc/systemd/system/oneapi-monitor.timer <<'UNIT'
[Unit]
Description=Sample OneAPI host every 15 seconds
[Timer]
OnBootSec=15
OnUnitInactiveSec=15
AccuracySec=1
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now oneapi-monitor.timer
systemctl start oneapi-monitor.service
