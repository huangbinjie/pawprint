import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCatalog } from "../electron/usage/catalog.mjs";
import { estimateCost } from "../electron/usage/pricing.mjs";
test("catalog persists prices, skips fresh network and retains stale prices after a failed refresh", async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), "pawprint-prices-"));
 try {
 const catalog = {openai: {models: Object.fromEntries(Array.from({length: 11}, (_,i) => [`model-${i}`, {cost:{input:2,output:10,cache_read:0.2}}]))}};
 let calls = 0;
 const fetchImpl = async () => { calls++; return {ok:true, text:async()=>JSON.stringify(catalog)}; };
 const first = await loadCatalog({cacheDirectory:root,now:100,fetchImpl});
 const second = await loadCatalog({cacheDirectory:root,now:200,fetchImpl});
 assert.equal(calls,1);
 assert.equal(first.pricingVersion, second.pricingVersion);
 const offline = await loadCatalog({cacheDirectory:root,now:86400101,fetchImpl:async()=>{throw Error("offline");}});
 assert.equal(offline.pricingStatus.status,"stale");
 assert.deepEqual(offline.catalog,catalog);
 } finally { await rm(root,{recursive:true,force:true}); }
});
test("catalog distinguishes context and fast pricing and does not guess omitted rates",()=>{
 const entry = {cost:{input:2,output:10,cache_read:0.1,tiers:[{tier:{type:"context",size:272000},input:4,output:15,cache_read:0.2}]},experimental:{modes:{fast:{cost:{input:4,output:20,cache_read:0.2}}}}};
 const catalog={openai:{models:{new:entry}}};
 const c={input:1000,cached:500,write:0,output:100};
 assert.equal(estimateCost("new",c,null,catalog),0.00205);
 assert.equal(estimateCost("new",c,"fast",catalog),0.0041);
 assert.equal(estimateCost("new",{...c,input:300000},"fast",catalog),null);
 assert.equal(estimateCost("new",{...c,write:100},null,catalog),null);
});
