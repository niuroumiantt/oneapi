const categories=['全部 Skills','编程开发','网站与设计','文档与办公','数据与分析','搜索与研究','内容与运营','个人娱乐','设计与排版'];
const paths={code:'M8 7 3 12l5 5m8-10 5 5-5 5M14 4l-4 16',doc:'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',chart:'M4 3v17h17M8 16v-5m5 5V7m5 9V4',search:'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',dice:'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01',map:'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16',film:'M3 4h18v16H3zM7 4v16M17 4v16M3 9h4m-4 6h4M17 9h4m-4 6h4M10 8l5 4-5 4z',spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM19 2v4m-2-2h4',palette:'M12 3a9 9 0 1 0 0 18c3 0 1-4 3-5 2-1 6 1 6-4a9 9 0 0 0-9-9ZM7 8h.01M12 6h.01M17 9h.01M6 13h.01',layout:'M3 4h18v16H3ZM3 9h18M9 9v11',slides:'M3 3h18v13H3zM12 16v5M7 21l5-3 5 3M7 8h4M7 11h8',message:'M3 4h18v13H9l-6 4zM7 8h10M7 12h7',check:'M9 12l2 2 5-6M5 3h14v18H5z',arrow:'M5 12h14m-5-5 5 5-5 5',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',input:'M3 12h11m-4-4 4 4-4 4M14 4h6v16h-6',output:'M10 4H4v16h6M10 12h11m-4-4 4 4-4 4',shield:'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6',clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',book:'M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3zM12 6v15',copy:'M9 9h12v12H9zM15 9V3H3v12h6',filter:'M3 5h18M6 12h12M9 19h6',external:'M14 3h7v7M21 3l-10 10M10 3H3v18h18v-7'};
const svg=(type,cls='')=>`<svg class="line-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[type]||paths.book}"/></svg>`;
const icon=t=>`<span class="icon">${svg(t)}</span>`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=window.SKILL_CATALOG.map(r=>{const source=window.SKILL_SOURCES.find(s=>s.repo===r.repo&&s.path.endsWith('/'+(r.folder||r.slug)+'/SKILL.md'));if(!source)throw new Error('Missing source '+r.id);const license=source.license||r.license||(r.repo==='anthropics/skills'?'Apache-2.0':'MIT');return {...r,...source,license,trial:window.SKILL_TESTS?.[r.id],sourceUrl:`https://github.com/${r.repo}/blob/${source.sha}/${source.path}`,folderUrl:`https://github.com/${r.repo}/tree/${source.sha}/${source.path.replace('/SKILL.md','')}`,licenseUrl:`https://github.com/${r.repo}/blob/${source.sha}/`+(source.licensePath||r.licensePath||(r.repo==='anthropics/skills'?source.path.replace('SKILL.md','LICENSE.txt'):r.repo==='vercel-labs/agent-skills'?'README.md#license':r.repo.startsWith('K-Dense')?'LICENSE.md':'LICENSE'))};});
const app=document.querySelector('#app');let category=0,query='',sort='recommended',publisher='all',market={},marketFailed=false,board='featured';
let activeScreen='featured', listingScroll=0, activeAgent='claude-code';
const featuredIds=['docx','sheet','slides','pdf','lark-workflow-meeting-summary','md-format','md-html','infographic','impeccable','taste'];

const scene=(n,extra='')=>`<div class="scene scene-${n} ${extra}" aria-hidden="true"><span>用途示意</span></div>`;

function popularity(r){return market.popularity?.[(r.repo+'/'+r.slug).toLowerCase()]}
function snapshotDate(value){if(!value)return '尚未获取';return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}
function outdated(value){return !value||Date.now()-new Date(value).getTime()>36*60*60*1000}
function safeExternal(value){try{const u=new URL(value);return u.protocol==='https:'&&['github.com','skills.sh','www.skills.sh'].includes(u.hostname)?esc(u.href):'#'}catch{return '#'}}
function popularityLine(r){const m=popularity(r);return `<div class="popularity">${svg('download')}<b>${m?.display?esc(m.display):'—'}</b><span>平台记录安装${m?.status==='stale'||(m?.checkedAt&&outdated(m.checkedAt))?' · 旧快照':''}</span>${m?.rank?`<small>总榜 #${Number(m.rank)}</small>`:''}</div>`}
function popularityDetail(r){const m=popularity(r);return `<section class="popularity-detail"><div>${popularityLine(r)}<p>skills.sh 跨版本安装统计${m?.rank?` · 来源总榜第 ${Number(m.rank)} 名`:''}，并非本站下载量或质量评分。${m?.checkedAt?`采集于 ${snapshotDate(m.checkedAt)}（上海时间）`:'暂未取得该条目的公开统计。'}</p></div><a href="${safeExternal(m?.sourceUrl||`https://skills.sh/${r.repo}/${r.slug}`)}" target="_blank" rel="noopener">查看来源 ${svg('external')}</a></section>`}
function featuredItem(r,index){const m=popularity(r);return `<li><a class="rank-row" href="#skill/${r.id}"><span class="rank-number">${String(index+1).padStart(2,'0')}</span>${icon(r.icon)}<div class="rank-copy"><h3>${esc(r.name)}</h3><p>${esc(r.category)} · ${esc(r.author)}</p><span>${esc(r.output)}</span></div><div class="rank-metric"><strong>${m?.display?esc(m.display):'—'}</strong><small>记录安装</small></div>${svg('arrow')}</a></li>`}
function githubItem(r){return `<li><a class="rank-row github-row" href="${safeExternal(r.url)}" target="_blank" rel="noopener"><span class="rank-number">${String(Number(r.rank)).padStart(2,'0')}</span><div class="rank-copy"><h3>${esc(r.repo)}</h3><p>${esc(r.description||'原仓库未提供简介')}</p><span>${esc(r.language||'未标注语言')} · ${r.stars==null?'总星数未提供':Number(r.stars).toLocaleString()+' stars'}</span></div><div class="rank-metric"><strong>+${Number(r.starsToday).toLocaleString()}</strong><small>今日 stars</small></div>${svg('external')}</a></li>`}
function renderDiscovery(){const el=document.querySelector('#discovery');if(!el)return;const gh=market.github;const hasGithub=Array.isArray(gh?.items)&&gh.items.length===10;const stale=gh?.status==='error'||outdated(gh?.updatedAt);el.innerHTML=`<div class="discovery-head"><div><h2>值得打开的下一项</h2><p>先看精选，也看看今天正在受到关注的项目。</p></div><div class="board-tabs" role="group" aria-label="选择榜单"><button data-board="featured" aria-pressed="${board==='featured'}">semifly 精选</button><button data-board="github" aria-pressed="${board==='github'}">GitHub Top 10</button></div></div><div class="board-caption">${board==='featured'?'<span>编辑精选 10 项 · 优先办公、设计与排版；综合用途、来源和安装量，不是下载量排名。</span><a href="#catalog" id="browse-all">查看全部 '+rows.length+' 项 '+svg('arrow')+'</a>':`<span>GitHub 官方日榜 · 全语言 · 原榜顺序 · 仓库不一定是 Skill</span><a href="https://github.com/trending?since=daily" target="_blank" rel="noopener">查看原榜 ${svg('external')}</a>`}</div>${board==='featured'?`<ol class="rank-list">${featuredIds.map(id=>rows.find(r=>r.id===id)).filter(Boolean).map(featuredItem).join('')}</ol>`:hasGithub?`${stale?'<p class="board-status warning">更新暂未成功或快照已超过 36 小时，以下保留上次榜单，不代表当前排名。</p>':''}<ol class="rank-list">${gh.items.map(githubItem).join('')}</ol>`:`<div class="board-empty"><h3>${marketFailed||gh?.status==='error'?'暂时无法取得榜单':'正在读取每日榜单'}</h3><p>暂不展示推测排名。可以直接查看 GitHub 原榜。</p><a href="https://github.com/trending?since=daily" target="_blank" rel="noopener">前往 GitHub</a></div>`}<div class="board-foot">${board==='featured'?'<span>安装量日期与来源可在详情查看。</span>':`<span>最近成功采集：${snapshotDate(gh?.updatedAt)}（上海时间）</span><span>每天 09:00 本地更新（需本机与 Codex 运行） · stars 不等于下载</span>`}</div>`;el.querySelectorAll('[data-board]').forEach(button=>button.onclick=()=>{board=button.dataset.board;renderDiscovery()});el.querySelector('#browse-all')?.addEventListener('click',event=>{event.preventDefault();showSkillScreen('catalog')});}

function trialView(r){const t=r.trial;if(!t)return '';return `<section class="trial-evidence"><div class="trial-title"><span class="trial-badge ${t.tone}">${svg('check')}${t.status}</span><small>${t.date}</small></div><h2>${t.headline}</h2><p>${t.summary}</p>${r.id==='gif'?'<div class="actual-gif"><img src="tests/gif/cat-wave.gif" width="128" height="128" alt="实际生成的橘猫挥手动画"><span>真实输出 GIF<br>128×128 · 放大展示</span></div>':''}<a class="evidence-shot" href="tests/${r.id}/index.html" target="_blank" rel="noopener"><img src="tests/${r.id}/screenshot.jpg" alt="${r.name}的真实试运行输出记录截图" loading="lazy"></a><p class="example-label">${t.caption||'真实运行产物的本站排版截图，不是原生客户端截图。'} 点击查看完整记录。</p><ul class="trial-checks">${t.checks.map(c=>`<li>${svg('check')}<span>${c}</span></li>`).join('')}</ul><p class="trial-limit"><b>本次范围</b>${t.limits}</p><p class="example-label">${t.runtime}<br>CLI 默认模型，未记录服务端确切模型 ID；未取得金额账单，不标为零成本。</p><div class="evidence-links">${t.files.map(([label,file])=>`<a href="tests/${r.id}/${file}" target="_blank" rel="noopener">${label} ${svg('external')}</a>`).join('')}<a href="tests/${r.id}/install.log" target="_blank" rel="noopener">安装日志 ${svg('external')}</a><a href="tests/verification.json" target="_blank" rel="noopener">完整验证记录 ${svg('external')}</a></div></section>`;}

function card(r){return `<a class="skill" href="#skill/${r.id}" aria-label="查看${esc(r.name)}"><div class="skill-body"><div class="skill-top">${icon(r.icon)}<div><h3>${r.name}</h3><small>${r.category} · ${r.license}</small></div></div><p class="summary">${r.summary}</p><div class="skill-bottom"><span>${r.author}</span><b>介绍、样本与安装 ${svg('arrow')}</b></div></div></a>`}
function renderGrid(){let list=rows.filter(r=>(!category||r.category===categories[category])&&(publisher==='all'||r.repo===publisher)&&[r.name,r.slug,r.summary,r.author,r.category,r.input,r.output,...r.tags].join(' ').toLowerCase().includes(query.toLowerCase()));if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));else if(sort==='installs')list.sort((a,b)=>(popularity(b)?.countApprox??-1)-(popularity(a)?.countApprox??-1));else list.sort((a,b)=>(featuredIds.includes(a.id)?featuredIds.indexOf(a.id):100)-(featuredIds.includes(b.id)?featuredIds.indexOf(b.id):100));document.querySelector('#count').textContent=`${list.length} 个`;document.querySelector('#grid').innerHTML=list.length?list.map(card).join(''):'<div class="empty"><h3>没有找到匹配的 Skill</h3><p>换个用途关键词，或清除分类与来源筛选。</p><button class="btn" id="reset">清除筛选</button></div>';document.querySelectorAll('[data-cat]').forEach(b=>{b.classList.toggle('active',+b.dataset.cat===category);b.setAttribute('aria-pressed',String(+b.dataset.cat===category))});document.querySelector('#category-select').value=category;document.querySelector('#active-filter').textContent=category?categories[category]:'全部用途';document.querySelector('#reset')?.addEventListener('click',()=>{category=0;query='';publisher='all';document.querySelector('#search').value='';document.querySelector('#publisher').value='all';renderGrid()});}
function listing(){document.title='Skills 广场 · semifly.ai 本地目录';app.innerHTML=`<section class="hero"><div><h1>给你的 AI，添一项技能。</h1></div><div><label class="search">${svg('search')}<input id="search" type="search" aria-label="搜索 Skill" placeholder="想做什么？试试 会议纪要、排版、PDF"></label><div class="search-note">Skill 免费获取，运行时的模型和第三方服务费用另计。</div></div></section><section id="discovery" class="discovery" aria-label="发现榜单"></section><div class="catalog"><div><button class="mobile-filter" aria-expanded="false">${svg('filter')}筛选分类</button><aside class="sidebar"><h3>按用途探索</h3><div class="categories">${categories.map((c,i)=>`<button data-cat="${i}"><span>${svg(['book','code','layout','doc','chart','search','message','dice','palette'][i])}${c}</span><small>${i?rows.filter(r=>r.category===c).length:rows.length}</small></button>`).join('')}</div></aside></div><section><div class="toolbar"><div><h2>发现 Skills <span id="count"></span></h2><p id="active-filter">全部用途</p></div><div class="filter-controls"><select id="category-select" aria-label="按用途筛选">${categories.map((c,i)=>`<option value="${i}">${c}</option>`).join('')}</select><select id="publisher" aria-label="按来源筛选"><option value="all">全部来源</option>${[...new Set(rows.map(r=>r.repo))].map(repo=>`<option value="${repo}">${repo.split('/')[0]}</option>`).join('')}</select><select id="sort" aria-label="排序"><option value="recommended">编辑推荐顺序</option><option value="installs">平台记录安装量</option><option value="name">名称排序</option></select></div></div><p class="metric-note">安装量来自 skills.sh 的 CLI 统计，不等于独立用户或 GitHub 下载量；“—”表示暂无数据。<a href="https://skills.sh/docs" target="_blank" rel="noopener">查看口径</a></p><div class="grid" id="grid" aria-live="polite"></div><p class="gallery-note">标有“真实样本”的封面来自实际产物，其余封面为 AI 用途示意；已测试条目的详情页另附真实截图、原始输出和验收记录。中文简介由本站整理。</p><section class="license-faq"><h2>这些 Skills 都是免费的吗？</h2><p><b>当前收录的 ${rows.length} 个固定版本，Skill 内容均开源且可免费使用：</b>${rows.filter(r=>r.license==='Apache-2.0').length} 个 Apache-2.0，${rows.filter(r=>r.license==='MIT').length} 个 MIT。每项详情都可查看原始许可依据。</p><p>使用时可能产生模型 API 调用费、Agent 工具订阅费、服务器或第三方服务费用。</p><p>重新分发时须遵守原许可，保留版权、许可及适用的 NOTICE，修改内容按许可要求标记。</p><a href="https://opensource.org/license/mit" target="_blank" rel="noopener">MIT 原文</a> · <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache-2.0 原文</a></section></section></div>`;renderDiscovery();document.querySelector('#category-select').value=category;document.querySelector('#category-select').onchange=e=>{category=Number(e.target.value);renderGrid()};document.querySelector('#search').value=query;document.querySelector('#sort').value=sort;document.querySelector('#publisher').value=publisher;renderGrid();document.querySelector('#search').addEventListener('input',e=>{query=e.target.value;renderGrid()});document.querySelector('#sort').addEventListener('change',e=>{sort=e.target.value;renderGrid()});document.querySelector('#publisher').addEventListener('change',e=>{publisher=e.target.value;renderGrid()});document.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{category=Number(b.dataset.cat);renderGrid()}));document.querySelector('.mobile-filter').onclick=e=>{const open=document.querySelector('.sidebar').classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',String(open))};setupSkillScreens();}
const agents={
 'claude-code':{name:'Claude Code',invoke:'新建会话，在输入框键入 / 并选择已安装的 Skill，或在任务里明确指定 Skill 名称。'},
 codex:{name:'Codex',invoke:'在当前项目新建会话，输入 $ 选择已安装的 Skill，或使用下方的任务示例。'},
 cursor:{name:'Cursor',invoke:'在当前项目打开 Agent 对话，在任务里明确指定已安装的 Skill 名称。'},
 opencode:{name:'OpenCode',invoke:'在当前项目启动 OpenCode，在任务里明确指定 Skill 名称。'},
 workbuddy:{
  name:'WorkBuddy',
  importPath:'打开「技能 → 添加技能 → 上传技能」，选择本地 Skill 包。',
  scope:'上传的技能默认可跨项目使用。',
  invoke:'打开任务对话，明确告诉 WorkBuddy 要用这个 Skill，并添加任务需要的文件。',
  docs:'https://www.tencentcloud.com/zh/document/product/1316/84503'
 },
 'qoder-desktop':{
  name:'Qoder 桌面版',
  importPath:'打开「扩展 → 技能 → 添加技能 → 上传技能」，选择本地 Skill ZIP。',
  scope:'在「已安装」确认导入结果。',
  invoke:'在新的本地任务里输入 /，从建议列表选择已安装的 Skill。',
  docs:'https://docs.qoder.com/qoder/skills'
 },
 qoder:{
  name:'Qoder IDE',
  scope:'项目目录为 .qoder/skills/。国际版和中国版在项目级使用同一目录。',
  invoke:'在 IDE 的 Agent 对话中输入 / 并选择 Skill，或直接描述任务。',
  docs:'https://docs.qoder.com/extensions/skills'
 }
};
let applySkillScreen;
function showSkillScreen(id){
 if(activeScreen===id)return;
 const nav=app.querySelector('.skill-screen-tabs');
 const top=nav.previousElementSibling.getBoundingClientRect().bottom+window.scrollY;
 const target=Math.min(window.scrollY,top);
 activeScreen=id;
 applySkillScreen();
 window.scrollTo(0,target);
}
function agentGuide(){
 const instructions=['workbuddy','qoder-desktop','qoder','codex','claude-code','cursor','opencode'].map(id=>{
  const tool=agents[id];
  return `<section><h3>${tool.name}</h3><p>${tool.importPath||'在 Skill 详情选择对应工具，复制命令，在当前项目目录执行。'} ${tool.invoke}</p>${tool.docs?external(tool.docs,'查看官方说明'):''}</section>`;
 }).join('');
 return `<h2>在 Agent 中安装和使用 Skill</h2><p>打开任意 Skill，选择你用的客户端。先查看依赖，再复制详情里的任务示例试用。</p><div class="agent-guide">${instructions}</div>`;
}
const external=(url,label)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${label} ${svg('external')}</a>`;
function installCommand(r,agent){return `npx skills@1.9.0 add ${r.repo}@${r.sha} --skill ${(r.installSkills||[r.slug]).join(' ')} --agent ${agent}`;}
function renderAgent(r){
 const tool=agents[activeAgent];
 const target=document.querySelector('#agent-instructions');
 const archive=`https://github.com/${r.repo}/archive/${r.sha}.zip`;
 const command=tool.importPath?'':installCommand(r,activeAgent);
 const install=tool.importPath
  ?`<ol><li>${external(archive,'下载核对版本')}并解压。对照${external(r.folderUrl,'原始目录')}找到包含 <code>SKILL.md</code> 的 Skill 文件夹，把完整文件夹压成 ZIP，保留脚本和参考资料。</li><li>${tool.importPath} ${tool.scope}</li></ol>`
  :`<p>在当前项目目录的终端执行。需要 Node.js ≥ 22.20 和 Git。</p><pre class="install-code">${esc(command)}</pre><button class="btn primary" id="copy-command">${svg('copy')}复制安装命令</button>${tool.scope?`<p>${tool.scope}</p>`:''}`;
 const prompt=`请使用 ${r.slug} 技能。\n${r.prompt}`;
 target.innerHTML=`${install}
 ${r.installSkills?`<p>配套 Skills：<code>${esc(r.installSkills.join('、'))}</code>。${tool.importPath?'按相同步骤导入所需的配套技能。':''}使用前请配置 lark-cli 并完成账号与资源授权。</p>`:''}
 <h3>安装后怎么用</h3><p>${tool.invoke}</p>
 <button class="btn" id="copy-agent-prompt">${svg('copy')}复制对话示例</button>
 <p class="install-caption">如提示缺少依赖，按作者说明补齐。${r.trial?'本条目的样本测试使用 Codex。':''}</p>
 <div class="agent-links">${external(r.folderUrl,'查看原始文件')} ${tool.docs?external(tool.docs,'查看官方说明'):''}</div>`;
 target.querySelector('#copy-command')?.addEventListener('click',()=>copy(command));
 target.querySelector('#copy-agent-prompt').addEventListener('click',()=>copy(prompt));
}
function details(id){if(id==='story')id='dungeon';const r=rows.find(r=>r.id===id);if(!r){app.innerHTML='<a class="back" href="#">← 返回广场</a><div class="empty"><h1>未找到这个 Skill</h1><p>请返回广场重新选择。</p></div>';window.scrollTo(0,0);return}document.title=`${r.name} · Skills 广场`;app.innerHTML=`<a class="back" href="#">← 返回 Skills 广场</a><section class="detail-head">${icon(r.icon)}<div><h1>${r.name}</h1><p>${r.summary}</p><div class="tags"><span class="tag">${r.category}</span><span class="tag">${r.author}</span><span class="tag">${r.license} · 免费获取</span></div></div></section><div class="detail-layout"><aside><div class="install"><h2>${svg('download')}安装这个 Skill</h2><label class="field-label" for="agent">使用工具</label><select id="agent" class="tool-select">${Object.entries(agents).map(([id,tool])=>`<option value="${id}" ${activeAgent===id?'selected':''}>${tool.name}</option>`).join('')}</select><div id="agent-instructions"></div></div></aside><article class="article">${popularityDetail(r)}${trialView(r)}${r.trial?'':`<figure class="detail-visual">${scene(r.scene)}<figcaption>AI 生成的用途示意图 · 非实测成果</figcaption></figure>`}<section><h2>适合谁，能做什么</h2><p>${r.audience}</p><ul class="features">${r.features.map(f=>`<li>${svg('check')}<span>${f}</span></li>`).join('')}</ul><dl class="detail-io io"><div><dt>${svg('input')}你提供</dt><dd>${r.input}</dd></div><div><dt>${svg('output')}你得到</dt><dd>${r.output}</dd></div></dl><p class="editor-note">${svg('book')}<span><b>编辑选入理由</b>${r.recommended}</span></p></section><section><div class="sample-head"><h2>安装后，试着这样说</h2><button id="copy">${svg('copy')}复制示例</button></div><div class="sample">${r.prompt}</div><p class="example-label">${r.trial?'本站编写的入门示例；实际测试输入与结果见上方记录。':'本站编写的任务示例，尚未运行。'}</p></section><section><h2>你可以期待的交付形式</h2><div class="result-shape">${svg('output')}<p>${r.result}</p></div><p class="example-label">交付结构示意，不代表已生成这些文件。</p></section><section><h2>需要准备什么</h2><p>${r.dependencies}</p><p class="limitations"><b>使用边界</b>${r.limitations}</p></section><section id="verification"><h2>验证记录</h2><div class="verification"><div><span>${svg('shield')}原始来源与许可</span><b class="verified">已核对</b></div><div><span>${svg('book')}安装文档与 Skill 名称</span><b class="verified">已核对</b></div><div><span>${svg('download')}实际安装</span><b class="${r.trial?'verified':''}">${r.trial?'已验证 · 项目级':'未执行'}</b></div><div><span>${svg('check')}代表任务运行</span><b class="${r.trial?'verified':''}">${r.trial?r.trial.status:'未执行'}</b></div><div><span>${svg('code')}OneAPI 模型组合</span><b>未验证</b></div></div><p class="example-label">核对日期：2026-11-17。样本测试仅对列明的环境与输入负责，不是完整代码安全审计。</p></section><section><h2>原作者与版本</h2><div class="source-list"><a class="source" href="${r.sourceUrl}" target="_blank" rel="noopener noreferrer">${svg('book')}原始 SKILL.md ${svg('external')}</a><a class="source" href="${r.folderUrl}" target="_blank" rel="noopener noreferrer">${svg('code')}完整 Skill 目录 ${svg('external')}</a><a class="source" href="${r.licenseUrl}" target="_blank" rel="noopener noreferrer">${svg('shield')}${r.license} 许可依据 ${svg('external')}</a></div><p class="example-label">${r.repo}<br>核对版本：<code>${r.sha}</code>${r.repo==='vercel-labs/agent-skills'?'<br>许可依据为仓库 README 的 MIT 声明；不是另行签发的认证。':''}</p></section></article></div>`;document.querySelector('#copy').onclick=()=>copy(r.prompt);renderAgent(r);
 document.querySelector('#agent').onchange=event=>{activeAgent=event.target.value;renderAgent(r);};
 window.scrollTo(0,0);
}
function toast(s){const e=document.querySelector('#toast');e.textContent=s;e.style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>e.style.display='none',3000)}async function copy(s){try{await navigator.clipboard.writeText(s);toast('已复制；尚未执行')}catch{toast('复制失败，请手动选择文字复制')}}function route(){
 if(location.hash.startsWith('#skill/')) details(location.hash.slice(7));
 else {
  if(location.hash==='#catalog') activeScreen='catalog';
  listing();
  window.scrollTo(0,listingScroll);
 }
}
document.addEventListener('click',event=>{
 if(event.target.closest('a[href^="#skill/"]')) listingScroll=window.scrollY;
});
window.addEventListener('hashchange',route);
route();
async function readMarket(url){const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error('snapshot unavailable');const data=await response.json();if(data.schemaVersion!==1)throw new Error('unsupported snapshot');return data;}readMarket(document.body.dataset.marketUrl||'market-data.json').catch(()=>readMarket('market-data.json')).then(data=>{if(data.schemaVersion!==1)throw new Error('unsupported snapshot');market=data;
 const detail=app.querySelector('.popularity-detail');
 if(detail){
  const row=rows.find(r=>r.id===(location.hash==='#skill/story'?'dungeon':location.hash.slice(7)));
  if(row)detail.outerHTML=popularityDetail(row);
 }else if(app.querySelector('#grid')){renderDiscovery();renderGrid();}}).catch(()=>{marketFailed=true;if(!location.hash.startsWith('#skill/'))renderDiscovery()});

function setupSkillScreens(){
 const hero=app.querySelector('.hero'),discovery=app.querySelector('#discovery'),catalog=app.querySelector('.catalog');
 const help=document.createElement('section');
 help.className='skill-screen-help';
 help.innerHTML=agentGuide();
 help.append(app.querySelector('.license-faq'));
 app.querySelector('.gallery-note').remove();
 app.append(help);
 const nav=document.createElement('nav');
 nav.className='skill-screen-tabs';
 nav.setAttribute('aria-label','Skills 栏目');
 nav.innerHTML=[['featured','精选榜单'],['catalog','技能目录'],['help','使用说明']].map(([id,label])=>`<button type="button" data-skill-screen="${id}">${label}</button>`).join('');
 hero.after(nav);
 const panels={featured:discovery,catalog,help};
 applySkillScreen=()=>{
  for(const [key,el] of Object.entries(panels)) el.hidden=key!==activeScreen;
  nav.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.skillScreen===activeScreen)));
 };
 nav.addEventListener('click',event=>{
  const button=event.target.closest('[data-skill-screen]');
  if(button)showSkillScreen(button.dataset.skillScreen);
 });
 app.querySelector('#search').addEventListener('input',()=>showSkillScreen('catalog'));
 applySkillScreen();
}
