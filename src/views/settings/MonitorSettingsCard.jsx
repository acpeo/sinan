import { useState } from "react";
import { loadMonitorConfig, saveMonitorConfig } from "../../lib/taskClient.js";
import { setNotificationWindow } from "../../lib/windowClient";


export function MonitorSettingsCard({ tasksWidgetEnabled, onToggleTasksWidget }) {
  const [draft, setDraft] = useState(() => loadMonitorConfig());
  const [saved, setSaved] = useState(false);

  const current = loadMonitorConfig();
  const dirty =
    Number(draft.refreshIntervalSec) !== current.refreshIntervalSec ||
    Number(draft.staleThresholdSec) !== current.staleThresholdSec ||
    Number(draft.episodeGapMin) !== current.episodeGapMin ||
    Number(draft.failedWindowH) !== current.failedWindowH ||
    Number(draft.historyWindowMin) !== current.historyWindowMin ||
    Number(draft.ledgerRetentionDays) !== current.ledgerRetentionDays ||
    Number(draft.missedWindowHours) !== current.missedWindowHours ||
    Number(draft.watermarkWarnPct) !== current.watermarkWarnPct ||
    Boolean(draft.notifyOnFailure) !== current.notifyOnFailure ||
    Boolean(draft.notifyOnComplete) !== current.notifyOnComplete ||
    Number(draft.notifyAggregateMin) !== current.notifyAggregateMin ||
    Number(draft.notifyStaySec) !== current.notifyStaySec ||
    Boolean(draft.notifyQuietOn) !== current.notifyQuietOn ||
    String(draft.notifyQuietStart) !== current.notifyQuietStart ||
    String(draft.notifyQuietEnd) !== current.notifyQuietEnd ||
    Boolean(draft.translateProgress) !== current.translateProgress ||
    Boolean(draft.tasksEdgeDock) !== current.tasksEdgeDock;

  const apply = () => {
    saveMonitorConfig(draft);
    setDraft(loadMonitorConfig());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const numberField = (label, aria, key, min, max) => (
    <label className="monitor-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft[key]}
        aria-label={aria}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );

  return (
    <div className="settings-card">
      <h2>实时监控参数</h2>
      <p className="gateway-hint">
        任务页的同步节奏、接力分段与本地台账口径。保存后立即生效，无需重启或重装。
      </p>
      <div className="monitor-groups">
        <section className="monitor-group">
          <span className="monitor-group-title">同步节奏</span>
          <div className="monitor-grid">
            {numberField("自动同步间隔（秒，1–60）", "自动同步间隔秒数", "refreshIntervalSec", 1, 60)}
            {numberField("无活动判定阈值（秒，10–3600）", "无活动判定阈值秒数", "staleThresholdSec", 10, 3600)}
            {numberField("僵尸行判死阈值（秒，300–21600，默认 1800）", "运行中的行多久没动静就按收班处理；北斗长跑几十分钟到一小时是常态，别设太短", "zombieThresholdSec", 300, 21600)}
          </div>
        </section>
        <section className="monitor-group">
          <span className="monitor-group-title">接力与台账</span>
          <div className="monitor-grid">
            {numberField("接力分段沉默上限（分钟，5–720）", "接力分段沉默上限分钟数", "episodeGapMin", 5, 720)}
            {numberField("失败记录保留（小时，1–168）", "失败记录保留小时数", "failedWindowH", 1, 168)}
            {numberField("历史轮次回看（分钟，0=关闭，最长 7 天）", "历史轮次回看分钟数", "historyWindowMin", 0, 10080)}
            {numberField("台账保留期（天，1–90）", "台账保留期天数", "ledgerRetentionDays", 1, 90)}
            {numberField("漏采补记窗口（小时，1–72）", "漏采补记窗口小时数", "missedWindowHours", 1, 72)}
          </div>
        </section>
        <section className="monitor-group">
          <span className="monitor-group-title">提醒与预警</span>
          <div className="monitor-grid">
          <label className="monitor-field monitor-field--check">
            <input
              type="checkbox"
              checked={draft.notifyEnabled}
              aria-label="自绘提醒角标"
              onChange={(event) => {
                const next = event.target.checked;
                // 总开关即时生效（像任务小组件一样不等"保存参数"）：
                // 窗口幂等开合 + 立刻落盘（只并入这一项，不带draft里其他未保存改动）。
                setDraft((current) => ({ ...current, notifyEnabled: next }));
                saveMonitorConfig({ ...loadMonitorConfig(), notifyEnabled: next });
                setNotificationWindow(next);
                window.dispatchEvent(new Event("metrik-monitor-changed"));
              }}
            />
            <span>自绘提醒角标（屏幕右下角弹卡）</span>
          </label>
          <label className="monitor-field monitor-field--check">
            <input
              type="checkbox"
              checked={draft.notifyOnFailure}
              aria-label="轮次失败提醒"
              onChange={(event) =>
                setDraft((current) => ({ ...current, notifyOnFailure: event.target.checked }))
              }
            />
            <span>轮次失败提醒（真失败才响）</span>
          </label>
          <label className="monitor-field monitor-field--check">
            <input
              type="checkbox"
              checked={draft.notifyOnComplete}
              aria-label="轮次完成提醒"
              onChange={(event) =>
                setDraft((current) => ({ ...current, notifyOnComplete: event.target.checked }))
              }
            />
            <span>轮次完成提醒（默认关）</span>
          </label>
          {numberField("失败聚合窗口（分钟，2–60）", "失败聚合窗口分钟数", "notifyAggregateMin", 2, 60)}
            {numberField("卡片停留（秒，4–30）", "提醒卡片停留秒数", "notifyStaySec", 4, 30)}
          {numberField("上下文水位预警（%，0=关）", "上下文水位预警阈值百分比", "watermarkWarnPct", 0, 95)}
          <label className="monitor-field monitor-field--check monitor-field--check--wide">
            <input
              type="checkbox"
              checked={draft.notifyQuietOn}
              aria-label="免打扰时段"
              onChange={(event) =>
                setDraft((current) => ({ ...current, notifyQuietOn: event.target.checked }))
              }
            />
            <span>免打扰时段</span>
          </label>
            <label className="monitor-field">
              <span>免打扰开始</span>
              <input
                type="time"
                value={draft.notifyQuietStart}
                aria-label="免打扰开始时间"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notifyQuietStart: event.target.value }))
                }
              />
            </label>
            <label className="monitor-field">
              <span>免打扰结束</span>
              <input
                type="time"
                value={draft.notifyQuietEnd}
                aria-label="免打扰结束时间"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notifyQuietEnd: event.target.value }))
                }
              />
            </label>
          </div>
        </section>
        <section className="monitor-group">
          <span className="monitor-group-title">桌面小组件</span>
          <div className="monitor-grid">
            <label className="monitor-field monitor-field--check">
              <input
                type="checkbox"
                checked={draft.translateProgress}
                aria-label="进度与报错中文显示"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, translateProgress: event.target.checked }))
                }
              />
              <span>进度与报错中文显示</span>
            </label>
            <label className="monitor-field monitor-field--check">
              <input
                type="checkbox"
                checked={tasksWidgetEnabled}
                onChange={onToggleTasksWidget}
              />
              <span>显示任务小组件（独立小窗）</span>
            </label>
            <label className="monitor-field monitor-field--check">
              <input
                type="checkbox"
                checked={draft.tasksEdgeDock}
                aria-label="任务小组件贴边自动隐藏"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, tasksEdgeDock: event.target.checked }))
                }
              />
              <span>贴边自动隐藏（拖边收起，碰边弹出；置顶时不隐藏）</span>
            </label>
          </div>
        </section>
        <button
          type="button"
          className="ledger-button ledger-button--primary"
          disabled={!dirty}
          onClick={apply}
        >
          {saved ? "已保存" : "保存参数"}
        </button>
      </div>
      <p className="gateway-hint">
        建议：同步 2–5 秒；无活动阈值 60–300 秒（北斗星位一轮思考加工具调用常超 30 秒，不宜过短）。
        接力分段按"交接沉默"切：星位间交接一直连续，一轮跑多久都是同一段，只有沉默超过上限
        （如中途等你确认）才切下一段；失败记录保留 = 失败的工作在面板/迷你条留多久，过期自动消失
        （成功的工作完成即走，不占位）；历史轮次回看 = 主窗任务页列出收尾的接力段多长时间内的（0 = 关闭）。
        台账保留期到期自动清理；水位预警 = 星位上下文水位超过阈值时琥珀高亮并标"建议清理"（0 = 不预警）。
        失败分诊自动进行：心跳静默跳过、重启中止、手动取消按"跳过"灰显，只有真失败才染红；
        中文显示 = 映射 openclaw 工具名与常见报错；贴边隐藏 = 置顶时不隐藏。
      </p>
    </div>
  );
}

