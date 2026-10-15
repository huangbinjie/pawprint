import React, { useState, useEffect, useRef } from 'react';
export default function CodexAccounts({ titleLabels, mode = 'connections' }) {
  const api = window.pawprint;
  const [status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [form,setForm]=useState({name:'',baseUrl:'',model:'',apiKey:''}),[adding,setAdding]=useState(false),[deleting,setDeleting]=useState(null);
  const modal=useRef(null),titleState=titleLabels||status?.titleLabels;
  const run=async fn=>{setBusy(true);setError('');try{const r=await fn();if(!r.ok)throw Error(r.error);setStatus(r.data);return true;}catch(e){setError(e.message);return false;}finally{setBusy(false);}};
  useEffect(()=>{void run(()=>api.codexAccounts('status'));},[]);
  useEffect(()=>{if(adding)modal.current?.showModal();else modal.current?.close();},[adding]);
  const field=(key,label,placeholder,type='text')=><label>{label}<input aria-label={label} type={type} placeholder={placeholder} value={form[key]} autoComplete="off" required disabled={busy} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
  if(mode==='advanced')return <section className="card codex-card"><h3>配置与备份</h3><p>路径仅在本机使用，默认收起。</p>{error&&<p role="alert">{error}</p>}<details><summary>查看本机路径</summary><dl className="codex-paths"><dt>配置文件</dt><dd translate="no">{status?.configPath||'—'}</dd><dt>最近备份</dt><dd translate="no">{status?.backupPath||'—'}</dd></dl></details></section>;
  if(mode==='titles')return <section className="card codex-card"><div className="codex-card-head"><div><h3>会话来源标注</h3><p>为确认使用第三方 Provider 的本机会话添加标题前缀。</p></div><button className={`toggle ${titleState?.enabled!==false?'on':''}`} role="switch" aria-label="Provider 标题标注" aria-checked={titleState?.enabled!==false} disabled={busy||status?.supported===false} onClick={()=>run(()=>api.codexAccounts('title-labels',{enabled:titleState?.enabled===false}))}><span/></button></div>
    {status?.supported===false&&<p>当前仅支持 macOS。</p>}
    <p className="codex-example">例如：[我的 API] 项目讨论</p><details><summary>标注规则</summary><p>OpenAI 会话保持原样，远端或无法确认的会话不会标注。关闭后已有前缀保留，客户端列表可能需要刷新。</p></details>
    {(titleState?.error||error)&&<p role="status">{titleState?.error||error}</p>}
    <div className="codex-actions"><button className="button secondary" disabled={busy||titleState?.enabled===false||status?.supported===false} onClick={()=>run(()=>api.codexAccounts('title-labels-refresh'))}>立即标注会话标题</button></div></section>;
  return <section className="card codex-card codex-accounts">
    <div className="codex-card-head"><div><h2>连接与 Provider</h2><p>选择新会话的默认连接，保留 ChatGPT 登录。</p></div><button className="button secondary" disabled={busy} onClick={()=>run(()=>api.codexAccounts('status'))}>刷新状态</button></div>
    {error&&<p role="alert">{error}</p>}{status&&<>
      <div className="codex-current"><span>默认连接</span><strong translate="no">{status.providers.find(p=>p.id===status.selected)?.name||(status.selected==='openai'?'ChatGPT / OpenAI':status.selected)} · {status.model||'—'}</strong><small>{status.running?'Codex 正在运行':'Codex 未运行'}</small></div>
      <p>更新默认连接后，请新建会话；已有会话不会自动切换。</p>
      <div className="codex-provider-list">
        <div className={`codex-provider ${status.selected==='openai'?'is-selected':''}`}><div><strong>ChatGPT / OpenAI</strong><p>使用已有登录</p></div><button className="button secondary" disabled={busy||!status.supported} onClick={()=>run(()=>api.codexAccounts('switch',{id:'openai'}))}>{status.selected==='openai'?'已选用':'选用 ChatGPT'}</button></div>
        {status.providers.map(p=><div key={p.id} className={`codex-provider ${status.selected===p.id?'is-selected':''}`}><div><strong translate="no">{p.name}</strong><p translate="no">{p.model}</p></div><div className="codex-actions"><button className="button secondary" aria-label={`选用 ${p.name}`} disabled={busy||!status.supported} onClick={()=>run(()=>api.codexAccounts('switch',{id:p.id}))}>{status.selected===p.id?'已选用':'选用'}</button><button className="button secondary" disabled={busy} onClick={()=>setDeleting(p)} aria-label={`删除 ${p.name}`}>删除</button></div></div>)}
      </div>
      <div className="codex-actions"><button className="button" disabled={busy||!status.supported} onClick={()=>setAdding(true)}>添加 Provider</button></div>
      <details><summary>切换说明</summary><p>{status.notice}</p><p>第三方服务需支持 Responses API。默认配置不代表远端或已有会话已切换。</p></details>
      {deleting&&<div className="codex-confirm" role="alert"><p>确认删除 Provider：<span translate="no">{deleting.name}</span>？</p>{status.selected===deleting.id&&<p>将先恢复 ChatGPT 默认配置。</p>}<p>删除密钥后，使用它的旧会话将无法继续请求。</p><div className="codex-actions"><button className="button secondary" disabled={busy} onClick={()=>setDeleting(null)}>取消删除</button><button className="button" disabled={busy} onClick={async()=>{if(await run(()=>api.codexAccounts('remove',{id:deleting.id})))setDeleting(null);}}>确认删除</button></div></div>}
      <dialog ref={modal} className="codex-modal" onCancel={e=>{if(busy)e.preventDefault();}} onClose={()=>{setAdding(false);setForm(current=>({...current,apiKey:''}));}}>
        <h3>添加 API Provider</h3><p>API Key 仅保存到 macOS Keychain。</p>
        <form onSubmit={async e=>{e.preventDefault();const input={...form};setForm({...form,apiKey:''});if(await run(()=>api.codexAccounts('add',input))){setAdding(false);setForm({name:'',baseUrl:'',model:'',apiKey:''});}}}>
          {field('name','Provider 名称','我的 API')}{field('baseUrl','Base URL','https://api.example.com/v1','url')}{field('model','模型','服务提供的模型 ID')}{field('apiKey','API Key','仅保存到 Keychain','password')}
          {error&&<p role="alert">{error}</p>}<div className="codex-actions"><button className="button secondary" disabled={busy} type="button" onClick={()=>setAdding(false)}>取消</button><button className="button" disabled={busy} type="submit">保存 Provider</button></div>
        </form>
      </dialog>{!status.supported&&<p>当前仅支持 macOS。</p>}
    </>}
  </section>;
}
