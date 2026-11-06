# 供应商模块首步交接

2026-11-07，oneapi。用户要求从企业权限继续到供应商模块；旧 api.glocalstorage.cn 保持独立。

本阶段实现内部供应管理台：供应商档案、供应产品草稿、七项人工资料核验、岗位隔离与审计。`#ops/supply` 是真实数据库页面；原 `#supply` 仍是公开说明。员工岗位 supply/platform_admin 可改，operations/finance 可读；客户不可访问员工接口。数据库迁移 `002_supply.sql` 幂等，不包含供应商密钥。产品不可标记为正式销售；`sale_ready=false`。

角色补丁同时允许企业代表人将企业员工改为代表人，再改回员工，保留最后一位有效代表人保护。企业员工预算、模型授权和 Token 消费仍须真实资金/调用系统接入。

测试：使用本机隔离 PostgreSQL 的 `npm test`，包含供应商权限、草稿、核验、阻止暂停供方新增产品与审计。上线后核对 `/api/status`、`/release.json`、员工管理台以及旧域名健康。下一步按 `docs/phase-1/07-supplier-operations.md` 建正式供方账户、合同授权、受控凭据、真实模型探测、采购计量/账单、商品发布门禁。
