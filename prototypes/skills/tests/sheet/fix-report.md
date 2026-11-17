# Excel 本地重算修复 · 2026-11-17

## 结论

固定版本原 Skill 的宏启动路径在当前捆绑 LibreOffice 环境没有完成写回，延长等待不解决问题。原始超时记录保留。新增 `recalc-local.py` 是本站本地适配，不是上游已发布修复；原 Skill 文件未修改。

## 定位与方案

原命令、添加进程退出、调整文件与宏顺序、使用 macro:/// URI 均在12秒诊断窗口超时，副本均未改写（diagnosis*.json）。只能据此确定当前宏调用路径未完成，未证实 LibreOffice 内部具体卡点，不能说是算式复杂度造成。

适配器在临时副本清除公式缓存并请求全量计算，以独立配置目录执行 LibreOffice XLSX 转换，再复用原脚本 `_write_values` / `_report` 仅写回缓存值并扫描错误。不改变全局 Office 配置，不降低宏安全级别。超时只结束自己启动的进程组。

初次适配只有直接转换，带旧缓存的改价回归失败；增加“仅在临时输入副本清除缓存”后，同一个回归通过。这不是把预期数写死到输出。

## 验证

- 11个公式，0错误，基准实测约1.4秒；9月1516、10月2824、合计4340。
- 在已有缓存的文件中只改E2单价68→70，不清空原文件缓存：重算得到1540/2824/4364。
- 原始公式文本不变；ZIP部件集合不变，图表、样式、关系等所有非工作表部件字节相同。
- 重复重算无部件变化；故意输入=1/0，检测到Sheet!A1的#DIV/0!且非零退出。
- 模拟引擎超时返回错误，输入文件字节完全不变。

完整数值与耗时见 recalc-fixed-result.json；fixed.xlsx 是保持原结构、补齐公式缓存的推荐下载，output.xlsx 保留首次生成状态。

## 运行方法

需要 Python + openpyxl + defusedxml，以及 PATH 中可用的 LibreOffice soffice。安装上游固定版本 xlsx Skill 后，在自己的项目中运行：

```sh
python recalc-local.py --skill-script .agents/skills/xlsx/scripts/recalc.py --timeout 30 your-file.xlsx
```

脚本要求上游 recalc.py SHA-256为7265aa4a41f5273596ee5694ce8a4d881c18adafb6203fece769107d08403263，否则拒绝运行，避免静默套用到不同版本。工作前保留自己的文件副本；本适配按原脚本语义原位更新缓存。仅验证本页XLSX样本、基础公式及故障分支，未验证XLSM、外部链接、动态数组、所有Excel函数或微软客户端交互。

开发回归：设置 XLSX_SKILL_RECALC 为固定版本 recalc.py 绝对路径，确保上述运行依赖可用，然后执行 `python test-recalc-local.py`。回归数据写入系统临时目录，不覆盖本站已保存证据。

LibreOffice 官方命令行文档：https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html （独立用户配置、转换与宏参数说明）。采用转换入口是本地实验后的适配选择，不代表官方推荐用于所有 Excel 文件。
