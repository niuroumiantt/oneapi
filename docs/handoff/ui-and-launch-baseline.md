# UI 与首期基线交接（2026-11-06，m5）

## 目标
按用户确认的风格深化 OneAPI 五模块并上线，同时将视觉规范交给另一对话用于 glocal dmg。

## 已定规则
- 珍珠白 #F5F7FB、白卡片、蓝 #2563EB、青 #06B6D4、紫 #8B5CF6；后台高密度。
- 重点：员工/客户登录权限、供应商/产品验证、模型广场、付费、促销；按依赖并行。
- 中国首轮直接公众注册；主体深圳市格洛可半导体有限公司，新版域名 oneapi.glocalstorage.cn；旧 api.glocalstorage.cn 保留。
- 中国阿里云，海外 AWS，核心代码共享，地区数据/账户/资金独立。
- glocal dmg 改造在另一对话；沿用其真实技术栈与业务，不搬 OneAPI 演示业务。

## 进度
- 已完成：私有 UI 预览、桌面与窄屏检查、主要演示交互；用户确认风格。
- 已完成：原型快照及设计 token/迁移指导归档；0.4 决定和上线设计基线更新。
- 尚未完成：真实认证、供应商接入、支付和促销业务实现；未变更 DNS；阿里云已发布独立静态预览，真实业务和 AWS 部署尚未完成。

## 下一步
1. 本仓库先读 README、docs/phase-1/08-launch-baseline.md 与决定记录，细化身份授权和供应验证契约后实现。
2. 核实商户/采购账户、服务器/DNS与域名手续；用户未提供凭据，不要在 Git 或聊天中收集明文秘密。
3. glocal dmg 对话读取 design/spectrum/handoff-glocal-dmg.md，检查真实仓库，再覆盖其相关界面。

## 待决定
实际商户和采购账户状态、上线商品/客户端版本、价格/促销/佣金、海外域名和主体、人员与上线日期。不要再次询问已确认的中国主体、域名、视觉方向或公众注册方式。

## 入口
- docs/phase-1/08-launch-baseline.md
- docs/10-decisions-and-open-questions.md
- design/spectrum/README.md 与 handoff-glocal-dmg.md
- 私有原型：https://oneapi-spectrum-preview.niuroumiantt.chatgpt.site

最新阶段见 [阿里云部署交接](oneapi-aliyun.md) 和 [企业工作台设计](../phase-1/09-enterprise-workspace.md)。
