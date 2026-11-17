# Skills production delivery

The existing static builder publishes the explicit `prototypes/skills/public-files.json` list at `/skills/`, with root-site navigation links. It preserves synthetic trial files and honest test limits; no further Word/Excel/WeChat trial is required to publish.

Daily public data is separate from immutable static releases:

- `/srv/sites/oneapi-skills-data/market-data.json` is the only mutable public snapshot (not secrets). Caddy already mounts `/srv/sites` read-only; the updater writes on the host as `deploy`.
- `/srv/oneapi-skills/<source-sha>/` contains the pinned updater, sources and service/routing files; `current` points to it.
- `oneapi-skills-update.timer`: 09:00 Asia/Shanghai, persistent catch-up, 30s jitter. Service uses no token and has write access only to its public snapshot directory.
- `/skills/market-live.json` is mapped by the narrow Caddy snippet; `install-routing.py` validates the candidate, checks for concurrent edits, backs up the existing config and reloads only `mainland-caddy-1` via SIGUSR1.
- Frontend fetches the live endpoint with no-store and falls back to the packaged snapshot. Source failures retain the last successful data and date, while the UI labels errors/stale data.
- The former Codex automation is local only; production does not depend on it.

Deployment follows infra's `push_static_candidate.sh oneapi <archive> <source-sha>` for static content. No API/database/container replacement is needed. Install the timer/service using systemctl, and run the service once to verify actual fetching. Check the live endpoint, timer next-run and journal; a source failure is not a successful refresh.

Rollback static content with infra's publisher and the preceding artifact/source SHA at a higher sequence. To stop refresh, disable this timer. To remove the endpoint, remove only the BEGIN/END skills fragment after validating the candidate; do not restore an entire old Caddyfile over unrelated later changes. Keep the snapshot, archives and evidence.
