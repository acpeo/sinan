# Workboard 卡片镜像 —— 司南侧对接口径（Phase 1）

> 北斗侧规则在 VPS `/root/.openclaw/beidou/sop/北斗协作SOP.md` 第十一节
> （2026-10-20 Leo 会话授权）。本文只写司南怎么读。

## 数据流

```
飞书任务表 tblGWeeAWrYadALt（唯一主表，不变）
  → 天枢 watchdog 每 5 分钟镜像成 workboard 卡片（labels 带 bm:<案号>）
  → 网关 workboard.cards.list（bundled 插件，2026.10.1）
  → 司南 fetch_agents_snapshot 每 60 秒拉一次，落 workboard_cards 表
  → 卡片 status=done 直接作为关单证据（confirm_closure，幂等）
```

## 司南读卡规则

- **对案**：labels 里 `bm:<案号>`（`workboard_case_id()`）。没有 bm: 标签的卡
  （联测卡、别的看板卡）只落表，**永不碰账本**。
- **关单**：`status == "done"` → `confirm_closure`。这是 Phase 1 的新关单信号，
  优先级与 chat.history 对账平行（都幂等，谁先到谁生效）。
- **在跑证据（Phase 1 备用）**：`metadata.claim.agentId` / heartbeat 时间戳。
  泳道 live 判据暂时仍走会话审计，Phase 2 再切。

## 状态映射（watchdog 写卡的依据，司南反向理解）

| 飞书「当前阶段」 | 卡片 status |
| --- | --- |
| 待派发天璇 | todo |
| 天璇选题中/天权初审中/天玑创作中/天权二审中/玉衡出图中/开阳制作中/摇光发布中 | running |
| 待关单 | review |
| 已关单 | done |
| 「状态」= 异常阻塞 | blocked（优先） |

## RPC 速查（operator token 即可）

| 动作 | 方法 | 参数要点 |
| --- | --- | --- |
| 列卡 | `workboard.cards.list` | `{}`，payload.cards |
| 单卡+尝试史 | `workboard.cards.runs` | `{id}` |
| 统计 | `workboard.cards.stats` | `{}` |
| 建/删/移 | `workboard.cards.create/delete/move` | delete/move 用 `id` |
| 派发 | `workboard.cards.dispatch` | 只会启动 ready 卡的 worker |

不存在：`workboard.stats`、`workboard.cards.read`。
插件启用前提：`plugins.allow` 含 `workboard`（2026-10-20 已加）。

## Phase 2（未做）

- 星位直接 claim/release 卡片（收尾三项变四项），镜像退役为兜底。
- 泳道 UI 绑定：列头/卡片显示卡态 + proof/attempts 徽标（待 Leo 定设计面）。
- live 判据从会话审计切到 claim 心跳。
