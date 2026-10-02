import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, MessageCircle, Pin, PinOff, Folder, StickyNote, X } from 'lucide-react';
import { currentLanguage } from '../i18n/locale.js';
import RawText from '../i18n/RawText.jsx';
const copy = (en, zh) => currentLanguage() === 'en' ? en : zh;
const api = window.pawprint;

function MiniChat({ row, pinned, target, command, working, open }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.bookmark);
  const input = useRef(null);
  useEffect(() => { if (!editing) setText(row.bookmark); }, [row.bookmark, editing]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  const kind = row.attention ? copy(row.attention.kind==='approval'?'Needs approval':'Needs your answer',row.attention.kind==='approval'?'等你审批':'等你回答') : { running: copy('Working', '进行中'), completed: copy('Reply ended', '回复已结束'), stopped: copy('Stopped', '已停止'), unknown: copy('Unconfirmed', '状态待确认') }[row.kind];
  return <article className={`mini-chat ${pinned ? 'is-pinned' : ''} ${target ? 'is-target' : ''}`}>
    <div className="mini-chat-meta"><span className={`mini-kind ${row.attention?'attention':row.kind}`}>{kind}</span>{row.unread && <span className="mini-unread">{copy('New reply', '新回复')}</span>}
      <button className="mini-icon" disabled={working} aria-label={pinned ? copy('Unpin chat', '取消固定') : copy('Pin chat', '固定会话')} onClick={() => command({ type: 'work-pin', threadId: pinned ? null : row.threadId })}>{pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
    </div>
    {row.project && <div className="mini-chat-project"><Folder size={12}/><RawText>{row.project}</RawText>{pinned && <span className="mini-pinned-label">{copy('Pinned','已固定')}</span>}</div>}
    <div className="mini-chat-title"><span translate="no" title={row.title || row.bookmark}><RawText>{row.title || row.bookmark || copy('Untitled chat','未命名会话')}</RawText></span>{!row.project && pinned && <span className="mini-pinned-label">{copy('Pinned','已固定')}</span>}</div>
    {editing ? <form className="mini-note-editor" onSubmit={async e => { e.preventDefault(); const result = await command({ type: 'work-bookmark', threadId: row.threadId, text }); if (result) setEditing(false); }}>
      <input ref={input} aria-label={copy('Conversation bookmark', '会话便签')} maxLength={160} onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();setEditing(false);}}} value={text} onChange={e => setText(e.target.value)} placeholder={copy('Your next step…', '下一步做什么…')}/>
      <div><button type="button" className="mini-text-button" onClick={() => setEditing(false)}>{copy('Cancel', '取消')}</button><button type="submit" className="mini-save" disabled={working}>{copy('Save note', '保存便签')}</button></div>
    </form> : <button className={`mini-bookmark ${row.bookmark ? 'has-note' : ''}`} aria-label={copy('Edit bookmark', '编辑便签')} onClick={() => setEditing(true)}><StickyNote size={14}/><span>{row.bookmark ? <RawText>{row.bookmark}</RawText> : copy('Add a next-step note…', '留一句下一步…')}</span></button>}
    {!editing && <footer>{row.unread && <button className="mini-icon" disabled={working} aria-label={copy('Mark as read', '标记已读')} onClick={() => command({ type: 'work-read', threadId: row.threadId })}><Check size={14}/></button>}<button className="mini-return" disabled={working} aria-label={copy(target ? 'Return to focus chat' : 'Return to chat', target ? '返回关注会话' : '返回会话')} title={copy(target ? 'Return to focus chat' : 'Return to chat', target ? '返回关注会话' : '返回会话')} onClick={() => open(row.threadId)}><ArrowUpRight size={15}/></button></footer>}
  </article>;
}

export default function WorkMini({ state, command, working, error, onError }) {
  const w = state.work;
  const recent = [...w.recent].sort((a, b) => Number(b.threadId === w.pinned) - Number(a.threadId === w.pinned));
  const target = state.activity?.target?.threadId;
  useEffect(() => {
    const handle = e => { if (e.key === 'Escape' && e.target.tagName !== 'INPUT') void api.hideWorkPanel(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, []);
  async function open(id) { const r = await api.openWorkSession(id); if (!r.ok) onError(r.error); }
  return <main className="work-mini" aria-label={copy('Recent Codex chats', '最近 Codex 会话')}>
    <header><div><span className="mini-eyebrow">PAWPRINT · WORK</span><h1>{copy('Recent chats', '最近会话')}</h1></div><button className="mini-icon mini-close" aria-label={copy('Close panel', '关闭小面板')} onClick={() => api.hideWorkPanel()}><X size={17}/></button></header>
    <p className="mini-intro">{copy('Pin your focus. Keep the next step close.', '固定关注，把下一步放在手边。')}</p>
    {error && <p className="mini-error" role="alert">{error}</p>}
    <div className="mini-chat-list">{recent.length ? recent.map(row => <MiniChat key={row.threadId} row={row} pinned={w.pinned === row.threadId} target={target === row.threadId} command={command} working={working} open={open}/>) : <div className="mini-empty"><MessageCircle size={27}/><p>{copy('No recent chats yet.', '暂时没有最近会话。')}</p><small>{copy('Enable session feedback in Work chats to discover them.', '在工作会话中开启联动后，就会显示在这里。')}</small></div>}</div>
    <footer className="mini-panel-footer"><button className="mini-text-button" onClick={() => api.showHome('work')}>{copy('All chats & reminders', '所有会话与提醒')}<ArrowUpRight size={13}/></button><small>{copy('Local notes', '本地便签')}</small></footer>
  </main>;
}

export function WorkNote({ note }) {
  if (!note) return null;
  return <aside className="work-note" role="status"><header><StickyNote size={15}/><span>{copy('Your next step', '你的下一步')}</span><small><RawText>{note.title || copy("Untitled chat","未命名会话")}</RawText></small></header><p className="work-note-text"><RawText>{note.text}</RawText></p></aside>;
}
