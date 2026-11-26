# 公网个人密钥页小数金额故障修复

## 已完成

- 用户报告登录后 `#personal/keys` 无法显示。在用户现有 Chrome 登录页复现 `Cannot convert 0.0000000000 to a BigInt`，并非认证或权限失败。
- `/api/customer-credit/status` 的 `list_credit_fen` 来自 PostgreSQL numeric(30,10)。预览此前只使用整数字符串，未覆盖真实返回格式。
- 修复提交 `0e94c873d18f13b1b0f373b9e45f5ed91a222df7`：前端 wholeFen 按字符串提取整分，供金额显示及最低整分额度检查；同时修复通用/专属 Key 接入与创建流程。精确余额、账单与服务器计费不变，避免 Number 转换丢失大整数精度。
- 15 个密钥流程测试通过；包括真实十位小数格式、零余额、非零小数和大整数。合入设置页后共 18 个相关测试通过。
- 用生产格式模拟余额，本地确认零余额密钥页、有余额密钥页、通用及专属 Key 接入页均可加载。
- 标准 `scripts/publish_shanghai.sh` 完成备份、迁移、容器与前端切换，退出 0。
- 发布目录 `/srv/oneapi-data/oneapi-cutover-q72dymap/releases/0e94c873d18f.hvd05v`。
- 公网 `/api/status`、`/release.json` 均为上述 SHA，status=ok。
- 用户原有 Chrome 登录页刷新后密钥列表正常显示；用量页显示已有调用记录，无浏览器错误。最后返回密钥页并保留标签。未变更用户密码、密钥、余额或数据。

## 源码与下一步

- 独立修复工作树 `~/.worktrees/oneapi/account-decimal-hotfix`，分支 `codex/account-decimal-hotfix`。
- 常驻主工作区已提交设置页 `229de24`，并在 `f46f9de` 合入公网修复，已推送 main。
- **设置页尚未上线**，生产仅包含本次小数修复与此前已上线功能。
- 验证时另发现已有导航问题：从 keys 点击概览，URL 变为 #personal，但仍保留 personalTab=keys；再次点击概览才会更新。根因是 personal-tab 处理在设置 personalTab 前跳转，而 account 对根路由保留旧 tab。后续设置页发布时应补上此导航回归；本次紧急发布未扩大范围。
- 临时格式预览 `/private/tmp/oneapi-decimal-preview.py`，端口 4184，仅模拟数据。
