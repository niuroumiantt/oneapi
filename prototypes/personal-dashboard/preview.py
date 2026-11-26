#!/usr/bin/env python3
"""Read-only local design preview. No database, real login, or production requests."""
import argparse
import http.server
import json
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
WEB = HERE.parents[1] / 'web'
MODELS = [{'id': 'deepseek-flash', 'name': 'DeepSeek Flash'},
          {'id': 'glm-5.3', 'name': 'GLM-5.3'},
          {'id': 'glm-5.3-flash', 'name': 'GLM-5.3-Flash'}]

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def send_content(self, content, mime):
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/index.html'):
            html = (WEB / 'index.html').read_text()
            html = html.replace('</head>', '<link rel="stylesheet" href="/__dashboard__/charts.css"></head>')
            html = html.replace('</body>', '<script type="module" src="/__dashboard__/charts.js"></script></body>')
            self.send_content(html.encode(), 'text/html; charset=utf-8')
            return
        if path.startswith('/__dashboard__/'):
            name = path.rsplit('/', 1)[-1]
            if name not in ('charts.js', 'charts.css', 'demo-data.js'):
                self.send_error(404)
                return
            self.send_content((HERE / name).read_bytes(), 'text/css' if name.endswith('.css') else 'text/javascript')
            return
        if path.startswith('/api/'):
            data = {}
            if path == '/api/platform/me':
                data = {'user': {'id':'preview','name':'示例用户','email':'preview@example.test'},'organizations':[],'personal_assets':True}
            elif path == '/api/public/auth-methods':
                data = {'methods':{}}
            elif path == '/api/public/models':
                data = {'models':[dict(m, available=True) for m in MODELS]}
            elif path == '/api/billing/personal':
                data = {'payments_enabled':True,'list_credit_fen':'18640','cash_balance_fen':'18640','total_spent_fen':'1360','usage_by_model':[],'entries':[],'packs':[],'recharge':{'channels':[]}}
            elif path == '/api/customer-credit/status':
                data = {'enabled':True,'base_url':'https://semifly.cn/v1','list_credit_fen':'18640','held_fen':'0','unallocated_fen':'8640','keys':[{'id':'example-key','label':'日常使用','key_hint':'DEMO','limit_yuan':'100','used_yuan':'13.60','created_at':'2026-11-20T00:00:00Z'}],'calls':[],'models':MODELS}
            elif path in ('/api/pilot/status','/api/employee-credit/status'):
                data = {'enabled':False}
            elif 'notification' in path:
                data = {'items':[], 'unread_count':0, 'unread':0}
            self.send_content(json.dumps(data).encode(), 'application/json')
            return
        super().do_GET()

    def do_POST(self):
        self.send_error(405, 'Read-only design preview')

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4196)
    args = parser.parse_args()
    print(f'Local preview: http://127.0.0.1:{args.port}/#personal', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
