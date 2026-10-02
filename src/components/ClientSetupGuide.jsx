import React,{useState} from 'react';
import {X,ShieldCheck,ExternalLink} from 'lucide-react';
import {currentLanguage} from '../i18n/locale.js';
const copy=(en,zh)=>currentLanguage()==='en'?en:zh;
const api=window.pawprint;
export default function ClientSetupGuide({state}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function openHooks(){setBusy(true);try{const r=await api.openClientHelperSettings('hooks');if(!r.ok)setError(r.error);}finally{setBusy(false);}}
 return <main className="client-setup-guide"><header><div className="setup-emblem"><ShieldCheck size={24}/></div><h1>{copy('Pawprint hooks','Pawprint 的 Hooks')}</h1><button className="mini-icon" aria-label={copy('Close guide','关闭引导')} onClick={()=>api.closeClientGuide()}><X size={18}/></button></header>
 <p>{copy('These seven rows belong to Pawprint. Their names start with “Pawprint ·”. Keep other project rules unchanged.','下面这 7 条是 Pawprint 的规则，名称都以“Pawprint ·”开头。其他项目的规则保持原样。')}</p>
 <ol><li>{copy('Open client settings, then choose Hooks if it is not selected automatically.','打开客户端设置；如果未自动选中，请点左侧 Hooks／钩子。')}</li><li>{copy('Expand the Pawprint rows and review the commands. Enable and trust these rows.','展开带 Pawprint 名称的条目，核对命令后启用并信任。')}</li></ol>
 <div className="setup-hook-list">{state.attention?.rules?.map(r=><article key={r.event}><strong>{r.label}</strong><small>{r.event}</small></article>)}</div>
 <button className="button primary" disabled={busy} onClick={openHooks}><ExternalLink size={16}/>{copy('Open Hooks in client','打开客户端 Hooks')}</button>
 {state.setupGuide?.navigation==='settings-only'&&<small>{copy('The client opened Settings. Select Hooks in its sidebar.','已打开客户端设置，请在左侧选择 Hooks／钩子。')}</small>}
 {error&&<p role="alert" className="setup-error">{error}</p>}
 </main>;
}
