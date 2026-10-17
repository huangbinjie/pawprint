import test from "node:test";
import assert from "node:assert/strict";
import {
  TRAITS,
  GENE_KEYS,
  GENE_COUNT,
  LEGACY_KEYS,
  randomGenome,
  starterGenome,
  STARTER_RULES,
  phenotype,
  geneOdds,
  rarityFor,
  migrateGenetics,
  withDefaults,
} from "../core/genetics.mjs";
import { initialState, transition } from "../core/game.mjs";

test('new first companions match the approved legacy cream tabby look across random draws',()=>{
 const reference=withDefaults({coat:[3,0],pattern:[1,3],eyes:[0,2],eyeSize:[1,2],ears:[2,1],tail:[1,2],white:[1,1]});
 const hidden=new Set();
 for(let seed=1;seed<=32;seed++){
  let random=seed,sequence=0;const rng=max=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random%max;};
  const options={now:1000,rng,id:()=>`starter-${seed}-${++sequence}`};
  let s=transition(initialState(1000),{type:'free-egg'},options);assert.equal(s.eggs[0].birthRules,STARTER_RULES);
  assert.deepEqual(phenotype(s.eggs[0].genome),phenotype(reference));hidden.add(JSON.stringify(GENE_KEYS.map(k=>s.eggs[0].genome[k][1])));
  s=transition(s,{type:'hatch',eggId:s.eggs[0].id},options);assert.deepEqual(phenotype(s.pets[0].genome),phenotype(reference));
 }
 assert.ok(hidden.size>1);
});
test('starter appearances do not share mutable DNA or replace discovery eggs or existing eggs',()=>{
 const a=starterGenome(()=>0),b=starterGenome(()=>0);a.pattern[0]=7;assert.equal(phenotype(b).pattern,1);
 let sequence=0;const options={now:1000,rng:()=>0,id:()=>`egg-${++sequence}`};
 let state=transition(initialState(1000),{type:'free-egg'},options);state.balance=1000;
 state=transition(state,{type:'buy-egg'},options);assert.deepEqual(state.eggs[1].genome,randomGenome(()=>0));assert.notDeepEqual(phenotype(state.eggs[1].genome),phenotype(state.eggs[0].genome));
 state.eggs[0].genome=randomGenome(()=>0);state.eggs[0].birthRules='founder-v4';const previous=structuredClone(state.eggs[0].genome);
 const hatched=transition(state,{type:'hatch',eggId:state.eggs[0].id},options);assert.deepEqual(hatched.pets[0].genome,previous);assert.deepEqual(state.eggs[0].genome,previous);
});

test("every birth probability matches exhaustive weighted allele pairs and sums to 100%", () => {
  assert.equal(GENE_KEYS.length, 16);
  assert.equal(GENE_COUNT, 173);
  for (const key of GENE_KEYS) {
    const values = TRAITS[key],
      total = values.reduce((s, g) => s + g.weight, 0);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      let visible = 0,
        carried = 0;
      values.forEach((a, ai) =>
        values.forEach((b, bi) => {
          const chance = ((a.weight * b.weight) / total ** 2) * 100;
          if (ai === i) visible += chance / 2;
          if (bi === i) visible += chance / 2;
          if (ai === i || bi === i) carried += chance;
        }),
      );
      const odds = geneOdds(key, i);
      assert.ok(Math.abs(visible - odds.visible) < 1e-10);
      assert.ok(Math.abs(carried - odds.carried) < 1e-10);
      assert.ok(odds.carried >= odds.visible - 1e-10);
      assert.equal(odds.rarity.id, rarityFor(visible).id);
      sum += odds.visible;
    }
    assert.ok(Math.abs(sum - 100) < 1e-9);
  }
});
test("random founder sampling honors the configured weights, including rare final alleles", () => {
  for (let locus = 0; locus < GENE_KEYS.length; locus++) {
    const key = GENE_KEYS[locus],
      weights = TRAITS[key].map((g) => g.weight),
      counts = weights.map(() => 0),
      total = weights.reduce((a, b) => a + b, 0);
    for (let draw = 0; draw < total; draw++) {
      let call = 0;
      const genome = randomGenome(() => (call++ === locus * 2 ? draw : 0));
      counts[genome[key][0]]++;
    }
    assert.deepEqual(counts, weights);
  }
});
test("rarity is frequency-based; a solid coat can be legendary without complex markings", () => {
  const last = TRAITS.coat.length - 1;
  assert.equal(geneOdds("coat", last).rarity.id, "legendary");
  const genome = withDefaults(
    Object.fromEntries(LEGACY_KEYS.map((k) => [k, [0, 0]])),
  );
  genome.coat = [last, last];
  genome.white = [2, 2];
  assert.equal(phenotype(genome).pattern, 0);
  assert.equal(phenotype(genome).white, 2);
  assert.equal(phenotype(genome).coat, last);
  assert.equal(rarityFor(15).id, "common");
  assert.equal(rarityFor(5).id, "uncommon");
  assert.equal(rarityFor(1).id, "rare");
  assert.equal(rarityFor(0.1).id, "epic");
  assert.equal(rarityFor(0.099).id, "legendary");
});
test("legacy pets, unhatched eggs and ancestors keep their existing alleles on upgrade", () => {
  const old = initialState(1000);
  delete old.geneticsVersion;
  const genome = Object.fromEntries(LEGACY_KEYS.map((k) => [k, [0, 1]]));
  old.pets = [
    {
      id: "p",
      genome: structuredClone(genome),
      parents: [{ id: "parent", genome: structuredClone(genome) }],
    },
  ];
  old.eggs = [{ id: "e", genome: structuredClone(genome), parents: [] }];
  const updated = migrateGenetics(old);
  for (const entity of [
    updated.pets[0],
    updated.pets[0].parents[0],
    updated.eggs[0],
  ]) {
    for (const key of LEGACY_KEYS)
      assert.deepEqual(entity.genome[key], genome[key]);
    for (const key of GENE_KEYS.filter((k) => !LEGACY_KEYS.includes(k)))
      assert.deepEqual(entity.genome[key], [0, 0]);
  }
  assert.equal(updated.balance, old.balance);
  assert.deepEqual(updated.ledger, old.ledger);
  assert.equal(migrateGenetics(updated), updated);
  assert.equal(old.pets[0].genome.body, undefined);
});
test("rename and hatch never reroll birth genes and gene-edit commands are rejected", () => {
  let n = 0;
  const opts = { now: 1000, rng: () => 0, id: () => String(++n) };
  let s = transition(initialState(1000), { type: "free-egg" }, opts);
  const dna = structuredClone(s.eggs[0].genome),
    id = s.eggs[0].id;
  s = transition(s, { type: "hatch", eggId: id }, opts);
  s = transition(s, { type: "rename", petId: id, name: "普通小猫" }, opts);
  assert.deepEqual(s.pets[0].genome, dna);
  assert.throws(() =>
    transition(s, { type: "edit-genome", petId: id, genome: {} }, opts),
  );
});
