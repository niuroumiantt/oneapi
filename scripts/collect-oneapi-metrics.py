#!/usr/bin/env python3
"""Host-only, read-only metrics collector. Never export environment or logs."""
import datetime as dt
import json
from pathlib import Path
import shutil
import subprocess
import time

OUTPUT = Path('/srv/oneapi-data/oneapi-cutover-q72dymap/metrics/snapshot.json')
STATE = Path('/var/lib/oneapi-sh-monitor/counters.json')
SERVICES = [('api', 'oneapi-sh-api'), ('database', 'oneapi-sh-db'), ('edge', 'oneapi-sh-edge')]

def delta_metrics(previous, current):
    elapsed = current['clock'] - previous.get('clock', current['clock'])
    result = {'cpu_percent': None, 'rx_bps': None, 'tx_bps': None, 'sample_seconds': None}
    if previous.get('boot') != current['boot'] or elapsed <= 0 or elapsed > 120:
        return result
    result['sample_seconds'] = round(elapsed, 2)
    total = current['total'] - previous.get('total', current['total'])
    idle = current['idle'] - previous.get('idle', current['idle'])
    if total > 0 and 0 <= idle <= total:
        result['cpu_percent'] = round(100 * (total - idle) / total, 2)
    if previous.get('interface') == current['interface'] and current['interface']:
        for metric in ('rx', 'tx'):
            old, new = previous.get(metric), current.get(metric)
            if isinstance(old, int) and isinstance(new, int) and new >= old:
                result[metric + '_bps'] = round((new - old) * 8 / elapsed, 2)
    return result

def counters():
    cpu = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    interface = None
    for line in Path('/proc/net/route').read_text().splitlines()[1:]:
        row = line.split()
        if row[1] == '00000000' and int(row[3], 16) & 2:
            interface = row[0]
            break
    net = {}
    if interface:
        for name in ('rx', 'tx'):
            net[name] = int(Path('/sys/class/net', interface, 'statistics', name + '_bytes').read_text())
    return dict(clock=time.monotonic(), boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                total=sum(cpu), idle=cpu[3] + cpu[4], interface=interface, **net)

def command(args, timeout=5):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True).stdout.strip()

def probe(path):
    try:
        raw = command(['curl', '--silent', '--fail', '--max-time', '4', '--resolve',
                       'semifly.cn:443:127.0.0.1', '--write-out', '\n%{time_total}',
                       'https://semifly.cn' + path])
        payload, seconds = raw.rsplit('\n', 1)
        return json.loads(payload), round(float(seconds) * 1000, 2)
    except (ValueError, OSError, subprocess.SubprocessError):
        return None, None

def atomic_json(path, value, mode):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, separators=(',', ':')))
    tmp.chmod(mode)
    tmp.replace(path)

def project_network():
    """Actual container bytes, including internal traffic; NOT billable public egress."""
    try:
        identity, pid, started = command(['docker', 'inspect', '--format', '{{.Id}}|{{.State.Pid}}|{{.State.StartedAt}}', 'oneapi-sh-api']).split('|')
        if int(pid) <= 0:
            return None
        rows = Path('/proc', pid, 'net/dev').read_text().splitlines()[2:]
        rx = tx = 0
        interfaces = []
        for line in rows:
            name, values = line.split(':', 1)
            if name.strip() == 'lo':
                continue
            fields = values.split()
            rx += int(fields[0]); tx += int(fields[8]); interfaces.append(name.strip())
        if not interfaces:
            return None
        return dict(identity=identity + ':' + started + ':' + ','.join(sorted(interfaces)), rx=rx, tx=tx)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None

def backup_inventory():
    """Only completed local OneAPI dumps; no contents or filenames exported."""
    try:
        sizes, modified = [], []
        for directory in Path('/srv/oneapi-data/backups').glob('oneapi-*'):
            dump = directory / 'oneapi.dump'
            if not directory.is_symlink() and (directory / 'receipt.json').is_file() and dump.is_file() and not dump.is_symlink():
                st = dump.stat()
                sizes.append(st.st_size)
                modified.append(st.st_mtime)
        return dict(status='ok', source='local_completed_database_dumps', bytes=sum(sizes), files=len(sizes),
                    latest_at=dt.datetime.fromtimestamp(max(modified),dt.timezone.utc).isoformat() if modified else None)
    except OSError:
        return dict(status='unavailable')

