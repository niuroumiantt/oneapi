// Actual local execution evidence. Never infer broader compatibility from these samples.
window.SKILL_TESTS = {
  dungeon:{status:'样本实测通过',tone:'passed',date:'2026-11-17',headline:'3 轮真实输出：玩家选择与状态回顾',summary:'读取已安装的原 Skill，以真实上一轮输出作为下一轮上下文，完成开场、指定行动、暂停回顾三轮测试。',checks:['保留林舟、灯、绳子与已获得的蓝纸','尊重“不转铜盘、不下石阶”的明确选择','暂停回顾未替玩家解谜或推进事件'],limits:'采用三次临时会话回放上下文；未验证长战役、跨会话存档或 OneAPI 模型组合。',runtime:'Codex CLI 0.160.0 · macOS · skills@1.9.0',files:[['第一轮输出','turn-1.md'],['第二轮输出','turn-2.md'],['第三轮输出','turn-3.md']]},
  gif:{status:'补齐依赖后通过',tone:'conditional',date:'2026-11-17',headline:'真实 GIF：橘猫挥手，20 帧 / 2 秒',summary:'首次执行因缺少 imageio 失败。独立虚拟环境补齐原作者依赖后，同一份模型生成脚本调用原始 GIFBuilder 成功输出动画。',checks:['128×128 像素、20 帧、每帧 100 ms','无限循环，整体时长 2000 ms','独立重开文件检查尺寸、颜色、循环与帧数'],limits:'原 Skill 未修改；仅本地生成和文件检查，未上传 Slack。真实效果见动画，场景封面不作为实测证据。',runtime:'Codex CLI 0.160.0 · Python 3.12.14 · 独立 .venv',files:[['下载实际 GIF','cat-wave.gif'],['生成脚本','make_gif.py'],['成功验证记录','result.json'],['首次失败记录','result-first-attempt.json']]},
  pdf:{status:'样本实测通过',tone:'passed',date:'2026-11-17',headline:'3 页 PDF：12 / 12 个字段核对一致',summary:'Agent 使用已安装 PDF Skill 编写并执行提取脚本；3 条记录的名称、日期、预算与页码全部匹配预留标准答案。',checks:['3 条记录、12 个字段逐项相等','第 3 条缺失日期保留为 null','预算精度与原始页码保留；提取时输入文件未改变'],limits:'人工构造的文字 PDF，未测试扫描 OCR、复杂表格或加密文件；本地重跑修正了样本标题的缺字分隔符，字段数据未改变。',runtime:'Codex CLI 0.160.0 · pdfplumber 0.11.9 · pypdf 6.21.4',files:[['输入 PDF','fixture.pdf'],['提取 CSV','extracted.csv'],['提取 JSON','extracted.json'],['执行报告','report.md']]},
  react:{status:'样本实测通过',tone:'passed',date:'2026-11-17',headline:'静态代码审查：识别 3 / 3 项预植入问题',summary:'按已安装的 React 性能指南审查独立样本，识别请求瀑布、lodash 根入口导入和搜索旧响应覆盖问题。',checks:['三个发现与保留的验收答案逐项对应','报告包含文件行号与修改建议','未将正常文本插值误报为 XSS，未修改输入源码'],limits:'仅静态审查；没有构建、测速或性能提升数据。竞态发现正确，但引用的 client-swr-dedup 是相关上位规则，不是专门的竞态规则。',runtime:'Codex CLI 0.160.0 · vercel-react-best-practices 1.0.0',files:[['输入代码','ReviewFixture.tsx'],['完整审查报告','report.md'],['发现 JSON','findings.json'],['验收标准','expected.json']]}
};

