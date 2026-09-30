import { access } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ModelCatalog, MODEL_CATALOG, recommendModels } from './catalog.mjs';
export {MODEL_CATALOG};
async function findBinary() {
  const candidates = process.platform === 'win32'
    ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe')].filter(Boolean)
    : process.platform === 'darwin' ? ['/Applications/Ollama.app/Contents/Resources/ollama', path.join(homedir(), 'Applications/Ollama.app/Contents/Resources/ollama'), '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama'] : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  for (const file of candidates) { try { await access(file); return file; } catch {} }
  return null;
}
function launch(binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' } });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
export class OllamaModels {
  constructor({ fetcher = fetch, baseURL = 'http://127.0.0.1:11434', find = findBinary, start = launch, onChange = () => {}, onUse = async () => true, getGeneration = () => 0, catalog, runtime, getActive = () => null, beforeRemove = () => {}, onRemove = () => {}, getLanguage = () => 'zh', getSelected = () => null, accelerated = true } = {}) {
    Object.assign(this, { fetcher, baseURL, find, start, onChange, onUse, getGeneration, runtime, getActive, beforeRemove, onRemove, getLanguage, getSelected, accelerated });
    this.catalog = catalog || new ModelCatalog({remote:false});
    this.state = { status: 'idle', running: false, installed: [], error: null, model: null, progress: null };
  }
  snapshot() { return { ...this.state, catalog: this.catalog.value.models, recommendations: recommendModels(this.catalog.value.models,{memoryGB:Math.round(totalmem()/1073741824),language:this.getLanguage(),accelerated:this.accelerated}), catalogSource:this.catalog.source, catalogRevision:this.catalog.value.revision, currentModel:this.getActive(), selectedModel:this.getSelected(), managed:!!this.runtime, runtimeBytes:this.runtime?.asset?.bytes || 0, runtimeInstalled: Boolean(this.binary) || this.state.running, memoryGB: Math.round(totalmem() / 1073741824) }; }
  set(value) { Object.assign(this.state, value); this.onChange(this.snapshot()); return this.snapshot(); }
  async json(route, body, signal, timeout = 5000) {
    const response = await this.fetcher(this.baseURL + route, { method: body ? 'POST' : 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout), headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(String(data.error || `Ollama HTTP ${response.status}`).slice(0, 200));
    if (data.error) throw new Error(String(data.error).slice(0, 200)); return data;
  }
  async tags(signal) {
    const data = await this.json('/api/tags', null, signal);
    return (data.models || []).filter(m => typeof m.name === 'string' && m.name.length <= 160).slice(0, 200).map(m => ({ name: m.name, size: m.size }));
  }
  async refresh(forceCatalog=false) {
    if (this.controller) return this.snapshot();
    this.set({ status: 'checking', error: null });
    await this.catalog.refresh(forceCatalog);
    this.binary = await (this.runtime ? this.runtime.find() : this.find());
    try { return this.set({ status: 'ready', running: true, installed: await this.tags() }); }
    catch { return this.set({ status: this.binary ? 'stopped' : 'missing', running: false, installed: this.runtime ? await this.runtime.installed() : [] }); }
  }
  async ensureRunning(signal) {
    try { const installed = await this.tags(signal); this.set({ running: true, installed }); return; } catch { if (signal.aborted) throw signal.reason; }
    this.set({ running: false });
    if(this.runtime){this.set({status:'preparing-runtime'});this.binary=await this.runtime.ensure(signal,progress=>this.set({progress}));}
    else this.binary = await this.find();
    if (signal.aborted) throw signal.reason;
    if (!this.binary) throw new Error('请先安装一次 Ollama，安装完成后回到这里点击“重新检测”。之后下载模型无需输入命令。');
    this.set({ status: 'starting' }); await (this.runtime ? this.runtime.start(this.binary,this.baseURL) : this.start(this.binary));
    for (let i = 0; i < 20; i++) {
      if (signal.aborted) throw signal.reason;
      try { this.set({ installed: await this.tags(signal), running: true }); return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('本地引擎未能启动，请重试或检查高级连接设置。');
  }
  async ensureAvailable(){
    if(!this.runtime)return;
    if(!await this.runtime.find())throw new Error('请先从推荐列表下载并准备本地模型。');
    const controller=new AbortController();await this.ensureRunning(controller.signal);
  }
  cancel() { this.controller?.abort(new Error('user-cancelled')); }
  async download(model) {
    if (!this.catalog.value.models.some(m => m.id === model)) throw new Error('请选择推荐列表中的模型。');
    return this.prepare(model, true);
  }
  async use(model) { return this.prepare(model, false); }
  async prepare(model, download) {
    if (this.controller) throw new Error('已有模型任务正在进行。');
    const controller = new AbortController(), generation = this.getGeneration(); this.controller = controller;
    this.set({ status: 'connecting', model, error: null, progress: null });
    try {
      await this.ensureRunning(controller.signal);
      const exists = this.state.installed.some(m => m.name === model);
      if (!exists && !download) throw new Error('这个模型尚未安装，请先下载。');
      if (!exists) await this.pull(model, controller);
      if (controller.signal.aborted) throw controller.signal.reason;
      this.set({ status: 'testing', installed: await this.tags(controller.signal) });
      const test = await this.json('/api/generate', { model, prompt: 'Reply only OK.', stream: false, think: false, options: { num_predict: 16, num_ctx: this.catalog.value.models.find(m=>m.id===model)?.contextTokens || 4096 }, keep_alive: '2m' }, controller.signal, 180000);
      if (typeof test.response !== 'string' || !test.response.trim()) throw new Error('模型已下载，但试运行没有返回内容。可以重试使用或选择其他模型。');
      if (controller.signal.aborted) throw controller.signal.reason;
      const active = await this.onUse(model, generation);
      return this.set({ status: active ? 'active' : 'ready', error: active ? null : '模型已就绪，当前设置尚未切换；请点击“使用”以切换模型。' });
    } catch (error) { const cancelled = controller.signal.reason?.message === 'user-cancelled'; return this.set({ status: cancelled ? 'cancelled' : 'error', error: cancelled ? '已取消，可再次点击继续下载。' : String(controller.signal.reason?.message || error.message).slice(0, 250) }); }
    finally { if (this.controller === controller) this.controller = null; }
  }
  async remove(model) {
    if(this.controller)throw new Error('请先等待或取消当前模型任务。');
    if(this.runtime)await this.ensureAvailable();
    if(!this.state.installed.some(m=>m.name===model))throw new Error('这个模型尚未安装。');
    const controller=new AbortController();this.controller=controller;this.set({status:'removing',model,error:null,progress:null});
    try {
      await this.beforeRemove(model);
      await this.json('/api/generate',{model,stream:false,keep_alive:0},controller.signal,30000);
      const response=await this.fetcher(this.baseURL+'/api/delete',{method:'DELETE',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({model}),signal:controller.signal});
      if(!response.ok)throw new Error('模型卸载失败，请重试。');
      const installed=await this.tags(controller.signal);if(installed.some(m=>m.name===model))throw new Error('模型仍在本地，请重新检测后重试。');
      await this.onRemove(model);return this.set({status:'ready',installed,model:null,error:null});
    }catch(e){return this.set({status:'error',error:e.message});}finally{if(this.controller===controller)this.controller=null;}
  }
  close(){this.cancel();this.runtime?.close();}
  async pull(model, controller) {
    this.set({ status: 'downloading' });
    let timeout = setTimeout(() => controller.abort(new Error('连接 Ollama 下载服务超时。')), 20000);
    let response;
    try { response = await this.fetcher(this.baseURL + '/api/pull', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    if (!response.ok || !response.body) throw new Error(`Ollama 下载请求失败（HTTP ${response.status}）。`);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', success = false, last = 0;const layers=new Map();
    const consume = line => {
      if (!line.trim()) return;
      const data = JSON.parse(line); if (data.error) throw new Error(String(data.error));
      if (data.status === 'success') {success = true;for(const layer of layers.values())layer.completed=layer.total;}
      if(Number.isSafeInteger(data.total)&&data.total>0){const key=data.digest||'model';layers.set(key,{total:data.total,completed:Number.isSafeInteger(data.completed)?Math.max(0,Math.min(data.total,data.completed)):0});}
      if (Date.now() - last > 200 || success) { last = Date.now(); this.set({ progress: { kind:'model',status:String(data.status||''),completed:[...layers.values()].reduce((n,l)=>n+l.completed,0),total:[...layers.values()].reduce((n,l)=>n+l.total,0) } }); }
    };
    try {
      while (true) {
        timeout = setTimeout(() => controller.abort(new Error('模型下载长时间没有进度，请重试。')), 90000);
        let part; try { part = await reader.read(); } finally { clearTimeout(timeout); }
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        if (buffer.length > 1048576) throw new Error('Ollama 下载响应无效。');
        const lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(consume);
      }
      consume(buffer + decoder.decode());
      if (!success) throw new Error('模型下载连接提前结束，请重试以继续下载。');
    } finally { await reader.cancel().catch(() => {}); }
  }
}
