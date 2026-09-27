import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_ASSISTANT, normalizeAssistant, validateAction, stripPetGreeting, quickAction, defaultPersonality } from '../core/assistant.mjs';
import { AssistantService } from '../electron/assistant/service.mjs';
const pet = { id: 'pet-123', name: '布丁' };
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'paw-assistant-'));
  const actions = [], calls = [];
  const service = new AssistantService({ directory, safeStorage: { isEncryptionAvailable: () => true, encryptString: x => Buffer.from('encrypted:' + x), decryptString: x => x.toString().slice(10) }, getPet: () => pet, getLanguage: () => 'zh', executeAction: async a => actions.push(a), fetchImpl: async (url, args) => { calls.push({ url, ...args }); return { ok: true, json: async () => ({ choices: [{ message: { content: '喵，你好。' } }] }) }; }, ...options });
  await service.init(); t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { service, directory, actions, calls };
}
test('opt-in settings and transport restrictions', () => {
  assert.equal(DEFAULT_ASSISTANT.enabled, false); assert.equal(DEFAULT_ASSISTANT.provider, "");
  assert.throws(() => normalizeAssistant({ provider: 'custom', model: 'x', baseURL: 'http://example.com/v1' }));
  assert.throws(() => normalizeAssistant({ provider: 'custom', model: 'x', baseURL: 'https://secret@example.com' }));
  assert.equal(normalizeAssistant({ provider: 'ollama', model: 'qwen3', baseURL: 'http://localhost:11434/v1/' }).baseURL, 'http://localhost:11434/v1');
});
test('typed greeting uses current name and preserves full command, including URLs', () => {
  assert.equal(stripPetGreeting('Hi，布丁，帮我打开推特。', '布丁'), '帮我打开推特。');
  assert.equal(stripPetGreeting('hi，布丁，打开 https://x.com/A?b=1', '布丁'), '打开 https://x.com/A?b=1');
  assert.equal(stripPetGreeting('布丁喜欢吃什么', '布丁'), null);
  assert.equal(quickAction('幫我打開推特。').url, 'https://x.com/');
  assert.equal(stripPetGreeting('hi，松露，帮我打开推特', '布丁'), null);
  assert.equal(stripPetGreeting('Hi, Pudding, open Twitter', 'Pudding'), 'open Twitter');
  assert.equal(quickAction('不要打开推特'), null);
  assert.equal(quickAction('帮我打开推特').url, 'https://x.com/');
});
test('tools reject shell, custom protocols and invalid application identifiers', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://x.com', 'https://user:pass@x.com']) assert.throws(() => validateAction('open_website', { url }));
  assert.throws(() => validateAction('exec', { command: 'open -a Terminal' }));
  assert.throws(() => validateAction('open_app', { app: 'Terminal' }));
  assert.equal(validateAction('search_web', { query: '猫 & 咖啡' }).url, 'https://www.google.com/search?q=%E7%8C%AB%20%26%20%E5%92%96%E5%95%A1');
});
test('defaults never connect; fast action succeeds only after enabling and permission', async t => {
  const { service, calls, actions } = await fixture(t);
  await assert.rejects(() => service.run('打开推特'), /未开启/); assert.equal(calls.length, 0);
  await service.configure({ ...DEFAULT_ASSISTANT, enabled: true, provider: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', actionsEnabled: true });
  const result = await service.run('Hi，布丁，帮我打开推特');
  assert.equal(actions.length, 1); assert.match(result.text, /打开/); assert.equal(calls.length, 0);
  await service.configure({ ...service.config, actionsEnabled: false });
  await service.run('打开推特'); assert.equal(actions.length, 1); assert.equal(calls.length, 1);
});
test('credentials are scoped to endpoint, excluded from snapshots; personality survives model changes', async t => {
  const { service, calls, directory } = await fixture(t);
  await service.configure({ enabled: true, provider: 'custom', baseURL: 'https://one.example/v1', model: 'test', apiKey: 'secret-value' });
  await service.profile(pet.id, '独立又傲娇');
  await service.run('你好');
  assert.equal(calls[0].headers.Authorization, 'Bearer secret-value');
  assert.match(JSON.parse(calls[0].body).messages[0].content, /独立又傲娇/);
  assert.doesNotMatch(JSON.stringify(service.snapshot()), /secret-value/);
  assert.doesNotMatch(await readFile(path.join(directory, 'assistant.json'), 'utf8'), /secret-value/);
  await service.configure({ enabled: true, provider: 'custom', baseURL: 'https://two.example/v1', model: 'other' });
  await service.run('你好');
  assert.equal(calls[1].headers.Authorization, undefined); assert.equal(service.snapshot().personality, '独立又傲娇');
  assert.equal(defaultPersonality(pet), defaultPersonality(pet));
});
test('failed execution never reports success, disabled actions reject provider tool calls', async t => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: 'open_app', arguments: '{"app":"calculator"}' } }] } }] }) });
  const { service } = await fixture(t, { fetchImpl, executeAction: async () => { throw new Error('app missing'); } });
  await service.configure({ enabled: true, provider: 'custom', baseURL: 'https://test.example/v1', model: 'test', actionsEnabled: true });
  await assert.rejects(() => service.run('打开计算器'), /app missing/); assert.equal(service.snapshot().lastReply, '');
  await service.configure({ ...service.config, actionsEnabled: false });
  await assert.rejects(() => service.run('打开计算器'), /一次执行/);
});
test('turning off cancels an outstanding model response before side effects', async t => {
  let release;
  const { service, actions } = await fixture(t, { fetchImpl: async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: 'open_app', arguments: '{"app":"calculator"}' } }] } }] }) }); }) });
  await service.configure({ enabled: true, provider: 'custom', baseURL: 'https://test.example/v1', model: 'test', actionsEnabled: true });
  const running = service.run('打开计算器');
  await service.configure({ ...service.config, enabled: false }); release();
  await assert.rejects(() => running, /取消/); assert.equal(actions.length, 0);
});

