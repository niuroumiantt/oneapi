"""Run as root on the existing mainland host; add only the Skills snapshot route."""
from pathlib import Path
import datetime,hashlib,os,shutil,subprocess
config=Path('/srv/infra/oa-cn/hosts/mainland/Caddyfile.public')
original=config.read_text();snippet=(Path(__file__).parent/'Caddy.snippet').read_text()
start=original.index('# BEGIN oneapi independent preview');end=original.index('# END oneapi independent preview',start)
block=original[start:end]
if '# BEGIN oneapi skills daily snapshot' in block:
    raise SystemExit('Skills route already installed; inspect before changing it')
needle='    @identity path /api /api/*'
assert block.count(needle)==1
candidate=original[:start]+block.replace(needle,snippet+needle)+original[end:]
subprocess.run(['docker','exec','-i','mainland-caddy-1','caddy','validate','--config','/dev/stdin','--adapter','caddyfile'],input=candidate.encode(),check=True)
assert config.read_text()==original,'Concurrent configuration change detected'
backup=Path('/var/lib/infra-release/backups')/('Caddyfile.before-skills.'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
shutil.copy2(config,backup)
with config.open('w') as f:f.write(candidate);f.flush();os.fsync(f.fileno())
try:
    subprocess.run(['docker','kill','--signal=USR1','mainland-caddy-1'],check=True)
except Exception:
    config.write_text(original)
    raise
print('Caddy snapshot route installed; backup:',backup)
print('Config SHA256:',hashlib.sha256(candidate.encode()).hexdigest())
