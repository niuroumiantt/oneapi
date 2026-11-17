from pathlib import Path
import subprocess,os,json,zipfile,shutil,re,hashlib,sys
from openpyxl import load_workbook,Workbook
base=Path(__file__).resolve().parent;root=Path(__import__('tempfile').mkdtemp(prefix='oneapi-recalc-regression-'));up=Path(os.environ['XLSX_SKILL_RECALC'])
env=dict(os.environ)
results={}
def run(name,file):
 before={i:zipfile.ZipFile(file).read(i) for i in zipfile.ZipFile(file).namelist()}
 p=subprocess.run([sys.executable,str(base/'recalc-local.py'),'--skill-script',str(up),'--timeout','20',str(file)],env=env,capture_output=True,text=True,timeout=25)
 r=json.loads(p.stdout);r['exit_code']=p.returncode
 after={i:zipfile.ZipFile(file).read(i) for i in zipfile.ZipFile(file).namelist()}
 changed=[i for i in before if before[i]!=after[i]]
 assert before.keys()==after.keys()
 assert all(re.fullmatch(r'xl/worksheets/sheet\d+.xml',i) for i in changed),changed
 r['changedParts']=changed;r['nonWorksheetPartsIdentical']=True
 results[name]=r
 return r
f=root/'fixed.xlsx';shutil.copy2(base/'output.xlsx',f);r=run('baseline',f);assert r['status']=='success' and r['total_formulas']==11 and r['total_errors']==0,r
w=load_workbook(f,data_only=True);actual=[w['汇总'][a].value for a in ['B4','B5','B6']];assert actual==[1516,2824,4340];results['baseline']['actual']=actual
original=load_workbook(base/'output.xlsx');fixed=load_workbook(f)
assert [(s.title,c.coordinate,c.value) for s in original for row in s for c in row if c.data_type=='f']==[(s.title,c.coordinate,c.value) for s in fixed for row in s for c in row if c.data_type=='f']
results['baseline']['formulaTextsIdentical']=True
# Keep stale caches intact while changing the price directly in the zip.
m=root/'fixed-mutation.xlsx'
with zipfile.ZipFile(f) as a,zipfile.ZipFile(m,'w') as b:
 for item in a.infolist():
  data=a.read(item)
  if item.filename=='xl/worksheets/sheet2.xml':
   data,n=re.subn(rb'(<c r="E2"[^>]*><v>)68(</v></c>)',rb'\g<1>70\2',data);assert n==1
  b.writestr(item,data)
r=run('staleCacheMutation',m);assert r['status']=='success',r
w=load_workbook(m,data_only=True);actual=[w['汇总'][a].value for a in ['B4','B5','B6']];assert actual==[1540,2824,4364];results['staleCacheMutation']['actual']=actual
r=run('repeat',f);assert r['status']=='success' and not r['changedParts'],r
err=root/'formula-error.xlsx';w=Workbook();w.active['A1']='=1/0';w.save(err);r=run('divisionByZero',err);assert r['status']=='errors_found' and r['total_errors']==1 and r['exit_code']==1,r
# Forced short timeout fails without changing the workbook.
fake=root/'fake-bin';fake.mkdir(exist_ok=True);cmd=fake/'soffice';cmd.write_text('#!/bin/sh\nsleep 10\n');cmd.chmod(0o755)
failure=root/'timeout.xlsx';shutil.copy2(base/'output.xlsx',failure);old=failure.read_bytes()
env2=dict(env,PATH=str(fake)+':'+env['PATH']);p=subprocess.run([sys.executable,str(base/'recalc-local.py'),'--skill-script',str(up),'--timeout','1',str(failure)],env=env2,capture_output=True,text=True,timeout=5)
r=json.loads(p.stdout);assert 'error' in r and failure.read_bytes()==old and p.returncode==1;results['timeoutDoesNotModifyInput']=r
(root/'recalc-fixed-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(results,ensure_ascii=False,indent=2))
