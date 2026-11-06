# Semifly / OneAPI 品牌、入口与图标规范

2026-11-06 用户反馈后的当前规范。沿用珍珠白与光谱色；补充企业品牌、客户入口和图标规则。原始 reference 快照保留作历史记录，以本文增量规则为准。

## 客户优先的入口

- 欢迎页用一个紧凑的选择区切换个人与企业团队，只有一个随选择变化的主按钮；不再做两个大入口卡片。企业所有者、管理员、财务、普通成员走同一企业入口，根据服务端授权显示能力。
- 平台员工指深圳市格洛可半导体有限公司自己的运营、供应、财务、客服等人员。入口收在全站右上角“管理台”，不再与客户并列大卡片。
- `#staff` 是内部管理台的独立预览说明页，`#admin` 是运营界面。当前都是静态演示，入口位置不构成访问控制；真实上线必须在服务端验证独立员工身份和权限。

## 企业品牌与产品名

- 页头使用用户品牌包的 `semifly-wordmark-primary.svg` 原版矢量，保留 TM、轮廓、颜色和留白。OneAPI 作为产品标签，不重命名仓库或业务主体。
- `web/semifly-wordmark.svg` 用于导航，`web/semifly-lockup.svg` 保留带 semifly.ai 的完整组合标。没有修改域名、运营主体或站点地址。
- 来源：semifly-brand-pack，README 标记 2026.06。源码中不依赖品牌包的本机路径。
- 品牌墨黑 `#1A1F26`，品牌橙 `#FF7A30`；背景 `#F5F7FB`、白卡片、操作蓝 `#2563EB`、辅助青 `#06B6D4` 和紫 `#8B5CF6`。
- 橙色用于品牌，不直接用来表达错误、成功或所有主操作；状态同时给出文字说明。

## 统一图标

- 全站功能图标采用 Lucide SVG，固定 lucide-static 1.70.0，只包含用到的图标，离线自托管，来源与完整性记录见 `../icons/source.json`。
- 24 × 24 坐标网格、2 单位描边、圆端点和圆转角、currentColor；默认 18px，按钮 16px，导航 19px，图标容器 24–28px。
- 在静态和动态模板里写 `<span data-icon="user-round"></span>`；`web/icons.js` 负责生成 SVG，动态内容也自动处理。不要用 emoji、Unicode 几何字符或其他图标库拼凑导航。
- 装饰 SVG 使用 aria-hidden；图标按钮必须有可见文本或 aria-label。保留 `⌘ K` 等真实键盘提示、货币和乘号等文字符号。
- 语义：个人 user-round、企业 building-2、管理 shield-check、成员 users-round、预算 arrow-left-right、供应 server、模型 layers、资金 receipt-text、促销 gift、通知 bell、设置 settings。
- 模型及客户端旁的图标是通用能力图标，不冒充厂商 Logo；semifly 使用企业原版品牌资产，不替换成 Lucide 图标。
- 版权随部署产物附带 `THIRD-PARTY-LICENSES.txt`（Lucide ISC 与源自 Feather 的 MIT），不要删去。

## Figma 与代码的对应

现存对话资料没有找到此前“Figma 协议”的准确约定，不能声称已恢复或已接通。

Figma MCP 是让 AI 获取设计上下文、变量和组件的连接协议；Lucide 是图标系统。未来接入 Figma 时，对齐这些语义变量与组件，而不是重新选择一套视觉：

| Figma 变量 / 组件 | 代码 |
| --- | --- |
| color/surface/page | --bg |
| color/text/primary | --ink |
| color/action/primary | --blue |
| color/brand/orange | --brand-orange |
| color/brand/ink | --brand-ink |
| Brand/Semifly | .brand-wordmark，原版 SVG |
| Icon/UserRound | data-icon="user-round" |
| Entry/Customer | .welcome-choices / .welcome-continue |
| Entry/Staff | .management-link / .staff-card |

官方参考：[Lucide](https://lucide.dev/guide/lucide)、[许可证](https://lucide.dev/license)、[Figma MCP](https://developers.figma.com/docs/figma-mcp-server/)。本次没有安装 Figma 插件，也未创建或修改 Figma 文件。


## 欢迎页视觉修订（2026-11-06）

用户明确否定之前“两个大登录卡片”的工程化外观，要求年轻、科技、跳动、欢快。`#login` 是客户进入工作空间前的欢迎页，首页 `#market` 仍是模型广场。

- 欢迎页独立排版：上方企业品牌与低调管理台；左侧大字和橙色原创轨道花形插画；右侧单一进入区域。避免照搬后台卡片和开发预览导航。
- 个人模式采用淡紫背景 #F0EDFA、紫色标题 #6052C7；企业模式转换为浅绿 #EAF2EF、深绿 #3A7C69。品牌橙 #FF7A30 承担图形与动作点缀，CTA 墨色 #2A2636。这组表达性颜色限定欢迎页，既有工作台语义色保持不变。
- Lucide 继续承担功能图标；原创 SVG 是装饰插画，aria-hidden，不作为品牌 Logo。
- 花形慢速旋转、球体轻浮动；可显式暂停，并尊重 prefers-reduced-motion。欢迎页无必需外部字体、图片或 CDN。
- 选择个人/企业只更新文案和目标路由；没有假登录表单或虚构登录成功。真实认证未接通的状态在主按钮下明确说明。
- 手机竖向排版，插画与正文留出空间；不把桌面两栏硬缩成小卡片。
