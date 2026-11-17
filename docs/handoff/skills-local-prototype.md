# Skills 广场本地目录交接

2026-11-17。用户认可初版方向，要求补齐真实免费 Skills、增加个人娱乐、丰富介绍和图标图片。仅本地，不上线。

## 文件与启动

目录：`prototypes/skills/`。仓库根目录运行：

```sh
python3 -m http.server 4175 --bind 127.0.0.1
```

广场：`http://127.0.0.1:4175/prototypes/skills/`。
娱乐详情：`http://127.0.0.1:4175/prototypes/skills/#skill/dungeon`。
旧的 `#skill/story` 自动展示真实的 AI 跑团主持。初版原创占位条目已退出目录。

沿用 semifly.ai 标志、浅底、海军蓝文字、红色操作。生产 web 入口和打包白名单未改，无发布、推送或 API 调用。

## 数据与信源

15 个真实 Skills、7 个分类、4 个原作者仓库。个人娱乐 5 个：agent-dungeon-master、dungeon-master-assistant、algorithmic-art、slack-gif-creator、canvas-design（最后三个是个人创作玩法）。

- `catalog.js`：中文介绍、适用对象、输入输出、功能、依赖、边界、任务示例。
- `source-refs.js`：原始目录及核对时的不可变 commit。
- `source-audit.json`：来源原文片段、许可依据、核对日期与测试边界。
- `skills.js` / `skills.css`：目录、筛选和详情交互。
- `assets/scenes.jpg`：imagegen 内置工具生成的 6 格用途插画。保留原 PNG，生成提示在 assets/README.md。
- `check-catalog.cjs`：检查条目唯一性、实际 Skill 名称、commit、许可证据及必要编辑字段。

原始仓库：

- https://github.com/anthropics/skills — 10 条；逐项读取 LICENSE.txt，当前核对版本为 Apache-2.0，包括四种文档 Skills。不要沿用历史上“文档 Skills 必定专有”的判断。
- https://github.com/vercel-labs/agent-skills — 2 条；MIT 依据为固定版本 README，React Skill 前置元数据也声明 MIT。CLI 实际 Skill 名称是 vercel-react-best-practices，不是目录名 react-best-practices。
- https://github.com/NylasDev/nylas-dungeon-master-skills — 2 条；根目录 LICENSE 与两个 Skill 元数据均为 MIT。
- https://github.com/K-Dense-AI/scientific-agent-skills — 1 条；LICENSE.md 与 Skill 元数据均为 MIT。旧 claude-scientific-skills 仓库已经迁移，不再使用旧路径。

安装说明依据 Vercel Skills CLI 官方 README / docs/commands.md；已确认 v1.9.0 release 存在。命令固定 CLI 为 skills@1.9.0，来源固定核对 commit，默认仅当前项目；可切换 Claude Code / Codex / Cursor / OpenCode。要求 Node.js >=22.20 与 Git；未执行安装命令。

## 首轮来源核验结论与限制（实测状态见下方更新）

每项均读取原始 SKILL.md 和许可依据，核对了安装参数与文档。安装、代表任务运行、OneAPI 模型兼容均未验证，页面分别标识。没有“安全认证”、虚构星级或下载量。

K-Dense 条目核心证据分析不需网络；可选科学绘图依赖 OpenRouter 和额外费用，已说明默认不启用。办公类 Skill 的上游预装依赖不可假定在用户本机存在。

配图只表达用途；任务示例、交付结构由本站编辑，均非实测输出。

## 页面验证

- JS 语法与 check-catalog.cjs 通过：15 个条目、5 个娱乐条目、源名称与 commit 对齐。
- Chrome 逐一打开 15 个详情页，每页有 3 个原始来源/目录/许可链接及安装命令；未捕获 console error/warn。
- 娱乐筛选得到 5 个；叠加 Anthropic 来源得到 3 个；返回保留筛选。
- 切换 Codex 后命令参数正确，复制安装命令反馈正常。
- 搜索无结果与清除恢复正常。
- 390px 手机广场、分类展开与 GIF 详情视觉检查，页面宽度无横向溢出。
- 实际安装、Skill 生成效果、浏览器跨平台完整回归不在本轮通过项。

后续实测已完成下列范围，仍未获得上线授权。


## 2026-11-17 代表 Skill 实装与实测更新

用户要求优先跑团与 GIF，再测 PDF 和代码审查；仅本地。四项已经通过 skills@1.9.0 安装固定提交到临时项目，并由 Codex CLI 0.160.0 实际读取已安装 Skill 执行样本任务。

