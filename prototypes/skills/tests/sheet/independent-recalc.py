import os,subprocess,json
from pathlib import Path
from openpyxl import load_workbook
r=Path('/private/tmp/oneapi-office-tests-20261117'); s=r/'sheet'
so='/Users/m5/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice'
env=dict(os.environ,FONTCONFIG_FILE=str(r/'fonts.conf'))
for label,mutate in [('recalculated',False),('mutation',True)]:
 d=s/label; d.mkdir(exist_ok=True)
 source=s/'output.xlsx'
 if mutate:
  w=load_workbook(source);w['明细']['E2']=70;source=s/'mutation-input.xlsx';w.save(source)
 p=subprocess.run([so,f'-env:UserInstallation=file://{d}/profile','--headless','--convert-to','xlsx','--outdir',str(d),str(source)],env=env,capture_output=True,text=True,timeout=60)
 (d/'conversion.log').write_text(p.stdout+p.stderr)
 out=d/source.name;w=load_workbook(out,data_only=True)
 got=[w['汇总'][x].value for x in ['B4','B5','B6']];expected=[1540,2824,4364] if mutate else [1516,2824,4340]
 assert got==expected,(got,expected)
 (d/'check.json').write_text(json.dumps({'actual':got,'expected':expected,'passed':got==expected,'method':'Independent LibreOffice direct conversion, not upstream recalc.py'},ensure_ascii=False,indent=2))
p=subprocess.run([so,f'-env:UserInstallation=file://{s}/render-profile','--headless','--convert-to','pdf','--outdir',str(s),str(s/'output.xlsx')],env=env,capture_output=True,text=True,timeout=60)
(s/'font-recovery.log').write_text(p.stdout+p.stderr)
subprocess.run(['pdftoppm','-scale-to','1500','-jpeg',str(s/'output.pdf'),str(s/'page')],check=True)
print('PASS baseline and changed-price formula recalculation; rendered three sheets')
