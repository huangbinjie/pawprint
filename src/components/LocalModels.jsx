import React,{useEffect,useState} from 'react';
const api=window.pawprint;
export default function LocalModels({state,language,onConfigured}){
 const tx=(zh,en)=>language==='en'?en:zh,[notice,setNotice]=useState('');
 useEffect(()=>{void api.assistantModelsRefresh();},[]);
 if(!state)return null;
 const busy=['connecting','preparing-runtime','starting','downloading','testing','removing','checking'].includes(state.status),names=new Set(state.installed.map(m=>m.name));
 const act=async(name,installed)=>{setNotice('');const r=await(installed?api.assistantModelUse(name):api.assistantModelDownload(name));if(!r.ok)setNotice(r.error);else if(r.data.models.status==='active')onConfigured(r.data.assistant);};
 const remove=async name=>{setNotice('');if(!window.confirm(tx(`卸载 ${name}？正在使用时会关闭本地助手。宠物、性格和相处记录会保留。`,`Uninstall ${name}? If active, the local assistant will stop. Pets, personality and companion records remain.`)))return;const r=await api.assistantModelRemove(name);if(!r.ok)setNotice(r.error);else if(r.data.error)setNotice(r.data.error);};
 const title={light:tx('极简','Minimal'),balanced:tx('适合这台电脑','For this computer'),quality:tx('高级','Advanced')};
 const stage={connecting:tx('正在连接本地引擎…','Connecting to local engine…'),'preparing-runtime':tx('正在自动准备本地引擎…','Preparing the local engine…'),starting:tx('正在启动本地引擎…','Starting the local engine…'),downloading:tx('正在下载模型…','Downloading model…'),testing:tx('正在确认模型可用…','Checking model readiness…'),removing:tx('正在卸载模型…','Uninstalling model…'),active:tx('模型已就绪，可以聊天。','Model ready. You can chat now.')}[state.status];
 const progress=state.progress;
 return <div className="assistant-guide" data-testid="local-models">
  <strong>{tx('三档本地推荐，下载后直接使用','Three local options, ready after download')}</strong>
  <p>{tx('按语言和内存推荐；只在你点击后下载，不调用付费云端模型。','Recommended by language and memory. Downloads start only when requested; no paid cloud inference.')}</p>
  <p className="current-local-model" data-testid="current-local-model">{tx('当前使用：','Currently using: ')}<span translate="no">{state.selectedModel?.name||state.currentModel||tx('未选择','None')}</span></p>
  {state.managed&&!state.runtimeInstalled&&<p>{tx(`首次会自动准备约 ${Math.round((state.runtimeBytes||0)/1000000)} MB 的本地引擎，无需另装软件。`,`The first download prepares a local engine of about ${Math.round((state.runtimeBytes||0)/1000000)} MB. No separate app installation.`)}</p>}
  {!state.managed&&state.status==='missing'&&<button className="button secondary small" onClick={()=>api.assistantHelp('ollama')}>{tx('安装 Ollama（官方）','Install Ollama (official)')}</button>}
  <div className="assistant-buttons"><span>{tx(`本机 ${state.memoryGB} GB 内存`,`Device memory: ${state.memoryGB} GB`)}</span><button className="button secondary small" disabled={busy} onClick={()=>api.assistantModelsRefresh(true)}>{tx('刷新推荐与已下载模型','Refresh recommendations and downloads')}</button></div>
  <div className="model-cards">{state.recommendations.map(m=><div className="model-card" data-tier={m.tier} data-model-id={m.id} key={m.tier}>
   <strong>{title[m.tier]}{m.tier==='balanced'&&tx(' · 推荐',' · Recommended')}</strong><span translate="no">{m.name}</span>
   <span>{tx(`约 ${m.sizeGB} GB · 建议 ${m.memoryGB} GB 内存`,`About ${m.sizeGB} GB · ${m.memoryGB} GB RAM recommended`)}</span>
   <p>{m.tier==='light'?tx('下载小，适合短聊和基础指令。','Small download for short chats and basic commands.'):m.tier==='balanced'?tx('结合这台电脑选择，兼顾聊天、任务和速度。','Chosen for this computer, balancing conversation, tasks and speed.'):tx('能力更强，下载更大、占用更高。','More capable, with a larger download and higher memory use.')}</p>
   {!m.compatible&&<p>{tx(`至少需要 ${m.minMemoryGB} GB 内存`,`Requires at least ${m.minMemoryGB} GB RAM`)}</p>}
   {state.currentModel===m.id?<span className="chip">{tx('正在使用','In use')}</span>:<button className="button secondary small" disabled={busy||!m.compatible} onClick={()=>act(m.id,names.has(m.id))}>{names.has(m.id)?tx('使用这个模型','Use this model'):tx('下载并使用','Download and use')}</button>}
  </div>)}</div>
  <h4>{tx('已下载模型','Downloaded models')}</h4>
  {!state.installed.length&&<p>{tx('还没有下载模型。','No models downloaded yet.')}</p>}
  {state.installed.map(m=><div className="assistant-buttons downloaded-model" key={m.name}><span translate="no">{m.name}</span><span>{(m.size/1073741824).toFixed(2)} GB</span>{state.currentModel===m.name?<span className="chip">{tx('正在使用','In use')}</span>:<button className="button secondary small" disabled={busy} onClick={()=>act(m.name,true)}>{tx('使用','Use')}</button>}<button className="button secondary small" disabled={busy} onClick={()=>remove(m.name)}>{tx('卸载','Uninstall')}</button></div>)}
  {stage&&<strong role="status">{stage} <span translate="no">{state.model}</span></strong>}
  {busy&&state.status!=='checking'&&<><progress aria-label={tx('模型下载进度','Model download progress')} max="100" value={progress?.total?Math.min(100,progress.completed/progress.total*100):undefined}/>{progress?.total>0&&<span>{Math.round(progress.completed/progress.total*100)}% · {(progress.completed/1073741824).toFixed(2)} / {(progress.total/1073741824).toFixed(2)} GB</span>}<button className="button secondary small" disabled={state.status==='removing'} onClick={()=>api.assistantModelCancel()}>{tx('取消','Cancel')}</button></>}
  {(notice||state.error)&&<p role="alert">{notice||state.error}</p>}
 </div>;
}
