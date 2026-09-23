import { CATALOG_VERSION, GENE_COUNT } from "../core/genetics.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { LanService } from "../electron/lan/service.mjs";
import { rpc } from "../electron/lan/transport.mjs";
import { Store } from "../core/store.mjs";
import { transition } from "../core/game.mjs";
import { availableCoins, usedSlots } from "../core/economy.mjs";
import { txKey, LAN_PROTOCOL } from "../core/multiplayer.mjs";
import { seedMatureCompanion } from "./fixtures/game.mjs";
async function peer(directory) {
  await seedMatureCompanion(directory);
  const store = new Store(directory);
  await store.load();
  let queue = Promise.resolve();
  const command = (c) => {
    const task = queue.then(async () => {
      const next = transition(store.state, c, {
        now: Date.now(),
        rng: randomInt,
        id: randomUUID,
      });
      await store.save(next);
      return store.state;
    });
    queue = task.catch(() => {});
    return task;
  };
  await command({ type: "visit" });
  const service = new LanService({
    directory,
    getGame: () => store.state,
    command,
    testHost: "127.0.0.1",
    discovery: false,
  });
  await service.init();
  await service.enable();
  return { store, service, command };
}
async function paired(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pawprint-lan-test-"));
  let a, b;
  try {
    a = await peer(path.join(root, "a"));
    b = await peer(path.join(root, "b"));
    await a.service.pair(b.service.inviteCode());
    const pending = b.service.snapshot().pairRequests[0];
    assert.ok(pending);
    await b.service.answerPair(pending.id, true);
    await a.service.poll();
    await b.service.poll();
    assert.equal(a.service.snapshot().peers.length, 1);
    await fn(a, b);
  } finally {
    await a?.service.close();
    await b?.service.close();
    await rm(root, { recursive: true, force: true });
  }
}
test("TLS paired visits require acceptance, expose only pet cards and can be ended", () =>
  paired(async (a, b) => {
    const bid = b.service.auth.id;
    const profile = await a.service.send(bid, "/profile", {});
    assert.ok(!JSON.stringify(profile).includes("balance"));
    assert.ok(!JSON.stringify(profile).includes("usage"));
    assert.ok(!JSON.stringify(profile).includes("codexHome"));
    await a.service.requestVisit(bid, a.store.state.pets[0].id);
    assert.equal(b.service.snapshot().visitors.length, 0);
    const visit = b.service.snapshot().visitRequests[0];
    b.service.answerVisit(visit.id, true);
    assert.equal(b.service.snapshot().visitors.length, 1);
    await a.service.poll();
    assert.equal(a.service.snapshot().outVisits[0].status, "accepted");
    await a.service.returnVisit(visit.id);
    assert.equal(b.service.snapshot().visitors.length, 0);
    assert.equal(a.store.state.pets.length, 1);
    assert.equal(b.store.state.pets.length, 1);
    const fake = { ...b.service.target(), fp: "a".repeat(64) };
    await assert.rejects(() => rpc(fake, "/profile", {}), /身份/);
    await assert.rejects(() => rpc(b.service.target(), "/profile", {}), /配对/);
  }));
test("peer breeding reserves, settles once and retries a lost acknowledgement without duplicate eggs or fees", () =>
  paired(async (a, b) => {
    const aid = a.service.auth.id,
      bid = b.service.auth.id,
      ap = a.store.state.pets[0].id,
      bp = b.store.state.pets[0].id;
    const id = await a.service.requestBreed(bid, ap, bp);
    assert.equal(a.store.state.balance, 240);
    assert.equal(availableCoins(a.store.state), 0);
    assert.equal(usedSlots(a.store.state), 2);
    await assert.rejects(
      () => a.command({ type: "garden", petId: ap }),
      /配种/,
    );
    await assert.rejects(() => a.command({ type: "buy-egg" }));
    await b.service.answerBreed(aid, id, true);
    assert.equal(b.store.state.balance, 300);
    assert.equal(b.store.state.pets[0].breedCount, 1);
    const receipt = structuredClone(
      b.store.state.lanTransactions[txKey(aid, id)].receipt,
    );
    // Repeating accept is idempotent even after reloading the recipient's durable store.
    await b.store.load();
    await b.service.answerBreed(aid, id, true);
    assert.deepEqual(
      b.store.state.lanTransactions[txKey(aid, id)].receipt,
      receipt,
    );
    assert.equal(b.store.state.balance, 300);
    await a.service.reconcile(a.store.state.lanTransactions[id]);
    assert.equal(a.store.state.balance, 0);
    assert.equal(a.store.state.eggs.length, 1);
    assert.equal(a.store.state.pets[0].breedCount, 1);
    await a.command({ type: "_lan-finalize", id, peerId: bid, receipt });
    await a.service.reconcile(a.store.state.lanTransactions[id]);
    assert.equal(a.store.state.balance, 0);
    assert.equal(a.store.state.eggs.length, 1);
    assert.equal(b.store.state.balance, 300);
    assert.equal(a.store.state.balance + b.store.state.balance, 480 - 180);
  }));
