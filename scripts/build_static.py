"""Build the committed, allowlisted customer frontend for infra's static publisher."""
import argparse
import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if git('status', '--porcelain', '--', 'web', 'scripts/build_static.py').strip():
        raise SystemExit('Commit web and builder changes before packaging.')
    sha = git('rev-parse', 'HEAD').decode().strip()
    html = git('show', 'HEAD:web/index.html').decode()
    assets = {}
    for name in ('styles.css', 'welcome.css', 'market.css', 'universe.css', 'universe.js', 'operations.js', 'identity.js', 'identity.css', 'home.css', 'landings.css', 'landings.js', 'operations.css', 'brand.css', 'icons.js', 'app.js', 'welcome.js'):
        content = git('show', f'HEAD:web/{name}')
        stem, extension = name.rsplit('.', 1)
        target = f'{stem}.{hashlib.sha256(content).hexdigest()[:12]}.{extension}'
        html = html.replace(f'"{name}"', f'"{target}"')
        assets[target] = content
    assets['index.html'] = html.encode()
    for name in ('pinapi-mark.svg', 'pinapi-wordmark.svg', 'semifly-email-logo.png', 'universe-speed-knob.png', 'favicon.svg', 'semifly-wordmark.svg', 'semifly-lockup.svg', 'THIRD-PARTY-LICENSES.txt'):
        assets[name] = git('show', f'HEAD:web/{name}')
    release = {
        'app': 'oneapi', 'source_sha': sha, 'stage': 'identity-live',
        'domain': 'oneapi.glocalstorage.cn', 'transactions_enabled': False,
        'customer_registration_enabled': True, 'staff_login_enabled': True, 'inference_enabled': False,
        'status': 'ok', 'business_ready': False,
    }
    assets['release.json'] = (json.dumps(release, sort_keys=True) + '\n').encode()
    assets['healthz'] = assets['release.json']
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('wb') as output:
        with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w') as archive:
                for name, content in sorted(assets.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size, entry.mode, entry.mtime = len(content), 0o644, 0
                    archive.addfile(entry, io.BytesIO(content))
    print(json.dumps({'source_sha': sha, 'archive': str(args.out.resolve()),
                     'sha256': hashlib.sha256(args.out.read_bytes()).hexdigest(),
                     'files': sorted(assets)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
