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
    if git('status', '--porcelain', '--', 'web', 'prototypes/skills', 'scripts/build_static.py').strip():
        raise SystemExit('Commit web and builder changes before packaging.')
    sha = git('rev-parse', 'HEAD').decode().strip()
    html = git('show', 'HEAD:web/index.html').decode()
    assets = {}
    asset_names = {}
    for name in ('styles.css', 'welcome.css', 'market.css', 'universe.css', 'universe.js', 'identity.js', 'identity.css', 'home.css', 'landings.css', 'landings.js', 'brand.css', 'icons.js', 'model-catalog.js', 'app.js', 'welcome.js', 'table-sort.js', 'docs.js', 'docs.css', 'console.js', 'console.css', 'realtesting.js', 'realtesting.css', 'select-menu.js', 'site-header.js', 'site-header.css'):
        content = git('show', f'HEAD:web/{name}')
        stem, extension = name.rsplit('.', 1)
        target = f'{stem}.{hashlib.sha256(content).hexdigest()[:12]}.{extension}'
        html = html.replace(f'"{name}"', f'"{target}"')
        assets[target] = content
        asset_names[name] = target
    assets['index.html'] = html.encode()
    compare_html = git('show', 'HEAD:web/compare.html').decode()
    for name in ('compare.css', 'compare-savings.js', 'compare-pdf.js', 'compare.js'):
        content = git('show', f'HEAD:web/{name}')
        stem, extension = name.rsplit('.', 1)
        target = f'{stem}.{hashlib.sha256(content).hexdigest()[:12]}.{extension}'
        compare_html = compare_html.replace(f'"{name}"', f'"{target}"')
        assets[target] = content
        asset_names[name] = target
    for source, target in asset_names.items():
        compare_html = compare_html.replace(f'"{source}"', f'"{target}"')
    assets['compare.html'] = compare_html.encode()

    for name in ('pinapi-mark.svg', 'pinapi-wordmark.svg', 'semifly-email-logo.png', 'universe-speed-knob.png', 'favicon.svg', 'semifly-wordmark.svg', 'semifly-lockup.svg', 'THIRD-PARTY-LICENSES.txt'):
        assets[name] = git('show', f'HEAD:web/{name}')
    # Explicit publication manifest: no arbitrary repository/runtime files.
    skill_files = json.loads(git('show', 'HEAD:prototypes/skills/public-files.json'))
    for name in skill_files:
        if name.startswith('/') or '..' in Path(name).parts:
            raise ValueError('Invalid Skills publication path')
        content = git('show', f'HEAD:prototypes/skills/{name}')
        if name == 'index.html':
            text = content.decode().replace('../../web/', '../').replace('../index.html#market', '../#market')
            text = text.replace('semifly.ai 本地原型', 'semifly.ai')
            text = text.replace('<body>', '<body data-market-url="market-live.json">')
            text = text.replace('本地交互原型', 'Skills 广场').replace('本地验证 ·', '来源与许可已核对 ·')
            for source, target in asset_names.items():
                text = text.replace(f'"../{source}"', f'"../{target}"')
            content = text.encode()
        elif name == 'skills.js':
            content = content.decode().replace('semifly.ai 本地目录', 'semifly.ai').replace('每天 09:00 本地更新（需本机与 Codex 运行）', '每天 09:00 更新（北京时间）').encode()
        assets['skills/' + name] = content
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