def update_usage(previous, current, stamp):
    """Only accumulate observed intervals. Reset/gap/midnight never backfills history."""
    old = previous.get('usage_meter') or {}
    result = dict(started_at=old.get('started_at', stamp), days=[dict(x) for x in old.get('days', [])],
                  allocation_ready=False, source='container_interface_bytes', public_egress_status='not_separated')
    day = dt.datetime.fromisoformat(stamp).astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
    row = next((x for x in result['days'] if x['date']==day), None)
    if row is None:
        row = dict(date=day, rx_bytes=0, tx_bytes=0, observed_seconds=0, gaps=0)
        result['days'].append(row)
    elapsed = current['clock'] - previous.get('clock', current['clock'])
    a, b = previous.get('project_network'), current.get('project_network')
    previous_day = old.get('last_day')
    valid = (previous.get('boot')==current['boot'] and 0 < elapsed <= 120 and previous_day==day and a and b and a['identity']==b['identity'] and b['rx']>=a['rx'] and b['tx']>=a['tx'])
    if valid:
        row['rx_bytes'] += b['rx']-a['rx']; row['tx_bytes'] += b['tx']-a['tx']
        row['observed_seconds'] = round(row['observed_seconds']+elapsed, 2)
    elif old:
        row['gaps'] += 1
    result['last_day'] = day
    result['days'] = sorted(result['days'],key=lambda x:x['date'])[-35:]
    result['collected_at'] = stamp
    result['network_status'] = 'ok' if b else 'unavailable'
    result['backup'] = backup_inventory()
    return result

def collect():
    try:
        previous = json.loads(STATE.read_text())
    except (OSError, ValueError):
        previous = counters()
        time.sleep(1)
    current = counters()
    rates = delta_metrics(previous, current)
    current['project_network'] = project_network()
    current['usage_meter'] = update_usage(previous, current, dt.datetime.now(dt.timezone.utc).isoformat())
    memory = {row.split(':')[0]: int(row.split()[1]) * 1024 for row in Path('/proc/meminfo').read_text().splitlines()}
    disk = shutil.disk_usage('/srv/oneapi-data')
    services = []
    fmt = '{{json .State.Status}}|{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}|{{.RestartCount}}|{{json .State.StartedAt}}|{{json .Config.Image}}'
    for name, container in SERVICES:
        try:
            status, health, restarts, started, image = command(['docker', 'inspect', '--format', fmt, container]).split('|')
            services.append(dict(name=name, status=json.loads(status), health=json.loads(health),
                                 restarts=int(restarts), started_at=json.loads(started), image=json.loads(image)))
        except (OSError, ValueError, subprocess.SubprocessError):
            services.append(dict(name=name, status='unknown', health=None, restarts=None, started_at=None, image=None))
    api, latency = probe('/api/status')
    release, _ = probe('/release.json')
    result = dict(schema=1, collected_at=dt.datetime.now(dt.timezone.utc).isoformat(), scope='shared_host',
                  cpu_percent=rates['cpu_percent'], sample_seconds=rates['sample_seconds'], cpu_cores=os.cpu_count(),
                  memory_total_bytes=memory['MemTotal'], memory_used_bytes=memory['MemTotal']-memory['MemAvailable'],
                  disk_total_bytes=disk.total, disk_used_bytes=disk.used,
                  network=dict(interface=current['interface'], rx_bps=rates['rx_bps'], tx_bps=rates['tx_bps']),
                  usage_meter=current['usage_meter'], uptime_seconds=float(Path('/proc/uptime').read_text().split()[0]), services=services,
                  local_probe=dict(ok=bool(api and api.get('status')=='ok'), latency_ms=latency),
                  deployment=dict(api_sha=api.get('source_sha') if api else None,
                                  web_sha=(release.get('source_sha') or release.get('source_commit') or release.get('commit')) if release else None))
    atomic_json(OUTPUT, result, 0o644)
    atomic_json(STATE, current, 0o600)
    # Keep private monthly ledgers beyond the 35-day UI window. Never rewrite an older month with a truncated window.
    meter = current['usage_meter']; today = meter['last_day']
    months = {today[:7]}
    if today.endswith('-01'):
        months.update(x['date'][:7] for x in meter['days'] if x['date'] < today)
    for month in months:
        atomic_json(STATE.parent / ('usage-' + month + '.json'), dict(started_at=meter['started_at'], period=month, days=[x for x in meter['days'] if x['date'].startswith(month)], allocation_ready=False), 0o600)

if __name__ == '__main__':
    collect()
