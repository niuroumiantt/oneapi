from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from pathlib import Path
import json
base=Path(__file__).parent
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
c=canvas.Canvas(str(base/'fixture.pdf'),pagesize=A4)
rows=[('海港照明改造','2026-11-01','128000.50','P-001'),('图书馆网络升级','2026-11-08','45600.00','P-002'),('社区展厅布置',None,'9800.00','P-003')]
for i,(name,date,budget,code) in enumerate(rows,1):
 c.setFillColorRGB(.11,.15,.25);c.setFont('STSong-Light',23);c.drawString(48,785,'项目资料  提取测试')
 c.setFont('STSong-Light',12);c.drawString(48,748,'人工构造样本，不含真实客户资料')
 c.setStrokeColorRGB(.85,.88,.92);c.line(48,730,547,730)
 c.setFont('STSong-Light',15)
 for y,label,value in [(680,'项目编号',code),(630,'项目名称',name),(580,'签订日期',date or '待确认'),(530,'项目预算（人民币元）',budget)]:
  c.drawString(48,y,label);c.drawString(265,y,value)
 c.setFont('STSong-Light',12);c.drawString(48,470,'要求：逐页提取名称、日期、预算，并保留来源页码。')
 c.drawString(48,445,'日期未提供时请保留未知，不得从文件名推测。')
 c.drawString(48,55,f'第 {i} 页 / 共 3 页');c.showPage()
c.save()
(base/'expected.json').write_text(json.dumps([{'name':n,'date':d,'budget':b,'page':i} for i,(n,d,b,_) in enumerate(rows,1)],ensure_ascii=False,indent=2))
print('fixture.pdf: 3 pages, expected.json saved')
