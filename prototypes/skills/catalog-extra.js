window.SKILL_CATALOG.push(...[
  {
    "id": "themes",
    "slug": "theme-factory",
    "name": "文档与演示主题配色",
    "category": "设计与排版",
    "repo": "anthropics/skills",
    "author": "Anthropic",
    "summary": "为报告、幻灯片和 HTML 选择统一字体与颜色，提供 10 套主题，也可按内容创建新主题。",
    "input": "现有文档、演示稿与风格偏好",
    "output": "统一配色与字体方案，以及应用后的内容",
    "features": [
      "先展示主题样张，再选择风格。",
      "同时规范标题、正文与强调色。",
      "支持定制主题并应用到已有产物。"
    ],
    "dependencies": "需要完整 themes 目录与字体；修改目标文件还需对应文档或网页工具。",
    "limitations": "主题方案不等于完整排版引擎；字体可用性和目标软件显示仍需检查。",
    "prompt": "为这份项目汇报推荐两套克制的字体配色方案，选择后统一应用，保持所有数字与正文不变。",
    "tags": [
      "字体配色",
      "主题模板",
      "演示排版"
    ],
    "icon": "palette",
    "scene": 5,
    "level": "需要运行环境",
    "audience": "经常制作报告与演示、希望统一视觉风格的办公用户。",
    "result": "统一配色与字体方案，以及应用后的内容，附过程说明及待确认项。",
    "recommended": "把配色和字体从临时决定变成可复用的主题，适合与文档、演示 Skill 配合。",
    "license": "Apache-2.0",
    "licensePath": "skills/theme-factory/LICENSE.txt"
  },
  {
    "id": "brand",
    "slug": "brand-guidelines",
    "name": "Anthropic 品牌排版参考",
    "category": "设计与排版",
    "repo": "anthropics/skills",
    "author": "Anthropic",
    "summary": "按 Anthropic 的既有品牌规范应用颜色和字体，适合学习品牌一致性的具体实现。",
    "input": "待排版内容与使用 Anthropic 风格的需求",
    "output": "应用指定品牌色与字体的视觉内容",
    "features": [
      "规定标题与正文字体的搭配。",
      "提供主色、背景色和强调色。",
      "处理系统缺少目标字体时的回退。"
    ],
    "dependencies": "可使用系统字体；最佳效果需要 Poppins 与 Lora，编辑产物仍需对应工具。",
    "limitations": "这是 Anthropic 的品牌规范，不是你的品牌生成器；使用品牌标识仍须遵守相关权利要求。",
    "prompt": "演示这套规范中的标题、正文和强调色如何组合，只做内部排版参考，不添加官方背书。",
    "tags": [
      "品牌规范",
      "字体搭配",
      "风格参考"
    ],
    "icon": "palette",
    "scene": 5,
    "level": "需要运行环境",
    "audience": "学习品牌规范落地的设计师，以及明确需要 Anthropic 风格的使用者。",
    "result": "应用指定品牌色与字体的视觉内容，附过程说明及待确认项。",
    "recommended": "保留为一份具体的品牌规范参考；详情明确它不代表 semifly 的品牌。",
    "license": "Apache-2.0",
    "licensePath": "skills/brand-guidelines/LICENSE.txt"
  },
  {
    "id": "artifact",
    "slug": "web-artifacts-builder",
    "name": "可分享的交互报告",
    "category": "网站与设计",
    "repo": "anthropics/skills",
    "author": "Anthropic",
    "summary": "把表单、图表或多组件报告做成 React 页面，再打包成一个可分享的 HTML 文件。",
    "input": "报告内容、交互要求与页面素材",
    "output": "可本地打开的 HTML 与开发源文件",
    "features": [
      "初始化 React、TypeScript 和组件环境。",
      "实现多组件、带状态的交互界面。",
      "将脚本和样式内联到单个 HTML。"
    ],
    "dependencies": "需要 Node.js、包管理器、Bash 及随附构建脚本，首次构建需下载依赖。",
    "limitations": "主要交付网页，不会自动部署；外部数据服务仍需要单独连接与权限。",
    "prompt": "把这些预算数据做成可筛选的交互报告，打包为单个 HTML，本地打开检查，不部署。",
    "tags": [
      "交互报告",
      "HTML",
      "组件"
    ],
    "icon": "layout",
    "scene": 0,
    "level": "需要运行环境",
    "audience": "需要交付交互式报告、计算器或演示页面的产品与运营人员。",
    "result": "可本地打开的 HTML 与开发源文件，附过程说明及待确认项。",
    "recommended": "单文件 HTML 便于分享，补充静态 Word、PDF 和 PPT 之外的交付方式。",
    "license": "Apache-2.0",
    "licensePath": "skills/web-artifacts-builder/LICENSE.txt"
  },
  {
    "id": "lark-doc",
    "slug": "lark-doc",
    "name": "飞书文档编辑",
    "category": "文档与办公",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "读取和编辑在线文档，把会议材料、方案和说明整理成可协作的文档内容。",
    "input": "文档链接、已有正文和修改要求",
    "output": "更新后的云文档内容与改动摘要",
    "features": [
      "读取现有文档结构与正文。",
      "创建或局部修改内容及图片附件。",
      "区分正文编辑与文件管理任务。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。",
    "limitations": "评论、权限和文件移动需使用云空间 Skill；不替代本地 Word 编辑。",
    "prompt": "读取这份飞书文档，整理为项目方案，先列出修改建议，保留原有数据与出处。",
    "tags": [
      "云文档",
      "方案",
      "协作"
    ],
    "icon": "doc",
    "scene": 1,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要飞书文档编辑的团队成员与项目负责人。",
    "result": "更新后的云文档内容与改动摘要，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-doc",
      "lark-shared"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-sheets",
    "slug": "lark-sheets",
    "name": "飞书表格与图表",
    "category": "数据与分析",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "处理飞书电子表格的公式、汇总、格式和图表，让日常运营数据留在在线工作簿里。",
    "input": "在线表格链接、字段定义与统计需求",
    "output": "更新的工作表、公式、汇总及图表",
    "features": [
      "读取单元格、公式与工作表结构。",
      "维护图表、透视表和条件格式。",
      "支持本地 Excel / CSV 导入导出。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。",
    "limitations": "多维表格需用 lark-base；财务模型仍需人工复核公式和业务口径。",
    "prompt": "检查销售表字段，按月份汇总并创建趋势图，保留原始数据，先说明将修改的区域。",
    "tags": [
      "在线表格",
      "公式",
      "透视表"
    ],
    "icon": "chart",
    "scene": 1,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要飞书表格与图表的团队成员与项目负责人。",
    "result": "更新的工作表、公式、汇总及图表，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-sheets",
      "lark-shared"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-base",
    "slug": "lark-base",
    "name": "飞书多维表格管理",
    "category": "数据与分析",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "用字段、记录和视图组织项目数据，适合需求池、客户跟进或活动报名表。",
    "input": "Base 链接、记录字段与管理目标",
    "output": "整理后的字段、记录、视图及统计结果",
    "features": [
      "维护记录、字段和关联关系。",
      "设置视图、表单和统计展示。",
      "理解多维表格与应用模式的资源结构。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。",
    "limitations": "不是普通电子表格；字段结构、权限和批量变更需先检查影响范围。",
    "prompt": "检查这份需求池，提出状态字段和视图方案，先用少量样本验证，不删除任何记录。",
    "tags": [
      "多维表格",
      "项目管理",
      "表单"
    ],
    "icon": "chart",
    "scene": 1,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要飞书多维表格管理的团队成员与项目负责人。",
    "result": "整理后的字段、记录、视图及统计结果，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-base",
      "lark-shared"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-slides",
    "slug": "lark-slides",
    "name": "飞书在线演示文稿",
    "category": "文档与办公",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "直接读取和编辑飞书幻灯片，按页组织标题、正文与视觉布局。",
    "input": "现有演示链接、汇报大纲和素材",
    "output": "在线幻灯片及逐页内容修改说明",
    "features": [
      "创建并读取演示文稿。",
      "按页调整内容与版式。",
      "支持局部替换，保留未修改的页面。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。",
    "limitations": "需要平台支持与权限；不是本地 PPTX 引擎，复杂效果需在飞书内验收。",
    "prompt": "把这份材料整理成 6 页飞书演示稿，先给大纲，确认后创建；每页保留数据来源。",
    "tags": [
      "在线演示",
      "汇报",
      "页面布局"
    ],
    "icon": "slides",
    "scene": 1,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要飞书在线演示文稿的团队成员与项目负责人。",
    "result": "在线幻灯片及逐页内容修改说明，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-slides",
      "lark-shared"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-markdown",
    "slug": "lark-markdown",
    "name": "飞书 Markdown 协作",
    "category": "设计与排版",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "在飞书管理原生 Markdown 文件，查看远端正文、比较版本并编辑内容。",
    "input": "飞书 Markdown 链接与本地草稿",
    "output": "远端 Markdown 更新或版本差异说明",
    "features": [
      "读取与创建原生 Markdown 文件。",
      "上传或局部编辑内容。",
      "比较远端版本与本地稿件差异。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。",
    "limitations": "不负责把 Markdown 转为飞书云文档；纯本地格式整理使用其他 Skill。",
    "prompt": "比较这份飞书 Markdown 和本地草稿，列出差异并生成合并建议，暂不覆盖远端。",
    "tags": [
      "Markdown",
      "版本比较",
      "在线文稿"
    ],
    "icon": "doc",
    "scene": 2,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要飞书 Markdown 协作的团队成员与项目负责人。",
    "result": "远端 Markdown 更新或版本差异说明，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-markdown",
      "lark-shared"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-calendar",
    "slug": "lark-calendar",
    "name": "日程与会议室安排",
    "category": "文档与办公",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "查询会议、忙闲与会议室，帮助你找出适合协作的时间窗口。",
    "input": "参与人、时间范围和会议需求",
    "output": "候选时段、日程清单或会议创建结果",
    "features": [
      "查看近期日程与冲突。",
      "查询多人公共空闲时间。",
      "按要求创建或修改会议安排。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。",
    "limitations": "账号必须有对应日历权限；邀请与预约会产生真实外部操作，应先核对人和时间。",
    "prompt": "查看下周二三位同事的公共空闲时段，推荐 30 分钟会议时间，只列建议，不发送邀请。",
    "tags": [
      "日历",
      "会议室",
      "时间安排"
    ],
    "icon": "clock",
    "scene": 2,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要日程与会议室安排的团队成员与项目负责人。",
    "result": "候选时段、日程清单或会议创建结果，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-calendar",
      "lark-shared"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-task",
    "slug": "lark-task",
    "name": "任务清单与待办",
    "category": "文档与办公",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "把工作拆成任务、子任务和清单，查看负责人、截止时间与完成状态。",
    "input": "项目目标、现有任务与日期信息",
    "output": "任务清单、子任务及进度摘要",
    "features": [
      "读取和更新任务状态。",
      "拆分子任务并组织到清单。",
      "处理任务成员与附件。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。",
    "limitations": "分配任务会影响其他人；未知日期保持待确认，不凭空推断进展。",
    "prompt": "整理本周未完成任务，按截止时间排序，标出缺少负责人的事项，先不要修改任务。",
    "tags": [
      "待办",
      "项目协作",
      "负责人"
    ],
    "icon": "check",
    "scene": 2,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要任务清单与待办的团队成员与项目负责人。",
    "result": "任务清单、子任务及进度摘要，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-task",
      "lark-shared"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-wiki",
    "slug": "lark-wiki",
    "name": "知识库目录整理",
    "category": "文档与办公",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "盘点飞书知识空间与文档节点，整理层级、重复入口和迁移计划。",
    "input": "知识库链接、目录规则与归类目标",
    "output": "目录树、分类建议与节点操作记录",
    "features": [
      "读取知识空间和节点结构。",
      "创建、移动或复制文档节点。",
      "通过云空间工作流组织复杂整理。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。另需 lark-drive。",
    "limitations": "正文编辑要用文档 Skill；移动、成员或权限变更应检查引用与使用者。",
    "prompt": "只读盘点这个知识库，输出目录树和重复主题，给出重组计划，不移动文件。",
    "tags": [
      "知识库",
      "目录",
      "资料管理"
    ],
    "icon": "book",
    "scene": 1,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要知识库目录整理的团队成员与项目负责人。",
    "result": "目录树、分类建议与节点操作记录，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-wiki",
      "lark-shared",
      "lark-drive"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-drive",
    "slug": "lark-drive",
    "name": "云盘文件归档",
    "category": "文档与办公",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "搜索与整理飞书云空间文件，处理文件夹、元数据和本地办公文件导入。",
    "input": "云空间目录、文件清单和归档规则",
    "output": "分类方案、文件索引及导入结果",
    "features": [
      "按条件定位文件与资源。",
      "管理目录和文件元数据。",
      "导入 Word、Excel、Markdown 或 PPTX。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。",
    "limitations": "整理范围不包含文档正文；复制、移动和权限修改要单独确认范围，不自动删除。",
    "prompt": "按项目只读扫描这些文件夹，生成文件索引与归档建议，不移动或删除原文件。",
    "tags": [
      "云盘",
      "文件索引",
      "归档"
    ],
    "icon": "book",
    "scene": 1,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要云盘文件归档的团队成员与项目负责人。",
    "result": "分类方案、文件索引及导入结果，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-drive",
      "lark-shared"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-workflow-meeting-summary",
    "slug": "lark-workflow-meeting-summary",
    "name": "会议纪要汇总",
    "category": "文档与办公",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "汇总一段时间内可访问的会议纪要，提取决策、行动项和未决问题。",
    "input": "会议时间范围、筛选条件与纪要权限",
    "output": "结构化会议回顾、行动项与原文链接",
    "features": [
      "定位指定时间段内的会议。",
      "获取已有纪要或可用逐字稿。",
      "整理报告，可按要求写入云文档。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。另需 lark-meeting、lark-doc。",
    "limitations": "只能处理账号可访问且已产生的会议材料；不能凭空还原未录制会议。",
    "prompt": "汇总本周项目会议，列出决策、负责人和截止日期；未明确的事项标待确认，附原文链接。",
    "tags": [
      "会议纪要",
      "行动项",
      "周报"
    ],
    "icon": "message",
    "scene": 2,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要会议纪要汇总的团队成员与项目负责人。",
    "result": "结构化会议回顾、行动项与原文链接，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-workflow-meeting-summary",
      "lark-shared",
      "lark-meeting",
      "lark-doc"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "lark-workflow-standup-report",
    "slug": "lark-workflow-standup-report",
    "name": "每日工作安排摘要",
    "category": "文档与办公",
    "repo": "larksuite/cli",
    "author": "Lark / 飞书",
    "summary": "把日历和未完成任务合成一份开工摘要，减少在多个页面里查找安排。",
    "input": "指定日期、时区与日程和任务权限",
    "output": "当天会议、待办和需要关注的冲突",
    "features": [
      "读取指定日期的日历安排。",
      "筛选未完成待办与到期任务。",
      "按本地时区生成清晰的工作摘要。"
    ],
    "dependencies": "需要 lark-cli、飞书或 Lark 账号及相应资源权限，并安装 lark-shared；服务套餐与 API 配额以平台为准。另需 lark-calendar、lark-task。",
    "limitations": "是日程与任务汇总，不是自动定时器；定时执行需另配调度。",
    "prompt": "列出明天的会议和到期未完成任务，按上海时区排序，指出时间冲突，不发送消息。",
    "tags": [
      "每日安排",
      "日程待办",
      "摘要"
    ],
    "icon": "clock",
    "scene": 2,
    "level": "需要飞书账号",
    "audience": "在飞书或 Lark 中协作，日常需要每日工作安排摘要的团队成员与项目负责人。",
    "result": "当天会议、待办和需要关注的冲突，附过程说明及待确认项。",
    "recommended": "来自 Lark CLI 原始仓库，按明确的业务对象拆分；适合已使用飞书的团队，并提供可追溯的账号与资源边界。",
    "installSkills": [
      "lark-workflow-standup-report",
      "lark-shared",
      "lark-calendar",
      "lark-task"
    ],
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "md-format",
    "slug": "baoyu-format-markdown",
    "name": "中文 Markdown 排版",
    "category": "设计与排版",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "整理文章标题、摘要、层级和列表，再处理中文标点及中英文间距，保留可继续编辑的 Markdown。",
    "input": "原始文章或 Markdown 与排版目标",
    "output": "带标题层级和摘要的格式化 Markdown",
    "features": [
      "分析读者需要的信息结构。",
      "补齐标题、摘要和必要元数据。",
      "通过脚本整理标点、空格与排版细节。"
    ],
    "dependencies": "需要 Bun 或可运行 npx 的 Node.js，以及随附排版脚本。",
    "limitations": "不自动核实文章事实；排版不应改变原意，最终需对照原文复核。",
    "prompt": "排版这份中文文章，统一标题与列表、中英文间距，保留数字、引用和含义，另存新文件。",
    "tags": [
      "中文排版",
      "Markdown",
      "中英文间距"
    ],
    "icon": "doc",
    "scene": 2,
    "level": "需要运行环境",
    "audience": "写公众号、技术博客、知识库和工作文稿的中文内容作者。",
    "result": "带标题层级和摘要的格式化 Markdown，附过程说明及待确认项。",
    "recommended": "中文标点、中英文间距和标题层级是高频问题，适合中文办公内容整理。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "md-html",
    "slug": "baoyu-markdown-to-html",
    "name": "公众号风格 HTML 排版",
    "category": "设计与排版",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "将 Markdown 转成带主题样式的 HTML，支持代码、公式、图示与文末引用，方便继续编辑和粘贴。",
    "input": "Markdown 正文、主题与引用展示要求",
    "output": "带排版样式的 HTML 文件及转换说明",
    "features": [
      "应用可选主题与强调颜色。",
      "处理代码高亮、脚注和数学公式。",
      "可将外链整理为底部引用。"
    ],
    "dependencies": "需要 Bun 或 npx；Mermaid 渲染需要无头 Chrome，公式和绘图依赖按原作者说明配置。",
    "limitations": "这里只转换文件，不发布公众号；粘贴后样式兼容需在目标编辑器实测。",
    "prompt": "把这篇 Markdown 转成简洁的公众号 HTML，保留标题和外链引用，输出文件，不发布。",
    "tags": [
      "HTML",
      "公众号排版",
      "脚注"
    ],
    "icon": "layout",
    "scene": 2,
    "level": "需要运行环境",
    "audience": "需要把 Markdown 草稿转成公众号或网页正文的内容运营人员。",
    "result": "带排版样式的 HTML 文件及转换说明，附过程说明及待确认项。",
    "recommended": "把文稿结构与展示样式分开，适合保留可维护的源稿并反复导出。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "visual-slides",
    "slug": "baoyu-slide-deck",
    "name": "视觉型幻灯片设计",
    "category": "设计与排版",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "先组织演讲大纲与逐页视觉说明，再生成幻灯片图片，可组合成 PDF 或图片式 PPTX。",
    "input": "演示主题、内容资料、页数与风格",
    "output": "逐页幻灯片图片，以及组合后的演示文件",
    "features": [
      "按内容生成逐页大纲。",
      "选择统一视觉风格与尺寸。",
      "生成图片并组合为演示文件。"
    ],
    "dependencies": "需要可用的图片生成工具或配套 baoyu-image-gen；可能消耗图像模型额度或 API 费用，需配置对应账号。打包脚本需要 Bun 或 npx。",
    "limitations": "主要是图片式幻灯片，不承诺每个文字对象可编辑；准确数字和中文文字需逐页检查。",
    "prompt": "为这份产品资料设计 6 页视觉演示，先给逐页大纲；不得新增数据，图片式页面需清楚标注。",
    "tags": [
      "视觉演示",
      "图片式 PPT",
      "演讲大纲"
    ],
    "icon": "slides",
    "scene": 5,
    "level": "需要运行环境",
    "audience": "更重视演讲视觉表达、可以接受图片式页面的培训与展示用户。",
    "result": "逐页幻灯片图片，以及组合后的演示文件，附过程说明及待确认项。",
    "recommended": "补充传统可编辑 PPT 的另一种视觉交付路径，并明确图片式页面的限制。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "infographic",
    "slug": "baoyu-infographic",
    "name": "业务信息图设计",
    "category": "设计与排版",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "把流程、对比和多层信息组织成一张信息图，先选布局和视觉风格，再生成图片。",
    "input": "事实材料、数据与目标阅读场景",
    "output": "结构化内容、图像提示及信息图文件",
    "features": [
      "分析内容适合的布局类型。",
      "组合布局与视觉风格。",
      "保留源数据并组织生成提示。"
    ],
    "dependencies": "需要可用的图片生成工具或配套 baoyu-image-gen；可能消耗图像模型额度或 API 费用，需配置对应账号。",
    "limitations": "文字与图中数值需要人工逐项核对；不等同于可编辑矢量图或数据图表引擎。",
    "prompt": "把这个业务流程做成信息图，保留步骤顺序和所有数值，先提供布局建议与文字清单。",
    "tags": [
      "信息图",
      "流程对比",
      "可视化"
    ],
    "icon": "chart",
    "scene": 5,
    "level": "需要运行环境",
    "audience": "需要解释流程、产品对比或复杂信息的运营、培训与设计人员。",
    "result": "结构化内容、图像提示及信息图文件，附过程说明及待确认项。",
    "recommended": "适合把分散的信息整理到一张图中，先确认内容和布局再调用图像工具。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "cover",
    "slug": "baoyu-cover-image",
    "name": "文章与报告封面",
    "category": "设计与排版",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "根据文章主题规划封面类型、配色、表现方式和情绪，生成适配不同版面的封面图。",
    "input": "标题、内容摘要、参考图与宽高比",
    "output": "封面图片和可复用的生成提示",
    "features": [
      "按内容选择封面构图。",
      "支持宽屏、方形等画幅。",
      "把参考风格和必要文字写入提示。"
    ],
    "dependencies": "需要可用的图片生成工具或配套 baoyu-image-gen；可能消耗图像模型额度或 API 费用，需配置对应账号。",
    "limitations": "图片生成可能收费；不能保证一次就得到准确中文字或品牌一致性。",
    "prompt": "为这篇城市观察报告做一张 16:9 封面，克制简洁，不添加未提供的标志，先确认构图。",
    "tags": [
      "文章封面",
      "报告视觉",
      "构图"
    ],
    "icon": "palette",
    "scene": 5,
    "level": "需要运行环境",
    "audience": "为文章、研究报告和活动资料制作封面的编辑与设计人员。",
    "result": "封面图片和可复用的生成提示，附过程说明及待确认项。",
    "recommended": "将画幅、配色和文案要求提前说清，减少封面生成中的反复沟通。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "illustrations",
    "slug": "baoyu-article-illustrator",
    "name": "长文配图规划",
    "category": "设计与排版",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "分析文章结构，找到真正需要解释的段落，再按统一风格生成配图并整理插入位置。",
    "input": "文章正文、目标读者与配图风格",
    "output": "插图清单、实际图片及文章放置建议",
    "features": [
      "识别适合用图解释的信息。",
      "按类型、风格与配色统一画面。",
      "保存逐张提示及参考资料。"
    ],
    "dependencies": "需要可用的图片生成工具或配套 baoyu-image-gen；可能消耗图像模型额度或 API 费用，需配置对应账号。",
    "limitations": "配图是表达工具，不能作为事件现场照片或事实证据；使用前检查版权与图中文字。",
    "prompt": "为这篇教程规划 3 张解释性配图，先列每张图要解决的问题，不把示意图说成真实现场。",
    "tags": [
      "文章插图",
      "内容设计",
      "统一风格"
    ],
    "icon": "palette",
    "scene": 5,
    "level": "需要运行环境",
    "audience": "需要为长文、教程或业务说明补充解释性图片的内容作者。",
    "result": "插图清单、实际图片及文章放置建议，附过程说明及待确认项。",
    "recommended": "先决定哪里需要图、图要解释什么，避免为配图而配图。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "compress",
    "slug": "baoyu-compress-image",
    "name": "图片压缩与 WebP 转换",
    "category": "设计与排版",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "批量压缩文章或网页图片，按本机工具选择转换方式，控制文件体积并输出 WebP 或 PNG。",
    "input": "图片文件、体积目标与保留原图要求",
    "output": "压缩后的图片和处理结果说明",
    "features": [
      "检测可用的图像处理工具。",
      "支持单图和目录批量处理。",
      "设置格式、质量与是否保留源图。"
    ],
    "dependencies": "需要 Bun 或 npx；根据系统使用 sips、cwebp 或相关图像库。",
    "limitations": "默认行为可能替换原图，建议显式使用 --keep；透明度与画质要抽样检查。",
    "prompt": "将这个目录的图片转为 WebP，保留所有原文件（--keep），列出前后体积并检查透明背景。",
    "tags": [
      "图片压缩",
      "WebP",
      "网页素材"
    ],
    "icon": "palette",
    "scene": 5,
    "level": "需要运行环境",
    "audience": "需要优化网页加载、文章附件或批量图片体积的内容与前端人员。",
    "result": "压缩后的图片和处理结果说明，附过程说明及待确认项。",
    "recommended": "文件体积优化是常见收尾任务，输入输出清楚，便于比较实际收益。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "translate",
    "slug": "baoyu-translate",
    "name": "长文翻译与术语统一",
    "category": "文档与办公",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "按快速、标准或精修方式翻译文章，结合术语表处理长文本，让同一术语在全文保持一致。",
    "input": "原文、目标语言和已有术语表",
    "output": "译文、术语处理及需要确认的歧义",
    "features": [
      "按需求选择翻译深度。",
      "将长文本拆分为可处理段落。",
      "用术语表保持表达一致。"
    ],
    "dependencies": "需要支持文件读写的 Agent；网页输入可能另需抓取工具，模型调用按所用服务计费。",
    "limitations": "专业、法律或合同文本需人工复核；不把语义不确定的内容强行译成确定事实。",
    "prompt": "将这份产品说明翻译成中文，沿用术语表，保留数字与链接，将歧义列在文末。",
    "tags": [
      "中英翻译",
      "术语表",
      "长文"
    ],
    "icon": "doc",
    "scene": 2,
    "level": "需要运行环境",
    "audience": "处理双语产品资料、海外文章和长文档的编辑与业务人员。",
    "result": "译文、术语处理及需要确认的歧义，附过程说明及待确认项。",
    "recommended": "把术语一致性和翻译深度显式化，比零散逐段翻译更容易复核。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "web-clip",
    "slug": "baoyu-url-to-markdown",
    "name": "网页资料转 Markdown",
    "category": "文档与办公",
    "repo": "jimliu/baoyu-skills",
    "author": "宝玉 · Jim Liu",
    "summary": "把可访问的网页提取成 Markdown，保留正文结构，方便归档、引用和后续整理。",
    "input": "网页地址与保存目录、媒体保留选项",
    "output": "Markdown 正文及可选本地媒体文件",
    "features": [
      "借助浏览器读取网页正文。",
      "针对常见站点使用对应提取方式。",
      "按需要保留媒体并整理本地路径。"
    ],
    "dependencies": "需要 Bun、Chrome 与随附 CLI 依赖；需要登录的页面由用户自行完成授权。",
    "limitations": "无法保证所有动态网页提取完整；不绕过访问限制，保存内容仍受原站版权约束。",
    "prompt": "将这个公开网页转成 Markdown，保留标题和原链接，不下载媒体，检查正文是否完整。",
    "tags": [
      "资料收集",
      "网页剪藏",
      "Markdown"
    ],
    "icon": "book",
    "scene": 2,
    "level": "需要运行环境",
    "audience": "需要收集公开网页、建立本地资料库的研究和办公用户。",
    "result": "Markdown 正文及可选本地媒体文件，附过程说明及待确认项。",
    "recommended": "把网页转换为可检索的文本材料，便于继续引用、整理与写作。",
    "license": "MIT",
    "licensePath": "LICENSE"
  },
  {
    "id": "impeccable",
    "slug": "impeccable",
    "name": "界面排版与设计精修",
    "category": "设计与排版",
    "repo": "pbakaus/impeccable",
    "author": "Paul Bakaus",
    "summary": "针对现有页面检查层级、排版、间距、交互和响应式，并按问题做有范围的精修。",
    "input": "已有页面源码、截图或待改善的问题",
    "output": "具体设计改动、页面代码与验收结果",
    "features": [
      "支持排版、文案和布局专项调整。",
      "关注无障碍、响应式和异常状态。",
      "提供检测工具与设计上下文工作流。"
    ],
    "dependencies": "需要代码读写、原 Skill 工具脚本；浏览器验收和构建依赖当前项目环境。",
    "limitations": "不是一条命令自动完成所有设计；要指定范围，避免改变已确认的品牌和业务行为。",
    "prompt": "仅精修当前报告页的排版、行距和手机布局，保持品牌与事实内容，给出修改前后检查结果。",
    "tags": [
      "界面精修",
      "排版",
      "响应式"
    ],
    "icon": "layout",
    "scene": 0,
    "level": "需要运行环境",
    "audience": "希望改善现有产品界面、文案和排版的设计师与前端开发者。",
    "result": "具体设计改动、页面代码与验收结果，附过程说明及待确认项。",
    "recommended": "提供细分的排版和界面精修入口，适合已有页面的渐进改进。",
    "license": "Apache-2.0",
    "licensePath": "LICENSE"
  },
  {
    "id": "taste",
    "slug": "design-taste-frontend",
    "name": "品牌网页视觉设计",
    "category": "网站与设计",
    "repo": "leonxlnx/taste-skill",
    "author": "Leonxlnx",
    "summary": "从品牌与真实内容出发完成网站视觉设计，包含布局、图片、字体、动效与浏览器检查流程。",
    "input": "品牌约束、真实文案、素材和页面目标",
    "output": "实现后的网页与多尺寸验收记录",
    "features": [
      "按网站类型规划信息与视觉。",
      "选择与品牌匹配的布局和素材。",
      "结合检查脚本进行多尺寸验收。"
    ],
    "dependencies": "需要 Node.js 22+、Chrome 等浏览器及完整脚本资源；素材生成或外部工具可能另计费。",
    "limitations": "工作流较完整且有明确审美约束；适合整页设计，简单文字修改不必启用全部流程。",
    "prompt": "基于我们的品牌和现有文案做一个产品介绍页，先确认内容结构，再实现并检查手机显示，不上线。",
    "tags": [
      "品牌网页",
      "视觉设计",
      "浏览器验收"
    ],
    "icon": "layout",
    "scene": 0,
    "level": "需要运行环境",
    "audience": "需要完整品牌网站视觉和浏览器验收流程的设计工程师。",
    "result": "实现后的网页与多尺寸验收记录，附过程说明及待确认项。",
    "recommended": "在公开安装榜上具有较高使用量，适合对整页视觉一致性有要求的项目。",
    "folder": "taste-skill",
    "license": "MIT",
    "licensePath": "LICENSE"
  }
]);
