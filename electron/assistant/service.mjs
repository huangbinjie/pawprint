import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ASSISTANT, normalizeAssistant, petPrompt, defaultPersonality, ASSISTANT_TOOLS, validateAction, quickAction, stripPetGreeting } from '../../core/assistant.mjs';

export class AssistantService {
  constructor({ directory, safeStorage, getPet, getLanguage, executeAction, onChange = () => {}, fetchImpl = fetch }) {
    Object.assign(this, { directory, safeStorage, getPet, getLanguage, executeAction, onChange, fetchImpl });
    this.config = structuredClone(DEFAULT_ASSISTANT); this.secrets = {}; this.histories = new Map();
    this.generation = 0; this.status = 'off'; this.error = null;
    this.saveQueue = Promise.resolve();
  }
  async init() {
    try {
      const data = JSON.parse(await readFile(path.join(this.directory, 'assistant.json'), 'utf8'));
      const legacy = data.config?.provider === 'builtin' || 'voiceEnabled' in (data.config || {}) || 'ready' in data;
      this.config = data.config?.provider === 'builtin'
        ? { ...structuredClone(DEFAULT_ASSISTANT), profiles: data.config.profiles || {} }
        : { ...normalizeAssistant(data.config), profiles: data.config.profiles || {} };
      this.secrets = data.secrets || {};
      if (legacy) {
        await this.persist();
        // Only app-managed, reproducible old weights; external model stores are untouched.
        for (const model of ['whisper-base', 'Qwen3-0.6B-ONNX']) await rm(path.join(this.directory, 'assistant-models', 'onnx-community', model), { recursive: true, force: true });
        this.migrationNotice = '旧版内置模型与语音监听已移除。请选择自己的模型服务。';
      }
    } catch (error) { if (error.code !== 'ENOENT') this.error = '助手设置或旧模型清理失败，请检查本地存储。'; }
    this.status = this.config.enabled ? 'idle' : 'off';
  }
  keyId(config = this.config) { return `${config.provider}:${config.baseURL}`; }
  snapshot() { const pet = this.getPet(); return { ...this.config, hasKey: Boolean(this.secrets[this.keyId()]), status: this.status,
    error: this.error, migrationNotice: this.migrationNotice, lastReply: this.lastReply || '', petId: pet?.id, petName: pet?.name,
    personality: pet ? this.config.profiles[pet.id] || defaultPersonality(pet) : '' }; }
  changed() { this.onChange(this.snapshot()); }
  async persist() {
    const body = JSON.stringify({ config: this.config, secrets: this.secrets });
    const file = path.join(this.directory, 'assistant.json');
    const task = this.saveQueue.then(async () => { await mkdir(this.directory, { recursive: true }); await writeFile(file + '.tmp', body, { mode: 0o600 }); await rename(file + '.tmp', file); });
    this.saveQueue = task.catch(() => {}); return task;
  }
  async configure(input) {
    const config = normalizeAssistant(input);
    const secrets = { ...this.secrets };
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      if (input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) throw new Error('API key 无效。');
      if (!this.safeStorage.isEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('系统安全存储不可用，无法保存 API key。');
      secrets[this.keyId(config)] = this.safeStorage.encryptString(input.apiKey.trim()).toString('base64');
    }
    if (input.clearKey === true) delete secrets[this.keyId(config)];
    this.cancel(); this.config = { ...config, profiles: this.config.profiles }; this.secrets = secrets;
    this.status = config.enabled ? 'idle' : 'off'; this.error = null; this.migrationNotice = null;
    await this.persist(); this.changed(); return this.snapshot();
  }
  async profile(petId, value) {
    const pet = this.getPet();
    if (!pet || pet.id !== petId || typeof value !== 'string' || value.length > 2000) throw new Error('宠物或性格资料无效。');
    this.cancel(); this.config.profiles[pet.id] = value.trim(); this.histories.delete(pet.id); await this.persist(); this.changed(); return this.snapshot();
  }
  cancel() {
    this.generation++; this.abort?.abort(); this.abort = null; this.busy = false;
    this.status = this.config.enabled ? 'idle' : 'off'; this.changed();
  }
  endConversation() {
    this.cancel(); this.histories.delete(this.getPet()?.id); this.lastReply = ''; this.error = null; this.changed(); return this.snapshot();
  }
  async request(messages, { tools = true } = {}) {
    const c = this.config;
    const stored = this.secrets[this.keyId()];
    const key = stored ? this.safeStorage.decryptString(Buffer.from(stored, 'base64')) : '';
    if (['openai', 'mimo', 'deepseek'].includes(c.provider) && !key) throw new Error('请保存这个供应商的 API key。');
    const controller = new AbortController(); this.abort = controller;
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const nativeOllama=c.provider==='ollama';
      const response = await this.fetchImpl(nativeOllama ? c.baseURL.replace(/\/v1$/, '')+'/api/chat' : c.baseURL + '/chat/completions', { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(key ? (c.provider === 'mimo' ? { 'api-key': key } : { Authorization: `Bearer ${key}` }) : {}) },
        body: JSON.stringify({ model: c.model, messages, stream: false, ...(nativeOllama?{think:false,options:{num_ctx:4096},keep_alive:'2m'}:{}), ...(tools ? { tools: ASSISTANT_TOOLS, tool_choice: 'auto' } : {}) }) });
      if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}，请核对地址、模型名称、额度及工具调用支持。`);
      const data = await response.json(), message = data.choices?.[0]?.message || (nativeOllama?data.message:null);
      if (!message) throw new Error('接口不兼容 Chat Completions。');
      if (message.tool_calls?.length) {
        if (!tools || message.tool_calls.length !== 1) throw new Error('请一次执行一个操作。');
        const call = message.tool_calls[0];
        let args; try { args = typeof call.function.arguments==='string'?JSON.parse(call.function.arguments):call.function.arguments; } catch { throw new Error('模型返回了无效工具参数。'); }
        return { action: validateAction(call.function.name, args) };
      }
      if (typeof message.content !== 'string' || !message.content.trim()) throw new Error('模型没有返回回答。');
      return { text: message.content.slice(0, 6000) };
    } catch (error) { if (controller.signal.aborted) throw new Error('请求已取消或超时。'); throw error; }
    finally { clearTimeout(timer); if (this.abort === controller) this.abort = null; }
  }
  async probe() {
    if (!this.config.enabled || this.busy) throw new Error('请先开启助手，或等待当前任务完成。');
    this.busy = true; const generation = this.generation;
    try { await this.request([{ role: 'user', content: 'Reply with OK. Do not call any tools.' }]); return '连接成功；工具调用格式仍需用实际指令验证。'; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async run(text) {
    if (!this.config.enabled) throw new Error('宠物助手尚未开启。');
    const pet = this.getPet(); if (!pet) throw new Error('请先选择一只宠物。');
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('请输入 1–2000 字的指令。');
    if (this.busy) throw new Error('宠物还在处理上一件事，请稍候。');
    const generation = this.generation; this.busy = true; this.status = 'thinking'; this.error = null; this.changed();
    try {
      const command = stripPetGreeting(text, pet.name) ?? text;
      const history = [...(this.histories.get(pet.id) || [])];
      while (history.length && history.reduce((n, m) => n + m.content.length, 0) > (this.config.provider==='ollama'?4000:8000)) history.splice(0, 2);
      const messages = [{ role: 'system', content: petPrompt(pet, this.config.profiles[pet.id], this.getLanguage()) }, ...history, { role: 'user', content: command || '和我打个招呼。' }];
      const shortcut = this.config.actionsEnabled && quickAction(command);
      const result = shortcut ? { action: shortcut } : await this.request(messages, { tools: this.config.actionsEnabled });
      if (generation !== this.generation || this.getPet()?.id !== pet.id || !this.config.enabled) throw new Error('会话已改变，操作已取消。');
      let reply = result.text;
      if (result.action) {
        if (!this.config.actionsEnabled) throw new Error('请先允许打开网站和应用。');
        await this.executeAction(result.action);
        reply = this.getLanguage() === 'en' ? 'Opened it for you, meow.' : '给你打开啦，喵。';
      }
      if (generation !== this.generation) throw new Error('会话已结束。');
      this.lastReply = reply; this.histories.set(pet.id, [...history, { role: 'user', content: command }, { role: 'assistant', content: reply }].slice(-12));
      return { text: reply, action: result.action || null };
    } catch (error) { if (generation === this.generation) this.error = error.message; throw error; }
    finally { if (generation === this.generation) { this.busy = false; this.status = this.config.enabled ? 'idle' : 'off'; this.changed(); } }
  }
  async close() { this.cancel(); this.histories.clear(); await this.saveQueue; }
}
