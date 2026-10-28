import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ArrowUpRight, Bell, Check, MessageCircle, RefreshCw, Search, Trash2 } from 'lucide-react';
import { currentLanguage } from '../i18n/locale.js';
import ClientHelpers from './ClientHelpers.jsx';
import RawText from '../i18n/RawText.jsx';
import RetryCountdown from './RetryCountdown.jsx';

const copy = (en, zh) => currentLanguage() === 'en' ? en : zh;

function Highlight({ text, query }) {
  const value = String(text || '');
  const terms = query.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{value}</>;
  const pattern = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
  return <>{value.split(pattern).map((part, index) => terms.some(term => part.toLocaleLowerCase() === term.toLocaleLowerCase()) ? <mark key={index}>{part}</mark> : <React.Fragment key={index}>{part}</React.Fragment>)}</>;
}

function Bookmark({ row, onCommand, working }) {
  const [text, setText] = useState(row.bookmark);
  useEffect(() => setText(row.bookmark), [row.bookmark]);
  return <form className="work-bookmark" onSubmit={event => { event.preventDefault(); void onCommand({ type: 'work-bookmark', threadId: row.threadId, text }); }}><label><span>{copy('Next step', '下一步')}</span></label><div><input aria-label={copy('Conversation bookmark', '会话便签')} maxLength={160} value={text} onChange={event => setText(event.target.value)} placeholder={copy('e.g. Check failing tests, then commit the fix', '例如：检查失败的测试，再提交修复')}/><button className="button secondary small" disabled={working || text === row.bookmark} type="submit">{copy('Save note', '保存便签')}</button></div></form>;
}

