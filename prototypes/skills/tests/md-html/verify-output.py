import json
import re
from pathlib import Path
from html.parser import HTMLParser

class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)

html = Path('input.html').read_text()
parser = Text()
parser.feed(html)
text = ''.join(parser.parts).replace('\xa0', ' ')
checks = {
    'first_heading': bool(re.search(r'<h1\b[^>]*>海风书店十月活动复盘</h1>', html)),
    'chinese': '本次为虚构业务样本' in text and '尚未收集满意度问卷，不能声称满意度提升。' in text,
    'amounts': all(v in text for v in ['18,000 元', '16,420 元', '1,580 元']),
    'table': '<table ' in html and all(v in text for v in ['场地', '6,000', '讲师', '5,200', '物料', '3,220', '推广', '2,000']),
    'code': '<pre ' in html and '<code ' in html and all(v in text for v in ['budget = 18000', 'spent = 16420', 'remaining = budget - spent', '# 1580']),
    'bottom_original_url': 'https://daringfireball.net/projects/markdown/' in text.split('引用链接')[-1],
    'citation_marker': '<sup>[1]</sup>' in html,
    'red': '#A93226' in html,
    'font_size': 'font-size: 16px' in html,
}
Path('verification.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(checks, ensure_ascii=False, indent=2))
assert all(checks.values()), 'Output verification failed'
