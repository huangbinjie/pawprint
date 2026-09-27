import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { seedMatureCompanion } from './fixtures/game.mjs';
import { openHome } from './helpers.mjs';
test('assistant is opt-in; provider setup, per-pet character, tool execution and restart work', async ({}, info) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'paw-assistant-ui-'));
  await seedMatureCompanion(profile);
  const requests = [];
  const server = http.createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => { requests.push(JSON.parse(body)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '喵，我是松露。' } }] })); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PAWPRINT_TEST_MODE: '1', PAWPRINT_TEST_DATA: profile, PAWPRINT_TEST_CODEX_HOME: path.join(profile, 'codex'), PAWPRINT_TEST_LAN: '1' };
  let app;
  try {
    app = await electron.launch({ args: ['.'], env });
    let home = await openHome(app, 'settings');
    const panel = home.getByTestId('assistant-settings');
    await expect(panel.getByLabel('开启宠物助手')).not.toBeChecked();
    expect(requests.length).toBe(0);
    await expect(panel.getByRole('button', { name: '下载本地对话模型', exact: true })).toHaveCount(0);
    await expect(panel.getByLabel('启用本地语音唤醒')).toHaveCount(0);
    expect(await home.evaluate(() => Object.keys(window.pawprint).filter(k => /assistant(Voice|Audio|Listen|Prepare)/.test(k)))).toEqual([]);
    await app.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.assistantOpenedURL = url; }; });
    await panel.getByRole('button', { name: 'Ollama', exact: true }).click();
    await expect(panel.locator('.model-card')).toHaveCount(3);
    await panel.getByRole('button', { name: '安装 Ollama（官方）', exact: true }).click();
    await expect.poll(() => app.evaluate(() => globalThis.assistantOpenedURL)).toBe('https://ollama.com/download');

    await panel.getByLabel('开启宠物助手').check();
    await panel.getByRole('button', { name: 'DeepSeek', exact: true }).click();
    await expect(panel.getByLabel('API Base URL')).toHaveValue('https://api.deepseek.com/v1');
    await expect(panel.getByLabel('模型名称', { exact: true })).toHaveValue('deepseek-chat');
    await panel.getByLabel('模型来源').selectOption('custom');
    await panel.getByLabel('API Base URL').fill(`http://127.0.0.1:${server.address().port}/v1`);
    await panel.getByLabel('模型名称', { exact: true }).fill('test-model');
    await panel.getByLabel('允许打开网站、搜索网页和打开指定应用').check();
    await panel.getByRole('button', { name: '保存助手设置', exact: true }).click();
    await expect(panel.getByText('设置已保存。', { exact: true })).toBeVisible();
    await panel.getByLabel('宠物性格').fill('独立又傲娇，回答简短');
    await panel.getByRole('button', { name: '保存这只宠物的性格' }).click();
    await panel.getByLabel('输入指令').fill('你好');
    await panel.getByRole('button', { name: '发送指令' }).click();
    await expect(panel.locator('.assistant-reply')).toHaveText('喵，我是松露。');
    expect(requests[0].messages[0].content).toContain('独立又傲娇');
    await app.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.assistantOpenedURL = url; }; });
    await panel.getByLabel('输入指令').fill('Hi，松露，帮我打开推特');
    await panel.getByRole('button', { name: '发送指令' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.assistantOpenedURL)).toBe('https://x.com/');
    await expect(panel.locator('.assistant-reply')).toContainText('给你打开啦');
    await panel.getByRole('button', { name: '结束聊天', exact: true }).click();
    await expect(panel.locator('.assistant-reply')).toHaveCount(0);
    await expect(panel.getByText('聊天已结束，对话上下文已清空。')).toBeVisible();
    await panel.getByRole('heading', { name: '宠物助手', exact: true }).scrollIntoViewIfNeeded();
    await home.screenshot({ path: info.outputPath('assistant-setup.png') });
    expect((await home.evaluate(() => window.pawprint.getState())).data.assistant.listening).toBeUndefined();
    const save = JSON.parse(await readFile(path.join(profile, 'assistant.json'), 'utf8'));
    expect(save.config.enabled).toBe(true);
    await app.close(); app = await electron.launch({ args: ['.'], env });
    home = await openHome(app, 'settings');
    const restored = home.getByTestId('assistant-settings');
    await expect(restored.getByLabel('宠物性格')).toHaveValue('独立又傲娇，回答简短');
    expect((await home.evaluate(() => window.pawprint.getState())).data.assistant.listening).toBeUndefined();
    await restored.getByRole('button', { name: '立即关闭助手' }).click();
    await expect(restored.getByLabel('开启宠物助手')).not.toBeChecked();
    await home.getByLabel('界面语言').selectOption('en');
    await expect(restored.getByLabel('Enable pet assistant')).not.toBeChecked();
  } finally { await app?.close(); await new Promise(resolve => server.close(resolve)); }
});

test('a catalog download streams progress, tests the model and configures chat without manual fields', async ({}, info) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'paw-model-catalog-')); await seedMatureCompanion(profile);
  let downloaded = false, pulls = 0;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: downloaded ? [{ name: 'qwen3:8b', size: 100 }] : [] }));
      if (req.url === '/api/pull') { pulls++; res.write('{"status":"pulling","total":100,"completed":50}\n'); setTimeout(() => { downloaded = true; res.end('{"status":"success"}\n'); }, 1000); return; }
      if (req.url === '/api/generate') return res.end('{"response":"OK"}');
      if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: '模型连接成功。' } }] }));
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PAWPRINT_TEST_MODE: '1', PAWPRINT_TEST_DATA: profile, PAWPRINT_TEST_LAN: '1', PAWPRINT_TEST_CODEX_HOME: path.join(profile, 'codex'), PAWPRINT_TEST_OLLAMA_URL: base } });
  try {
    const home = await openHome(app, 'settings'), panel = home.getByTestId('assistant-settings');
    await panel.getByRole('button', { name: 'Ollama', exact: true }).click();
    const card = panel.locator('.model-card').filter({ hasText: 'Qwen3 8B' });
    await card.getByRole('button', { name: '下载并使用', exact: true }).click();
    await expect(panel.getByRole('progressbar', { name: '模型下载进度' })).toBeVisible();
    await expect(panel.getByText('模型已就绪，已自动保存连接，可以聊天了。')).toBeVisible();
    const state = (await home.evaluate(() => window.pawprint.getState())).data;
    expect(state.assistant.enabled).toBe(true); expect(state.assistant.model).toBe('qwen3:8b'); expect(state.assistant.baseURL).toBe(base + '/v1');
    await panel.getByLabel('输入指令').fill('你好'); await panel.getByRole('button', { name: '发送指令', exact: true }).click();
    await expect(panel.locator('.assistant-reply')).toHaveText('模型连接成功。');
    await card.getByRole('button', { name: '使用这个模型', exact: true }).click();
    await expect(panel.getByText('模型已就绪，已自动保存连接，可以聊天了。')).toBeVisible(); expect(pulls).toBe(1);
    await panel.getByTestId('local-models').screenshot({ path: info.outputPath('model-catalog.png') });
  } finally { await app.close(); await new Promise(r => server.close(r)); }
});
