"""One-page newcomer flyer. Run with ReportLab; uses embedded CJK fonts."""
from pathlib import Path
import argparse
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--out',default=str(ROOT/'output/pdf/semifly-personal-start-guide.pdf'));args=p.parse_args()
out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('CJK','/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
pdfmetrics.registerFont(TTFont('CJK-Bold','/System/Library/Fonts/STHeiti Medium.ttc',subfontIndex=0))
W,H=595.276,841.89
c=canvas.Canvas(str(out),pagesize=(W,H));c.setTitle('semifly 个人工作台 · 新人一页指南');c.setAuthor('semifly.ai')
navy='#20263D';muted='#536178';red='#DB392D';blue='#356FBE';line='#DDE3EB'
def text(x,y,s,size=11,color=navy,bold=False):
 c.setFillColor(HexColor(color));c.setFont('CJK-Bold' if bold else 'CJK',size);c.drawString(x,H-y,s)
def rule(x,y,width):
 c.setStrokeColor(HexColor(line));c.setLineWidth(.6);c.line(x,H-y,x+width,H-y)
def lines(x,y,items,size=11,color=muted,leading=18):
 for i,s in enumerate(items):text(x,y+i*leading,s,size,color)
def link(x,y,label,url):
 text(x,y,label,10,blue);c.linkURL(url,(x,H-y-3,x+pdfmetrics.stringWidth(label,'CJK',10),H-y+12),relative=0)
c.drawImage(str(ROOT/'web/semifly-email-logo.png'),36,H-65,width=150,height=35,preserveAspectRatio=True,mask='auto',anchor='sw')
qr=QrCodeWidget('https://semifly.cn/#register');d=Drawing(58,58,transform=[58/qr.getBounds()[2],0,0,58/qr.getBounds()[3],0,0]);d.add(qr);renderPDF.draw(d,c,501,H-81)
text(489,95,'扫码开始 · semifly.cn',8.5,muted)
text(36,116,'从注册，到第一次调用',27,navy,True)
text(36,143,'个人工作台 · 新人一页指南',12,muted)
rule(36,164,523)
steps=[
 ('注册并登录',['手机号 + 验证码，或使用邮箱注册。','邮箱注册后先点验证邮件，再登录。','忘记密码？使用登录页的找回密码入口。']),
 ('充值，获得可用额度',['打开「充值与账单」，选择金额与付款方式。','核对实付金额和赠送额度，完成支付。','以页面显示充值成功、额度到账为准。']),
 ('挑选模型，选择 Key 类型',['先在「模型广场」了解模型，再加入「我的模型」。','单模型用专属 Key；多个模型可创建通用 Key。','通用 Key 默认包含开放模型，可先删除不需要的。']),
 ('生成 Key，配置你的工具',['设置消费上限，生成后复制并保存 Key。','按接入页指引，把 API 地址、Key 和模型 ID','填入工具；同一个通用 Key 可切换允许的模型。']),
 ('查看用量与花费',['「用量」按模型、Key 或每次调用查看 Token 与费用。','「API 密钥」看额度进度，调整上限或停用 Key。','「充值与账单」核对消费账单、充值记录及发票。']),
 ('不用了？核对后申请退款',['「充值与账单」→「退款」，选择一笔充值。','核对可退实付与收回的赠送额度，再提交申请。','在原页面查看进度；受限订单可通过「支持」处理。'])]
y=196
for i,(title,body) in enumerate(steps,1):
 text(36,y,f'{i:02}',12,red,True);text(64,y,title,14,navy,True)
 lines(64,y+23,body,size=10.5,leading=17)
 if i<6:rule(64,y+69,292)
 y+=88
# Compact money/key explanation alongside the actual journey.
c.setStrokeColor(HexColor(line));c.line(383,H-186,383,H-705)
text(402,199,'先看懂额度',13,navy,True)
text(402,224,'实付 + 赠送 = 到账额度',9.6,muted)
c.setFillColor(HexColor(blue));c.roundRect(402,H-248,99,8,4,fill=1,stroke=0)
c.setFillColor(HexColor(red));c.roundRect(503,H-248,56,8,4,fill=1,stroke=0)
text(402,268,'左蓝：赠送剩余',10,blue,True)
text(402,288,'右红：实付剩余',10,red,True)
lines(402,316,['先用实付，再用赠送。','赠送额度不能折现退款。'],10,leading=18)
rule(402,356,157)
text(402,380,'上限不是充值',13,navy,True)
lines(402,405,['Key 上限控制这把 Key','最多能花多少。调整上限','不会增加账户余额。'],10,leading=18)
lines(402,469,['在可分配额度内调整；','不能低于这把 Key 的','已用额度。'],10,leading=18)
rule(402,525,157)
text(402,550,'退款看「可退金额」',12,navy,True)
lines(402,576,['符合条件的未消费实付','可退款，无手续费；','收回对应赠送额度。'],10,leading=18)
lines(402,642,['VIP 激活款、已开票及','约定不可退部分，','请提交工单核对。'],10,leading=18)
rule(36,731,523)
text(36,755,'还有这些入口',12,navy,True)
link(36,779,'支持：遇到问题，提交工单','https://semifly.cn/#support')
link(295,779,'API 对比：比较回答、速度与费用','https://semifly.cn/#personal/compare')
link(36,799,'去申请 VIP：了解计划与申请流程','https://semifly.cn/#personal/vip')
text(295,799,'API 对比需可用额度，两侧分别计费。',9,muted)
text(36,823,'2026.11 · 以账户实时额度、可用模型及订单条款为准。',8,muted)
c.showPage();c.save();print(out)
