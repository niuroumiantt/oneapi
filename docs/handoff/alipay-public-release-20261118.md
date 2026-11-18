# 支付宝全用户开放与服务器恢复（2026-11-18，m5）

## 已完成
- 用户明确授权普通重启青岛 ECS、恢复同机业务、取消支付宝白名单并更新公网；未强制重启，未执行真实付款。
- ECS i-m5e9tgl6evbqgavhfm29 普通重启后恢复。OA 曾因启动时 oa-db DNS 尚未就绪而退出；数据库健康后启动 oa-cn-oa-1，恢复 healthy。
- 九个公网入口已核对：官网、api、oneapi 返回 200；oa、login、mail、agent、leads、price 返回正常登录跳转。发布后 22 个容器均运行，有健康检查者均 healthy，无重启循环。这是健康/入口检查，不代表每个同机业务的全部功能验收。
- PR #125 已合并，运行前后端源码均为 3f29929a0582d45595321264ee66ebff43728129。公开 /api/status status=ok、payments_enabled=true，/release.json 同 SHA；静态清单中的旧功能布尔值不是实时开关。
- ALIPAY_ENABLED=true，ALIPAY_ALLOWED_EMAILS 空列表；已移除邮箱白名单，所有符合账户权限的用户可使用支付宝。企业创建订单仍要求 active 企业管理者，不放宽组织权限。微信仍未开放。
- 页面准确显示“支付宝 · 已开通”；限制和未配置状态不再混为“接入中”。

## 验收与边界
- 个人真实账号：普通重启恢复后、切换新版前，生成 ¥5 待付款订单，官方支付宝收银台显示正确金额与公司收款方。
- 用户登录真实 Glocal Team 企业管理者：切换前因旧白名单不可充值；切换新版后显示已开通，成功创建 ¥5 企业订单，并打开官方支付宝收银台。回跳目标为该企业账单。
- 数据库只读核验两笔验收订单，均 pending、amount_fen=face_fen=500，账户分别为 personal 和 organization；未付款、未增加余额。支付回调入账未在此次重新实付验收，不能声称本轮完成实付闭环。
- 订单：个人 OA20261118090130a05690d9bbb7；企业 OA202611180910378693d63ec68d。保留正常订单状态，不删除支付记录、不模拟回调；按原有过期处理结束。
- 发布前支付渠道状态、个人/企业入口、支付宝账单解析安全等 10 项测试通过。
- 本机截图：/private/tmp/oneapi-personal-alipay-cashier.jpg、/private/tmp/oneapi-enterprise-alipay-cashier.jpg、/private/tmp/oneapi-alipay-public-enterprise.jpg。

## 发布及回滚
- 数据库备份：/srv/oneapi-backups/oneapi-before-alipay-public-20261118T085651Z.dump，pg_dump 成功结束后才切换配置。
- 配置备份：/srv/oneapi-runtime/pilot.override.yml.before-alipay-public-3f29929。
- API 镜像 oneapi-identity:3f29929；原 47c423a 镜像保留，无 schema/依赖变更。
- 静态完整包 SHA256：6db5aa3d55e58161da08122ec0364e120a9436868cdc6e15653507b15ed96b9b。
- 因上传慢，以 4 个变化文件增量和现有服务器资源重建静态包，逐文件及整包 SHA256 均与本地产物一致，再通过 infra push_static_candidate.sh 发布，回执 deployed。
- 未更改代理、DNS、安全组或其他业务配置。旧前端目录、原镜像及配置备份保留；回滚采用一致的前后端版本。
- 云助手诊断命令发送失败，未执行；不依赖它判断已重启恢复。历史 OOM 日志不能证明此次失联根因。

## 后续任务
微信/支付宝扫码登录、阿里云短信及既有账号资质核查仍是独立待办；本次支付宝支付上线不等于第三方登录已开通。详见既有登录材料文档，未重复申请应用或商户。
