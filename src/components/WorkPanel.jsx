import React, {useState, useEffect} from 'react';
import {ArrowUpRight, Pin, PinOff, Check, Bell, StickyNote, MessageCircle} from 'lucide-react';
import {currentLanguage} from '../i18n/locale.js';
import RawText from '../i18n/RawText.jsx';
import ClientHelpers from './ClientHelpers.jsx';
const copy=(en,zh)=>currentLanguage()==='en'?en:zh;
function Bookmark({row,onCommand,working}) {
  const [text,setText]=useState(row.bookmark);
  useEffect(()=>setText(row.bookmark),[row.bookmark]);
  return <form className="work-bookmark" onSubmit={e=>{e.preventDefault();void onCommand({type:'work-bookmark',threadId:row.threadId,text});}}>
    <label><StickyNote size={15}/><span>{copy('Next step','下一步')}</span></label>
    <div><input aria-label={copy('Conversation bookmark','会话便签')} maxLength={160} value={text} onChange={e=>setText(e.target.value)} placeholder={copy('A small note for when you come back…','写一句回来后要做的事…')}/><button className="button secondary small" disabled={working||text===row.bookmark} type="submit">{copy('Save note','保存便签')}</button></div>
  </form>;
}
export default function WorkPanel({state,command,working,onError}) {
  const w=state.work || {recent:[],pinned:null},mode=state.settings.workReminder || 'quiet',dnd=!!state.settings.workDnd;
  async function open(id){const r=await window.pawprint.openWorkSession(id);if(!r.ok)onError(r.error);}
  const status=kind=>({running:copy('Working','进行中'),completed:copy('Reply ended','回复已结束'),stopped:copy('Stopped','已停止'),unknown:copy('Status unconfirmed','状态待确认')})[kind];
  return <div className="work-page">
    <ClientHelpers state={state} command={command} working={working} onError={onError}/>
    <section className="card work-intro"><MessageCircle size={27}/><div><span className="eyebrow">YOUR WORK, CLOSE BY</span><h2>{copy('A little place to pick up where you left off.','回来就知道接着做什么。')}</h2><p>{copy('Pin one chat for the cat’s return shortcut. Notes stay on this device; no messages or replies are stored.','固定一个会话作为猫咪的返回目标。便签仅保存在本机，不保存消息和回复。')}</p></div></section>
    {!state.settings.activityEnabled && <section className="card work-empty"><p>{copy('Turn on local session feedback to discover your recent chats.','开启本地会话联动，发现最近会话。')}</p><button className="button secondary" disabled={working} onClick={()=>command({type:'activity',enabled:true,topics:state.settings.activityTopics===true})}>{copy('Enable session feedback','开启会话联动')}</button></section>}
    <section className="card work-reminders"><div><Bell size={19}/><h3>{copy('Reply reminders','回复提醒')}</h3></div><p>{copy('An unread dot stays until you open or mark a chat as read. A reply ending does not mean the whole task is complete.','未读圆点保留到打开会话或标记已读。回复结束不代表整个任务完成。')}</p><div className="work-preferences"><label>{copy('Reminder','提醒方式')}<select aria-label={copy('Reply reminder','回复提醒方式')} value={mode} onChange={e=>command({type:'work-settings',reminder:e.target.value,dnd})} disabled={working}><option value="quiet">{copy('Quiet · unread dot','安静 · 未读圆点')}</option><option value="sound">{copy('Gentle sound','轻声提示')}</option><option value="system">{copy('System notification','系统通知')}</option></select></label><label className="work-dnd"><input type="checkbox" checked={dnd} onChange={e=>command({type:'work-settings',reminder:mode,dnd:e.target.checked})} disabled={working}/>{copy('Do not disturb','勿扰模式')}</label></div>{dnd&&<small>{copy('Sounds, notifications and work bubbles are muted. Unread dots are still saved.','声音、通知和工作气泡已静音，仍保留未读圆点。')}</small>}</section>
    <div className="work-list" data-testid="work-list">{w.recent.length===0&&<section className="card work-empty"><MessageCircle size={31}/><h3>{copy('Your recent chats will appear here.','最近会话会出现在这里。')}</h3><p>{copy('This list uses chat metadata. Existing chats start with an unconfirmed status until a new local event arrives.','此列表使用会话元数据。已有会话在收到新的本地记录前显示为状态待确认。')}</p></section>}
    {w.recent.map(row=><article key={row.threadId} className={`card work-chat ${w.pinned===row.threadId?'is-pinned':''}`}><div className="work-chat-head"><div><span className={`work-kind ${row.kind}`}>{row.attention?(row.attention.kind==='approval'?copy('Needs approval','等你审批'):copy('Needs your answer','等你回答')):status(row.kind)}</span>{row.unread&&<span className="work-new">{copy('New reply','新回复')}</span>}{row.project&&<div className="work-chat-project"><RawText>{row.project}</RawText></div>}<h3><RawText>{row.title || row.bookmark || copy("Untitled chat","未命名会话")}</RawText></h3><small>{new Date(row.at).toLocaleString(currentLanguage()==='en'?'en-US':'zh-CN')}</small></div><button className="button secondary small" aria-label={w.pinned===row.threadId?copy('Unpin chat','取消固定'):copy('Pin chat','固定会话')} onClick={()=>command({type:'work-pin',threadId:w.pinned===row.threadId?null:row.threadId})} disabled={working}>{w.pinned===row.threadId?<PinOff size={16}/>:<Pin size={16}/>} {w.pinned===row.threadId?copy('Pinned','已固定'):copy('Pin','固定')}</button></div><Bookmark row={row} onCommand={command} working={working}/><footer>{row.unread&&<button className="text-button" disabled={working} onClick={()=>command({type:'work-read',threadId:row.threadId})}><Check size={15}/>{copy('Mark as read','标记已读')}</button>}<button className="button primary small" onClick={()=>open(row.threadId)}>{copy('Return to chat','返回会话')}<ArrowUpRight size={16}/></button></footer></article>)}</div>
  </div>;
}
