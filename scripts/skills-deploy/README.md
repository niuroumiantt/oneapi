# OneAPI Skills 上海生产维护

构建 OneAPI 前端时，`scripts/build_static.py` 按 `prototypes/skills/public-files.json` 发布静态文件。以后随 OneAPI 从 `scripts/publish_shanghai.sh` 统一发布。

生产每天北京时间 09:00 由 `oneapi-sh-skills.timer` 更新市场快照。上海上的运行程序位于 `/srv/oneapi-data/oneapi-skills-runtime/scripts/update-market.py`，对应仓库中的 `prototypes/skills/scripts/update-market.py`。运行用户是 `oneapi-skills`，只写 `/srv/oneapi-data/oneapi-skills-data`。单元文件见 [上海 systemd 单元](../shanghai/systemd/)。Caddy 把 `/skills/market-live.json` 映射到该快照。

**[上海 ECS]** 可以用 `systemctl status oneapi-sh-skills.timer` 和 `journalctl -u oneapi-sh-skills.service` 验证。更新该采集器时保留其数据目录，并核对实时页面中的快照日期。
