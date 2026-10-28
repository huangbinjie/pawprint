import React,{useEffect,useState} from 'react';
import {RotateCw} from 'lucide-react';
import {currentLanguage} from '../i18n/locale.js';

export default function RetryCountdown({retry}){
  const [now,setNow]=useState(Date.now),retryAt=retry?.retryAt;
  useEffect(()=>{
    if(retryAt==null)return;
    setNow(Date.now());
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[retryAt]);
  if(!retry)return null;
  const seconds=Math.max(0,Math.ceil((retryAt-now)/1000)),english=currentLanguage()==='en';
  return <span className="capacity-retry-countdown" role="timer"><RotateCw size={12}/>{seconds>0
    ?english?`Retry in ${seconds}s · Round ${retry.round}/${retry.maxRounds} · ${retry.attempt}/${retry.maxAttempts}`:`${seconds} 秒后重试 · 第 ${retry.round}/${retry.maxRounds} 轮 · 第 ${retry.attempt}/${retry.maxAttempts} 次`
    :english?'Requesting a retry…':'正在请求重试…'}</span>;
}
