# PDF 项目提取报告

输入仅为 `fixture.pdf`；未读取 make_fixture.py 或 expected.json，未修改原 PDF。

使用 pdfplumber 0.11.9 逐页提取文本，以字段标签定位项目名称、签订日期和人民币元预算；使用 pypdf 6.21.4 独立核对 PDF 页数。无需 OCR。
预算使用 Python Decimal 解析并输出十进制字符串，避免浮点误差。日期“待确认”转为 JSON null；CSV 对应为空字段。page 保留原始 1 起始页码。

实际读取 3 页，提取 3 个项目，日期未知 1 个；预算合计 183400.50 元。

| 名称 | 日期 | 预算（元） | 原页码 |
| --- | --- | --- | --- |
| 海港照明改造 | 2026-11-01 | 128000.50 | 1 |
| 图书馆网络升级 | 2026-11-08 | 45600.00 | 2 |
| 社区展厅布置 | 未知 | 9800.00 | 3 |

输出为 extracted.json、extracted.csv；可通过 extract.py 重复运行。运行前后 SHA-256 一致，确认输入未变。
输入 SHA-256：`e5fd3affe0e9935babb8d87fdf8f17cdc09ec69a0ce14920f9c0127186d4a7f6`。
