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
        if path == '/__preview__/label.js':
            script = "const footer=SiteHeader.footer;SiteHeader.footer=(...args)=>footer(...args).replace(/<a class=\"site-filing\"[^>]*>[^<]*<\\/a>/,'<span class=\"site-filing\">本地配色预览 · 演示数据</span>');"
            self.send_content(script.encode(), 'text/javascript')
            return
        if path in ('/', '/index.html'):
            html = (preview.WEB / 'index.html').read_text().replace('<html lang="zh-CN">', '<html lang="zh-CN" data-icp-filing="本地配色预览 · 演示数据">')
            html = html.replace('<script defer src="site-header.js"></script>', '<script defer src="site-header.js"></script><script defer src="/__preview__/label.js"></script>')
            html = html.replace('</head>', '<style>.site-footer>span.site-filing{flex:0 0 100%;text-align:center}</style></head>')
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
