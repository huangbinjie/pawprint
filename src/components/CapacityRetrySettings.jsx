import React from 'react';
import {currentLanguage} from '../i18n/locale.js';
import RetryCountdown from './RetryCountdown.jsx';
const copy=(en,zh)=>currentLanguage()==='en'?en:zh;

export default function CapacityRetrySettings({state,command,working}){
  const enabled=state.settings.capacityRetryEnabled!==false;
  const lastAttempt=state.capacityRetry?.lastAttempt;
  return <section className="card codex-card capacity-retry-settings"><div className="setting-row"><div>
    <h3>{copy('Retry model overloads','模型过载自动重试')}</h3>
    <p>{copy('Retry immediately, up to 5 times per round. If overloads continue, wait 30 seconds before the next round, up to 3 rounds (15 retries). Uses the chat’s current model and permissions. A manual retry resets both counts; stopping cancels retries.','模型过载后立即重试，每轮最多 5 次；仍然过载则等待 30 秒进入下一轮，最多 3 轮（共 15 次重试）。沿用会话的模型和权限，手动重试会重新计数，停止会取消重试。')}</p>
    <small data-testid="capacity-retry-status">{!state.settings.activityEnabled?copy('Enable local session feedback to use automatic retries.','开启本地会话联动后可使用自动重试。'):copy(({waiting:'Waiting to retry.',retrying:'Requesting a retry.',exhausted:'Retry limit reached. Continue manually.',unavailable:'Client retry unavailable. Continue manually.',skipped:'The chat changed; retry cancelled.'})[state.capacityRetry?.status]||'Applies to new overloads while Pawprint is running.',({waiting:'正在等待自动重试。',retrying:'正在请求重试。',exhausted:'已达到重试上限，请手动继续。',unavailable:'客户端重试暂不可用，请手动继续。',skipped:'会话状态已改变，已取消重试。'})[state.capacityRetry?.status]||'仅处理 Pawprint 运行期间新发生的过载。')}</small>
    <RetryCountdown retry={state.capacityRetry?.scheduled?.[0]}/>
    {lastAttempt&&<small data-testid="capacity-retry-result">{copy('Last automatic retry: ','上次自动重试：')}{copy(({requesting:'requesting',requested:'request sent; waiting for the client to start',started:'a retry turn started',completed:'the retried reply ended',failed:'the retried turn failed',stopped:'stopped',skipped:'cancelled because the chat changed',unavailable:'client request unavailable'})[lastAttempt.status],({requesting:'正在请求',requested:'请求已发出，等待客户端开始',started:'重试回复已开始',completed:'重试后的本次回复已结束',failed:'重试后的本次回复仍然失败',stopped:'已停止',skipped:'会话状态已改变，已取消',unavailable:'客户端请求未能发出'})[lastAttempt.status])}{copy(` · Round ${lastAttempt.round}/${lastAttempt.maxRounds} · ${lastAttempt.attempt}/${lastAttempt.maxAttempts}`,` · 第 ${lastAttempt.round}/${lastAttempt.maxRounds} 轮 · 第 ${lastAttempt.attempt}/${lastAttempt.maxAttempts} 次`)}</small>}
  </div><button className={`toggle ${enabled?'on':''}`} role="switch" aria-label={copy('Retry model overloads','模型过载自动重试')} aria-checked={enabled} disabled={working||!state.capacityRetry?.supported||!state.settings.activityEnabled} onClick={()=>command({type:'capacity-retry',enabled:!enabled})}><span/></button></div></section>;
}
