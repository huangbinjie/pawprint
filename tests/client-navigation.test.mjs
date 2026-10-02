import test from 'node:test';
import assert from 'node:assert/strict';
import {ClientNavigation} from '../electron/client-navigation.mjs';
const id='01a0f1ea-4534-7651-b950-045a233fe631';
test('one direct conversation link defers macOS activation to the client and coalesces duplicates',async()=>{
 const calls=[];let resolve;const nav=new ClientNavigation({platform:'darwin',openExternal:(...args)=>{calls.push(args);return new Promise(r=>resolve=r);}});
 const a=nav.open(id),b=nav.open(id.toUpperCase());assert.equal(a,b);await Promise.resolve();assert.deepEqual(calls,[[`codex://threads/${id}`,{activate:false}]]);resolve();await a;await assert.rejects(nav.open('https://evil.invalid'),/Invalid conversation/);assert.equal(calls.length,1);
});
test('failed links release the pending request and keep other-platform behavior',async()=>{
 const nav=new ClientNavigation({platform:'win32',openExternal:async(url,options)=>{assert.equal(options,undefined);throw new Error('No client');}});await assert.rejects(nav.open(id),/No client/);assert.equal(nav.pending.size,0);await assert.rejects(nav.open(id),/No client/);
});
