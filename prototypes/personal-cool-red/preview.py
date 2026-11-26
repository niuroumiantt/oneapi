#!/usr/bin/env python3
"""Local, read-only color preview; fixtures only, no production connection."""
import argparse, importlib.util, json, http.server
from pathlib import Path
from urllib.parse import urlparse
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('dashboard_preview', HERE.parent / 'personal-dashboard' / 'preview.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)
class Handler(preview.Handler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/__preview__/palettes.css', '/__preview__/palettes.js'):
            name = path.rsplit('/', 1)[1]
            media = 'text/css' if name.endswith('.css') else 'text/javascript'
            self.send_content((HERE / name).read_bytes(), media)
            return
        if path in ('/', '/index.html'):
            html = (preview.WEB / 'index.html').read_text()
            html = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-icp-filing="本地配色预览 · 演示数据">')
            html = html.replace(
                '<script defer src="site-header.js"></script>',
                '<script defer src="site-header.js"></script><script defer src="/__preview__/palettes.js"></script>',
            )
            html = html.replace('</head>', '<link rel="stylesheet" href="/__preview__/palettes.css"></head>')
            self.send_content(html.encode(), 'text/html; charset=utf-8')
            return
        if path == '/api/customer-credit/usage/chart':
            self.send_content((HERE / 'chart-fixture.json').read_bytes(), 'application/json')
            return
        super().do_GET()
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4211)
    args = parser.parse_args()
    print(f'Local preview: http://127.0.0.1:{args.port}/#personal', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
