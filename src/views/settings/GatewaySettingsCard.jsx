import { useState } from "react";
import { refreshCronJobs, saveGatewayConfig } from "../../lib/taskClient.js";


export function GatewaySettingsCard({ gateways, onGatewaysChanged }) {
  const [draft, setDraft] = useState({ label: "", url: "", token: "", identityDir: "" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const valid = draft.label.trim() && draft.url.trim() && draft.token.trim();

  const addGateway = async () => {
    if (!valid) return;
    setBusy(true);
    setFeedback(null);
    try {
      const entry = {
        label: draft.label.trim(),
        url: draft.url.trim(),
        token: draft.token.trim(),
      };
      // 身份目录可选：远程网关用专用设备身份（identity/device.json）。
      // 本机网关留空 → 后端用默认 state 目录的探测身份。
      if (draft.identityDir.trim()) {
        entry.identityDir = draft.identityDir.trim();
      }
      // 连通性验证：直接试拉一次。失败也允许保存（VPS 可能暂时离线），
      // 但把错误显示出来让用户知道。
      const result = await refreshCronJobs([entry]);
      const outcome = result.results?.[0];
      const next = [
        ...gateways.filter((candidate) => candidate.label !== entry.label),
        entry,
      ];
      saveGatewayConfig(next);
      onGatewaysChanged(next);
      setDraft({ label: "", url: "", token: "", identityDir: "" });
      if (outcome?.ok) {
        setFeedback({ tone: "success", message: `已添加并连通：${entry.label}` });
      } else {
        setFeedback({
          tone: "error",
          message: `已保存，但连通失败：${outcome?.error || "未知原因"}（回环/SSH 隧道自动批准；否则需在网关侧 openclaw devices approve）`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const removeGateway = (label) => {
    const next = gateways.filter((entry) => entry.label !== label);
    saveGatewayConfig(next);
    onGatewaysChanged(next);
  };

  return (
    <div className="settings-card">
      <h2>被追踪的 Gateway</h2>
      {gateways.length === 0 ? (
        <p className="gateway-hint">尚未配置。本机 Gateway（ws://127.0.0.1:18789）可直接添加。</p>
      ) : (
        <ul className="gateway-list">
          {gateways.map((entry) => (
            <li key={entry.label}>
              <span className="gateway-label">{entry.label}</span>
              <span className="gateway-url">{entry.url}</span>
              <button type="button" className="ledger-button ledger-button--secondary" onClick={() => removeGateway(entry.label)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="gateway-form">
        <input
          type="text"
          value={draft.label}
          placeholder="名称（如：本机 / VPS）"
          aria-label="Gateway 名称"
          onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
        />
        <input
          type="text"
          value={draft.url}
          placeholder="ws://127.0.0.1:18789"
          aria-label="Gateway 地址"
          spellCheck={false}
          onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
        />
        <input
          type="password"
          value={draft.token}
          placeholder="Gateway token"
          aria-label="Gateway token"
          onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))}
        />
        <input
          type="text"
          value={draft.identityDir}
          placeholder="身份目录（可选，远程网关用，如 C:\\Users\\me\\.openclaw-vps-metrik）"
          aria-label="Gateway 身份目录"
          spellCheck={false}
          onChange={(event) => setDraft((current) => ({ ...current, identityDir: event.target.value }))}
        />
        <button type="button" className="ledger-button ledger-button--primary" disabled={busy || !valid} onClick={addGateway}>
          {busy ? "验证中…" : "添加并验证"}
        </button>
      </div>
      {feedback && (
        <p className={feedback.tone === "error" ? "tasks-feedback tasks-feedback--error" : "tasks-feedback tasks-feedback--success"}>
          {feedback.message}
        </p>
      )}
      <p className="gateway-hint">
        远程 Gateway：推荐 SSH 隧道（ssh -N -L 127.0.0.1:18790:127.0.0.1:18789 user@vps），
        地址填 ws://127.0.0.1:18790，回环自动批准；公网直连则需在网关侧
        openclaw devices approve。远程网关请填专用身份目录（内含 identity/device.json，
        由 metrik-gateway-setup.sh 生成）；本机网关留空。token 与任务元数据不出本机。
      </p>
    </div>
  );
}