| Skill | 实际结果 | 边界 |
| --- | --- | --- |
| agent-dungeon-master | 三轮上下文回放人工检查通过 | 不是长战役或跨会话持久记忆测试 |
| slack-gif-creator | 首次缺 imageio；补齐原依赖后生成 128×128、20 帧、2 秒循环橘猫 GIF | 原 Skill 未修改，未上传 Slack |
| pdf | 三页中文文字样本的 12 个字段与预留标准答案一致 | 缺日期保持 null；不含 OCR/复杂表格 |
| vercel-react-best-practices | 命中 3 个预植入问题，正常 JSX 无 XSS 误报 | 静态审查，无构建或性能测量 |

新增 `prototypes/skills/test-results.js` 与 `tests/`：真实原始输出、输入、生成脚本、安装日志、锁文件、SHA256 验证记录、4 张浏览器报告截图。GIF 同时展示实际动画。报告明确是本站排版的真实产物，不冒充原生客户端界面。失败与修复过程保留。详情页和卡片状态更新，其他 11 项仍未运行。

当前 15 个固定版本均可按开源许可免费获取使用：10 Apache-2.0、5 MIT。许可计数限定当前快照；运行涉及模型/订阅/第三方服务，不能承诺零费用。页面增加费用 FAQ。重新分发须保留许可、版权与适用 NOTICE 等要求。

环境：macOS M5，Python 3.12.14，Node 22.23.3，现有 Codex 登录。未记录确切服务端模型 ID，未取得金额账单；未验证 OneAPI 具体模型组合。临时项目 `/private/tmp/oneapi-skill-tests-20261117`；复现细节见 tests/README.md。

验收：4 项报告人工视觉检查；详情页截图正常加载；GIF 详情 390px 无溢出；广场费用说明与状态正确；浏览器未捕获 error/warn。`check-evidence.py` 核对 27 个产物哈希、4 张截图、PDF 标准答案；目录检查与 JS 语法通过。仍仅本地，未推送或部署。

## 2026-11-17 扩充目录与双榜

用户确认双榜为 **semifly 精选** + **GitHub Top 10**，不是 skills.sh Trending 第三榜。继续仅本地，未部署或推送。

### 目录与来源

- 从 15 增至 40 项：新增 25，来自 Anthropic（3）、Lark / 飞书（11）、宝玉（9）、Impeccable（1）、Taste（1）。
- 当前分类：文档与办公 13、设计与排版 11、数据与分析 3、网站与设计 4，其他保留。编辑精选 10 项优先 Word、Excel、PPT、PDF、会议纪要、Markdown 与 HTML 排版、信息图、界面精修和品牌网页。
- 新数据在 catalog-extra.js；source-refs.js 和 source-audit.json 包含每项固定 commit、真实 Skill 名称、许可路径、来源片段和内容哈希。
- 新增候选 doc-coauthoring 在所查提交没有单独许可证，未收录；换为有明确许可的 web-artifacts-builder。brand-guidelines 明确是 Anthropic 自有品牌参考。
- 当前固定版本许可为 14 Apache-2.0 + 26 MIT。图像服务、飞书账号与 API 配额费用另计。新增条目均未安装/运行；原四项实测证据不变。
- Lark 安装命令加入 lark-shared 和对应工作流依赖，仍需配置 lark-cli 及资源权限。

### 安装量与榜单

- market-data.json 保存真实公开采集数据，40 项均取得 skills.sh Installs 数值；K/M 是来源展示的约数，仅用于近似排序。不是 GitHub 下载量、独立用户、固定 commit 安装数或本站统计。详情显示来源与采集时间。
- 排名只取 skills.sh 公开全时榜明确显示的名次，不给未出现在榜页中的条目编造名次。目录新增安装量排序、分批加载（每批 12 项），搜索时隐藏顶部榜单，避免结果被长榜单挤到下方。
- semifly 精选为人工编辑顺序；GitHub Top 10 来自官方全语言 daily 页面并保留原始次序。不是“GitHub 官方 Skill 榜”，不自动把上榜仓库收入已核验免费目录。
- 首次更新已实际成功：2026-11-17T04:51:16+00:00（上海 12:51）。当天首位 ag-ui-protocol/ag-ui；以后以实时快照为准，不把交接文字当当前榜单。

### 每日调度

