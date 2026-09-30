import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {ModelCatalog,MODEL_CATALOG,recommendModels,validateCatalog} from '../electron/assistant/catalog.mjs';
const payload={schemaVersion:1,revision:'test',models:MODEL_CATALOG};
test('recommendations are exactly three tiers and adapt to memory and language',()=>{
 const zh=recommendModels(MODEL_CATALOG,{memoryGB:32,language:'zh'});assert.deepEqual(zh.map(m=>m.tier),['light','balanced','quality']);assert.equal(zh[1].id,'qwen3.5:9b');
 assert.equal(recommendModels(MODEL_CATALOG,{memoryGB:16,language:'en'})[1].id,'phi4-mini:latest');assert.equal(recommendModels(MODEL_CATALOG,{memoryGB:8,language:'zh'})[1].id,'qwen3.5:2b');assert.equal(recommendModels(MODEL_CATALOG,{memoryGB:8})[2].compatible,false);
});
test('GitHub metadata is cached; offline and malformed updates keep a usable catalog',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paw-catalog-'));let result=new Response(JSON.stringify(payload));const c=new ModelCatalog({directory:dir,fetcher:async()=>result});await c.refresh();assert.equal(c.source,'github');assert.equal(JSON.parse(await readFile(path.join(dir,'model-catalog.json'))).revision,'test');
 result=new Response('{"schemaVersion":99}');await c.refresh(true);assert.equal(c.value.revision,'test');
 const offline=new ModelCatalog({directory:dir,fetcher:async()=>{throw Error('offline');}});await offline.refresh();assert.equal(offline.source,'cache');assert.equal(offline.value.revision,'test');
 assert.throws(()=>validateCatalog({...payload,models:[{...MODEL_CATALOG[0],id:'../../run:command'}]}));
});
