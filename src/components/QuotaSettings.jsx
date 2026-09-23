import React from "react";
import { quotaPresentation } from "../../core/quota.mjs";
import { currentLanguage } from "../i18n/locale.js";
export default function QuotaSettings({ state, now, working, onCommand, onRefresh, onRecover }) {
  const enabled = state.settings.quotaEnabled === true;
  const window = state.settings.quotaWindow || "weekly";
  const view = quotaPresentation(state.quota, window, now, currentLanguage());
  return <section className="card settings-card">
    <h3>菜单栏额度</h3>
    <div className="setting-row"><div><strong>菜单栏图标不见了？</strong>
      <p>可重新创建入口。若仍不显示，检查 macOS 系统设置 → 菜单栏 → 允许 Pawprint 显示，或切换仅图标模式减少占位。</p>
      <small data-testid="tray-status">{state.trayStatus?.created ? "入口已创建，实际显示位置由系统菜单栏决定。" : "入口当前不可用，请尝试恢复。"}</small>
    </div><button className="button secondary" onClick={onRecover}>恢复菜单栏图标</button></div>
    <div className="setting-row"><div><strong>仅显示图标</strong><p>不在图标旁放数字，额度仍可在菜单中查看。适合菜单栏空间不足时使用。</p></div>
      <button role="switch" aria-label="仅显示图标" aria-checked={state.settings.trayCompact === true}
        className={`toggle ${state.settings.trayCompact ? "on" : ""}`} disabled={working}
        onClick={() => onCommand({ type: "tray-compact", value: !state.settings.trayCompact })}><span /></button>
    </div>
    <div className="setting-row"><div><strong>图标旁显示剩余额度</strong><p>W 表示周剩余，5h 表示 5 小时剩余。按本机 Codex 记录中的额度计算，不用 token 数量估算。</p></div>
      <button role="switch" aria-label="图标旁显示剩余额度" aria-checked={enabled} className={`toggle ${enabled ? "on" : ""}`} disabled={working}
        onClick={() => onCommand({ type: "quota-settings", enabled: !enabled, window })}><span /></button>
    </div>
    <div className="setting-row"><div><label htmlFor="quota-window"><strong>显示哪段额度</strong></label><p>缺少该时间段的记录时显示 —，不会把未知额度算成 0% 或 100%。</p></div>
      <select id="quota-window" className="idle-route-select" value={window} disabled={working || !enabled}
        onChange={e => onCommand({ type: "quota-settings", enabled: true, window: e.target.value })}>
        <option value="weekly">周剩余 · W</option><option value="session">5 小时剩余 · 5h</option><option value="both">同时显示</option>
      </select>
    </div>
    {enabled && <div className="quota-preview" data-testid="quota-preview"><strong>{view.title}</strong>
      <p>{view.values.weekly.detail} · {view.values.session.detail}</p><small>{view.source}</small>
      {state.quota?.error && <p role="status">{state.quota.error}</p>}
    </div>}
    <div className="setting-row"><div><strong>来自本机最近活动的 Codex 记录</strong><p>每 15 秒重新读取，不访问登录凭据、浏览器 Cookie 或钥匙串。不是实时账号查询；切换账号后需等待新记录，其他设备的后续用量可能尚未反映。</p><p>超过 15 分钟的记录用 ~ 标记。跨过重置时间后显示待更新，继续使用 Codex 才会产生新快照。</p></div>
      <button className="button secondary" disabled={!enabled || state.quota?.loading} onClick={onRefresh}>{state.quota?.loading ? "读取中…" : "重新读取"}</button>
    </div>
  </section>;
}
