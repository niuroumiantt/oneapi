"""Real acceptance test; never substitutes GIFBuilder or installs dependencies."""
import os
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
import sys
sys.dont_write_bytecode = True
import json, math, traceback, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKILL = ROOT / '.agents/skills/slack-gif-creator'
sys.path.insert(0, str(SKILL))
report = {
    'python': sys.executable,
    'requested': {'dimensions': [128,128], 'frames':20, 'fps':10,
                  'duration_ms':2000, 'colors':48, 'background':'light cream', 'loop':0},
    'skill_sources_sha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [SKILL/'SKILL.md', SKILL/'core/gif_builder.py', SKILL/'core/validators.py']},
    'workarounds': [], 'status':'started',
    'limitations': ['Upstream validator checks dimensions for pass/fail; it does not enforce palette, duration, file size or seamless motion.'],
}

def draw_frame(i):
    from PIL import Image, ImageDraw
    s=4
    im=Image.new('RGB',(128*s,128*s),(255,247,230))
    d=ImageDraw.Draw(im)
    ink=(91,49,29); orange=(241,147,48); light=(255,204,120)
    def box(b): return tuple(round(v*s) for v in b)
    def oval(b, fill, outline=ink, width=2): d.ellipse(box(b),fill=fill,outline=outline,width=width*s)
    def line(p,fill=ink,width=2): d.line([(round(x*s),round(y*s)) for x,y in p],fill=fill,width=width*s,joint='curve')
    def poly(p,fill): d.polygon([(round(x*s),round(y*s)) for x,y in p], fill=fill,outline=ink,width=2*s)
    t=2*math.pi*i/20
    oval((28,115,104,121),(232,215,188),None)
    # Curled tail behind the body.
    d.arc(box((74,78,112,116)),230,560,fill=ink,width=13*s)
    d.arc(box((74,78,112,116)),230,560,fill=orange,width=9*s)
    oval((36,69,86,117),orange)
    oval((47,82,76,114),light,None)
    oval((34,107,57,120),orange); oval((68,107,90,120),orange)
    # Raised arm and paw follow a periodic angle, with no duplicated endpoint.
    a=math.radians(-77+24*math.sin(t))
    elbow=(87,88); paw=(elbow[0]+27*math.cos(a),elbow[1]+27*math.sin(a))
    line([(77,93),elbow,paw],ink,15)
    line([(77,93),elbow,paw],orange,11)
    oval((paw[0]-8,paw[1]-9,paw[0]+8,paw[1]+9),orange)
    oval((paw[0]-3,paw[1]-1,paw[0]+3,paw[1]+4),(226,119,103),None)
    for dx in (-4,0,4): oval((paw[0]+dx-1.3,paw[1]-5,paw[0]+dx+1.3,paw[1]-2),(226,119,103),None)
    # Ears and broad smiling face.
    poly([(32,49),(29,20),(52,33)],orange)
    poly([(68,33),(88,20),(88,51)],orange)
    poly([(35,39),(34,28),(46,35)],(242,173,146))
    poly([(75,35),(84,28),(83,41)],(242,173,146))
    oval((27,31,94,83),orange)
    oval((39,57,82,79),light,None)
    for x in (48,73):
        d.arc(box((x-6,48,x+5,59)),190,350,fill=ink,width=3*s)
    poly([(56,61),(65,61),(60.5,66)],(166,79,63))
    line([(60.5,65),(60.5,69),(56,72),(52,70)])
    line([(60.5,69),(65,72),(69,70)])
    for x,y in [(48,39),(59,37),(70,39)]: line([(x,y),(x+1,y+7)],(191,99,35),3)
    for side in (-1,1):
        for dy in (-3,3): line([(60+side*20,65+dy),(60+side*31,63+dy)])
    return im.resize((128,128),Image.Resampling.LANCZOS)

try:
    # This import executes the installed helper's real dependency import.
    from core.gif_builder import GIFBuilder
    from core.validators import validate_gif, is_slack_ready
    import numpy as np
    from PIL import Image
    builder=GIFBuilder(width=128,height=128,fps=10)
    for i in range(20): builder.add_frame(draw_frame(i))
    # Disable optional frame reduction to retain the requested exact frame count.
    report['builder_options']={'num_colors':48,'optimize_for_emoji':False,'remove_duplicates':False}
    report['builder_result']=builder.save(ROOT/'cat-wave.gif',**report['builder_options'])
    passed, details=validate_gif(ROOT/'cat-wave.gif',is_emoji=True,verbose=True)
    report['skill_validation']={'passes':passed,'details':details,
        'is_slack_ready':is_slack_ready(ROOT/'cat-wave.gif',is_emoji=True,verbose=False)}
    durations=[]; sizes=[]; colors=[]; arrays=[]
    with Image.open(ROOT/'cat-wave.gif') as gif:
        loop=gif.info.get('loop')
        for i in range(gif.n_frames):
            gif.seek(i)
            durations.append(gif.info.get('duration'))
            sizes.append(list(gif.size))
            rgb=gif.convert('RGB')
            colors.append(len(rgb.getcolors(128*128)))
            arrays.append(np.array(rgb))
    all_colors=len(np.unique(np.concatenate([a.reshape(-1,3) for a in arrays]),axis=0))
    diffs=[float(np.abs(arrays[(i+1)%len(arrays)].astype(float)-arrays[i]).mean()) for i in range(len(arrays))]
    report['independent_pillow']={'actual_frames':len(arrays),'duration_per_frame_ms':durations,
        'total_duration_ms':sum(durations),'dimensions_per_frame':sizes,
        'bytes':(ROOT/'cat-wave.gif').stat().st_size,'loop':loop,
        'colors_per_frame':colors,'unique_colors_across_animation':all_colors,
        'cyclic_adjacent_mean_absolute_pixel_difference':diffs}
    report['motion']={'method':'Periodic sine, t=2*pi*i/20, excluding duplicate endpoint',
        'period_endpoint_matches_start':np.array_equal(np.array(draw_frame(0)),np.array(draw_frame(20)))}
    checks={'frames':len(arrays)==20,'durations':durations==[100]*20,
        'dimensions':all(x==[128,128] for x in sizes),'loop':loop==0,
        'palette_limit':all_colors<=48,'skill_validator':passed,
        'periodic_motion':report['motion']['period_endpoint_matches_start']}
    report['acceptance_checks']=checks
    report['status']='passed' if all(checks.values()) else 'failed'
except Exception as e:
    report['status']='blocked'
    report['original_error']={'type':type(e).__name__,'message':str(e),'traceback':traceback.format_exc()}
    report['limitations'].append('No substitute renderer used; GIF generation and validation could not execute because the actual installed helper failed to import.')
finally:
    (ROOT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'original_error':report.get('original_error',{}).get('message')},ensure_ascii=False))
    if report['status']!='passed': sys.exit(1)