test('MiMo uses its provider-specific key header', async t => {
  const { service, calls } = await fixture(t);
  await service.configure({ enabled: true, provider: 'mimo', baseURL: 'https://api.xiaomimimo.com/v1', model: 'user-selected-model', apiKey: 'mimo-secret' });
  await service.run('你好');
  assert.equal(calls[0].headers['api-key'], 'mimo-secret');
  assert.equal(calls[0].headers.Authorization, undefined);
});
test('each pet keeps its own character and conversation context', async t => {
  let selected = { id: 'cat-one', name: '布丁' };
  const { service, calls } = await fixture(t, { getPet: () => selected });
  await service.configure({ enabled: true, provider: 'custom', baseURL: 'https://test.example/v1', model: 'test' });
  await service.profile(selected.id, '活泼，好奇'); await service.run('只有布丁知道的故事');
  selected = { id: 'cat-two', name: '松露' };
  await service.profile(selected.id, '安静，独立'); await service.run('你好');
  const second = JSON.parse(calls[1].body).messages;
  assert.match(second[0].content, /安静，独立/);
  assert.doesNotMatch(JSON.stringify(second), /只有布丁知道的故事/);
  selected = { id: 'cat-one', name: '布丁' };
  assert.equal(service.snapshot().personality, '活泼，好奇');
});
test('DeepSeek preset uses a Bearer key and preserves the selected model', async t => {
  const { PROVIDERS } = await import('../core/assistant.mjs');
  const { service, calls } = await fixture(t);
  await service.configure({ ...DEFAULT_ASSISTANT, ...PROVIDERS.deepseek, enabled: true, provider: 'deepseek', apiKey: 'deepseek-test-key' });
  await service.run('你好');
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer deepseek-test-key');
  assert.equal(JSON.parse(calls[0].body).model, 'deepseek-chat');
});
test('legacy built-in migration removes only owned weights and preserves profiles and keys', async t => {
  const { service, directory, calls } = await fixture(t);
  const cache = path.join(directory, 'assistant-models', 'onnx-community');
  for (const model of ['whisper-base', 'Qwen3-0.6B-ONNX', 'user-model']) { await mkdir(path.join(cache, model), { recursive: true }); await writeFile(path.join(cache, model, 'weights'), 'fixture'); }
  await writeFile(path.join(directory, 'assistant.json'), JSON.stringify({ config: { enabled: true, provider: 'builtin', voiceEnabled: true, profiles: { [pet.id]: '傲娇' } }, ready: { chat: true }, secrets: { endpoint: 'encrypted-key' } }));
  await service.init();
  assert.equal(service.config.enabled, false); assert.equal(service.config.provider, '');
  assert.equal(service.config.profiles[pet.id], '傲娇'); assert.equal(calls.length, 0);
  const stored = JSON.parse(await readFile(path.join(directory, 'assistant.json'), 'utf8'));
  assert.equal(stored.secrets.endpoint, 'encrypted-key'); assert.equal('ready' in stored, false); assert.equal('voiceEnabled' in stored.config, false);
  await assert.rejects(() => access(path.join(cache, 'whisper-base')));
  await assert.rejects(() => access(path.join(cache, 'Qwen3-0.6B-ONNX')));
  await access(path.join(cache, 'user-model', 'weights'));
});
test('external provider migration keeps the existing enabled connection', async t => {
  const { service, directory, calls } = await fixture(t);
  await writeFile(path.join(directory, 'assistant.json'), JSON.stringify({ config: { enabled: true, provider: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', model: 'own-model', voiceEnabled: true, autoListen: true, profiles: {} }, ready: { speech: true }, secrets: {} }));
  await service.init();
  assert.equal(service.config.enabled, true); assert.equal(service.config.model, 'own-model');
  assert.equal('voiceEnabled' in service.snapshot(), false); assert.equal(calls.length, 0);
});
test('end conversation cancels pending actions and clears context without disabling the provider', async t => {
  let release;
  const { service, actions } = await fixture(t, { fetchImpl: async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: 'open_app', arguments: '{"app":"calculator"}' } }] } }] }) }); }) });
  await service.configure({ enabled: true, provider: 'custom', baseURL: 'https://example.com/v1', model: 'test', actionsEnabled: true });
  service.histories.set(pet.id, [{ role: 'user', content: 'previous conversation' }]); service.lastReply = 'previous reply';
  const pending = service.run('打开计算器'); service.endConversation(); release();
  await assert.rejects(() => pending, /取消/);
  assert.equal(actions.length, 0); assert.equal(service.histories.has(pet.id), false);
  assert.equal(service.lastReply, ''); assert.equal(service.busy, false); assert.equal(service.config.enabled, true);
});
