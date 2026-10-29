import React from "react";

export default function QuotaGuardSettings({ state, working, onCommand }) {
  const enabled = state.settings.quotaGuardEnabled === true;
  const threshold = state.settings.quotaGuardThreshold || 10;
  const supported = state.platform === "darwin";
  return <section className="card codex-card">
    <h3>聊天额度保护</h3>
    <div className="setting-row"><div>
      <strong>额度保护</strong>
      <p>默认保护 10%。有 5 小时额度时保护 5 小时额度，没有时保护周额度。达到阈值后暂停当前 Codex 发送区域，给切换 Provider 留出余量。</p>
      <small>{!supported ? "当前仅支持 macOS 本地代理。" : state.quotaGuard?.blocked ? "当前代理已暂停官方连接发送。切换 Provider 或关闭保护后恢复。" : "只依据本机最近快照，不是实时账号查询。"}</small>
    </div><button role="switch" aria-label="聊天额度保护" aria-checked={enabled} className={`toggle ${enabled ? "on" : ""}`} disabled={working || !supported}
      onClick={() => onCommand({ type: "quota-guard-settings", enabled: !enabled, threshold, window: "auto" })}><span /></button></div>
    <div className="setting-row"><div><label htmlFor="quota-guard-threshold"><strong>保护阈值</strong></label><p>剩余额度达到或低于该百分比就暂停发送。</p></div>
      <select id="quota-guard-threshold" className="idle-route-select" value={threshold} disabled={working || !supported || !enabled}
        onChange={event => onCommand({ type: "quota-guard-settings", enabled: true, threshold: Number(event.target.value), window: "auto" })}>
        <option value="5">5%</option><option value="10">10%</option><option value="20">20%</option><option value="30">30%</option><option value="40">40%</option><option value="50">50%</option><option value="60">60%</option><option value="70">70%</option><option value="80">80%</option>
      </select>
    </div>
  </section>;
}
