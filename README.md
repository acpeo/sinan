# 司南（Sinan）

北斗任务台：看北斗的活跑到哪了。

从 [Metrik](https://github.com/keros68/metrik) 分叉里整搬出来的任务追踪体，独立成 app：

- **任务台主窗**：任务台账 / 链路全景 / 定时任务看板 / 历史轮次 / 失败分诊
- **任务小组件窗**：桌面常驻胶囊，展开为任务面板
- **提醒角标窗**：右下角自绘通知卡（失败聚合 / 轮次完成 / 免打扰时段）

数据源 = openclaw 网关（tasks / sessions / cron / agents），本地 SQLite 台账突破官方 7 天保留。

构建：`npm install && npm run desktop:build`（Windows）。

License: AGPL-3.0-or-later（任务体源自 Metrik 分叉）。
