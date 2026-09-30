import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {deflateRawSync} from 'node:zlib';import {encodePetCard,decodePetCard} from '../core/pet-card.mjs';import {seedMatureCompanion} from './fixtures/game.mjs';
test('QR cards preserve genes and tricks while excluding private owner, model and memory data',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'paw-card-'));const state=await seedMatureCompanion(dir);const p=state.pets[0];p.companion={counts:{touch:10,play:3,chat:7,night:0},days:[],lastInteractionAt:123};p.ownerSecret='secret';p.chatHistory=['private-project'];
 const encoded=encodePetCard(p),card=decodePetCard(encoded);assert.ok(encoded.length<2000);assert.deepEqual(card.pet.genome,p.genome);assert.deepEqual(card.pet.skills,p.skills);assert.deepEqual(card.pet.talent,p.talent);assert.equal(card.pet.companion,undefined);assert.equal(card.pet.ownerSecret,undefined);assert.equal(card.pet.chatHistory,undefined);
});
test('malformed, oversized and incompatible QR inputs are rejected before import',()=>{
 for(const value of ['https://evil.test','pawprint-pet1:%%%','pawprint-pet1:'+ 'a'.repeat(2001),'pawprint-pet1:'+deflateRawSync(Buffer.alloc(100000,65)).toString('base64url')])assert.throws(()=>decodePetCard(value));
 assert.throws(()=>decodePetCard('pawprint-pet1:'+deflateRawSync(Buffer.from('{"version":99}')).toString('base64url')),/版本/);
});
