"""Build the committed, allowlisted customer frontend for infra's static publisher."""
import argparse
import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEGACY_DOMAIN = 'oneapi.glocalstorage.cn'
CN_DOMAIN = 'semifly.cn'
CN_ICP_NUMBER = '沪ICP备2024050749号-3'
GUIDE_PAGES = ('promotion/personal-start.html', 'promotion/vip-start.html')

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

def apply_cn_filing(assets):
    number = escape(CN_ICP_NUMBER)
    link = f'<a class="site-filing" href="https://beian.miit.gov.cn/">{number}</a>'
    for name in ('index.html', 'compare.html', 'cw.html', 'cw-terms.html', 'promotion/vip.html', 'skills/index.html', *GUIDE_PAGES):
        text = assets[name].decode()
        root = '<html lang="zh-CN">'
        if name == 'cw.html':
            # Legacy redirect stub — keep ICP on the document root only.
            if root in text:
                text = text.replace(root, f'<html lang="zh-CN" data-icp-filing="{number}">', 1)
            assets[name] = text.encode()
            continue
        if text.count(root) != 1:
            raise ValueError(f'Expected one document root in {name}')
        text = text.replace(root, f'<html lang="zh-CN" data-icp-filing="{number}">', 1)
        if '<div data-site-footer></div>' in text:
            text = text.replace('<div data-site-footer></div>', f'<div data-site-footer>{link}</div>')
        elif '<div id="cw-footer"></div>' in text:
            text = text.replace('<div id="cw-footer"></div>', f'<div id="cw-footer">{link}</div>')
        elif name == 'cw-terms.html':
            text = text.replace('</main>', f'</main><footer class="cw-app">{link}</footer>', 1)
        else:
            raise ValueError(f'Missing footer in {name}')
        if name == 'index.html':
            text = text.replace('</noscript>', f'<footer>{link}</footer></noscript>', 1)
        assets[name] = text.encode()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--domain', choices=(LEGACY_DOMAIN, CN_DOMAIN), default=LEGACY_DOMAIN)
    args = parser.parse_args()
    if git('status', '--porcelain', '--', 'web', 'prototypes/skills', 'scripts/build_static.py').strip():
        raise SystemExit('Commit web and builder changes before packaging.')
    sha = git('rev-parse', 'HEAD').decode().strip()
    html = git('show', 'HEAD:web/index.html').decode()
    assets = {}
    asset_names = {}
    for name in ('styles.css', 'welcome.css', 'market.css', 'universe.css', 'universe.js', 'navigation-data.js', 'identity.js', 'identity.css', 'personal-usage-charts.js', 'personal-usage-charts.css', 'home.css', 'landings.css', 'landings.js', 'brand.css', 'icons.js', 'model-catalog.js', 'model-background.js', 'model-explorer.js', 'model-explorer.css', 'model-showcase.css', 'app.js', 'welcome.js', 'table-sort.js', 'docs.js', 'docs.css', 'console.js', 'employee-api-context.js', 'employee-api-entry.js', 'console.css', 'realtesting.js', 'realtesting.css', 'select-menu.js', 'vip-notifications.js', 'screen-pages.css', 'screen-pages.js', 'site-header.js', 'site-header.css', 'personal-theme.css', 'personal-palettes.css', 'personal-theme.js', 'site-theme.css', 'cw.css', 'cw.js'):
        content = git('show', f'HEAD:web/{name}')
        if name == 'site-header.js':
            for shared in ('screen-pages.css', 'screen-pages.js'):
                content = content.replace(repr(shared).encode(), repr(asset_names[shared]).encode())
            content = content.replace(b"'vip-notifications.js'", repr(asset_names['vip-notifications.js']).encode())
        stem, extension = name.rsplit('.', 1)
        target = f'{stem}.{hashlib.sha256(content).hexdigest()[:12]}.{extension}'
        html = html.replace(f'"{name}"', f'"{target}"')
        assets[target] = content
        if name in ('screen-pages.css', 'screen-pages.js'):
            assets[name] = content  # protected staff frames use stable root URLs
        asset_names[name] = target
    assets['index.html'] = html.encode()
    compare_html = git('show', 'HEAD:web/compare.html').decode()
    for name in ('compare.css', 'compare-mode.js', 'compare-savings.js', 'compare-pdf.js', 'personal-compare.css', 'personal-compare.js', 'compare.js'):
        content = git('show', f'HEAD:web/{name}')
        stem, extension = name.rsplit('.', 1)
        target = f'{stem}.{hashlib.sha256(content).hexdigest()[:12]}.{extension}'
        compare_html = compare_html.replace(f'"{name}"', f'"{target}"')
        assets[target] = content
        asset_names[name] = target
    for source, target in asset_names.items():
        compare_html = compare_html.replace(f'"{source}"', f'"{target}"')
    assets['compare.html'] = compare_html.encode()
    employee_html = git('show', 'HEAD:web/employee-api.html').decode()
    for source, target in asset_names.items():
        employee_html = employee_html.replace(f'"/{source}"', f'"/{target}"')
    assets['employee-api.html'] = employee_html.encode()

    for name in ('pinapi-mark.svg', 'pinapi-wordmark.svg', 'semifly-email-logo.png', 'universe-speed-knob.png', 'favicon.svg', 'semifly-wordmark.svg', 'semifly-lockup.svg', 'THIRD-PARTY-LICENSES.txt'):
        assets[name] = git('show', f'HEAD:web/{name}')
    for name in ('cw.html', 'cw-terms.html'):
        content = git('show', f'HEAD:web/{name}')
        if name.endswith('.html') and name != 'cw.html':
            text = content.decode()
            for source, target in asset_names.items():
                text = text.replace(f'"{source}"', f'"{target}"')
            content = text.encode()
        assets[name] = content
    # VIP portal lives under /promotion/vip.html; assets remain at site root.
    vip_html = git('show', 'HEAD:web/promotion/vip.html').decode()
    for source, target in asset_names.items():
        vip_html = vip_html.replace(f'"../{source}"', f'"../{target}"')
    assets['promotion/vip.html'] = vip_html.encode()
    guide_assets = {}
    for name in ('start.css', 'personal-workbench.webp', 'vip-status.webp'):
        content = git('show', f'HEAD:web/promotion/{name}')
        stem, extension = name.rsplit('.', 1)
        target = f'{stem}.{hashlib.sha256(content).hexdigest()[:12]}.{extension}'
        assets[f'promotion/{target}'] = content
        guide_assets[name] = target
    for name in GUIDE_PAGES:
        page = git('show', f'HEAD:web/{name}').decode()
        for source, target in asset_names.items():
            page = page.replace(f'"../{source}"', f'"../{target}"')
        for source, target in guide_assets.items():
            page = page.replace(f'"{source}"', f'"{target}"')
            page = page.replace(f'https://{CN_DOMAIN}/promotion/{source}"', f'https://{CN_DOMAIN}/promotion/{target}"')
        assets[name] = page.encode()
    for name in ('code-activity.html', 'code-activity.js', 'code-activity.css'):
        content = git('show', f'HEAD:web/{name}')
        if name.endswith('.html'):
            html = content.decode()
            for source, target in asset_names.items():
                html = html.replace(f'"/{source}"', f'"/{target}"')
            content = html.encode()
        assets[name] = content
    # Official payment marks only; source notes and downloaded brand packs stay private.
    for name in ('assets/payments/alipay.ico', 'assets/payments/wechat-pay.svg'):
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
            text = text.replace('<body class="skills-page">', '<body class="skills-page" data-market-url="market-live.json">')
            text = text.replace('本地交互原型', 'Skills 广场').replace('本地验证 ·', '来源与许可已核对 ·')
            for source, target in asset_names.items():
                text = text.replace(f'"../{source}"', f'"../{target}"')
            content = text.encode()
        elif name == 'skills.js':
            content = content.decode().replace('semifly.ai 本地目录', 'semifly.ai').replace('每天 09:00 本地更新（需本机与 Codex 运行）', '每天 09:00 更新（北京时间）').encode()
        assets['skills/' + name] = content
    if args.domain == CN_DOMAIN:
        apply_cn_filing(assets)
    release = {
        'app': 'oneapi', 'source_sha': sha, 'stage': 'identity-live',
        'domain': args.domain, 'transactions_enabled': False,
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
