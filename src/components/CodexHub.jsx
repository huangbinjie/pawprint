import React,{useState} from 'react';
import {providerLabel} from '../../core/provider-labels.mjs';
import {t} from '../i18n/locale.js';
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}).format(n);
const compact=n=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(n);
export function ProviderUsage({report,busy,onRefresh,providerNames={}}){
 const totals=new Map();for(const day of report?.days||[])for(const model of day.models||[]){const id=model.provider||'unknown';const row=totals.get(id)||{id,tokens:0,input:0,cached:0,output:0,cost:0,unpriced:0};row.tokens+=model.tokens||0;row.input+=model.inputTokens||0;row.cached+=model.cachedTokens||0;row.output+=model.outputTokens||0;row.cost+=model.referenceKnownUSD??model.knownUSD??0;row.unpriced+=model.referenceUnpriced??model.unpriced??0;totals.set(id,row);}
 return <section className="card codex-card"><div className="codex-card-head"><div><h3>按 Provider 查看用量</h3><p>近七天本机记录，不包含未同步到本机的远端用量。</p></div><button className="button secondary" disabled={busy} onClick={onRefresh}>刷新用量</button></div>
  {!totals.size?<p>尚无本地用量记录，使用后刷新查看。</p>:<div className="codex-usage-grid">{[...totals.values()].map(row=><article key={row.id}><h4 translate="no">{providerLabel(row.id,providerNames,t('自定义 Provider'))}</h4><strong>{compact(row.tokens)} tokens</strong><dl><div><dt>输入（含缓存）</dt><dd>{compact(row.input)}</dd></div><div><dt>缓存输入</dt><dd>{compact(row.cached)}</dd></div><div><dt>输出</dt><dd>{compact(row.output)}</dd></div><div><dt>参考费用</dt><dd>{row.unpriced&&row.cost===0?t('未定价'):money(row.cost)}{row.unpriced&&row.cost>0&&<small>{t('（部分）')}</small>}</dd></div></dl></article>)}</div>}
  <p>按每条请求的模型名称匹配价格表，分别计算普通输入、缓存和输出费用；匹配不到的模型显示未定价。第三方参考费用不是实际账单。</p><p>实际余额、套餐额度与扣费请以服务商后台为准。</p>
 </section>;
}
export default function CodexHub({connections,sessions,usage,advanced}){
 const[section,setSection]=useState('connections');
 return <div className="codex-hub"><nav className="codex-tabs" aria-label="Codex 功能分组">{[['connections','连接与 Provider'],['sessions','会话与提醒'],['usage','用量与额度'],['advanced','高级设置']].map(([id,label])=><button key={id} className={section===id?'is-active':''} aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}</nav><div className="codex-stack">{{connections,sessions,usage,advanced}[section]}</div></div>;
}
