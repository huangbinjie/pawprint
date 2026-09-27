import React, { useEffect, useState } from 'react';
const api = window.pawprint;
export default function LocalModels({ state, language, onConfigured }) {
  const tx = (zh, en) => language === 'en' ? en : zh;
  const [notice, setNotice] = useState('');
  useEffect(() => { void api.assistantModelsRefresh(); }, []);
  if (!state) return null;
  const busy = ['connecting', 'starting', 'downloading', 'testing'].includes(state.status);
  const act = async (name, installed) => {
    setNotice('');
    const result = await (installed ? api.assistantModelUse(name) : api.assistantModelDownload(name));
    if (!result.ok) setNotice(result.error);
    else if (result.data.models.status === 'active') onConfigured(result.data.assistant);
  };
  const names = new Set(state.installed.map(m => m.name));
  const stage = { connecting: tx('正在连接 Ollama…', 'Connecting to Ollama…'), starting: tx('正在启动 Ollama…', 'Starting Ollama…'), downloading: tx('正在下载模型…', 'Downloading model…'), testing: tx('正在试运行，首次加载可能需要一会儿…', 'Testing the model; first load may take a while…'), active: tx('模型已连接，可以直接聊天。', 'Model connected. You can chat now.') }[state.status];
  const progress = state.progress;
  return <div className="assistant-guide" data-testid="local-models">
    <strong>{tx('选择一个模型，下载后自动连接', 'Pick a model; download and connect automatically')}</strong>
    <p>{tx('模型只在你点击后下载，由 Ollama 管理。无需复制地址或输入命令。', 'Models download only when you click and are managed by Ollama. No commands or copied URLs needed.')}</p>
    {(state.status === 'missing' || (state.status === 'error' && !state.runtimeInstalled)) && <div><p>{tx('这台电脑尚未检测到 Ollama。首次安装一次，完成后回来点“重新检测”。', 'Ollama was not found. Install it once, then return and click Check again.')}</p><button className="button secondary small" onClick={() => api.assistantHelp('ollama')}>{tx('安装 Ollama（官方）', 'Install Ollama (official)')}</button></div>}
    {state.status === 'stopped' && <p>{tx('已安装 Ollama；点击模型后会自动启动服务。', 'Ollama is installed. Choosing a model will start its service.')}</p>}
    <button className="button secondary small" disabled={busy || state.status === 'checking'} onClick={() => api.assistantModelsRefresh()}>{state.status === 'checking' ? tx('正在检测…', 'Checking…') : tx('重新检测', 'Check again')}</button>
    <div className="model-cards">{state.catalog.map(model => <div className="model-card" key={model.id}>
      <strong>{model.name}{model.tier === 'balanced' && state.memoryGB >= 16 ? tx(' · 推荐', ' · Recommended') : ''}</strong>
      <span>{tx(`约 ${model.sizeGB} GB · 建议 ${model.memoryGB} GB 内存`, `About ${model.sizeGB} GB · ${model.memoryGB} GB RAM recommended`)}</span>
      <p>{model.tier === 'light' ? tx('占用较低，适合先体验。', 'Lower memory use, a lighter starting point.') : model.tier === 'balanced' ? tx('日常中文聊天和工具操作，兼顾速度。', 'Balanced everyday chat and tool use.') : tx('更重视回答质量，加载和回复通常更慢。', 'More emphasis on quality, usually slower to load and reply.')}</p>
      <button className="button secondary small" disabled={busy || !['ready', 'stopped', 'active', 'error', 'cancelled'].includes(state.status)} onClick={() => act(model.id, names.has(model.id))}>{names.has(model.id) ? tx('使用这个模型', 'Use this model') : tx('下载并使用', 'Download and use')}</button>
    </div>)}</div>
    {state.installed.filter(m => !state.catalog.some(c => c.id === m.name)).map(m => <div className="assistant-buttons" key={m.name}><span translate="no">{m.name}</span><button className="button secondary small" disabled={busy} onClick={() => act(m.name, true)}>{tx('使用', 'Use')}</button></div>)}
    {stage && <strong role="status">{stage} <span translate="no">{state.model}</span></strong>}
    {busy && <><progress aria-label={tx('模型下载进度', 'Model download progress')} max="100" value={progress?.total ? Math.min(100, progress.completed / progress.total * 100) : undefined} />
      {progress?.total > 0 && <span>{(progress.completed / 1073741824).toFixed(2)} / {(progress.total / 1073741824).toFixed(2)} GB</span>}
      <button className="button secondary small" onClick={() => api.assistantModelCancel()}>{tx('取消', 'Cancel')}</button></>}
    {(notice || state.error) && <p role="alert">{notice || state.error}</p>}
  </div>;
}
