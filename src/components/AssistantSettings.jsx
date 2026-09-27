import React, { useEffect, useRef, useState } from 'react';
import { PROVIDERS } from '../../core/assistant.mjs';
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
  const local = ['ollama', 'lmstudio'].includes(draft.provider);
  return <section className="card settings-card assistant-settings" data-testid="assistant-settings">
    <div className="section-title"><h3>{tx('宠物助手', 'Pet assistant')}</h3><span className="chip">{current.enabled ? tx('已开启', 'Enabled') : tx('默认关闭', 'Off by default')}</span></div>
    <p>{tx('连接你自己的模型，与宠物文字聊天或让它打开网站和应用。Pawprint 不再内置模型或语音监听。', 'Connect your own model to chat by text or open websites and apps. Pawprint no longer bundles models or voice listening.')}</p>
    {current.migrationNotice && <p className="assistant-notice">{tx('旧版内置模型与语音监听已移除，宠物性格和已保存的 key 已保留。请选择自己的模型服务。', 'Old built-in models and voice listening were removed. Pet personalities and saved keys are preserved. Choose your own model service.')}</p>}
    {(notice || current.error) && <p className="assistant-notice" role="status"><RawText>{current.error || notice}</RawText></p>}
    <label className="assistant-check"><input type="checkbox" checked={draft.enabled} onChange={e => update({ enabled: e.target.checked })} />{tx('开启宠物助手', 'Enable pet assistant')}</label>
    <h4>{tx('1 · 选择自己的模型', '1 · Choose your model')}</h4>
    <div className="assistant-buttons">
      {['ollama', 'lmstudio', 'mimo', 'deepseek', 'openai'].map(provider => <button key={provider} className={`button ${draft.provider === provider ? 'primary' : 'secondary'} small`} onClick={() => chooseProvider(provider)}>{provider === 'mimo' ? tx('小米 MiMo', 'Xiaomi MiMo') : PROVIDERS[provider].label}</button>)}
    </div>
    <label>{tx('模型来源', 'Model source')}<select aria-label={tx('模型来源', 'Model source')} value={draft.provider} onChange={e => e.target.value ? chooseProvider(e.target.value) : update({ provider: '', baseURL: '', model: '' })}>
      <option value="">{tx('请选择模型服务', 'Choose a model service')}</option>
      {Object.entries(PROVIDERS).map(([id, p]) => <option key={id} value={id}>{id === 'custom' ? tx('自定义兼容接口', 'Custom compatible API') : id === 'mimo' ? tx('小米 MiMo', 'Xiaomi MiMo') : p.label}</option>)}
    </select></label>
    {local && <div className="assistant-guide">
      <strong>{tx('模型由你独立下载和运行', 'Download and run models separately')}</strong>
      {draft.provider === 'ollama' ? <>
        <p>{tx('安装 Ollama 后，建议先试 Qwen3 8B；内存充足时可试 14B，通常更慢。模型效果需要实际体验，Pawprint 不会自动下载。', 'Install Ollama and try Qwen3 8B first. With enough memory, try 14B, which is usually slower. Evaluate the model yourself; Pawprint does not download it automatically.')}</p>
        <div className="assistant-buttons"><button className="button secondary small" onClick={() => help('ollama')}>{tx('下载 Ollama（官网）', 'Download Ollama (official)')}</button><button className="button secondary small" onClick={() => help('qwen8')}>{tx('Qwen3 8B 模型页', 'Qwen3 8B model page')}</button><button className="button secondary small" onClick={() => help('qwen14')}>{tx('Qwen3 14B 模型页', 'Qwen3 14B model page')}</button></div>
        <code>ollama pull qwen3:8b</code>
        <p>{tx('保持 Ollama 在运行，填写实际下载的模型名称，然后保存并测试连接。', 'Keep Ollama running, enter the model name you downloaded, save and test the connection.')}</p>
      </> : <>
        <p>{tx('在 LM Studio 中搜索并下载合适的模型，加载模型并开启本地服务器，再把服务器地址和模型标识填到下方。', 'Download and load a model in LM Studio, enable its local server, then enter the server URL and model identifier below.')}</p>
        <button className="button secondary small" onClick={() => help('lmstudio')}>{tx('下载 LM Studio（官网）', 'Download LM Studio (official)')}</button>
      </>}
    </div>}
    {draft.provider && <>
      {!local && <><p>{tx('填写供应商提供的 key 和模型名称。需要兼容 Chat Completions；执行操作还要求支持工具调用。只有你发送文字时才会请求模型，角色资料及当前对话会发给所选服务。', 'Enter your provider’s key and model name. Chat Completions compatibility is required, plus tool calling for actions. Requests happen only when you send text; character details and current conversation go to the selected service.')}</p>
        {['mimo', 'deepseek', 'openai'].includes(draft.provider) && <button className="button secondary small" onClick={() => help(draft.provider)}>{tx('打开供应商平台', 'Open provider platform')}</button>}</>}
      <label>API Base URL<input aria-label="API Base URL" value={draft.baseURL} onChange={e => update({ baseURL: e.target.value })} placeholder="https://example.com/v1" spellCheck={false} /></label>
      <label>{tx('模型名称', 'Model name')}<input aria-label={tx('模型名称', 'Model name')} value={draft.model} onChange={e => update({ model: e.target.value })} placeholder={tx('填写供应商或本机提供的模型标识', 'Enter your model identifier')} spellCheck={false} /></label>
      <label>API key<input aria-label="API key" type="password" autoComplete="off" value={key} onChange={e => { setKey(e.target.value); setDirty(true); }} placeholder={current.hasKey && draft.baseURL === current.baseURL && draft.provider === current.provider ? tx('已安全保存，留空保留', 'Saved securely; leave blank to keep') : local ? tx('本机服务通常可以留空', 'Usually optional for local servers') : tx('填写你自己的 API key', 'Enter your API key')} /></label>
      <label className="assistant-check"><input type="checkbox" checked={clearKey} onChange={e => { setClearKey(e.target.checked); setDirty(true); }} />{tx('删除这个连接已保存的 key', 'Remove the saved key for this connection')}</label>
    </>}
    <label className="assistant-check"><input type="checkbox" checked={draft.actionsEnabled} onChange={e => update({ actionsEnabled: e.target.checked })} />{tx('允许打开网站、搜索网页和打开指定应用', 'Allow opening websites, web searches and supported apps')}</label>
    <div className="assistant-buttons"><button className="button primary" disabled={busy} onClick={save}>{tx('保存助手设置', 'Save assistant settings')}</button>
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
