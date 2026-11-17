import csv, hashlib, json
from pathlib import Path
from datetime import datetime
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.comments import Comment
from openpyxl.worksheet.pagebreak import Break

ROOT = Path(__file__).resolve().parent
source = ROOT / 'input.csv'
before = hashlib.sha256(source.read_bytes()).hexdigest()
with source.open(encoding='utf-8-sig', newline='') as f:
    rows = list(csv.DictReader(f))
wb = Workbook()
summary = wb.active
summary.title = '汇总'
detail = wb.create_sheet('明细')
dup = wb.create_sheet('重复记录')
headers = ['id','date','category','quantity','unit_price','amount']
for ws in (detail, dup):
    ws.append(headers)
    ws.freeze_panes = 'A2'
    for col, width in {'A':14,'B':16,'C':14,'D':13,'E':16,'F':18,'G':3,'H':43}.items():
        ws.column_dimensions[col].width = width
seen = {}
expected = {'2026-09':0, '2026-10':0}
for source_line, row in enumerate(rows, 2):
    duplicate = row['id'] in seen
    ws = dup if duplicate else detail
    r = ws.max_row + 1
    quantity, price = float(row['quantity']), float(row['unit_price'])
    ws.append([row['id'], datetime.strptime(row['date'], '%Y-%m-%d'), row['category'], quantity, price, f'=D{r}*E{r}'])
    ws.cell(r,2).number_format = 'yyyy-mm-dd'
    for c in (5,6):
        ws.cell(r,c).number_format = '#,##0.00;[Red](#,##0.00)'
    ws.cell(r,1).comment = Comment(f'来源：用户提供的 input.csv，第 {source_line} 行。', 'Source')
    if duplicate:
        dup['H1'] = '记录原因'
        dup.cell(r,8,f'id 重复；保留源第 {seen[row["id"]]} 行，剔除源第 {source_line} 行')
    else:
        seen[row['id']] = source_line
        month = row['date'][:7]
        expected[month] = expected.get(month,0) + quantity * price
for ws in (detail,dup):
    ws.auto_filter.ref = f'A1:{"H" if ws == dup else "F"}{ws.max_row}'
summary['A1'] = '海风书店销售汇总'
summary['A3'] = '月份'
summary['B3'] = '净销售额（元）'
summary['A4'] = '2026-09'
summary['A5'] = '2026-10'
summary['A6'] = '合计'
n = detail.max_row
for r, month, following in [(4,'2026-09-01','2026-10-01'),(5,'2026-10-01','2026-11-01')]:
    start = datetime.strptime(month,'%Y-%m-%d')
    end = datetime.strptime(following,'%Y-%m-%d')
    summary.cell(r,2,f'=SUMIFS(\'明细\'!$F$2:$F${n},\'明细\'!$B$2:$B${n},">="&DATE({start.year},{start.month},1),\'明细\'!$B$2:$B${n},"<"&DATE({end.year},{end.month},1))')
    summary.cell(r,2).comment = Comment('按用户指定月份汇总明细日期；金额包含负数退货，按 id 首条去重。来源：input.csv。', 'Source')
summary['B6'] = '=SUM(B4:B5)'
for r in (4,5,6):
    summary.cell(r,2).number_format = '#,##0.00;[Red](#,##0.00)'
summary.column_dimensions['A'].width = 21
summary.column_dimensions['B'].width = 24
summary.column_dimensions['C'].width = 4
for c in 'DEFGHIJKLM': summary.column_dimensions[c].width = 10
chart = BarChart()
chart.type = 'col'
chart.title = '月度净销售额'
chart.y_axis.title = '净销售额（元）'
chart.x_axis.title = '月份'
chart.add_data(Reference(summary,min_col=2,min_row=3,max_row=5),titles_from_data=True)
chart.set_categories(Reference(summary,min_col=1,min_row=4,max_row=5))
chart.width, chart.height = 17, 10
chart.roundedCorners = False
for obj in (chart.legend,chart.title,chart.x_axis.title,chart.y_axis.title):
    if obj is not None: obj.overlay = False
chart.x_axis.delete = chart.y_axis.delete = False
summary.add_chart(chart,'D3')
for ws in wb:
    for row in ws:
        for cell in row:
            cell.font = Font(name='Arial',size=11,color='000000')
            cell.alignment = Alignment(vertical='center')
    header_row = 3 if ws == summary else 1
    for cell in ws[header_row]:
        if cell.value:
            cell.fill = PatternFill('solid',fgColor='17365D')
            cell.font = Font(name='Arial',size=11,bold=True,color='FFFFFF')
    ws.row_dimensions[header_row].height = 26
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = ws.page_setup.fitToHeight = 1
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.25
    ws.page_margins.top = ws.page_margins.bottom = 0.4
    ws.print_area = 'A1:M24' if ws == summary else f'A1:{"H" if ws == dup else "F"}{ws.max_row}'
    ws.print_title_rows = '3:3' if ws == summary else '1:1'
summary['A1'].font = Font(name='Arial',size=19,bold=True,color='17365D')
summary.row_dimensions[1].height = 32
wb.save(ROOT / 'output.xlsx')
assert hashlib.sha256(source.read_bytes()).hexdigest() == before
(ROOT / 'build-info.json').write_text(json.dumps({'input_sha256':before,'source_records':len(rows),'detail_records':len(seen),'duplicate_records':len(rows)-len(seen),'independent_month_totals':expected},ensure_ascii=False,indent=2),encoding='utf-8')
print('Created output.xlsx:',len(seen),'detail records;',len(rows)-len(seen),'duplicate record')