export default function WorkPanel({ state, command, working, onError, managerOnly = false, hideManager = false }) {
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(true);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(false);

  async function search(value = query, archived = includeArchived) {
    setLoading(true);
    const result = await window.pawprint.searchSessions({ query: value, includeArchived: archived });
    setLoading(false);
    if (!result.ok) { onError(result.error); return; }
    setRows(result.data || []);
    setSelected(current => new Set([...current].filter(id => (result.data || []).some(row => row.id === id))));
  }

  useEffect(() => { void search(); }, [includeArchived]);

  const recent = useMemo(() => new Map((state.work?.recent || []).map(row => [row.threadId, row])), [state.work?.recent]);
  const selectedCount = selected.size;
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.id));

  async function mutate(action) {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'delete' && !window.confirm(copy(`Permanently delete ${ids.length} chat(s)?`, `确定永久删除 ${ids.length} 个会话吗？`))) return;
    const result = await window.pawprint.mutateSessions(action, ids);
    if (!result.ok) { onError(result.error); return; }
    setSelected(new Set());
    await search();
  }

  async function open(id) {
    const result = await window.pawprint.openWorkSession(id);
    if (!result.ok) onError(result.error);
  }

  function toggle(id) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return <div className="work-page">
    {!managerOnly && <>
    <ClientHelpers state={state} onError={onError}/>
    <section className="card work-intro"><MessageCircle size={22}/><div><h3>{copy(hideManager?'Chat pinning & notes':'Chat management',hideManager?'会话固定与便签':'会话管理')}</h3><p>{copy(hideManager?'Pin a chat for the return shortcut. Double-click the cat to return; your next-step note stays for 15 seconds.':'Search local Codex chats, jump back to a result, or archive and delete several chats together.',hideManager?'固定一个会话作为返回目标。双击猫咪返回，便签会显示 15 秒。':'搜索本机 Codex 会话，定位跳转，或批量归档、删除。')}</p></div></section>
    {(!state.settings.activityEnabled || !state.work?.recent?.length) && <section className="card work-empty"><p>{copy('Turn on local session feedback to discover recent activity.','开启本地会话联动后，才能发现最近活动。')}</p><button className="button secondary" disabled={working} onClick={() => command({ type: 'activity', enabled: true, topics: state.settings.activityTopics === true })}>{copy('Enable session feedback', '开启会话联动')}</button></section>}
    <section className="card work-reminders"><div><Bell size={19}/><h3>{copy('Reply reminders','回复提醒')}</h3></div><p>{copy('Unread dots stay until you open or mark a chat as read.','未读圆点会保留到你打开会话或手动标记已读。')}</p><div className="work-preferences"><label>{copy('Reminder','提醒方式')}<select aria-label={copy('Reply reminder','回复提醒方式')} value={state.settings.workReminder || 'quiet'} onChange={e=>command({type:'work-settings',reminder:e.target.value,dnd:!!state.settings.workDnd})} disabled={working}><option value="quiet">{copy('Quiet · unread dot','安静 · 未读圆点')}</option><option value="sound">{copy('Gentle sound','轻声提示')}</option><option value="system">{copy('System notification','系统通知')}</option></select></label><label className="work-dnd"><input type="checkbox" checked={state.settings.workDnd === true} onChange={e=>command({type:'work-settings',reminder:state.settings.workReminder || 'quiet',dnd:e.target.checked})} disabled={working}/>{copy('Do not disturb','勿扰模式')}</label></div></section>
    </>}
    {!hideManager && <section className="card session-manager" data-testid="session-manager">
      <form className="session-search" onSubmit={event => { event.preventDefault(); void search(); }}><Search size={17}/><input aria-label={copy('Search chats','搜索会话')} value={query} onChange={event => setQuery(event.target.value)} placeholder={copy('Search titles, projects or conversation IDs','搜索标题、项目或会话 ID')}/><button className="button primary small" type="submit" disabled={loading}>{copy('Search','搜索')}</button></form>
      <div className="session-manager-toolbar"><label><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)}/>{copy('Include archived','包含已归档')}</label><span>{loading ? copy('Searching…','搜索中…') : copy(`${rows.length} chats`, `${rows.length} 个会话`)}</span><button className="text-button" type="button" onClick={() => void search()} disabled={loading}><RefreshCw size={14}/>{copy('Refresh','刷新')}</button></div>
      {selectedCount > 0 && <div className="session-bulk-actions"><span>{copy(`${selectedCount} selected`, `已选 ${selectedCount} 个`)}</span><button className="button secondary small" type="button" onClick={() => void mutate('archive')}><Archive size={14}/>{copy('Archive','归档')}</button><button className="button secondary small" type="button" onClick={() => void mutate('unarchive')}><ArchiveRestore size={14}/>{copy('Unarchive','取消归档')}</button><button className="button danger small" type="button" onClick={() => void mutate('delete')}><Trash2 size={14}/>{copy('Delete','删除')}</button></div>}
      <div className="session-select-all"><label><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(row => row.id)))}/>{copy('Select all','全选')}</label></div>
      <div className="session-results">{rows.length === 0 ? <div className="work-empty"><MessageCircle size={28}/><h3>{copy('No matching chats','没有匹配的会话')}</h3><p>{copy('Try another keyword or enable archived chats.','换个关键词，或打开“包含已归档”。')}</p></div> : rows.map(row => { const local = recent.get(row.id); return <article className={`session-row ${row.archived ? 'is-archived' : ''}`} key={row.id}><label className="session-check"><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)}/><span/></label><div className="session-main"><h3><Highlight text={row.title || copy('Untitled chat','未命名会话')} query={query}/></h3><div className="session-meta">{row.project && <span><Highlight text={row.project} query={query}/></span>}<span>{row.archived ? copy('Archived','已归档') : copy('Active','进行中')}</span><span>{new Date(row.at).toLocaleString(currentLanguage() === 'en' ? 'en-US' : 'zh-CN')}</span></div>{local?.bookmark && <p className="session-note"><Check size={13}/><RawText>{local.bookmark}</RawText></p>}<RetryCountdown retry={state.capacityRetry?.scheduled?.find(retry => retry.threadId === row.id)}/></div><button className="button primary small" type="button" onClick={() => void open(row.id)}>{copy('Open chat','打开会话')}<ArrowUpRight size={15}/></button></article>; })}</div>
    </section>}
    {!managerOnly && <section className="work-recent"><h3>{copy('Recent activity','最近活动')}</h3><div className="work-list">{(state.work?.recent || []).map(row => <article key={row.threadId} className={`card work-chat ${state.work.pinned === row.threadId ? 'is-pinned' : ''}`}><div className="work-chat-head"><div><span className={`work-kind ${row.kind}`}>{row.attention ? copy(row.attention.kind === 'approval' ? 'Needs approval' : 'Needs your answer', row.attention.kind === 'approval' ? '等你审批' : '等你回答') : row.kind}</span>{row.unread && <span className="work-new">{copy('New reply', '新回复')}</span>}<h3><RawText>{row.title || row.bookmark || copy('Untitled chat', '未命名会话')}</RawText></h3><small>{new Date(row.at).toLocaleString(currentLanguage() === 'en' ? 'en-US' : 'zh-CN')}</small></div><button className="button secondary small" aria-label={state.work.pinned === row.threadId ? copy('Unpin chat', '取消固定') : copy('Pin chat', '固定会话')} onClick={() => command({ type: 'work-pin', threadId: state.work.pinned === row.threadId ? null : row.threadId })} disabled={working}>{state.work.pinned === row.threadId ? copy('Pinned', '已固定') : copy('Pin', '固定')}</button></div><RetryCountdown retry={state.capacityRetry?.scheduled?.find(retry => retry.threadId === row.threadId)}/><Bookmark row={row} onCommand={command} working={working}/><footer>{row.unread && <button className="text-button" disabled={working} onClick={() => command({ type: 'work-read', threadId: row.threadId })}><Check size={15}/>{copy('Mark as read', '标记已读')}</button>}<button className="button primary small" onClick={() => void open(row.threadId)}>{copy('Return to chat', '返回会话')}<ArrowUpRight size={16}/></button></footer></article>)}</div></section>}
  </div>;
}
