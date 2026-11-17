"""Extract project fields from fixture.pdf; no other input fixtures are read."""
import csv
import hashlib
import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pdfplumber
import pypdf


def main():
    source = Path('fixture.pdf')
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    reader = pypdf.PdfReader(source)
    rows = []
    with pdfplumber.open(source) as pdf:
        assert len(reader.pages) == len(pdf.pages)
        page_count = len(pdf.pages)
        for page_number, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ''
            def field(label):
                match = re.search(r'^' + re.escape(label) + r'\s+([^\n]+)$', text, re.MULTILINE)
                if not match:
                    raise ValueError(f'Page {page_number}: missing {label}')
                return match.group(1).strip()
            name = field('项目名称')
            raw_date = field('签订日期')
            parsed_date = date.fromisoformat(raw_date).isoformat() if re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw_date) else None
            raw_budget = field('项目预算（人民币元）').replace(',', '')
            budget_value = Decimal(raw_budget)
            if not budget_value.is_finite():
                raise ValueError('Budget must be finite')
            budget = format(budget_value, 'f')
            rows.append(dict(name=name, date=parsed_date, budget=budget, page=page_number))
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    Path('extracted.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    with Path('extracted.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=['name', 'date', 'budget', 'page'])
        writer.writeheader()
        writer.writerows(rows)
    total = sum((Decimal(row['budget']) for row in rows), Decimal('0'))
    lines = [
        '# PDF 项目提取报告', '',
        '输入仅为 `fixture.pdf`；未读取 make_fixture.py 或 expected.json，未修改原 PDF。', '',
        f'使用 pdfplumber {pdfplumber.__version__} 逐页提取文本，以字段标签定位项目名称、签订日期和人民币元预算；使用 pypdf {pypdf.__version__} 独立核对 PDF 页数。无需 OCR。',
        '预算使用 Python Decimal 解析并输出十进制字符串，避免浮点误差。日期“待确认”转为 JSON null；CSV 对应为空字段。page 保留原始 1 起始页码。', '',
        f'实际读取 {page_count} 页，提取 {len(rows)} 个项目，日期未知 {sum(row["date"] is None for row in rows)} 个；预算合计 {total:f} 元。', '',
        '| 名称 | 日期 | 预算（元） | 原页码 |', '| --- | --- | --- | --- |',
    ]
    lines += [f'| {r["name"]} | {r["date"] or "未知"} | {r["budget"]} | {r["page"]} |' for r in rows]
    lines += ['', '输出为 extracted.json、extracted.csv；可通过 extract.py 重复运行。运行前后 SHA-256 一致，确认输入未变。', f'输入 SHA-256：`{before}`。', '']
    Path('report.md').write_text('\n'.join(lines), encoding='utf-8')
    assert json.loads(Path('extracted.json').read_text(encoding='utf-8')) == rows
    with Path('extracted.csv').open(encoding='utf-8', newline='') as handle:
        exported = list(csv.DictReader(handle))
    assert len(exported) == len(rows)
    for actual, expected in zip(exported, rows):
        assert actual == {key: '' if value is None else str(value) for key, value in expected.items()}
    print(f'Extracted and verified {len(rows)} projects from {page_count} pages; input unchanged.')


if __name__ == '__main__':
    main()
