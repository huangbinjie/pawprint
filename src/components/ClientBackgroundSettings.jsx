import React,{useEffect,useState} from 'react';
import {currentLanguage} from '../i18n/locale.js';
import nightPreview from '../assets/skins/night.jpg';
import catPreview from '../assets/skins/cat.jpg';
import dogPreview from '../assets/skins/dog.jpg';
import './client-skins.css';
const previews={night:nightPreview,cat:catPreview,dog:dogPreview};
const copy=(en,zh)=>currentLanguage()==='en'?en:zh;

export default function ClientBackgroundSettings(){
 const [state,setState]=useState(null),[presets,setPresets]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const api=window.pawprint;
 async function run(action,input){
  setBusy(true);setError('');
  try{const r=await api.codexBackground(action,input);if(!r.ok)throw Error(r.error);setState(r.data);}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 useEffect(()=>{
  let active=true;const refresh=async()=>{const r=await api.codexBackground('status');if(active&&r.ok)setState(r.data);};
  void refresh();void api.codexBackground('presets').then(r=>{if(active){if(r.ok)setPresets(r.data);else setError(r.error);}});
  const timer=setInterval(()=>void refresh(),1000);return()=>{active=false;clearInterval(timer);};
 },[]);
 const current=state?.enabled?state.presetId||'custom':'default',selected=presets.find(p=>p.id===current);
 return <section className="card codex-card client-skins" data-testid="client-skins">
  <div className="skins-heading"><div><span className="skins-eyebrow">PERSONAL WORKSPACE</span><h3>{copy('Skins','皮肤')}</h3><p>{copy('A little company for your workspace. Choose a scene to make it yours.','给工作空间一点陪伴，选择喜欢的场景即可。')}</p></div><span className="skins-current">{copy('Current: ','当前主题：')}{current==='default'?copy('Original','默认外观'):selected?copy(selected.englishName,selected.name):copy('Current background','当前背景')}</span><button className="skin-original" aria-pressed={current==='default'} disabled={busy||!state?.supported} onClick={()=>run('select-preset','default')}>{copy('Original','默认外观')}</button></div>
  <div className="skins-grid">

   {presets.map(p=><button key={p.id} className={`skin-card ${current===p.id?'is-selected':''}`} aria-pressed={current===p.id} disabled={busy||!state?.supported} onClick={()=>run('select-preset',p.id)}><div className="skin-preview"><img src={previews[p.id]} alt={copy(p.englishName,p.name)}/><span className="skin-motion-badge">{copy('Animated','动态')}</span></div><div className="skin-card-copy"><strong>{copy(p.englishName,p.name)}</strong><span>{copy(p.englishDescription,p.description)}</span><small>{current===p.id?copy('Current skin','当前使用'):copy('Use skin','使用皮肤')}</small></div></button>)}
  </div>
  {state?.download&&<div className="skin-download" role="status"><span>{copy('Downloading skin… ','正在下载皮肤… ')}{state.download.percent}%</span><progress max="100" value={state.download.percent}/></div>}
  {state?.enabled&&state.status==='needs-connection'&&<p><button className="button secondary" disabled={busy} onClick={()=>run('reconnect')}>{copy('Connect to client','连接客户端')}</button></p>}
  <small className="skins-note">{copy('Videos download once on selection and work offline afterward. Keep Pawprint running to restore your skin after client restarts.','视频首次使用时下载，之后离线可用。保持 Pawprint 运行，客户端重开后会恢复当前皮肤。')}</small>
  {state&&!state.supported&&<p>{copy('Currently available on macOS.','目前支持 macOS。')}</p>}
  {(error||state?.error)&&<p role="alert">{error||state.error}</p>}
 </section>;
}
