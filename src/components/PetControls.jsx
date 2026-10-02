import React,{useRef} from 'react';
import {ArrowUpRight,List,BellRing} from 'lucide-react';
import {t} from '../i18n/locale.js';
const api=window.pawprint;
export default function PetControls({state}){
  const target=state.activity?.target,waiting=state.settings.attentionEnabled?state.work?.recent?.filter(r=>r.attention).sort((a,b)=>Number(a.attention.seen)-Number(b.attention.seen)||b.attention.at-a.attention.at)[0]:null;
  const hidden=!state.controlsRevealed,workClass=`dock-button dock-work${hidden?' is-hidden':''}`;
  const pressed=useRef(null);
  const inside=(element,event)=>{const b=element.getBoundingClientRect();return event.clientX>=b.left&&event.clientX<b.right&&event.clientY>=b.top&&event.clientY<b.bottom;};
  function begin(event){
    const button=event.target.closest('button[data-interactive]');if(event.button!==0||!button)return;
    pressed.current=button;button.setPointerCapture(event.pointerId);api.setControlsPressed(true);
  }
  function end(event){
    if(!pressed.current)return;pressed.current=null;
    api.setControlsHovered(event.type!=='pointercancel'&&inside(event.currentTarget,event));api.setControlsPressed(false);
  }
  function activate(event,action){if(event.detail>0&&!inside(event.currentTarget,event))return;void action();}
  return <nav className="pet-control-dock" aria-label={t('猫咪快捷操作')} onPointerDownCapture={begin} onPointerUpCapture={end} onPointerCancelCapture={end} onLostPointerCapture={end}>
    <button data-interactive={!hidden||undefined} className={workClass} aria-hidden={hidden} tabIndex={hidden?-1:0} aria-label={t('最近 Codex 会话')} title={t('最近 Codex 会话')} onClick={e=>activate(e,()=>api.showWorkPanel())}><List size={16}/></button>
    {target&&<button data-interactive={!hidden||undefined} className={`${workClass} dock-return`} aria-hidden={hidden} tabIndex={hidden?-1:0} aria-label={t('返回当前 Codex 会话')} title={`${t('返回当前 Codex 会话')}${target.title?` · ${target.title}`:''}`} onContextMenu={e=>{e.preventDefault();void api.showWorkPanel();}} onClick={e=>activate(e,()=>api.openWorkSession())}><ArrowUpRight size={16}/>{state.work?.recent?.some(r=>r.unread)&&<span className="work-unread-dot"/>}{state.work?.pinned&&<span className="work-pin-dot"/>}</button>}
    {waiting&&<button data-interactive className={`dock-button dock-attention ${waiting.attention.seen?'seen':'unseen'}`} aria-label={t('Codex 需要你处理')} title={`${t(waiting.attention.kind==='approval'?'Codex 等你审批':'Codex 等你回答')}${waiting.title?` · ${waiting.title}`:''}`} onClick={e=>activate(e,()=>api.openWorkSession(waiting.threadId))}><BellRing size={16}/></button>}
  </nav>;
}