Object.assign(window.SKILL_TESTS, {
  "docx": {
    "status": "补齐字体后通过",
    "headline": "1 页活动复盘，2 张可编辑表格",
    "summary": "实际安装原始 docx Skill，由 Agent 生成 Word 文件。原验证器通过；首次 PDF 中文缺字，配置临时中文字体后，同一 DOCX 渲染正常。",
    "checks": [
      "A4 单页，费用表与行动表均为 Word 原生表格",
      "预算 18,000、支出 16,420、余额 1,580 与输入一致",
      "保留“待确认”和满意度数据缺失，没有编造结论"
    ],
    "limits": "基于虚构业务材料；使用 LibreOffice 渲染并逐页目检，未在 Microsoft Word 中打开验收。",
    "files": [
      [
        "下载 Word",
        "output.docx"
      ],
      [
        "PDF 预览",
        "output.pdf"
      ],
      [
        "原始输入",
        "input.md"
      ],
      [
        "原执行报告",
        "report.md"
      ],
      [
        "最终核验",
        "final-verification.json"
      ]
    ],
    "date": "2026-11-17",
    "tone": "conditional",
    "runtime": "Codex CLI 0.160.0 · macOS · skills@1.9.0 · 临时项目安装",
    "caption": "真实生成文件经 LibreOffice 渲染后的预览页截图；不是 Microsoft Office 客户端截图。",
    "cardImage": "tests/docx/card.jpg"
  },
  "sheet": {
    "status": "本地适配后重算通过",
    "headline": "11 个公式约 1.4 秒重算，保留原表格与图表",
    "summary": "原宏调用在本机超时；新增本地适配器，先清除临时副本的旧缓存并用 LibreOffice 计算，再由原 Skill 写回公式缓存。基准、带旧缓存改价、重复执行、除零与超时保护均已实际测试。",
    "checks": [
      "11 个公式、0 错误；9 月 1,516、10 月 2,824、合计 4,340",
      "保留旧缓存改价 68→70 后，9 月 1,540、合计 4,364",
      "公式文本及图表、样式等非工作表部件未改变；重复重算无变化",
      "除零错误如实报告；强制超时返回失败且输入文件不变"
    ],
    "limits": "这是固定版本的本站本地适配，原作者脚本本身未修改，直接运行原脚本仍可能超时。只验证所列 XLSX 样本与故障分支，未在微软 Excel 客户端验收。",
    "files": [
      [
        "下载修复后 Excel",
        "fixed.xlsx"
      ],
      [
        "修复说明与用法",
        "fix-report.md"
      ],
      [
        "本地重算适配器",
        "recalc-local.py"
      ],
      [
        "实际回归结果",
        "recalc-fixed-result.json"
      ],
      [
        "保留旧缓存改价样本",
        "fixed-mutation.xlsx"
      ],
      [
        "原始 Excel",
        "output.xlsx"
      ],
      [
        "PDF 预览",
        "output.pdf"
      ],
      [
        "首次超时报告",
        "report.md"
      ],
      [
        "最终核验",
        "final-verification.json"
      ]
    ],
    "date": "2026-11-17",
    "tone": "conditional",
    "runtime": "Codex CLI 0.160.0 · macOS · skills@1.9.0 · 临时项目安装",
    "caption": "真实生成文件经 LibreOffice 渲染后的预览页截图；不是 Microsoft Office 客户端截图。",
    "cardImage": "tests/sheet/card.jpg"
  },
  "slides": {
    "status": "修正并渲染后通过",
    "headline": "4 页复盘：原生图表、行动表与讲稿",
    "summary": "实际安装 pptx Skill，Agent 使用 PptxGenJS 生成 16:9 演示文稿。运行中修正占位符写法并配置中文字体，重新生成后通过原验证器与逐页渲染检查。",
    "checks": [
      "4 页幻灯片，每页都有备注讲稿",
      "1 张原生柱状图、1 张原生表格、1 个内嵌数据工作簿",
      "无整页栅格图片；金额、负责人和待确认日期均与输入一致"
    ],
    "limits": "可编辑性依据 OOXML 原生对象结构检查，未在 Microsoft PowerPoint 中交互编辑。仅测试这份 4 页虚构材料。",
    "files": [
      [
        "下载 PPT",
        "output.pptx"
      ],
      [
        "PDF 预览",
        "output.pdf"
      ],
      [
        "原始输入",
        "input.md"
      ],
      [
        "执行报告",
        "report.md"
      ],
      [
        "最终核验",
        "final-verification.json"
      ]
    ],
    "date": "2026-11-17",
    "tone": "conditional",
    "runtime": "Codex CLI 0.160.0 · macOS · skills@1.9.0 · 临时项目安装",
    "caption": "真实生成文件经 LibreOffice 渲染后的预览页截图；不是 Microsoft Office 客户端截图。",
    "cardImage": "tests/slides/card.jpg"
  },
  "md-html": {
    "status": "HTML 转换与预览通过",
    "headline": "Markdown → 红色主题公众号 HTML",
    "summary": "实际安装 baoyu-markdown-to-html 及其锁定依赖，执行原始转换脚本，生成带标题、费用表、引用、代码块和行动清单的 HTML。",
    "checks": [
      "原脚本成功输出 HTML，9 项结构检查通过",
      "真实浏览器桌面与 390px 移动宽度均可阅读，无横向溢出",
      "保留 Markdown 来源链接、表格金额和“待确认”"
    ],
    "limits": "本地 HTML 转换与浏览器预览已通过。2026-11-17 尝试访问公众号编辑器，被浏览器站点安全策略阻止；没有完成微信粘贴验收，也未发布。需人工粘贴核对后补证。",
    "files": [
      [
        "打开真实 HTML",
        "input.html"
      ],
      [
        "原始 Markdown",
        "input.md"
      ],
      [
        "转换记录",
        "conversion.json"
      ],
      [
        "执行报告",
        "report.md"
      ],
      [
        "手机截图",
        "mobile.jpg"
      ],
      [
        "最终核验",
        "final-verification.json"
      ],
      [
        "微信人工验收步骤",
        "wechat-check.html"
      ]
    ],
    "date": "2026-11-17",
    "tone": "conditional",
    "runtime": "Codex CLI 0.160.0 · macOS · skills@1.9.0 · 临时项目安装",
    "caption": "实际 HTML 的本地浏览器截图，不是微信编辑器截图；微信粘贴验收仍待完成。",
    "cardImage": "tests/md-html/card.jpg"
  }
});
