import { access } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
export const MODEL_CATALOG = [
  { id: 'qwen3:4b', name: 'Qwen3 4B', sizeGB: 2.5, memoryGB: 8, tier: 'light' },
  { id: 'qwen3:8b', name: 'Qwen3 8B', sizeGB: 5.2, memoryGB: 16, tier: 'balanced' },
  { id: 'qwen3:14b', name: 'Qwen3 14B', sizeGB: 9.3, memoryGB: 24, tier: 'quality' },
];
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
  constructor({ fetcher = fetch, baseURL = 'http://127.0.0.1:11434', find = findBinary, start = launch, onChange = () => {}, onUse = async () => true, getGeneration = () => 0 } = {}) {
    Object.assign(this, { fetcher, baseURL, find, start, onChange, onUse, getGeneration });
    this.state = { status: 'idle', running: false, installed: [], error: null, model: null, progress: null };
  }
  snapshot() { return { ...this.state, catalog: MODEL_CATALOG, runtimeInstalled: Boolean(this.binary) || this.state.running, memoryGB: Math.round(totalmem() / 1073741824) }; }
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
  async refresh() {
    if (this.controller) return this.snapshot();
    this.set({ status: 'checking', error: null });
    this.binary = await this.find();
    try { return this.set({ status: 'ready', running: true, installed: await this.tags() }); }
    catch { return this.set({ status: this.binary ? 'stopped' : 'missing', running: false, installed: [] }); }
  }
  async ensureRunning(signal) {
    try { const installed = await this.tags(signal); this.set({ running: true, installed }); return; } catch { if (signal.aborted) throw signal.reason; }
    this.set({ running: false }); this.binary = await this.find();
    if (signal.aborted) throw signal.reason;
    if (!this.binary) throw new Error('请先安装一次 Ollama，安装完成后回到这里点击“重新检测”。之后下载模型无需输入命令。');
    this.set({ status: 'starting' }); await this.start(this.binary);
    for (let i = 0; i < 20; i++) {
      if (signal.aborted) throw signal.reason;
      try { this.set({ installed: await this.tags(signal), running: true }); return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Ollama 未能启动，请打开 Ollama 后重试。');
  }
  cancel() { this.controller?.abort(new Error('user-cancelled')); }
  async download(model) {
    if (!MODEL_CATALOG.some(m => m.id === model)) throw new Error('请选择推荐列表中的模型。');
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
      const test = await this.json('/api/generate', { model, prompt: 'Reply only OK.', stream: false, think: false, options: { num_predict: 16 }, keep_alive: '2m' }, controller.signal, 180000);
      if (typeof test.response !== 'string' || !test.response.trim()) throw new Error('模型已下载，但试运行没有返回内容。可以重试使用或选择其他模型。');
      if (controller.signal.aborted) throw controller.signal.reason;
      const active = await this.onUse(model, generation);
      return this.set({ status: active ? 'active' : 'ready', error: active ? null : '模型已就绪。你在下载期间修改了设置，请点击“使用”以切换模型。' });
    } catch (error) { const cancelled = controller.signal.reason?.message === 'user-cancelled'; return this.set({ status: cancelled ? 'cancelled' : 'error', error: cancelled ? '已取消，可再次点击继续下载。' : String(controller.signal.reason?.message || error.message).slice(0, 250) }); }
    finally { if (this.controller === controller) this.controller = null; }
  }
  async pull(model, controller) {
    this.set({ status: 'downloading' });
    let timeout = setTimeout(() => controller.abort(new Error('连接 Ollama 下载服务超时。')), 20000);
    let response;
    try { response = await this.fetcher(this.baseURL + '/api/pull', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    if (!response.ok || !response.body) throw new Error(`Ollama 下载请求失败（HTTP ${response.status}）。`);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', success = false, last = 0;
    const consume = line => {
      if (!line.trim()) return;
      const data = JSON.parse(line); if (data.error) throw new Error(String(data.error));
      if (data.status === 'success') success = true;
      if (Date.now() - last > 200 || success) { last = Date.now(); this.set({ progress: { status: String(data.status || ''), completed: data.completed || 0, total: data.total || 0 } }); }
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