test("cancel acknowledgement releases reservations; late requests cannot resurrect cancelled breeding", () =>
  paired(async (a, b) => {
    const aid = a.service.auth.id,
      bid = b.service.auth.id,
      id = await a.service.requestBreed(
        bid,
        a.store.state.pets[0].id,
        b.store.state.pets[0].id,
      ),
      t = structuredClone(a.store.state.lanTransactions[id]);
    await a.service.cancelBreed(id);
    assert.equal(availableCoins(a.store.state), 240);
    assert.equal(a.store.state.balance, 240);
    assert.equal(a.store.state.eggs.length, 0);
    await a.service.send(bid, "/breed/request", {
      id,
      petId: t.bPet.id,
      aPet: t.aPet,
    });
    assert.equal(
      b.store.state.lanTransactions[txKey(aid, id)].status,
      "cancelled",
    );
    await assert.rejects(() => b.service.answerBreed(aid, id, true));
  }));
test("accept wins a cancellation race; offline cancellation never refunds an unconfirmed committed transaction", () =>
  paired(async (a, b) => {
    const aid = a.service.auth.id,
      bid = b.service.auth.id,
      id = await a.service.requestBreed(
        bid,
        a.store.state.pets[0].id,
        b.store.state.pets[0].id,
      );
    await b.service.answerBreed(aid, id, true);
    await b.service.disable();
    await a.service.cancelBreed(id);
    assert.equal(availableCoins(a.store.state), 0);
    assert.equal(a.store.state.lanTransactions[id].status, "cancel-requested");
    await b.service.enable();
    a.service.auth.peers[bid].endpoint = b.service.target();
    await a.service.reconcile(a.store.state.lanTransactions[id]);
    assert.equal(a.store.state.lanTransactions[id].status, "completed");
    assert.equal(a.store.state.balance, 0);
    assert.equal(a.store.state.eggs.length, 1);
    assert.equal(b.store.state.balance, 300);
  }));

test("pairing verifies ownership of the claimed device certificate, not just its public fingerprint", () =>
  paired(async (a, b) => {
    const dest = b.service.target();
    const join = JSON.parse(
      Buffer.from(b.service.inviteCode().slice(10), "base64url").toString(),
    ).join;
    const bad = await rpc(dest, "/pair/request", {
      join,
      endpoint: { ...a.service.target(), fp: "a".repeat(64) },
      name: "冒名小屋",
      returnToken: "a".repeat(43),
      protocol: LAN_PROTOCOL,
      catalog: CATALOG_VERSION,
      geneCount: GENE_COUNT,
    });
    await assert.rejects(() => b.service.answerPair(bad.id, true), /身份/);
    assert.equal(b.service.auth.peers["a".repeat(64)], undefined);
  }));
test("a forged offspring receipt cannot release the requester hold or debit its wallet", () =>
  paired(async (a, b) => {
    const aid = a.service.auth.id,
      bid = b.service.auth.id,
      id = await a.service.requestBreed(
        bid,
        a.store.state.pets[0].id,
        b.store.state.pets[0].id,
      );
    await b.service.answerBreed(aid, id, true);
    const forged = structuredClone(
      b.store.state.lanTransactions[txKey(aid, id)].receipt,
    );
    forged.egg.genome.coat = [27, 27];
    await assert.rejects(
      () =>
        a.command({ type: "_lan-finalize", id, peerId: bid, receipt: forged }),
      /继承/,
    );
    assert.equal(a.store.state.balance, 240);
    assert.equal(availableCoins(a.store.state), 0);
    assert.equal(a.store.state.eggs.length, 0);
    await a.service.reconcile(a.store.state.lanTransactions[id]);
    assert.equal(a.store.state.eggs.length, 1);
  }));
