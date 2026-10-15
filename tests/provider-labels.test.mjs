import test from 'node:test';import assert from 'node:assert/strict';import {providerLabel} from '../core/provider-labels.mjs';
test('usage labels use saved names, retain named vendors and hide opaque manager IDs',()=>{
 const id='pawprint_'+'a'.repeat(32);
 assert.equal(providerLabel(id,{[id]:'My API'}),'My API');assert.equal(providerLabel('openai'),'ChatGPT / OpenAI');
 assert.equal(providerLabel(id,{},'Custom provider'),'Custom provider · aaaaaa');assert.equal(providerLabel('mimo'),'mimo');
 assert.equal(providerLabel(id,{[id]:'   '}),'自定义 Provider · aaaaaa');
});
