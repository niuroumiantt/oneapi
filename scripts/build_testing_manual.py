# Builds server/private/testing-manual.html, the illustrated manual for every test in 技术后台. Needs Python 3.12+: python3.12 scripts/build_testing_manual.py
import html, pathlib
E = html.escape
OUT = pathlib.Path(__file__).resolve().parent.parent / 'server/private/testing-manual.html'

# ---------- SVG helpers ----------
PAL = {'ours': ('#f4f0fb', '#7740b6'), 'off': ('#eaf6f0', '#17a673'), 'gray': ('#f3f4f8', '#8a92a3'), 'warn': ('#fff4df', '#c98200'), 'bad': ('#fdecea', '#c23a2b'), 'ink': ('#ffffff', '#3a4152')}
def _w(t, px): return sum(px if ord(c) > 0x2e7f else px * 0.56 for c in t)
def wrap(text, width, px):
    out = []
    for para in text.split('\n'):
        line = ''
        for ch in para:
            if _w(line + ch, px) > width and line:
                out.append(line); line = ch.lstrip()
            else: line += ch
        out.append(line)
    return out
TP, SP_ = 16, 13
def box(x, y, w, h, title, sub='', kind='ink', r=10):
    fill, stroke = PAL[kind]
    t = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>'
    tl = wrap(title, w - 14, TP) if title else []
    sl = wrap(sub, w - 14, SP_) if sub else []
    total = len(tl) * 20 + len(sl) * 16 + (4 if tl and sl else 0)
    cy = y + (h - total) / 2 + 15
    for line in tl:
        t += f'<text x="{x + w / 2}" y="{cy}" text-anchor="middle" class="bt">{E(line)}</text>'; cy += 20
    cy += 2 if tl and sl else 0
    for line in sl:
        t += f'<text x="{x + w / 2}" y="{cy - 2}" text-anchor="middle" class="bs">{E(line)}</text>'; cy += 16
    return t
