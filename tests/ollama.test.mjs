import test from 'node:test';
import assert from 'node:assert/strict';
import { OllamaModels, MODEL_CATALOG } from '../electron/assistant/ollama.mjs';
const json = data => new Response(JSON.stringify(data));
test('missing runtime is detected without downloading or launching anything', async () => {
  const manager = new OllamaModels({ find: async () => null, fetcher: async () => { throw new Error('ECONNREFUSED'); }, start: () => assert.fail('Unexpected launch') });
  assert.equal((await manager.refresh()).status, 'missing');
  assert.equal((await manager.download('qwen3:8b')).status, 'error');
  assert.match(manager.snapshot().error, /安装一次 Ollama/);
  await assert.rejects(() => manager.download('unlisted-huge-model'), /推荐列表/);
});
test('pull handles split NDJSON, verifies usability, then activates the downloaded model', async () => {
  let downloaded = false, used;
  const stages = [], calls = [];
  const manager = new OllamaModels({ find: async () => null, onChange: s => stages.push(s.status), onUse: async (model, generation) => { used = { model, generation }; return true; }, getGeneration: () => 7,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/api/tags')) return json({ models: downloaded ? [{ name: 'qwen3:8b', size: 100 }] : [] });
      if (url.endsWith('/api/generate')) { assert.equal(JSON.parse(init.body).think, false); return json({ response: 'OK' }); }
      assert.equal(JSON.parse(init.body).model, 'qwen3:8b'); downloaded = true;
      return new Response(new ReadableStream({ start(c) { for (const chunk of ['{"sta', 'tus":"pulling","total":100,"completed":50}\n{"status":"suc', 'cess"}\n']) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } }));
    } });
  assert.equal((await manager.download('qwen3:8b')).status, 'active');
  assert.deepEqual(used, { model: 'qwen3:8b', generation: 7 });
  assert.ok(stages.includes('downloading')); assert.ok(stages.includes('testing'));
  assert.equal(calls.filter(c => c.url.endsWith('/api/pull')).length, 1);
});
test('download errors and incomplete streams never activate a model', async () => {
  for (const stream of ['{"error":"not enough disk space"}\n', '{"status":"pulling"}\n']) {
    const manager = new OllamaModels({ onUse: () => assert.fail('Activated failed model'), fetcher: async url => url.endsWith('/api/tags') ? json({ models: [] }) : new Response(stream) });
    assert.equal((await manager.download(MODEL_CATALOG[0].id)).status, 'error');
  }
});
test('using an installed model skips download and respects a concurrent settings change', async () => {
  const manager = new OllamaModels({ onUse: async () => false, fetcher: async url => {
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'my-model', size: 100 }] });
    assert.ok(url.endsWith('/api/generate')); return json({ response: 'OK' });
  } });
  assert.equal((await manager.use('my-model')).status, 'ready'); assert.match(manager.snapshot().error, /修改了设置/);
});
test('cancel aborts a pull and never changes the configured provider', async () => {
  let started;
  const ready = new Promise(r => started = r);
  const manager = new OllamaModels({ onUse: () => assert.fail('Activated cancelled model'), fetcher: async (url, init) => {
    if (url.endsWith('/api/tags')) return json({ models: [] });
    return new Response(new ReadableStream({ start(c) { init.signal.addEventListener('abort', () => c.error(init.signal.reason)); started(); } }));
  } });
  const pending = manager.download('qwen3:8b'); await ready; manager.cancel();
  assert.equal((await pending).status, 'cancelled');
});
