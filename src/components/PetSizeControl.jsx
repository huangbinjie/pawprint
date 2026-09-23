import React, { useEffect, useRef, useState } from "react";
export default function PetSizeControl({ value = 100, onState, onError }) {
  const [percent, setPercent] = useState(value);
  const timer = useRef(null), latest = useRef(value), pending = useRef(false);
  const revision = useRef(0), saving = useRef(-1);
  useEffect(() => { if (!pending.current) { setPercent(value); latest.current = value; } }, [value]);
  const commit = async () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    const wanted = latest.current;
    const request = revision.current;
    if (saving.current === request) return;
    saving.current = request;
    const r = await window.pawprint.command({ type: "pet-scale", percent: wanted });
    if (request !== revision.current) return;
    pending.current = false;
    if (r.ok) onState(r.data);
    else { setPercent(value); latest.current = value; void window.pawprint.previewPetScale(value); onError(r.error); }
  };
  useEffect(() => () => { clearTimeout(timer.current); if (pending.current) void window.pawprint.command({ type: "pet-scale", percent: latest.current }); }, []);
  function change(next) {
    revision.current++;
    setPercent(next); latest.current = next; pending.current = true;
    void window.pawprint.previewPetScale(next).then(r => { if (!r.ok) onError(r.error); });
    clearTimeout(timer.current); timer.current = setTimeout(commit, 250);
  }
  return <div className="setting-row pet-size-setting">
    <div><label htmlFor="pet-size"><strong>桌面宠物尺寸</strong></label><p>拖动立即预览，自动保存。自己的宠物、蛋和访客一起缩放，小屋中的展示不变。</p></div>
    <div className="pet-size-control">
      <output htmlFor="pet-size">{percent}%</output>
      <input id="pet-size" aria-label="桌面宠物尺寸" type="range" min="50" max="100" step="5" value={percent} onChange={e => change(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <div>{[60,75,100].map(p => <button key={p} className="text-button" onClick={() => change(p)}>{p}%</button>)}</div>
    </div>
  </div>;
}