- 新增 Python 标准库更新器 prototypes/skills/scripts/update-market.py，输入 market-sources.json，原子写 market-data.json；公开页面读取，无 token、无安装、无部署。
- 网络、解析或不足 10 条失败，保留上次成功榜单及日期；超过 36 小时或失败时页面显示旧快照提示。缺失安装量展示“—”，不写 0。
- 已通过 Codex app automation_update 创建并查看任务 `semifly-skills`（ACTIVE）：每天本地时间 09:00，当前 Asia/Shanghai。附着本对话，只更新本地 JSON 和校验，不 commit / push / deploy。
- 需要本机、Codex 运行与网络可达；未设置生产常驻调度。未来上线需另行明确授权。完整说明见 prototypes/skills/scripts/README.md。

### 验收

- 40 项来源/许可/元数据及统计请求清单一致性检查通过；原 27 个实测产物哈希仍一致。
- update-market.py 真实抓取成功；6 个离线回归覆盖解析、数量不足、单位转换、失败保留日期、未知值和原子写入。
- 浏览器逐一打开 40 个详情页，均具来源/目录/许可链接和安装命令；PDF 的 lazy 图片在加载完成后复核正常。
- 双榜切换、按安装量排序、11 项排版分类、13 项办公分类、搜索/空状态、分批展示全部 40 项、Codex 命令切换与复制通过。
- 桌面、390px 手机视觉检查；768px 与390px 宽度检查无横向溢出；console 无 error/warn。手机截图接口需显式 clip 才正常返回缩放比例，已用对应截图验证，不是页面缩放问题。
- Impeccable detector 返回 []；没有更改其项目配置。
- 截图：本会话 visualizations 目录的 skills-featured-board.jpg、skills-github-board.jpg、skills-github-mobile.jpg。本地地址仍为 http://127.0.0.1:4175/prototypes/skills/ 。

## 2026-11-17 办公实测与四列布局（仅本地）

- 用户要求优先实际安装/测试 Word、Excel、PPT、公众号排版；缩紧顶部，桌面卡片从二列改四列。未 push、部署或发表文章。
- 在 `/private/tmp/oneapi-office-tests-20261117` 独立项目安装固定版本，使用 `skills@1.9.0 --agent codex --copy`；实际 Codex CLI 执行读入原 Skill。Office 仍为 anthropics 固定 e4bb5d9，公众号为 jimliu 固定 ca703c2。未改原 Skill。
- Word：生成一页 A4、两张可编辑表格；原校验器通过。初次 PDF 中文缺字，临时 Fontconfig 映射系统 Heiti SC 后同一 DOCX 正常渲染，保留初次失败文件与原报告。
- Excel：原始 XLSX 三表、11 公式、原生图表；8 行去重为7行并保留退货和重复记录。原 recalc.py 57s/119s 两次超时，原工作簿缓存为空。独立 LibreOffice 直接转换副本得到 1516/2824/4340，单价68→70 后得到1540/2824/4364。副本、改价样本及独立脚本留证，不把替代路径当原脚本通过。
- PPT：4页16:9、4页备注、1原生图表、1原生表格、1内嵌工作簿、无栅格整页图；模型修正占位符与字体后原验证器通过。PDF四页逐页目检。
- 公众号：原脚本 simple/red/16px/keep-title/cite 输出真实 HTML；锁定 Bun 依赖，9结构检查通过；桌面与390px实际浏览器预览无横向溢出。未微信粘贴、未发布。
- Word/Excel/PPT 均采用捆绑 LibreOffice 隔离配置渲染，不是 Microsoft Office 原生客户端验收。模型走现有 Codex 账户，金额未测，OneAPI 组合未测。
- `tests/{docx,sheet,slides,md-html}` 含原文件、PDF/HTML、真实预览、浏览器截图、输入、安装锁/日志、原报告和 final-verification.json；详情页挂接下载。总计8项已实测，32项未运行。
- 顶部双榜保留，缩紧行高/边距；1512px四列，1024px三列，850px以下二列，600px以下一列。四项新测试使用真实产物缩略图，其余封面用途示意。390px详情、列表，1024px列表、桌面四列均无横向溢出；GitHub榜仍10项。
- 验收：40条目录检查、8项安装/产物哈希/截图检查、6个榜单离线测试；Impeccable静态检测[]。浏览器截图 `tests/office-four-column.jpg`。
- 本地地址仍为 http://127.0.0.1:4175/prototypes/skills/ 。尚未执行 Office 原生交互编辑验收与微信公众号粘贴验收；Excel原重算脚本仍未通过，页面明确标记。
