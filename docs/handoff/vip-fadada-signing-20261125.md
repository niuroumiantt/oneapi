# Semifly VIP 法大大电子签接入

更新于 2026-11-25，m5。仓库为 niuroumiantt/oneapi。已核对 GitHub 主分支及 Semifly 正式前后端均为 a95cd1861d7f76a95117b35c0447e906788a5f5b。

## 已实现

甲方和盖章主体为深圳市格洛可半导体有限公司，乙方为个人正式 VIP。客户在「合同与资料」同意转交签署所需信息。管理员在 VIP 客户档案准备草稿、指定截止日期并确认经办人用印授权。双方分别登录法大大，由公司经办人手动盖章，个人在托管页完成实名和签署。签署回跳只显示进度。

应用验证 FASC 5.1 通知签名，入队后主动查询任务、签署方和经办人。确认双方签署和个人实名后，通过官方免费电子签名存证报告接口取得报告。PDF 和报告以 SHA-256 校验并加密保存于 PostgreSQL。应用的身份核验字段记录结果、凭证引用和时间。授权管理员可下载两个文件，签署客户可下载自己的协议。归档和回填同一事务提交，再沿用正式 VIP 的既有直接发码规则。作废时撤回该记录带来的推广资格。付款、试用和提成流程沿用主分支。

内部模拟与 VIP 回归合计 17 项 PostgreSQL 测试通过，覆盖错签署人、重复申请和回调、单方签署、归档失败重试、访问控制、连续直接发码和作废。真实沙箱尚待企业应用账号和两名实际试签经办人。试签稿在本机 oneapi 的 output/fadada-20261125 目录，已对齐正式 VIP 开通、推广码和提成业务规则。

## 开通和验收

| 事项 | 所需动作与当前状态 |
| --- | --- |
| 企业账号和实名 | 现有浏览器进入法大大登录页，邮箱与本机未发现可用凭证。公司管理员用既有账号登录开放平台，核对个人实名、同名企业实名、超级管理员和开发者权限。已有实名可复用。 |
| 沙箱自建应用 | 待建或核实既有应用。获取沙箱 App ID、App Secret、企业 OpenCorpId、经办人 Member ID、签署模板和两个参与方 ID。Secret 直接存入部署密钥。回调在该环境使用 HTTPS 的 /api/cw/signing/fadada/notify。订阅签署、任务结束、撤销、过期、作废和存证报告生成事件。 |
| 授权用印 | 待公司管理员确认所用企业公章，并给指定经办人授权用印。企业自建应用由公司发起且参与签署，首期通过托管页人工用印。 |
| 模板 | 在沙箱上传内部试签稿，设置单份正文和两个手动签署方。设置 contract_number、template_version、vip_number、partner_name 和 ends_on 五个文本控件，分别对应合同编号、版本、VIP 编号、乙方姓名、截至日期。将控件留给发起方或不分配给任何签署方。关闭模板层自动签署。确认模板按北京时间日期显示并预览字段宽度。 |
| 内部试签 | 使用独立数据库与内部自愿试签人，验证手机实名签署、公司盖章、官方回调、PDF 章签和官方验签、存证 ZIP、客户档案及连续发码。保留签署任务号、报告号、档案编号和文件哈希作验收记录。凭证文件保存在隔离环境。 |
| 采购和生产 | 待沙箱通过。由公司确认企业自建 API、签署用量、个人实名、签署文件下载及免费存证报告权限。正式服务与付费司法出证按实际需求批准采购。 |
| 首份正式协议 | 待运营或法务批准正式版本及合作截止日期，授权经办人确认公司印章和接收方后提交。尚未发送。 |

## 配置与发布

- 默认关闭。隔离环境设置 CW_ENABLED=true、FADADA_SIGNING_MODE=sandbox，数据库名以 _sandbox 或 _test 结尾。生产使用 FADADA_SIGNING_MODE=live 和公开 HTTPS 站点。启用前用 FADADA_PARTNER_IDS 限定首批 VIP 档案 UUID，逗号分隔。空值使已开通的正式 VIP 均可申请。
- 应用配置需要 FADADA_APP_ID、FADADA_APP_SECRET、FADADA_CORP_ID、FADADA_MEMBER_ID、FADADA_TEMPLATE_ID、FADADA_TEMPLATE_VERSION、FADADA_COMPANY_ACTOR_ID、FADADA_PERSON_ACTOR_ID。签署交互配置允许返回 /promotion/vip.html。下载使用法大大 HTTPS 域名，如服务商另有专用域名，按精确主机名配置 FADADA_DOWNLOAD_HOSTS。
- 部署同步迁移 090。保持应用归档加密所用的 BETTER_AUTH_SECRET 可用，并在隔离环境做一次备份恢复和双方下载检查。应用转移或更换 App ID 前处理旧应用的在途任务。审核模板版本后再允许管理员提交。
- 内部验证命令为 TEST_CW_DATABASE_URL 与 TEST_FADADA_DATABASE_URL 指向各自独立的 PostgreSQL 测试库，再运行 node --test server/test/cw-partners.test.mjs server/test/cw-fadada-signing.test.mjs。

[开放平台企业开通](https://developer.fadada.com/) · [自建应用接入助手](https://fasc-dev.fadada.com/) · [FASC 5.1 接口请求说明](https://dev.fadada.com/api-doc/F2X31QVDDD/PQR5QW3WR0M7LDNM/5-1) · [报告类型与计费](https://dev.fadada.com/api-doc/EDREK71KU1/UZIXJPO7GNXESDTQ/5-1) · [法大大官方验签](https://www.fadada.com/product/check)
