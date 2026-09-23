import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../core/store.mjs";
test("atomic store persists across restarts and retains previous backup", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-store-"));
  try {
    const store = new Store(dir);
    const initial = await store.load(1000);
    const next = structuredClone(initial);
    next.freeEggClaimed = true;
    await store.save(next);
    assert.deepEqual(await new Store(dir).load(), next);
    assert.deepEqual(
      JSON.parse(await readFile(`${store.file}.bak`, "utf8")),
      initial,
    );
    assert.equal((await stat(store.file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("corrupt or unsupported saves are preserved and never silently reset", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-bad-save-"));
  try {
    const file = path.join(dir, "save-v1.json");
    await writeFile(file, "broken");
    await assert.rejects(() => new Store(dir).load(), /存档损坏/);
    assert.equal(await readFile(file, "utf8"), "broken");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
