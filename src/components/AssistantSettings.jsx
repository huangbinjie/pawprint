import React, { useEffect, useRef, useState } from 'react';
import { PROVIDERS } from '../../core/assistant.mjs';
import LocalModels from './LocalModels.jsx';
import RawText from '../i18n/RawText.jsx';
import './assistant.css';
const api = window.pawprint;
export default function AssistantSettings({ state }) {
  const current = state.assistant;
  const en = state.settings.language === 'en';
  const tx = (zh, english) => en ? english : zh;
  const [draft, setDraft] = useState(current), [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [personality, setPersonality] = useState(current?.personality || ''), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [dirty, setDirty] = useState(false);
  const requestId = useRef(0);
  useEffect(() => { if (!dirty) setDraft(current); }, [current, dirty]);
  useEffect(() => { setPersonality(current?.personality || ''); }, [current?.petId, current?.personality]);
  if (!current || !draft) return null;
  const update = values => { setDraft(d => ({ ...d, ...values })); setDirty(true); setNotice(''); };
  const chooseProvider = provider => { update({ provider, baseURL: PROVIDERS[provider].baseURL, model: PROVIDERS[provider].model }); setKey(''); setClearKey(false); };
  const call = async fn => {
    const id = ++requestId.current; setBusy(true); setNotice('');
    try { const result = await fn(); if (id !== requestId.current) return null; if (!result.ok) throw new Error(result.error); return result.data; }
    catch (error) { if (id === requestId.current) setNotice(error.message); return null; }
    finally { if (id === requestId.current) setBusy(false); }
  };
  const save = async () => {
    const data = await call(() => api.assistantConfigure({ ...draft, apiKey: key, clearKey }));
    if (data) { setDraft(data); setDirty(false); setKey(''); setClearKey(false); setNotice(tx('设置已保存。', 'Settings saved.')); }
  };
  const end = async () => {
    requestId.current++; setBusy(false);
    const result = await api.assistantEnd();
    setText(''); setNotice(result.ok ? tx('聊天已结束，对话上下文已清空。', 'Conversation ended and context cleared.') : result.error);
  };
  const help = id => call(() => api.assistantHelp(id));
  const modelBusy = ['connecting', 'preparing-runtime', 'starting', 'downloading', 'testing', 'removing'].includes(state.localModels?.status);
  const local = ['ollama', 'lmstudio'].includes(draft.provider);
  return <section className="card settings-card assistant-settings" data-testid="assistant-settings">
    <div className="section-title"><h3>{tx('宠物助手', 'Pet assistant')}</h3><span className="chip">{current.enabled ? tx('已开启', 'Enabled') : tx('默认关闭', 'Off by default')}</span></div>
    <p>{tx('下载推荐本地模型即可文字聊天，无需填写地址和模型名称。也可在高级设置连接自己的服务；语音功能还未接入。', 'Download a recommended local model to chat without entering addresses or model names. Advanced settings support your own provider; voice has not been added yet.')}</p>
    {current.migrationNotice && <p className="assistant-notice">{tx('旧版内置模型与语音监听已移除，宠物性格和已保存的 key 已保留。请选择自己的模型服务。', 'Old built-in models and voice listening were removed. Pet personalities and saved keys are preserved. Choose your own model service.')}</p>}
    {(notice || current.error) && <p className="assistant-notice" role="status"><RawText>{current.error || notice}</RawText></p>}
    <label className="assistant-check"><input type="checkbox" checked={draft.enabled} disabled={modelBusy} onChange={e => update({ enabled: e.target.checked })} />{tx('开启宠物助手', 'Enable pet assistant')}</label>
    <h4>{tx('1 · 选择自己的模型', '1 · Choose your model')}</h4>
    <details open={['lmstudio','mimo','deepseek','openai','custom'].includes(draft.provider)}><summary>{tx('其他模型来源（高级）','Other model providers (advanced)')}</summary>
    <div className="assistant-buttons">
      {['ollama', 'lmstudio', 'mimo', 'deepseek', 'openai'].map(provider => <button key={provider} className={`button ${draft.provider === provider ? 'primary' : 'secondary'} small`} disabled={modelBusy} onClick={() => chooseProvider(provider)}>{provider === 'mimo' ? tx('小米 MiMo', 'Xiaomi MiMo') : PROVIDERS[provider].label}</button>)}
    </div>
    <label>{tx('模型来源', 'Model source')}<select aria-label={tx('模型来源', 'Model source')} value={draft.provider} disabled={modelBusy} onChange={e => e.target.value ? chooseProvider(e.target.value) : update({ provider: '', baseURL: '', model: '' })}>
      <option value="">{tx('请选择模型服务', 'Choose a model service')}</option>
      {Object.entries(PROVIDERS).map(([id, p]) => <option key={id} value={id}>{id === 'custom' ? tx('自定义兼容接口', 'Custom compatible API') : id === 'mimo' ? tx('小米 MiMo', 'Xiaomi MiMo') : p.label}</option>)}
    </select></label>
    </details>
    {(draft.provider === 'ollama' || !draft.provider) && <LocalModels state={state.localModels} language={state.settings.language} onConfigured={data => { requestId.current++; setBusy(false); setDraft(data); setDirty(false); setKey(''); setClearKey(false); setNotice(tx('模型已就绪，已自动保存连接，可以聊天了。', 'Model ready. Connection saved; you can chat now.')); }} />}
    {draft.provider === 'lmstudio' && <div className="assistant-guide"><p>{tx('在 LM Studio 下载并加载模型，开启本地服务器后填写下方连接信息。想一键下载并使用，可以选择 Ollama。', 'Load a model and start the server in LM Studio, then enter its connection below. Choose Ollama for one-click model downloads.')}</p><button className="button secondary small" onClick={() => help('lmstudio')}>{tx('下载 LM Studio（官网）', 'Download LM Studio (official)')}</button></div>}
    {draft.provider && <details open={draft.provider !== 'ollama'}><summary>{local ? tx('高级连接设置（可选）', 'Advanced connection (optional)') : tx('填写 API 连接', 'API connection')}</summary>
      {!local && <><p>{tx('填写供应商提供的 key 和模型名称。需要兼容 Chat Completions；执行操作还要求支持工具调用。只有你发送文字时才会请求模型，角色资料及当前对话会发给所选服务。', 'Enter your provider’s key and model name. Chat Completions compatibility is required, plus tool calling for actions. Requests happen only when you send text; character details and current conversation go to the selected service.')}</p>
        {['mimo', 'deepseek', 'openai'].includes(draft.provider) && <button className="button secondary small" onClick={() => help(draft.provider)}>{tx('打开供应商平台', 'Open provider platform')}</button>}</>}
      <label>API Base URL<input aria-label="API Base URL" value={draft.baseURL} onChange={e => update({ baseURL: e.target.value })} placeholder="https://example.com/v1" spellCheck={false} /></label>
      <label>{tx('模型名称', 'Model name')}<input aria-label={tx('模型名称', 'Model name')} value={draft.model} onChange={e => update({ model: e.target.value })} placeholder={tx('填写供应商或本机提供的模型标识', 'Enter your model identifier')} spellCheck={false} /></label>
      <label>API key<input aria-label="API key" type="password" autoComplete="off" value={key} onChange={e => { setKey(e.target.value); setDirty(true); }} placeholder={current.hasKey && draft.baseURL === current.baseURL && draft.provider === current.provider ? tx('已安全保存，留空保留', 'Saved securely; leave blank to keep') : local ? tx('本机服务通常可以留空', 'Usually optional for local servers') : tx('填写你自己的 API key', 'Enter your API key')} /></label>
      <label className="assistant-check"><input type="checkbox" checked={clearKey} onChange={e => { setClearKey(e.target.checked); setDirty(true); }} />{tx('删除这个连接已保存的 key', 'Remove the saved key for this connection')}</label>
    </details>}
    <label className="assistant-check"><input type="checkbox" checked={draft.actionsEnabled} onChange={e => update({ actionsEnabled: e.target.checked })} />{tx('允许打开网站、搜索网页和打开指定应用', 'Allow opening websites, web searches and supported apps')}</label>
    <div className="assistant-buttons"><button className="button primary" disabled={busy || modelBusy} onClick={save}>{tx('保存助手设置', 'Save assistant settings')}</button>
      {current.enabled && <button className="button secondary" onClick={async () => { requestId.current++; setBusy(false); const result = await api.assistantConfigure({ ...current, enabled: false }); if (result.ok) { setDraft(result.data); setDirty(false); } else setNotice(result.error); }}>{tx('立即关闭助手', 'Turn off now')}</button>}
      <button className="button secondary" disabled={dirty || busy || !current.enabled || !current.provider} onClick={async () => { const result = await call(() => api.assistantProbe()); if (result) setNotice(result); }}>{tx('测试模型连接', 'Test model connection')}</button>
    </div>
    {dirty && <p>{tx('先保存设置，再测试或聊天。', 'Save before testing or chatting.')}</p>}
    {current.enabled && <>
      <h4>{tx('2 · 宠物自己的性格', '2 · Your pet’s personality')}</h4>
      {current.petId && <><label><RawText>{current.petName}</RawText><textarea aria-label={tx('宠物性格', 'Pet personality')} maxLength={2000} rows={3} value={personality} onChange={e => setPersonality(e.target.value)} /></label>
        <button className="button secondary" disabled={busy} onClick={() => call(() => api.assistantProfile(current.petId, personality))}>{tx('保存这只宠物的性格', 'Save this pet’s personality')}</button></>}
      <h4>{tx('3 · 聊天与指令', '3 · Chat and commands')}</h4>
      <form onSubmit={async e => { e.preventDefault(); const result = await call(() => api.assistantRun(text)); if (result) setText(''); }}>
        <label>{tx('输入指令', 'Command')}<input aria-label={tx('输入指令', 'Command')} value={text} maxLength={2000} onChange={e => setText(e.target.value)} placeholder={tx('帮我打开推特', 'Open Twitter')} /></label>
        <div className="assistant-buttons"><button className="button primary" disabled={dirty || busy || !text.trim() || !current.petId}>{current.status === 'thinking' ? tx('正在思考…', 'Thinking…') : tx('发送指令', 'Send command')}</button><button type="button" className="button secondary" onClick={end}>{tx('结束聊天', 'End conversation')}</button></div>
      </form>
      {current.lastReply && <p className="assistant-reply" role="status"><RawText>{current.lastReply}</RawText></p>}
    </>}
  </section>;
}
