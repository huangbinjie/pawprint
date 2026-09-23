import RawText from "../i18n/RawText.jsx";
import { f, t, currentLanguage } from "../i18n/locale.js";
import React, { useState, useEffect } from "react";
import {
  Wifi,
  Copy,
  RefreshCw,
  Heart,
  ArrowRight,
  Users,
  ShieldCheck,
  Leaf,
} from "lucide-react";
import Cat from "./Cat.jsx";
import {
  housePets,
  availableCoins,
  breedingEligibility,
  usedSlots,
} from "../../core/economy.mjs";
import { talentById, talentOdds } from "../../core/talents.mjs";
import { petSkills, skillById, skillRarity } from "../../core/skills.mjs";
import SkillOdds from "./SkillOdds.jsx";
import {
  inheritanceOptions,
  GENE_KEYS,
  LABELS,
  formatChance,
} from "../../core/genetics.mjs";
const labels = {
  reserved: "等待同事确认",
  pending: "等待你确认",
  committed: "已确认，等待对方领取",
  completed: "已收到新蛋",
  cancelled: "已取消",
  "cancel-requested": "等待重连确认取消",
};
export default function Nearby({ state, now, working, run, onConsent }) {
  const [shareAddress, setShareAddress] = useState("");
  const lan = state.lan,
    own = housePets(state),
    [code, setCode] = useState(""),
    [name, setName] = useState(lan.name ?? "我的小屋"),
    [petId, setPetId] = useState(state.activePetId),
    [selected, setSelected] = useState(null);
  useEffect(() => {
    if (!selected) return;
    const before = document.activeElement;
    const focus = () => [
      ...document.querySelectorAll(".lan-confirm button:not(:disabled)"),
    ];
    const timer = setTimeout(() => focus().at(-1)?.focus(), 0);
    const onKey = (e) => {
      if (e.key === "Escape") setSelected(null);
      if (e.key === "Tab") {
        const nodes = focus();
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      if (before?.isConnected) before.focus();
    };
  }, [selected]);
  const pet = own.find((p) => p.id === petId) || own[0];
  const incoming = (lan.breeding ?? []).filter(
    (t) => t.direction === "in" && t.status === "pending" && t.expiresAt > now,
  );
  const transactions = (lan.breeding ?? [])
    .filter((t) => t.direction === "out")
    .slice(-12)
    .reverse();
  return (
    <div className="nearby-page">
      <section className="catalog-intro card">
        <div>
          <span className="eyebrow">GOOD COMPANY, CLOSE BY</span>
          <h2>同一个网络，两个温暖的小屋。</h2>
          <p>
            交换连接码后配对。串门和繁育都要对方点头，宠物的所有权始终保留。
          </p>
        </div>
        <button
          className={`button ${lan.enabled ? "secondary" : "primary"}`}
          disabled={working}
          onClick={() => (lan.enabled ? run({ type: "disable" }) : onConsent())}
        >
          <Wifi size={17} />
          {lan.enabled ? "关闭局域网" : "开启局域网小屋"}
        </button>
      </section>
      {!lan.enabled ? (
        <div className="empty-state nearby-empty">
          <Wifi size={40} />
          <h2>准备好迎接同事的伙伴了吗？</h2>
          <p>双方安装同一版本，连接可互通的 Wi-Fi 或网线，即可开始。</p>
        </div>
      ) : (
        <>
          <section className="nearby-connect card">
            <div>
              <h3>我的小屋</h3>
              <div className="inline-form">
                <input
                  aria-label="局域网小屋名字"
                  value={name}
                  maxLength={30}
                  onChange={(e) => setName(e.target.value)}
                />
                <button
                  className="button secondary small"
                  disabled={working}
                  onClick={() => run({ type: "name", name })}
                >
                  保存名字
                </button>
              </div>
              <button
                className="button primary small"
                disabled={!lan.addresses?.length}
                onClick={() =>
                  run({
                    type: "copy",
                    address: lan.addresses?.includes(shareAddress)
                      ? shareAddress
                      : lan.addresses?.[0],
                  })
                }
              >
                <Copy size={14} />
                复制连接码给同事
              </button>
              {lan.addresses?.length > 1 && (
                <select
                  aria-label="分享使用的网络地址"
                  value={
                    lan.addresses.includes(shareAddress)
                      ? shareAddress
                      : lan.addresses[0]
                  }
                  onChange={(e) => setShareAddress(e.target.value)}
                >
                  {lan.addresses.map((address) => (
                    <option key={address} value={address}>
                      {address}
                    </option>
                  ))}
                </select>
              )}
              <p>
                可用地址：{lan.addresses?.join(" / ") || "未找到局域网地址"}
              </p>
            </div>
            <div>
              <h3>连接同事</h3>
              <textarea
                aria-label="同事的连接码"
                placeholder="粘贴同事分享的 pawprint1: 连接码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                rows={2}
              />
              <button
                className="button secondary small"
                disabled={working || !code.trim()}
                onClick={async () => {
                  if (await run({ type: "pair", code: code.trim() }))
                    setCode("");
                }}
              >
                申请连接 <ArrowRight size={14} />
              </button>
              <p>
                {lan.pairing
                  ? <RawText>{`${lan.pairing.name} · ${t({ pending: "等待对方接受", accepted: "已连接", rejected: "对方已拒绝", expired: "邀请已过期" }[lan.pairing.status])}`}</RawText>
                  : "连接码只用来配对；每次访问仍需确认。"}
              </p>
            </div>
          </section>
          {lan.error && <div className="notice">{lan.error}</div>}
          <div className="nearby-discovery">
            <span>
              附近发现：
              {lan.nearby?.length
                ? <RawText>{lan.nearby.map((p) => p.name).join(currentLanguage() === "en" ? ", " : "、")}</RawText>
                : "暂未发现其他小屋，可直接粘贴连接码"}
            </span>
            <button
              className="text-button"
              onClick={() => run({ type: "refresh" })}
            >
              <RefreshCw size={13} />
              刷新
            </button>
          </div>
          {(lan.pairRequests ?? []).map((p) => (
            <div className="invite-card card" key={p.id}>
              <Users size={22} />
              <div>
                <strong translate="no">{f("{0}想连接你的小屋", p.name)}</strong>
                <p>确认是你的同事后再接受；只共享宠物外观、才艺与繁育状态。</p>
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  run({ type: "answer-pair", id: p.id, accept: false })
                }
              >
                拒绝
              </button>
              <button
                className="button primary small"
                onClick={() =>
                  run({ type: "answer-pair", id: p.id, accept: true })
                }
              >
                接受连接
              </button>
            </div>
          ))}
          {(lan.visitRequests ?? []).map((v) => (
            <div className="invite-card card" key={v.id}>
              <Cat genome={v.pet.genome} />
              <div>
                <strong translate="no">
                  {f("{0}的{1}想来串门", v.peerName, v.pet.name)}
                </strong>
                <p>
                  {talentById(v.pet.talent.id)?.name} · 访客最多停留 10 分钟
                </p>
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  run({ type: "answer-visit", id: v.id, accept: false })
                }
              >
                下次吧
              </button>
              <button
                className="button primary small"
                onClick={() =>
                  run({ type: "answer-visit", id: v.id, accept: true })
                }
              >
                欢迎来玩
              </button>
            </div>
          ))}
          {incoming.map((t) => (
            <div className="invite-card card" key={`${t.peerId}:${t.id}`}>
              <Heart size={24} />
              <div>
                <strong>
                  <RawText>{t.peerName}</RawText>申请与
                  <RawText>{own.find((p) => p.id === t.petId)?.name ?? (currentLanguage() === "en" ? "your pet" : "你的宠物")}</RawText>繁育
                </strong>
                <p>
                  对方的亲本：<RawText>{t.aPet?.name}</RawText> · 接受后你获得 60
                  币答谢，蛋归对方；你的亲本计入冷却。
                </p>
                <button
                  className="text-button"
                  disabled={!own.some((p) => p.id === t.petId)}
                  onClick={() =>
                    setSelected({
                      incoming: t,
                      pet: own.find((p) => p.id === t.petId),
                      mate: t.aPet,
                    })
                  }
                >
                  查看双方与后代概率
                </button>
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  run({
                    type: "answer-breed",
                    id: t.id,
                    peerId: t.peerId,
                    accept: false,
                  })
                }
              >
                拒绝
              </button>
              <button
                className="button primary small"
                disabled={working || !own.some((p) => p.id === t.petId)}
                onClick={() =>
                  setSelected({
                    incoming: t,
                    pet: own.find((p) => p.id === t.petId),
                    mate: t.aPet,
                  })
                }
              >
                查看并确认
              </button>
            </div>
          ))}
          <div className="section-label">
            <h3>已连接的小屋</h3>
            {own.length > 0 && (
              <select
                aria-label="派出的伙伴"
                value={pet?.id}
                onChange={(e) => setPetId(e.target.value)}
              >
                {own.map((p) => (
                  <option key={p.id} value={p.id} translate="no">
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="neighbor-grid">
            {(lan.peers ?? []).map((peer) => (
              <section className="card neighbor" key={peer.id}>
                <div className="card-title">
                  <h3><RawText>{peer.name}</RawText></h3>
                  <span>{peer.online ? "在线" : "离线"}</span>
                </div>
                {peer.profile?.pets?.length ? (
                  peer.profile.pets.map((mate) => (
                    <div className="neighbor-pet" key={mate.id}>
                      <Cat genome={mate.genome} />
                      <div>
                        <strong><RawText>{mate.name}</RawText></strong>
                        <p>
                          {t(talentById(mate.talent.id)?.name)} · 第{" "}
                          {mate.generation} 代
                        </p>
                        <span className="muted small-copy">
                          {mate.canBreed ? "可安排繁育" : mate.breedReason}
                        </span>
                        <div className="talent-actions">
                          <button
                            className="text-button"
                            disabled={!peer.online || !pet || working}
                            onClick={() =>
                              run({
                                type: "visit",
                                peerId: peer.id,
                                petId: pet.id,
                              })
                            }
                          >
                            申请串门
                          </button>
                          <button
                            className="text-button"
                            disabled={
                              !peer.online ||
                              !pet ||
                              !mate.canBreed ||
                              !breedingEligibility(pet, now, state).allowed ||
                              working
                            }
                            onClick={() => setSelected({ peer, pet, mate })}
                          >
                            申请配种 · 240 币
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    {peer.online
                      ? "对方暂时没有在小屋的伙伴。"
                      : "等待同事重新上线。"}
                  </p>
                )}
              </section>
            ))}
          </div>
          {!lan.peers?.length && (
            <p className="empty-inline">先交换连接码，邀请一位同事连接小屋。</p>
          )}
          <div className="visitor-grid">
            {(lan.visitors ?? []).map((v) => (
              <div className="card visitor-card" key={v.id}>
                <Leaf size={17} />
                <span translate="no" data-user-text="">
                  {f("{0}的{1}正在你桌面做客", v.peerName, v.pet.name)}
                </span>
                {pet && <div className="social-actions">
                  {[{ leader: "host", p: pet }, { leader: "guest", p: v.pet }].map(({ leader, p }) => {
                    const s = skillById(petSkills(p).social);
                    return <button key={leader} translate="no" data-user-text="" className="button secondary small" disabled={!!state.socialPerformance || working}
                      onClick={() => run({ type: "social", visitId: v.id, petId: pet.id, leader, skillId: s.id })}>
                      {f("{0}带领：{1} · {2}", p.name, t(s.name), t(skillRarity(s)))}
                    </button>;
                  })}
                  <small>在接待方桌面同台表演 8 秒；任一伙伴可以用自己拥有的社交技能带领。</small>
                </div>}
                <button
                  className="text-button"
                  onClick={() => run({ type: "dismiss", id: v.id })}
                >
                  送它回家
                </button>
              </div>
            ))}
            {(lan.outVisits ?? [])
              .filter((v) => v.status !== "ended")
              .map((v) => (
                <div className="card visitor-card" key={v.id}>
                  <span>
                    {v.peerName} ·{" "}
                    {v.status === "accepted"
                      ? "你的伙伴正在做客"
                      : "等待串门邀请确认"}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => run({ type: "return", id: v.id })}
                  >
                    结束这次串门
                  </button>
                </div>
              ))}
          </div>
          {transactions.length > 0 && (
            <section className="card network-history">
              <h3>配种进度</h3>
              {transactions.map((t) => (
                <div key={t.id}>
                  <span>
                    <RawText>{t.peerName}</RawText> · <RawText>{t.aPet?.name}</RawText> × <RawText>{t.bPet?.name}</RawText>
                    <small>
                      {labels[t.status]}
                      {t.error ? " · 等待重连" : ""}
                    </small>
                  </span>
                  {["reserved", "cancel-requested"].includes(t.status) && (
                    <button
                      className="text-button"
                      disabled={working}
                      onClick={() => run({ type: "cancel-breed", id: t.id })}
                    >
                      {t.status === "cancel-requested"
                        ? "重试取消"
                        : "取消申请"}
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          <div className="local-contract">
            <ShieldCheck size={21} />
            <div>
              <h3>局域网合作模式</h3>
              <p>
                不需要云服务器。连接受设备身份校验和加密保护；本地存档仍可被持有者修改，不用于真实金钱或防作弊交易。聊天正文、用量和文件路径不会分享。
              </p>
            </div>
          </div>
        </>
      )}
      {selected && (
        <div className="modal-backdrop">
          <section
            className="modal lan-confirm"
            role="dialog"
            aria-modal="true"
            aria-label="确认局域网配种"
          >
            <h2>让两份独特，遇见下一代</h2>
            <div className="lan-parent-pair">
              <Cat genome={selected.pet.genome} />
              <Heart size={23} />
              <Cat genome={selected.mate.genome} />
            </div>
            <p>
              <RawText>{selected.pet.name}</RawText> × <RawText>{selected.mate.name}</RawText>
            </p>
            <div className="prediction-grid">
              {GENE_KEYS.map((k) => (
                <div key={k}>
                  <span>{LABELS[k]}</span>
                  {inheritanceOptions(
                    selected.pet.genome,
                    selected.mate.genome,
                    k,
                  ).map((o) => (
                    <p key={o.value}>
                      {o.name}
                      <strong>{o.percent}%</strong>
                    </p>
                  ))}
                </div>
              ))}
            </div>
            <div className="talent-probabilities">
              <h4>后代才艺概率</h4>
              <div>
                {talentOdds(selected.pet.talent, selected.mate.talent).map(
                  (t) => (
                    <span className="chip" key={t.id}>
                      {t.name} {formatChance(t.percent)}
                    </span>
                  ),
                )}
              </div>
            </div>
            <SkillOdds a={selected.pet} b={selected.mate} />
            <div className="notice">
              {selected.incoming
                ? "接受后立即结算：你获得 60 币答谢，蛋归申请方，你的亲本计入繁育冷却。"
                : "申请会预留 240 币、亲本和一个蛋的位置。对方接受后，60 币给对方、180 币退出流通，蛋归你。断线后重连继续领取；未接受时可以取消。"}
            </div>
            {!selected.incoming &&
              (availableCoins(state) < 240 ||
                usedSlots(state) >= state.capacity) && (
                <p className="shortfall">
                  需要 240 枚可用宠物币，并留一个空位。
                </p>
              )}
            <button
              className="button primary full"
              disabled={
                working ||
                (!selected.incoming &&
                  (availableCoins(state) < 240 ||
                    usedSlots(state) >= state.capacity))
              }
              onClick={async () => {
                const ok = await run(
                  selected.incoming
                    ? {
                        type: "answer-breed",
                        id: selected.incoming.id,
                        peerId: selected.incoming.peerId,
                        accept: true,
                      }
                    : {
                        type: "breed",
                        peerId: selected.peer.id,
                        petId: selected.pet.id,
                        mateId: selected.mate.id,
                      },
                );
                if (ok) setSelected(null);
              }}
            >
              {selected.incoming ? "确认接受配种" : "确认申请并预留 240 币"}
            </button>
            <button className="text-button" onClick={() => setSelected(null)}>
              再想想
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
