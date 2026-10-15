import { readFile, writeFile, mkdir, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { parse as parseToml } from 'smol-toml';
function parse(text) { try { return parseToml(text); } catch { throw new Error('Codex 配置 TOML 格式无效，请检查配置文件；未覆盖任何设置。'); } }

export const KEYCHAIN_SERVICE = 'studio.binmax.pawprint.codex-provider';
const execute = promisify(execFile);
const START = '# BEGIN Pawprint Codex Provider';
const END = '# END Pawprint Codex Provider';
const keys = ['model', 'model_provider'];
const q = JSON.stringify;
const fail = message => { throw new Error(message); };
async function optional(file) { try { return await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } }
async function regular(file) { try { const s = await lstat(file); if (!s.isFile() || s.isSymbolicLink()) fail('配置文件必须是普通文件，不能是符号链接。'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function atomic(file, text) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(tmp, text, { mode: 0o600, flag: 'wx' }); await rename(tmp, file); } finally { await rm(tmp, { force: true }); }
}
export function validateProvider(input) {
  const name = String(input?.name || '').trim(), model = String(input?.model || '').trim();
  let url; try { url = new URL(input?.baseUrl); } catch { fail('请输入有效的 Base URL。'); }
  if (!name || name.length > 80 || !model || model.length > 160 || /[\x00-\x1f]/.test(name + model)) fail('请输入名称和模型（不含换行）。');
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) fail('Base URL 需要 HTTPS；本机服务可用 HTTP。不要包含密钥、查询参数或片段。');
  return { name, model, baseUrl: url.href.replace(/\/$/, '') };
}
function split(text) {
  const a = text.indexOf(START), b = text.indexOf(END);
  if ((a < 0) !== (b < 0) || (a >= 0 && (b < a || text.indexOf(START, a + 1) >= 0 || text.indexOf(END, b + 1) >= 0))) fail('Pawprint 配置区块有冲突，请先检查配置文件。');
  if (a < 0) return { body: text, block: '' };
  const end = b + END.length + (text[b + END.length] === '\n' ? 1 : 0);
  return { body: text.slice(0, a) + text.slice(end), block: text.slice(a, end) };
}
function roots(text) {
  const body = split(text).body;
  const end = body.search(/^\s*\[/m), top = end < 0 ? body : body.slice(0, end);
  const found = Object.fromEntries(keys.map(k => [k, top.match(new RegExp('^\\s*' + k + '\\s*=.*(?:\\r?\\n|$)', 'm'))?.[0] || null]));
  const doc = parse(body);
  for (const k of keys) if (Object.hasOwn(doc, k) && !found[k]) fail('模型设置使用了复杂 TOML 写法，请先改为单行 model/model_provider。');
  return found;
}
export function patchConfig(text, provider, baseline, providers = provider ? [provider] : []) {
  const before = parse(text), parts = split(text), old = roots(text);
  let body = parts.body;
  for (const k of keys) if (old[k]) body = body.replace(old[k], '');
  const root = provider ? `model = ${q(provider.model)}\nmodel_provider = ${q(provider.id)}\n` : keys.map(k => baseline[k] || '').join('');
  // Keep provider definitions available for existing chats across live switches.
  const definitions = providers.map(p => `[model_providers.${p.id}]\nname = ${q(p.name)}\nbase_url = ${q(p.baseUrl)}\nwire_api = "responses"\n[model_providers.${p.id}.auth]\ncommand = "/usr/bin/security"\nargs = ["find-generic-password", "-s", ${q(KEYCHAIN_SERVICE)}, "-a", ${q(p.id)}, "-w"]\ntimeout_ms = 30000\nrefresh_interval_ms = 0\n`).join('');
  const block = definitions ? `${START}\n${definitions}${END}\n` : '';
  const result = root + body + (block ? (body.endsWith('\n') ? '' : '\n') + block : '');
  const after = parse(result);
  for (const doc of [before, after]) {
    for (const k of keys) delete doc[k];
    if (doc.model_providers) {
      for (const id of Object.keys(doc.model_providers)) if (/^pawprint_[a-f0-9]{32}$/.test(id) && (parts.block.includes(`[model_providers.${id}]`) || providers.some(p => p.id === id))) delete doc.model_providers[id];
      if (!Object.keys(doc.model_providers).length) delete doc.model_providers;
    }
  }
  if (!isDeepStrictEqual(before, after)) fail('配置格式无法安全局部修改，已取消切换。');
  return result;
}

// The secret travels through stdin, never process arguments or error messages.
export class MacKeychain {
  async set(id, secret) {
    if (!/^pawprint_[a-f0-9]{32}$/.test(id) || typeof secret !== 'string' || !secret.trim() || secret.length > 8192 || /[\x00-\x20\x7f]/.test(secret)) fail('API Key 不能为空或包含空白字符。');
    await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Keychain 操作超时。')); }, 30000);
      child.on('error', () => { clearTimeout(timer); reject(new Error('无法访问 macOS Keychain。')); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Keychain 保存失败，请解锁登录钥匙串后重试。')); });
      child.stdin.on('error', () => {});
      child.stdin.end(`add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${id} -X ${Buffer.from(secret).toString('hex')}\n`);
    });
    // Interactive security can exit successfully after a failed command.
    const saved = await this.get(id);
    if (saved !== secret) fail('Keychain 未确认保存，已取消。');
  }
  async get(id) {
    try { return (await execute('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', id, '-w'], { timeout: 30000 })).stdout.trim(); }
    catch { fail('Keychain 密钥不可读取，请解锁钥匙串或重新添加 Provider。'); }
  }
  async remove(id) { try { await execute('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', id], { timeout: 30000 }); } catch { fail('Keychain 删除失败。'); } }
}
export async function codexRunning() {
  // Advisory status only: switching defaults does not require stopping Codex.
  const { stdout } = await execute('/bin/ps', ['-axo', 'comm='], { timeout: 5000 });
  return stdout.split('\n').some(line => /(?:^|\/)(?:codex|Codex|CodexCLI|Codex Dream Skin)(?:$|\.app\/)/.test(line.trim()));
}
export class CodexAccounts {
  constructor({ directory, dataDirectory, keychain = new MacKeychain(), running = codexRunning, platform = process.platform }) {
    this.directory = directory; this.dataDirectory = dataDirectory; this.keychain = keychain; this.running = running; this.platform = platform;
    this.file = path.join(directory, 'config.toml'); this.stateFile = path.join(dataDirectory, 'codex-accounts.json');
    this.state = { providers: [], providerNames: {} }; this.queue = Promise.resolve();
  }
  serial(fn) { const job = this.queue.then(fn); this.queue = job.catch(() => {}); return job; }
  async load() {
    const raw = await optional(this.stateFile); if (raw) this.state = JSON.parse(raw);
    if (this.state.pending) {
      const text = await optional(this.file), p = this.state.pending;
      if (text === p.after) this.state = p.next;
      else if (text === p.before) delete this.state.pending;
      else fail('上次切换被中断且配置已变化，请检查备份后再操作。');
      await this.save();
    }
  }
  rememberNames() {
    const history=this.state.providerNames;
    this.state.providerNames=history&&typeof history==='object'&&!Array.isArray(history)?history:{};
    for(const p of this.state.providers)this.state.providerNames[p.id]=p.name;
    return this.state.providerNames;
  }
  async save() { this.rememberNames(); await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 }); await atomic(this.stateFile, JSON.stringify(this.state)); }
  supported() { if (this.platform !== 'darwin') fail('Codex Account Manager 当前仅支持 macOS。'); }
  async status() {
    const text = await optional(this.file), doc = parse(text);
    const id = doc.model_provider || 'openai';
    const providerNames={...this.rememberNames()};
    for(const [key,p] of Object.entries(doc.model_providers||{}))if(typeof p?.name==='string'&&!Object.hasOwn(providerNames,key))providerNames[key]=p.name;
    return { supported: this.platform === 'darwin', providerNames, providers: this.state.providers, selected: id, model: doc.model || null, running: this.platform === 'darwin' ? await this.running() : false, configPath: this.file, backupPath: this.state.backupPath || null,
      notice: '默认配置已选择；运行中的会话不会自动切换。请新建会话并确认客户端的 Provider 与模型，客户端界面可能仍保留原选择。' };
  }
  add(input) { return this.serial(async () => {
    this.supported(); await this.status(); const provider = { ...validateProvider(input), id: 'pawprint_' + randomUUID().replaceAll('-', '') };
    await this.keychain.set(provider.id, input.apiKey);
    this.state.providers.push(provider);
    try { await this.save(); } catch (e) { this.state.providers.pop(); await this.keychain.remove(provider.id); throw e; }
    return this.status();
  }); }
  remove(id) { return this.serial(async () => {
    this.supported(); await this.load();
    if (!this.state.providers.some(p => p.id === id)) fail('Provider 不存在。');
    const previousProviders = this.state.providers, selected = (await this.status()).selected;
    const providers = previousProviders.filter(p => p.id !== id);
    if (selected === id || this.state.managed) await this.applySelection(selected === id ? 'openai' : selected, providers);
    else { this.state.providers = providers; await this.save(); }
    try { await this.keychain.remove(id); }
    catch (error) {
      // Keep the entry available for retry when Keychain deletion is refused.
      if (this.state.managed) await this.applySelection(selected, previousProviders);
      else { this.state.providers = previousProviders; await this.save(); }
      throw error;
    }
    return this.status();
  }); }
  switch(id) { return this.serial(async () => {
    this.supported(); await this.load(); return this.applySelection(id, this.state.providers);
  }); }
  async applySelection(id, providers) {
    const provider = id === 'openai' ? null : providers.find(p => p.id === id);
    if (id !== 'openai' && !provider) fail('Provider 不存在。');
    if (provider) await this.keychain.get(id);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, '.pawprint-account-lock');
    try { await mkdir(lock); } catch (e) { if (e.code === 'EEXIST') fail('另一个切换正在进行，或上次切换异常退出。请检查 .pawprint-account-lock。'); throw e; }
    try {
      await regular(this.file); const before = await optional(this.file), doc = parse(before);
      if (doc.profile || doc.forced_login_method === 'api') fail('配置启用了 profile 或强制 API 登录，请先手动处理，避免覆盖原有设置。');
      const current = { roots: roots(before), block: split(before).block };
      if (this.state.managed && !isDeepStrictEqual(current, this.state.managed)) fail('模型或 Pawprint Provider 配置已被外部修改，已取消覆盖。请检查配置与备份。');
      if (!this.state.baseline) {
        if ((doc.model_provider || 'openai') !== 'openai' || current.block) fail('首次使用需要当前选择为 OpenAI/ChatGPT，不能覆盖已有自定义 Provider。');
        this.state.baseline = current.roots;
      }
      const after = patchConfig(before, provider, this.state.baseline, providers);
      if (after === before) { this.state.providers = providers; await this.save(); return this.status(); }
      const backups = path.join(this.directory, 'pawprint-account-backups'); await mkdir(backups, { recursive: true, mode: 0o700 });
      const backupPath = path.join(backups, `${Date.now()}-${randomUUID()}.toml`);
      await writeFile(backupPath, before, { mode: 0o600, flag: 'wx' });
      const next = { ...this.state, providers, backupPath, managed: { roots: roots(after), block: split(after).block } };
      this.state.pending = { before, after, next }; await this.save();
      if (await optional(this.file) !== before) { delete this.state.pending; await this.save(); fail('配置发生变化，已取消切换。'); }
      await atomic(this.file, after); this.state = next; await this.save();
      return this.status();
    } finally { await rm(lock, { recursive: true, force: true }); }
  }
}