def arrow(x1, y1, x2, y2, label='', color='#8a92a3', dash=False, ly=-6):
    d = ' stroke-dasharray="5 4"' if dash else ''
    t = f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.6" marker-end="url(#ah)"{d}/>'
    if label:
        t += f'<text x="{(x1 + x2) / 2}" y="{(y1 + y2) / 2 + ly}" text-anchor="middle" class="al">{E(label)}</text>'
    return t
def path(d, color='#8a92a3', dash=False):
    dd = ' stroke-dasharray="5 4"' if dash else ''
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6" marker-end="url(#ah)"{dd}/>'
def note(x, y, text, cls='nt', anchor='start'):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" class="{cls}">{E(text)}</text>'
def svg(w, h, body, caption=''):
    defs = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8a92a3"/></marker></defs>'
    cap = f'<figcaption>{caption}</figcaption>' if caption else ''
    return f'<figure class="fig"><svg viewBox="0 0 {w} {h}" role="img">{defs}{body}</svg>{cap}</figure>'

def two_paths(start, start_sub, judge, judge_sub, outcomes, ours_chain=('semifly 网关', 'KerAPI', '模型'), official='模型官方 API', caption='', extra_top=''):
    """The pattern most tests share: one request, two paths, one judgement."""
    b = box(10, 75, 150, 110, start, start_sub, 'gray')
    b += box(250, 20, 300, 56, official, '尺子：官方能做到什么', 'off')
    chain_items = [n for n in ours_chain if n]
    subs = {'semifly 网关': '和员工完全一样', 'KerAPI': '上游供应商'}
    x = 220; right = 220
    for i, n in enumerate(chain_items):
        w = 120 if i == 0 else 110
        if len(chain_items) == 1: w = 370
        b += box(x, 180, w, 56, n, subs.get(n, ''), 'ours')
        if i: b += arrow(right, 208, x - 2, 208)
        right = x + w; x = right + 20
    b += path('M160 120 C 200 120, 200 48, 248 48', '#17a673')
    b += path('M160 140 C 190 140, 190 208, 218 208', '#7740b6')
    b += box(640, 75, 160, 110, judge, judge_sub, 'ink')
    b += path('M552 48 C 600 48, 600 120, 638 120', '#17a673')
    b += path(f'M{right} 208 C 615 208, 615 142, 638 142', '#7740b6')
    y = 30
    for label, kind in outcomes:
        fill, stroke = PAL[kind]
        b += f'<rect x="820" y="{y}" width="150" height="30" rx="15" fill="{fill}" stroke="{stroke}"/><text x="895" y="{y + 20}" text-anchor="middle" class="bs" style="fill:{stroke};font-weight:700">{E(label)}</text>'
        y += 40
    b += path('M800 130 L 816 130', '#8a92a3')
    b += note(130, 270, '上路：官方直连（绿色）    下路：我们的线路，员工实际走的路（紫色）', 'nt')
    b += extra_top
    return svg(990, 285, b, caption)

def chain(items, caption='', w=990, h=150, y=20, bw=None, gap=26, kinds=None, labels=None, sub_h=110):
    n = len(items); bw = bw or int((w - 20 - gap * (n - 1)) / n)
    b = ''
    for i, it in enumerate(items):
        t, s = it if isinstance(it, tuple) else (it, '')
        x = 10 + i * (bw + gap)
        b += box(x, y, bw, sub_h, t, s, (kinds or ['ink'] * n)[i])
        if i: b += arrow(x - gap, y + sub_h / 2, x - 2, y + sub_h / 2, (labels or [''] * n)[i])
    return svg(w, h, b, caption)

# ---------- page parts ----------
sections = []
def section(id_, num, title, question, body):
    sections.append((id_, num, title, question, body))

def steps(*xs): return '<ol class="steps">' + ''.join(f'<li>{x}</li>' for x in xs) + '</ol>'
def bullets(*xs): return '<ul>' + ''.join(f'<li>{x}</li>' for x in xs) + '</ul>'
def table(head, rows, cls=''):
    return f'<table class="t {cls}"><thead><tr>' + ''.join(f'<th>{h}</th>' for h in head) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows) + '</tbody></table>'
def card(title, body, kind=''): return f'<div class="card {kind}"><h4>{title}</h4>{body}</div>'
def h(t): return f'<h3>{t}</h3>'
def tip(t, kind='tip'): return f'<div class="{kind}">{t}</div>'
def mock(inner, caption): return f'<figure class="mock"><div class="mock-ui">{inner}</div><figcaption>界面示意 · {caption}</figcaption></figure>'
def pill(t, k): return f'<span class="pill {k}">{t}</span>'

# ===== 0. 总览 =====
overview_map = svg(1100, 330,
    box(10, 120, 130, 74, '员工的工具', 'Agent / SDK / Cursor', 'gray')
    + box(200, 120, 160, 74, 'semifly 网关', '校验 · 换算 · 计量', 'ours')
    + box(420, 120, 130, 74, 'KerAPI', '上游供应商', 'ours')
    + box(610, 120, 120, 74, '模型', '', 'ours')
    + arrow(140, 157, 198, 157) + arrow(360, 157, 418, 157) + arrow(550, 157, 608, 157)
    + box(420, 10, 310, 64, '模型官方 API（评测 Key）', '只用于测试，是所有对比的尺子', 'off')
    + path('M670 74 L 670 117', '#17a673', True)
    + box(780, 10, 310, 310, '', '', 'gray')
    + note(935, 40, '五个问题', 'bt', 'middle')
    + ''.join(note(798, 76 + i * 52, t, 'q') for i, t in enumerate(['① 通不通？', '② 功能对不对？', '③ 质量好不好、是不是真模型？', '④ 扛不扛得住？', '⑤ 账算得对不对？']))
    + ''.join(note(798, 96 + i * 52, t, 'bs2') for i, t in enumerate(['Key 检测 · 巡检 · 主备切换', '功能对比 · Agent 检测 · 兼容性矩阵', '任务验收 · 身份检测 · 型号对比', '压测', '逐笔交易 · 计量核账']))
    + note(10, 236, '① Key 检测、巡检：查网关 → KerAPI → 模型这一段通不通', 'nt')
    + note(10, 260, '②③ 对比类测试：同一请求发两路，官方当尺子', 'nt')
    + note(10, 284, '④ 压测：在这条路上一档一档加并发', 'nt')
    + note(10, 308, '⑤ 计量核账：我们记的账 ↔ KerAPI 扣的钱', 'nt'),
    '图 0-1 · 员工的请求走的路，以及每类测试检查哪一段')

rhythm = table(['什么时候', '做什么', '在哪里'], [
    ['<b>一直在跑，不用操作</b>', 'Key 巡检（每 30 分钟）、上游日志对账（每 5 分钟）。有问题会发邮件。', '运行观测、计量核账'],
    ['<b>每周一次</b>', '功能对比（常用项，约 1 分钟）；身份检测，<b>高峰和低谷各一次</b>', '验收测试 → 功能对比；对比评测 → 身份检测'],
    ['<b>新模型 / 新供应商上线前</b>', '采购 Key 检测 → 任务验收 → 功能对比（全选）→ 身份检测（含小测）→ 型号对比 → 压测 → 发布', '按这个顺序，一步过了再做下一步'],
    ['<b>员工常用的 Agent 升级后</b>', 'Agent 检测重新回放；兼容性矩阵点“回放全部”', '验收测试 → Agent 检测 / 兼容性矩阵'],
    ['<b>每月</b>', '计量核账看“有差异”和“证据不全”，和供应商账单总额对一下', '计量核账'],
    ['<b>收到告警或员工报错</b>', '先看运行观测的事件；确认是上游问题，就在路由与熔断里暂停这个模型', '运行观测 → 路由与熔断'],
])
section('overview', '0', '先看全局', '这些测试一起回答什么问题？', overview_map + f'''
<p>员工的请求要经过三段：<b>员工的工具 → 我们的网关 → 上游供应商 KerAPI → 模型</b>。任何一段出问题，员工都会遇到。所以每个测试只盯一个问题，合起来覆盖整条路。</p>
{h('所有对比测试共用一个思路：拿官方当尺子')}
<p>同一个请求、同样的参数，一份<b>直接发给模型官方</b>（DeepSeek 官方、智谱官方），一份<b>走我们的 API</b>（和员工拿到的完全一样）。官方能做到的，我们也要做到；官方自己做不到的，是模型本身的边界，不算我们的问题。</p>
{h('推荐的节奏')}{rhythm}
{tip('<b>花钱有上限，失败不自动重试。</b>每个测试开始前都会弹窗告诉你大约要调用多少次。测试题都是极短的人造题，不含员工的数据。')}''')

# ===== 1. 评测 Key =====
section('evalkeys', '1', '评测 Key', '拿什么当尺子？', chain([('官方控制台', '你在 DeepSeek / 智谱\n官网申请 API Key'), ('评测 Key 页', '粘贴保存\n加密存储'), ('自动查询', '这把 Key 能用\n哪些型号'), ('每个型号', '登记成“参照端点”'), ('只给测试用', '员工请求永远\n不会走到这里')], '图 1-1 · 官方 Key 从保存到被测试使用', kinds=['gray', 'off', 'off', 'off', 'ok' if False else 'gray']) + f'''
<p><b>是什么：</b>各厂商官方的 API Key。只用来做对比和检测，是所有“官方 vs 我们”测试的尺子。</p>
{h('怎么操作')}{steps('打开 <b>验收测试 → 评测 Key</b>。', '选厂商（DeepSeek 官方 / 智谱 GLM 国内 / Z.ai 国际），粘贴 Key，保存。', '系统会向厂商查询这把 Key 能用哪些型号，并自动登记好。')}
{h('需要知道的规则')}{bullets('每家厂商只保留一把有效 Key；换新 Key 时旧的自动停用。', '它的类型是“参照”，路由只会选“供应商”类型，所以<b>员工的请求不可能用到官方 Key</b>。', '官方 Key 的余额和限流会影响测试。对比里官方那一列报“429 / 余额不足”，先给官方账户充值，不是我们的问题。')}''')

# ===== 2. 采购 Key 检测 =====
section('credentials', '2', '采购 Key 与 Key 检测', 'KerAPI 给我们的 Key 通不通？每个模型通不通？', chain([('保存并检测', '登记新 Key 时\n自动执行一次'), ('读 /models', '上游实际提供\n哪些型号'), ('每个型号发 1 Token', '三个并发\n最小请求'), ('结果', '绿点 = 通\n红点 = 原始报错'), ('附带检查', '重复 Key？\n不守输出上限？')], '图 2-1 · Key 检测做的事', kinds=['ours', 'ours', 'ours', 'gray', 'warn']) + f'''
<p><b>在哪里：</b>上游接入 → 采购 Key。每家供应商有一把<b>主用</b> Key 和若干<b>备用</b> Key；主用失败时，员工请求自动改用备用。</p>
{h('怎么操作')}{steps('选供应商，填名称、API Key、接口地址，点 <b>保存并检测</b>。', '看每个型号的点：绿色能用，红色会显示供应商的原始报错。型号按延迟从快到慢排。', '想随时复查，在“运行观测”或上游页点 <b>立即检查</b>（和每 30 分钟的自动巡检是同一件事）。')}
{h('看到这些提示时')}{table(['提示', '意思', '怎么办'], [
    ['备用 Key 和主用是同一把', '两把 Key 的指纹一样，其实是同一把，主用失效时无处可切', '在 KerAPI 后台<b>新建一把</b>真正不同的 Key 登记进来'],
    ['只有主用 Key', '主用失效时员工调用会中断', '再登记一把备用'],
    ['不遵守输出上限', '要求最多 1 个 Token，上游却返回了很多', '不用处理：网关已自动启用“输出保护”（见第 13 节）'],
    ['红点 401 / 403', 'Key 无效、过期或没开通这个型号', '去 KerAPI 后台检查 Key 和型号权限'],
])}''')

# ===== 3. 功能对比 =====
fc_mock = mock('''<table class="mt"><thead><tr><th>测试</th><th>DeepSeek Flash<small>对照 deepseek-v4-flash</small></th><th>GLM-5.3<small>对照 GLM-5.3</small></th></tr></thead><tbody>
<tr><td>工具调用</td><td><span class="cell same"><i class="p"></i><i class="p"></i>✓</span></td><td><span class="cell same"><i class="p"></i><i class="p"></i>✓</span></td></tr>
<tr><td>JSON Schema 约束</td><td><span class="cell extra"><i class="f"></i><i class="p"></i>＋</span></td><td><span class="cell same"><i class="p"></i><i class="p"></i>✓</span></td></tr>
<tr><td>图片输入</td><td><span class="cell neither"><i class="f"></i><i class="f"></i>—</span></td><td><span class="cell neither"><i class="f"></i><i class="f"></i>—</span></td></tr>
<tr><td>输出 ≥32K</td><td><span class="cell same"><i class="p"></i><i class="p"></i>✓</span></td><td><span class="cell gap"><i class="p"></i><i class="f"></i>✕</span></td></tr></tbody></table>
<div class="legend"><span><i class="p"></i>能用</span><span><i class="w"></i>部分能用</span><span><i class="f"></i>不能用</span><span>每格：<b>左色块 = 官方，右色块 = 我们</b></span></div>''', '功能对比表格（数据为示意）')
section('features', '3', '功能对比', '官方能做的功能，我们这条线路也能做吗？', two_paths('25 项功能探针', '每项只测一个功能\n答案短、可判定', '按规则判定', '返回了吗？JSON 能\n解析吗？调了工具吗？', [('✓ 一致', 'off'), ('＋ 我们更多', 'ours'), ('— 模型限制', 'gray'), ('✕ 差异（要修）', 'bad')], caption='图 3-1 · 功能对比：同一请求发两路，按规则判定，归入四种结论') + f'''
<p><b>为什么要测：</b>员工用的 Agent 依赖很多“功能”：工具调用、流式输出、JSON 输出、思考强度、长上下文……网关的限制或供应商对参数的改写，都可能让某个功能在我们这里失效。公网的<a href="https://oneapi.glocalstorage.cn/#realtesting">实测报告页</a>就来自这里。</p>
{h('25 项测试，8 类能力')}{table(['类别', '测试', '在测什么'], [
    ['基础', '基础对话、流式输出', '能正常回答；流式能逐字返回并正常结束'],
    ['工具调用', '工具调用、指定工具、工具结果回传、一次调用多个工具', 'Agent 的核心能力'],
    ['输入与格式', '图片输入、JSON 输出、JSON Schema、停止词', '多模态、结构化输出、stop 参数'],
    ['思考', '思考 低 / 中 / 高 / 超高、开启 / 关闭思考', '思考强度和开关是否生效'],
    ['输出长度', '输出 ≥8K、≥32K、截断标记', '长输出是否放行；超限时是否标记 length'],
    ['长上下文', '≥32K、≥128K', '约 3 万字 / 12 万字输入（费用较高，默认不勾）'],
    ['对话', '系统提示词、多轮记忆', '是否遵守 system；是否记得上一轮'],
    ['计费', '流式返回用量、缓存命中', '计费依赖的 usage 和缓存是否回报'],
])}
{h('怎么操作')}{steps('确认表头：第一行是我们卖给员工的产品，第二行是对照的官方型号（自动配好，一般不用改）。', '勾选要跑的测试（左侧勾选框，或“常用 / 全选”），点右上 <b>对比所选测试</b>。常用项约 1 分钟。', '跑完后点任意格子，右侧弹出两边的原始回答。')}
{h('怎么看结果')}{fc_mock}
{table(['符号', '意思', '要不要处理'], [
    [pill('✓ 一致', 'ok'), '官方能用，我们也能用', '不用'],
    [pill('＋ 更多', 'ours'), '官方报错或不支持，我们能用（网关替模型做了换算）', '不用，是加分项'],
    [pill('— 模型限制', 'gray'), '官方自己也不行，两边一样', '不用，是模型的边界'],
    [pill('✕ 差异', 'bad'), '官方能、我们不能', '<b>要修</b>。点格子看是“网关拒绝”还是 KerAPI 报错'],
])}
{tip('<b>结果不会自己变。</b>修好之后要重新对比一次，格子才会更新。结论不稳定的项（这次一致、下次差异）多跑两次再下结论。')}
{h('对外发布')}<p>对比跑完、没有差异后，点 <b>发布到实测报告</b>，公网页面只显示每项的结论和简短说明，不公开回答原文。</p>''')

# ===== 4. Agent 检测 =====
section('agents', '4', 'Agent 检测', '某个 Agent（如 WorkBuddy）真实发出的请求，我们接得住吗？', chain([('员工在 Agent 里\n用某个功能', '例如“读文件”'), ('录下请求结构', '参数、工具定义、\n消息条数（不录内容）'), ('不用 Agent\n直接回放', '发给我们每个产品\n和官方 API'), ('逐格判定', '✓ 能用 ! 部分 ✕ 不能'), ('官方 ✓ 我们 ✕', '= 我们的问题')], '图 4-1 · 录制—回放：先录 Agent 真实的请求格式，再脱离 Agent 重放', kinds=['gray', 'ours', 'ours', 'ink', 'bad']) + f'''
<p><b>为什么要测：</b>功能对比用的是标准请求，而真实的 Agent 会发出很特别的请求：几十个工具定义、超长系统提示词、少见的参数组合。只有拿它真实发出的请求来试，才知道员工用起来行不行。</p>
{h('怎么操作')}{steps('选 Agent 和版本（没有就新建）。', '<b>第一步 · 拿到请求（左边）：</b>已打勾的功能已经有了，来自员工真实调用或之前的录制。没打勾的，点 <b>开始录这项</b>，然后有人在 Agent 里用一次这个功能，录到后点停止。', '<b>第二步 · 回放（右边）：</b>每行是我们的一个产品。勾“试”走我们的线路，勾“对照”同时发给官方。点 <b>回放</b>。')}
{h('怎么看结果')}{bullets('✓ 能用、! 部分能用、✕ 不能用。', '同一行官方 ✓、我们 ✕ = <b>我们的问题，要修</b>。', '两边都 ✕ = 模型本身不支持，或这个 Agent 的设置本来就不对。', 'Agent 升级后版本号变了，要重新录、重新回放。')}''')

# ===== 5. 兼容性矩阵 =====
mx = mock('''<table class="mt"><thead><tr><th>工具 \\ 选项</th><th>默认</th><th>思考 高</th><th>JSON 输出</th><th>128K 上下文</th></tr></thead><tbody>
<tr><td>Cursor</td><td><span class="mx ok">✓</span></td><td><span class="mx ok">✓</span></td><td><span class="mx seen">见过 · 未回放</span></td><td><span class="mx bad">✕ 网关拒绝 3 次</span></td></tr>
<tr><td>WorkBuddy</td><td><span class="mx ok">✓</span></td><td><span class="mx ok">✓</span></td><td><span class="mx ok">✓</span></td><td><span class="mx none">没见过</span></td></tr></tbody></table>''', '每格 = 一个工具 × 一个选项')
section('matrix', '5', '兼容性矩阵', '哪个工具 × 哪个选项能用？', mx + f'''
<p><b>和 Agent 检测的区别：</b>矩阵的数据是<b>被动积累</b>的：员工每用一次某个工具，网关就自动记下这个工具的请求格式。Agent 检测是工作人员<b>主动</b>按功能去录。</p>
{h('怎么操作')}{steps('想让矩阵多出一个工具：在那个工具里填我们的地址和一把员工 Key，正常用一次。', '想多测一个选项（如思考强度“高”）：在工具里打开这个选项，再发一句话，矩阵里会多出一个“见过 · 未回放”的格子。', '回到这页，选模型，点 <b>用所选模型回放全部</b>，或点单条的 <b>只回放这条</b>。')}
{h('怎么看结果')}{bullets('绿色 ✓：回放成功。', '灰色“见过 · 未回放”：员工用过，还没测。', '红色角标“网关拒绝 N 次”：员工真实调用时就被我们的网关拒绝了，通常是参数超出上限，要改网关或在文档里提醒员工。')}''')

# ===== 6. 任务验收 =====
section('tests', '6', '任务验收', '新接入的型号，能不能正确答题、用量报得对不对？', chain([('选一个型号', '供应商 / Key /\nModel ID'), ('4 道固定题', '计算 · JSON ·\n翻译 · 上下文理解'), ('每题一笔真实调用', '最多 4 次付费调用\n不自动重试'), ('规则判对错', '例如 17×23\n必须等于 391'), ('同时检查', 'Token 自洽？型号名\n和请求的一致？')], '图 6-1 · 任务验收：上线前最便宜的一次体检', kinds=['ours', 'gray', 'ours', 'ink', 'warn']) + f'''
{table(['题目', '内容', '通过条件'], [['事实与计算', '17 × 23', '严格等于 391'], ['结构化 JSON', '输出 {{result:42, ok:true}}', '能解析且取值正确'], ['中文表达', '翻译 Hello, world!', '包含“你好”和“世界”'], ['上下文理解', '给两座城市的代号，问乙城', '严格等于“红星”']])}
{h('怎么操作')}{steps('打开 <b>验收测试 → 任务验收</b>，选待测型号，点 <b>启动真实测试</b>。', '页面上方出现“最近一批”进度框，每道题的输出、Token 和延迟实时显示。', '跑完后可以点 <b>导出核对 CSV</b>。')}
{h('看到这些标记时')}{table(['标记', '意思'], [['回报型号与请求不符', '请求的是 A，上游回报的是 B：可能被换了模型，要追问供应商'], ['Token 或缓存计数不自洽', '输入、缓存、输出的数字对不上，计费可能有问题'], ['输出达到上限', '答案被截断了，不能据此判断模型能力，先调大输出上限'], ['费率未知', '这个型号还没登记采购价，费用不会按 0 元算']])}''')

# ===== 7. 逐笔交易 =====
section('transactions', '7', '逐笔交易', '每一笔测试花了多少？能和供应商账单对上吗？', chain([('每次测试调用', '自动留一条记录'), ('记录内容', '时间 · Key · 型号 ·\nToken · 延迟 · 成本'), ('上游请求号', '对账的钥匙'), ('导出 CSV', '最多 1000 笔'), ('和 KerAPI 账单', '逐行核对')], '图 7-1 · 每笔测试都可以追溯到供应商账单', kinds=['gray', 'ink', 'warn', 'ink', 'ours']) + f'''
<p>这一页是所有测试调用的流水账。每行：时间和归属、验收结论、输入 / 缓存 / 输出 Token、延迟、预估采购成本、上游请求号。</p>
{bullets('推理（思考）Token 已经算在输出里，不重复相加。', '<b>没有上游请求号的记录，不能证明和供应商逐笔一致。</b>', '点某次任务后，这里只显示那一批；点“清除筛选”看全部。')}''')

# ===== 8. 身份检测 =====
tok_fig = svg(990, 270,
    box(10, 10, 280, 74, '同一段文字', '“网关把员工请求转发给上游……”', 'gray')
    + box(340, 8, 300, 34, '官方：38 个输入 Token', '', 'off')
    + box(340, 52, 300, 34, '我们：38 个 → 差值 0', '', 'ours')
    + path('M290 38 L 338 25', '#17a673') + path('M290 58 L 338 69', '#7740b6')
    + box(690, 10, 290, 74, '五段文字差值全是 0', '→ 同一个分词器、同一个模型家族', 'off') + arrow(640, 47, 688, 47)
    + note(10, 128, '三种可能的结果（五段文字各自的差值）', 'bt')
    + note(20, 166, '0, 0, 0, 0, 0', 'mono') + box(260, 144, 720, 34, '✓ 一致：同一个分词器', '', 'off')
    + note(20, 208, '+7, +7, +7, +7, +7', 'mono') + box(260, 186, 720, 34, '! 固定 +7：分词一致，但上游给每个请求加了看不见的内容（多计费）', '', 'warn')
    + note(20, 250, '0, +3, −2, +5, +9', 'mono') + box(260, 228, 720, 34, '✕ 忽大忽小：分词器不同 → 基本可以断定不是同一个模型', '', 'bad'),
    '图 8-2 · 分词指纹：最硬的一项证据。同一个模型对同一段文字算出的 Token 数必然一样')
bench_fig = svg(990, 200,
    ''.join(f'<rect x="{60 + i * 46}" y="{40 if i not in (3, 9, 14) else 40}" width="36" height="22" rx="5" fill="#eaf6f0" stroke="#17a673"/><text x="{78 + i * 46}" y="56" text-anchor="middle" class="bs" style="fill:#0f7a54">✓</text>' for i in range(20))
    + ''.join(f'<rect x="{60 + i * 46}" y="110" width="36" height="22" rx="5" fill="{"#fdecea" if i in (3, 9, 14, 17) else "#f4f0fb"}" stroke="{"#c23a2b" if i in (3, 9, 14, 17) else "#7740b6"}"/><text x="{78 + i * 46}" y="126" text-anchor="middle" class="bs" style="fill:{"#c23a2b" if i in (3, 9, 14, 17) else "#7740b6"}">{"✕" if i in (3, 9, 14, 17) else "✓"}</text>' for i in range(20))
    + note(10, 56, '官方', 'bt') + note(10, 126, '我们', 'bt')
    + note(60, 30, '20 道只有一个正确答案的题：计算、日期、进制、代码输出、逻辑排序……', 'nt')
    + note(60, 160, '官方 20/20，我们 16/20 → 少对 4 题（≥3 题且 ≥15%）→ ✕ 明显低于官方：可能是更小或量化过的模型', 'nt')
    + note(60, 182, '少对 2 题 → ! 需要关注，再测一次；少对 0～1 题 → ✓ 持平（小题本身有波动）', 'nt'),
    '图 8-3 · 能力小测：规则判分，只比两边都答完的题')
id_card = mock('''<div class="idc"><div class="idh"><div><b>GLM-5.3</b><small>对照官方 GLM-5.3 · 智谱官方</small></div><span class="pill warn">需要关注</span></div>
<dl><dt>① 分词指纹</dt><dd class="w">! 分词一致，但每次多/少固定 Token <b>+7</b></dd><dt>② 自报身份</dt><dd class="g">✓ 自称同一家</dd><dt>③ 输出相似</dt><dd class="g">✓ 和官方一样像 <span class="d">0.93 / 官方自己 0.93</span></dd><dt>④ 能力小测</dt><dd class="g">✓ 和官方持平 <span class="d">我们 19/20 · 官方 20/20</span></dd></dl>
<ul><li class="w">每个请求我们这一路都多 7 个输入 Token：分词一致，但上游可能在每个请求里加了看不见的内容（会多计费）</li></ul></div>''', '身份检测的型号卡片（数据为示意）')
section('identity', '8', '身份检测（新）', '供应商给的，真的是官方那个模型吗？是满血版吗？', two_paths('四项检测', '分词 · 自报身份 ·\n输出相似 · 能力小测', '综合判断', '任何一项硬证据\n不对就标“疑似”', [('正常', 'off'), ('需要关注', 'warn'), ('疑似不是同一个', 'bad')], caption='图 8-1 · 身份检测：和功能对比一样两路发送，但比的是“是不是同一个模型”') + f'''
<p><b>为什么要测：</b>中转行业最常见的问题是“挂羊头卖狗肉”：名字叫 GLM-5.3，背后其实是更便宜的模型，或者是量化、缩小过的版本。功能对比看不出来，因为便宜模型也能调工具、也能输出 JSON。身份检测专门回答“是不是同一个模型”。</p>
{h('四项检测分别看什么')}
<div class="grid2">{card('① 分词指纹 · 最可靠', '<p>5 段固定文字（中文、英文、代码、数字符号、生僻字和表情），两边各算输入 Token 数。不同模型家族的分词器不一样，同一段文字算出的数一定不同。</p>', 'off')}{card('② 自报身份 · 旁证', '<p>问“你是什么模型？哪家公司开发的？”，看是不是自称同一家；同时看响应里回报的型号名。模型偶尔会说错，所以只作旁证，但自称别家公司是很强的信号。</p>')}{card('③ 输出相似 · 参考', '<p>温度 0，三道开放题。先让官方答两次，看官方自己两次有多像（基准）；再看我们和官方有多像。我们明显低于基准，说明说话风格不一样。</p>')}{card('④ 能力小测 · 抓降级', '<p>20 道只有一个正确答案的题，规则判分。量化或缩小过的模型，在多位数计算、日期推算、代码输出这类题上更容易错。</p>', 'ours')}</div>
{tok_fig}{bench_fig}
{h('怎么操作')}{steps('打开 <b>对比评测 → 身份检测</b>。', '勾选检测项：<b>身份指纹</b>（每个型号 21 次调用，约 1 分钟，几分钱）；<b>能力小测</b>（每个型号 40 次调用，需要思考，约 5～15 分钟，几元钱）。', '点 <b>开始检测</b>，确认弹窗。检测中进度条实时更新，可以离开页面。', '跑完看每个型号的卡片，点卡片看明细：分词对照表、两边的自我介绍、相似度、每道题两边的答案。', '<b>高峰（工作日 9–18 点）和低谷各测一次</b>，在“历史”里比较。有的供应商会在高峰期悄悄切到便宜模型。')}
{h('怎么看结果')}{id_card}
{table(['结论', '什么情况下出现', '怎么办'], [
    [pill('正常', 'ok'), '分词一致，自称同一家，小测和官方持平', '不用处理'],
    [pill('需要关注', 'warn'), '分词固定多几个 Token；或小测少对 2 题；或回答风格和官方差得多；或思考长度差一倍以上', '换个时段再测一次；固定多 Token 要问供应商是否加了系统提示词（这部分我们会多付钱）'],
    [pill('疑似不是同一个', 'bad'), '分词差值忽大忽小；或自称别家公司；或小测明显低于官方', '截图明细发给供应商要求解释；必要时在“路由与熔断”暂停该模型'],
])}
{tip('<b>局限：</b>同一家公司的大小模型（如 GLM-5.3 和 GLM-5.3-Flash）可能共用一个分词器，分词指纹分不出来，要靠能力小测和型号对比。小测只有 20 道题，单次少对 1～2 题属于正常波动，所以要看多次的趋势。', 'warn-box')}''')

# ===== 9. 型号对比 =====
section('compare', '9', '型号对比', '供应商的回答质量，和官方一样好吗？', two_paths('12 道题', '计算 · 推理 · 代码 ·\n写作 · 长文检索…', '三种打分', '规则 · 评审模型盲评 ·\n人工盲评', [('供应商更好', 'ours'), ('持平', 'off'), ('官方更好', 'warn')], ours_chain=('供应商型号（KerAPI 直连，同题同参数）',), caption='图 9-1 · 型号对比：同题同参数，比回答质量') + f'''
<p><b>和身份检测的区别：</b>身份检测问“是不是同一个模型”，用的是短题和硬指标；型号对比问“回答好不好”，题目更开放（写 SQL、写客户说明、长文找信息），需要评审。</p>
{h('三种打分方式')}{table(['方式', '怎么做', '适合哪类题'], [
    ['规则自动判', '有确定答案的直接比对，如 549、JSON 字段', '计算、抽取、格式'],
    ['评审模型盲评', '第三个模型看两个回答，不知道哪个是官方；<b>A/B 位置换过来再评一次</b>，两次结论一致才算胜负', '写作、代码、摘要'],
    ['人工盲评', '工作人员看两个回答（来源隐藏），选更好的', '抽查评审模型是否靠谱'],
])}
{svg(990, 130, box(10, 30, 200, 60, '第一次', '回答 A = 官方\n回答 B = 供应商', 'gray') + box(250, 30, 200, 60, '第二次（换位）', '回答 A = 供应商\n回答 B = 官方', 'gray') + arrow(210, 60, 248, 60) + box(500, 30, 220, 60, '两次都选同一边', '→ 这一边胜', 'off') + box(760, 30, 220, 60, '两次选的不一样', '→ 评审拿不准，算平', 'warn') + arrow(450, 50, 498, 50) + arrow(450, 70, 758, 70), '图 9-2 · 盲评换位：消除评审模型偏爱“第一个回答”的倾向')}
{h('怎么操作')}{steps('先在“评测 Key”存好官方 Key。', '选供应商型号、对照的官方型号、评审模型、思考模式，可展开“看题目”。', '点开始，跑完后看每题的规则结果和评审结论；有空时做几题人工盲评。')}''')

# ===== 10. Agent 对比 =====
section('agentcmp', '10', 'Agent 对比', '同一个 Agent 做同一组任务，走我们和走官方，最后交付一样好吗？', chain([('新建对比', '选 Agent 和任务\n系统发两把测试 Key'), ('A 路', '测试 Key A → 我们的线路'), ('B 路', '官方 API（也经网关）\n或 Agent 自带模型'), ('按任务“布防”', '在 Agent 里做任务\n系统按任务归档调用'), ('评分', '评审模型换位盲评\n+ 人工盲投')], '图 10-1 · Agent 对比：看端到端的最终结果，不只看单个请求', kinds=['gray', 'ours', 'off', 'ink', 'ink']) + f'''
{bullets('测试 Key 以 <code>sf_eval_</code> 开头，由工作人员持有，<b>不扣员工额度</b>，保存完整对话，对比结束即作废。', 'B 路选“Agent 自带模型”时，我们看不到过程，需要把最终回答手动贴进来。', '除了胜负，还会统计每条路的调用次数、Token 和耗时：同样完成任务，哪边更省。')}''')

# ===== 11. 压测 =====
bars = [(1, 40, '100%'), (2, 44, '100%'), (4, 48, '100%'), (8, 60, '99%'), (12, 82, '98%'), (16, 150, '91%'), (24, 190, '停止')]
stress_fig = svg(1100, 310,
    '<line x1="60" y1="250" x2="730" y2="250" stroke="#c9cdd8"/><line x1="60" y1="20" x2="60" y2="250" stroke="#c9cdd8"/>'
    + ''.join(f'<rect x="{90 + i * 92}" y="{250 - v}" width="50" height="{v}" rx="4" fill="{"#eaf6f0" if i < 5 else "#fdecea"}" stroke="{"#17a673" if i < 5 else "#c23a2b"}"/><text x="{115 + i * 92}" y="270" text-anchor="middle" class="bs">{c} 并发</text><text x="{115 + i * 92}" y="{243 - v}" text-anchor="middle" class="bs">{t}</text>' for i, (c, v, t) in enumerate(bars))
    + '<line x1="530" y1="30" x2="530" y2="250" stroke="#7740b6" stroke-dasharray="5 4"/>' + note(522, 44, '稳定并发 = 12', 'bt', 'end')
    + box(760, 20, 330, 220, '', '', 'gray')
    + note(778, 50, '怎么读这张图', 'bt') + note(778, 80, '柱子高度 = 首字延迟 P95（越高越慢）', 'nt') + note(778, 106, '柱子上的数字 = 这一档的成功率', 'nt')
    + note(778, 138, '12 并发：成功率 98%，延迟还在范围内', 'nt') + note(778, 164, '16 并发：成功率 91% < 98% → 不稳定', 'nt') + note(778, 190, '24 并发：失败率 > 20% → 自动停止', 'nt') + note(778, 222, '所以稳定并发 = 12', 'q')
    + note(60, 300, '再和员工最近 7 天的真实峰值并发比：稳定并发明显高于峰值 = 够用；接近或低于 = 需要加 Key 或换供应商。', 'nt'),
    '图 11-1 · 阶梯加压：并发一档一档往上加，找出“还稳定”的最高一档（数据为示意）')
section('stress', '11', '压测', '这个模型在我们的线路上能扛多少并发？', stress_fig + f'''
{h('三种负载画像')}{table(['画像', '输入', '输出', '看什么'], [['短问答', '一句话', '约 60 字', '首字延迟、排队'], ['常规对话', '约 2 千字', '约 300 字', '接近员工日常'], ['长上下文', '约 2 万字', '约 100 字', '长输入下的排队（费用最高）']])}
{h('怎么操作')}{steps('选型号、画像，勾选要跑的并发档（1、2、4、8、12、16、24、32）。', '页面会按最长回答估算最高花费，超过预算（最多 ¥20）的不允许启动。<b>第一次先用“短问答 + 1、2、4”试一次，费用不到 1 毛。</b>', '点 <b>开始压测</b>；随时可以点 <b>停止压测</b>。')}
{h('“稳定并发”怎么算')}{bullets('从第一档开始，连续满足两条的最高并发：', '① 成功率 ≥ 98%；', '② 首字延迟 P95 不超过“最轻那一档的 3 倍”和“最轻那一档 + 2 秒”中较大的那个。', '安全阀：最多 32 并发、240 次请求；某档失败率超过 20% 立即停止；单个请求 120 秒超时。')}''')

# ===== 12. 运行观测 =====
watch_fig = svg(990, 260,
    '<circle cx="495" cy="130" r="88" fill="none" stroke="#7740b6" stroke-width="1.5" stroke-dasharray="6 5"/>'
    + note(495, 125, '每 30 分钟', 'bt', 'middle') + note(495, 145, '启动 2 分钟后第一次', 'bs2', 'middle')
    + box(380, 5, 230, 50, '① 读每把 Key 的型号列表', '', 'ours') + box(640, 105, 340, 50, '② 每个型号发 1 Token：能答吗？', '', 'ours')
    + box(380, 205, 230, 50, '③ 不守输出上限？→ 输出保护', '', 'warn') + box(10, 105, 340, 50, '④ 新事件立即发邮件给平台管理员', '', 'bad'),
    '图 12-1 · Key 巡检：一直在跑，不用操作')
section('monitor', '12', '运行观测与 Key 巡检', '现在线上有没有异常？', watch_fig + f'''
{h('巡检会告诉你什么')}{table(['情况', '系统怎么做', '你要做什么'], [
    ['上游新增了我们已定价的型号', '自动上线，发信息邮件', '不用'],
    ['上游新增了未定价的型号', '发警告邮件', '在型号与费率里定价，再上线'],
    ['上游下架了在售型号，或 Key 不响应', '发严重告警邮件', '联系供应商；必要时暂停模型'],
    ['两把 Key 其实是同一把', '发警告', '新建一把真正的备用 Key'],
    ['某个型号不守 max_tokens', '自动启用输出保护', '不用；上游修好后自动解除'],
])}
{h('输出保护是什么')}<p>有的上游会忽略“最多输出 N 个 Token”的要求（实测 GLM-5.3-FlashX 要 16 个给了 200～1500 个）。网关对这类型号改为流式读取，<b>数到上限就关掉上游连接</b>，返回 finish_reason=length，行为和官方一致。被截断的那次没有可信的用量数字，计费以供应商日志为准。</p>
{tip('事件会一直保持“打开”，直到某次巡检不再看到它。页面上方的数字是近 7 天内部测试的汇总：成功率、可核对响应、费用待核、P95 耗时。')}''')

# ===== 13. 路由与熔断 =====
section('routing', '13', '路由与熔断', '出问题时，能不能马上止损？', chain([('员工请求', ''), ('主用 Key', '正常时走这里'), ('认证失败 / 连不上', '自动改用备用 Key'), ('手动暂停', '某个型号立即停止\n记录原因'), ('恢复', '修好后取消暂停')], '图 13-1 · 自动切换和手动熔断', kinds=['gray', 'ours', 'warn', 'bad', 'off']) + f'''
{bullets('表格显示每个模型走哪条上游、状态、30 天调用、失败数、P95 延迟。', '<b>暂停</b>后员工调用该模型会马上失败并看到提示，用于上游出严重问题（被换模型、大面积报错）时止损。', '自动切换要有<b>真正不同</b>的备用 Key 才有意义。')}''')

# ===== 14. 计量核账 =====
section('billing', '14', '计量核账', '我们记的账，和供应商实际扣的钱对得上吗？', chain([('每 5 分钟', '拉 KerAPI 用量日志\n同一密钥只拉一次'), ('按请求号配对', '我们的记录 ↔\n上游的记录'), ('独立复算', '用上游的计费表达式\n（含高峰 2 倍）'), ('逐笔结论', '一致 / 差异 / 证据不全\n/ 等待上游…')], '图 14-1 · 逐笔对账', kinds=['ours', 'ink', 'ink', 'gray']) + f'''
{table(['结论', '意思'], [['计量及规则复算一致', 'Token 一致，按规则算出的钱和上游实扣一致'], ['有差异', 'Token 或金额对不上，看“金额差额”列'], ['证据不全', '上游缺字段，无法复算'], ['等待上游记录', '上游日志还没出来，稍后自动补'], ['请求号重复 / 缺少请求号', '无法一一配对']])}
{bullets('“上游全部记录”页可以看上游返回的每个字段和计费表达式，计费表达式只当证据解析，绝不执行。', '恰好跨过高峰时段边界的请求保持“未核实”，不硬判。', '导出和展示时自动抹掉 Key、Token 等敏感字段。')}''')

# ===== 15. 未上线 =====
section('future', '15', '还没有做的测试', '业界还在用、我们还没上线的方法', table(['方向', '方法', '解决什么'], [
    ['模型身份', '<s>分词指纹、能力小测、分时段对比</s> <b>已上线（身份检测）</b>；下一步：logprobs 比对、每天定时自动跑', '偷换、降级'],
    ['线上验证', '外部黑盒拨测 + SLA 报表（可放到公网实测报告页）', '对外证明可用率'],
    ['协议兼容', '官方 SDK 契约测试进 CI；错误码语义；客户端断开后是否停止计费', '发版不破坏兼容'],
    ['故障演练', '注入上游 5xx / 超时 / 断流；真实停用主用 Key 演练切换', '出事时系统真的能扛'],
    ['公开评测集', 'GSM8K、MATH、BFCL、IFEval 子集，每周跑', '更大样本看质量趋势'],
    ['计量', '官方分词器独立复算 Token；月度总账对平', '从逐笔一致到总账对平'],
    ['安全', '租户隔离越权测试；不留存对话抽查', '数据安全承诺'],
]) + '<p class="small">完整清单和优先级见仓库 <code>docs/13-testing-system.md</code> 第 4、5 节。</p>')

# ===== 16. 术语 =====
section('terms', '16', '术语', '看不懂的词', table(['词', '意思'], [
    ['Token', '模型计费和计数的单位。中文大约 1 个字 ≈ 1 个 Token，英文 1 个词 ≈ 1～1.3 个 Token'],
    ['输入 / 输出 / 缓存 Token', '发给模型的、模型写出来的、命中缓存的（更便宜）'],
    ['分词器', '把文字切成 Token 的规则。每个模型家族各不相同，所以能当“指纹”'],
    ['首字延迟（TTFT）', '从发出请求到收到第一个字的时间'],
    ['P95', '95% 的请求都不超过这个值'],
    ['finish_reason', '回答结束的原因：stop 正常结束；length 到了输出上限被截断；tool_calls 要调用工具'],
    ['流式（stream）', '边生成边返回，像打字一样一个字一个字出来'],
    ['量化', '把模型的数字精度降低，换来更便宜、更快，但能力会下降'],
    ['参照端点', '官方 API 的测试入口，只用于对比，不参与路由'],
    ['盲评换位', '评审时隐藏来源，A/B 对调再评一次，两次一致才算数'],
    ['输出保护', '上游不守 max_tokens 时，网关代为计数并截断'],
]))

# ---------- assemble ----------
toc = ''.join(f'<a href="#{i}"><span>{n}</span>{E(t)}</a>' for i, n, t, q, b in sections)
body = ''.join(f'<section class="sec" id="{i}"><header><span class="num">{n}</span><div><h2>{E(t)}</h2><p class="q">{E(q)}</p></div></header>{b}</section>' for i, n, t, q, b in sections)
CSS = '''
:root{--ac:#7740b6;--ink:#1d2233;--dim:#5b6478;--line:#e3e5ee;--bg:#f6f7fb}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.wrap{display:grid;grid-template-columns:230px minmax(0,1fr);max-width:1240px;margin:0 auto;gap:28px;padding:0 24px}
nav.toc{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:24px 0}nav.toc b{display:block;margin:0 0 10px;font-size:13px;color:var(--dim)}
nav.toc a{display:flex;gap:8px;padding:5px 10px;border-radius:8px;color:var(--ink);text-decoration:none;font-size:13px}nav.toc a span{color:var(--ac);font-weight:700;min-width:18px}nav.toc a:hover{background:#ece6f7}
main{padding:24px 0 80px;min-width:0}.cover{padding:40px 0 20px}.cover small{color:var(--ac);font-weight:700;letter-spacing:.05em}.cover h1{margin:6px 0 10px;font-size:38px;line-height:1.2}.cover p{margin:0;color:var(--dim);max-width:760px}
.sec{margin-top:22px;padding:26px 30px;background:#fff;border:1px solid var(--line);border-radius:18px;scroll-margin-top:12px}
.sec>header{display:flex;gap:16px;align-items:flex-start;margin-bottom:12px}.sec .num{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#f1eafb;color:var(--ac);font-weight:800;font-size:18px;flex:none}
.sec h2{margin:0;font-size:24px;line-height:1.3}.sec .q{margin:2px 0 0;color:var(--ac);font-weight:600}.sec h3{margin:22px 0 8px;font-size:17px}
.fig{margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:14px;background:#fcfcfe}.fig svg{width:100%;height:auto;display:block}figcaption{margin-top:8px;color:var(--dim);font-size:12.5px;text-align:center}
.bt{font-size:16px;font-weight:700;fill:#1d2233}.bs{font-size:13px;fill:#4a5265}.bs2{font-size:13px;fill:#6b7184}.al{font-size:12px;fill:#6b7184}.nt{font-size:14px;fill:#4a5265}.q{font-size:15px;font-weight:700;fill:#1d2233}.mono{font:14px ui-monospace,Menlo,monospace;fill:#1d2233}
.t{width:100%;border-collapse:collapse;margin:10px 0;font-size:13.5px}.t th,.t td{padding:8px 10px;border-bottom:1px solid #eceef4;text-align:left;vertical-align:top}.t th{color:var(--dim);font-size:12.5px;background:#fafbfd}
ol.steps{counter-reset:s;list-style:none;padding:0;margin:8px 0}ol.steps li{counter-increment:s;position:relative;padding:6px 0 6px 40px}ol.steps li::before{content:counter(s);position:absolute;left:0;top:6px;width:26px;height:26px;border-radius:50%;background:var(--ac);color:#fff;font-weight:700;font-size:13px;display:grid;place-items:center}
.tip,.warn-box{margin:14px 0;padding:12px 16px;border-radius:12px;background:#f1eafb;border-left:4px solid var(--ac);font-size:14px}.warn-box{background:#fff6e5;border-color:#c98200}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0}.card{padding:12px 16px;border:1px solid var(--line);border-radius:12px}.card h4{margin:0 0 4px;font-size:15px}.card p{margin:0;font-size:13.5px;color:#3a4152}.card.off{border-color:#9ad6bd;background:#f4fbf7}.card.ours{border-color:#cdb6ea;background:#faf7fe}
.pill{display:inline-block;padding:1px 10px;border-radius:99px;font-size:12px;font-weight:700;white-space:nowrap}.pill.ok{background:#e5f6ec;color:#0f7a54}.pill.ours{background:#efe7fa;color:#7740b6}.pill.gray{background:#eef0f4;color:#5b6478}.pill.bad{background:#fde9e7;color:#c23a2b}.pill.warn{background:#fff3df;color:#a76200}
.mock{margin:14px 0}.mock-ui{padding:14px;border-radius:14px;background:#14241a;color:#e9f9e8;font-size:12.5px;overflow:auto}.mock figcaption{text-align:center}
.mt{width:100%;border-collapse:collapse}.mt th,.mt td{padding:7px 9px;border-bottom:1px solid #ffffff1a;text-align:left}.mt th{color:#b5cdb8;font-size:12px}.mt th small{display:block;font-weight:400;font-size:10.5px}
.cell{display:inline-flex;gap:3px;align-items:center;padding:2px 6px;border-radius:7px;font-weight:800;font-family:ui-monospace,monospace}.cell i,.legend i{display:inline-block;width:13px;height:13px;border-radius:4px}i.p{background:#bbff7a99}i.w{background:#ffd17b99}i.f{background:#ff898399}
.cell.same{color:#bbff7a}.cell.extra{color:#8fb3ff}.cell.neither{color:#b5cdb8}.cell.gap{color:#ff8983;outline:1px solid #ff898366;background:#ff898314}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;color:#b5cdb8}.legend span{display:inline-flex;gap:5px;align-items:center}
.mx{display:inline-block;padding:1px 8px;border-radius:7px;font-weight:700}.mx.ok{color:#bbff7a}.mx.seen{color:#b5cdb8;border:1px dashed #52735a}.mx.bad{color:#ff8983;background:#ff898314}.mx.none{color:#6d8a73}
.idc{max-width:520px;padding:14px;border:1px solid #52735a;border-radius:12px;background:#20392a}.idh{display:flex;justify-content:space-between;align-items:flex-start}.idh small{display:block;color:#b5cdb8;font-size:11px}
.idc dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:10px 0}.idc dt{color:#b5cdb8}.idc dd{margin:0}.idc .g{color:#bbff7a}.idc .w{color:#ffd17b}.idc .d{color:#b5cdb8}.idc ul{margin:0;padding-left:18px}
.small{font-size:13px;color:var(--dim)}code{padding:1px 6px;border-radius:5px;background:#f0f1f5;font-size:12.5px}a{color:var(--ac)}
@media(max-width:860px){.wrap{grid-template-columns:1fr;padding:0 16px}nav.toc{position:static;max-height:none;display:flex;flex-wrap:wrap;gap:4px}nav.toc b{width:100%}.grid2{grid-template-columns:1fr}.sec{padding:18px}.cover h1{font-size:28px}}
@media print{@page{size:A4;margin:12mm 11mm}html,body{background:#fff;font-size:12.5px}.wrap{display:block;padding:0;max-width:none}nav.toc{display:none}main{padding:0}.sec{break-inside:auto;border:0;padding:6px 0 10px;margin-top:8px;border-top:2px solid #ece6f7;border-radius:0}.sec>header{break-after:avoid}.fig,.mock,.t tr,.card,.tip,.warn-box,ol.steps li{break-inside:avoid}.sec h3{break-after:avoid}.cover{padding:0 0 8px}.cover h1{font-size:30px}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sec#overview{break-before:auto}.sec:not(#overview){break-before:page}}
'''
doc = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>测试手册 · semifly.ai 技术后台</title><style>{CSS}</style></head><body>
<div class="wrap"><nav class="toc"><b>目录</b>{toc}</nav><main>
<div class="cover"><small>semifly.ai · 技术后台</small><h1>模型与 API 测试手册</h1><p>技术后台里每一项测试：它回答什么问题、背后的逻辑、怎么操作、结果怎么看、看到问题怎么办。每节的编号和后台页面一一对应，在后台每个测试页右上角点“测试手册”会直接跳到对应的一节。</p><p class="small" style="margin-top:8px">更新：2026-11-12 · 图中的数字都是示意，真实数据以后台为准。</p></div>
{body}</main></div></body></html>'''
OUT.write_text(doc)
print('wrote', OUT, len(doc))
