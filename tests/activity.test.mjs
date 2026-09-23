import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ActivityTracker, CodexActivity, topicCategory } from "../electron/activity.mjs";
import { initialState, transition } from "../core/game.mjs";

const time = Date.parse("2026-09-20T05:00:00Z");
const event = (type, turn = "a", at = time, extra = {}) => JSON.stringify({
  timestamp: new Date(at).toISOString(), type: "event_msg",
  payload: { type, turn_id: turn, ...extra },
}) + "\n";

test("explicit completion is required; history and duplicate lifecycle events are ignored", () => {
  const tracker = new ActivityTracker({ since: time });
  tracker.consume(event("task_complete"), "one", time);
  tracker.consume(event("task_started", "old", time - 1), "one", time);
  assert.equal(tracker.snapshot(time).event, null);
  tracker.consume(event("task_started"), "one", time);
  assert.equal(tracker.snapshot(time).status, "running");
  assert.equal(tracker.snapshot(time + 121_000).status, "unknown");
  assert.equal(tracker.snapshot(time + 121_000).event, null);
  tracker.consume(event("task_complete", "a", time + 122_000, { last_agent_message: "PRIVATE result" }), "one", time + 122_000);
  assert.equal(tracker.snapshot(time + 122_000).event.kind, "completed");
  const id = tracker.event.id;
  tracker.consume(event("task_started", "a", time + 122_001), "one", time + 122_001);
  tracker.consume(event("task_complete", "a", time + 122_002), "one", time + 122_002);
  assert.equal(tracker.event.id, id);
  assert.equal(tracker.snapshot(time + 122_002).activeCount, 0);
  assert.ok(!JSON.stringify(tracker.snapshot(time + 122_002)).includes("PRIVATE"));
});

test("parallel sessions stay working after one finishes and abort is never completion", () => {
  const tracker = new ActivityTracker({ since: time });
  tracker.consume(event("task_started"), "one", time);
  tracker.consume(event("task_started", "b"), "two", time);
  tracker.consume(event("task_complete"), "one", time);
  assert.equal(tracker.snapshot(time).activeCount, 1);
  assert.equal(tracker.snapshot(time).status, "running");
  tracker.consume(event("turn_aborted", "b"), "two", time);
  assert.equal(tracker.snapshot(time).event.kind, "stopped");
  assert.equal(tracker.snapshot(time).activeCount, 0);
});

test("topics require opt-in and output fixed labels rather than transcript text", () => {
  for (const topics of [false, true]) {
    const tracker = new ActivityTracker({ since: time, topics });
    tracker.consume(event("task_started"), "one", time);
    tracker.consume(event("user_message", "a", time, { message: "帮我修复 SECRET@example.com 的报错" }), "one", time);
    assert.equal(tracker.event.text, topics ? "陪你排查问题" : "开工啦，我陪着你");
    assert.ok(!JSON.stringify(tracker.snapshot(time)).includes("SECRET"));
  }
  assert.equal(topicCategory("hello"), null);
  assert.equal(topicCategory({ text: "修复" }), null);
  const current = new ActivityTracker({ since: time, topics: true });
  current.consume(event("task_started"), "one", time);
  current.consume(event("item_completed", "a", time, {
    item: { type: "UserMessage", content: [{ type: "Text", text: "帮我设计一个新界面" }] },
  }), "one", time);
  assert.equal(current.event.text, "陪你做设计");
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pawprint-activity-"));
  const folder = path.join(directory, "sessions/2026/09/20");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, "session.jsonl");
  await writeFile(file, event("task_started", "history", time - 1000));
  let now = time;
  const changes = [];
  const watcher = new CodexActivity({ onChange: value => changes.push(value), now: () => now });
  t.after(async () => { await watcher.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, file, watcher, changes, advance: n => now += n };
}

test("tailer baselines history, handles split JSON/UTF8 and skips huge tool output", async t => {
  const { directory, file, watcher } = await fixture(t);
  await watcher.configure({ directory, enabled: true, topics: true });
  assert.equal(watcher.snapshot().status, "idle");
  const started = event("task_started");
  await appendFile(file, started.slice(0, 30)); await watcher.poll();
  assert.equal(watcher.snapshot().event, null);
  await appendFile(file, started.slice(30)); await watcher.poll();
  assert.equal(watcher.snapshot().status, "running");
  const message = Buffer.from(event("user_message", "a", time, { message: "设计界面 SECRET" }));
  const split = message.indexOf(Buffer.from("设计")) + 1;
  await appendFile(file, message.subarray(0, split)); await watcher.poll();
  await appendFile(file, message.subarray(split)); await watcher.poll();
  assert.equal(watcher.snapshot().event.text, "陪你做设计");
  await appendFile(file, JSON.stringify({ type: "response_item", payload: "x".repeat(300_000) }) + "\n" + event("task_complete"));
  await watcher.poll(); await watcher.poll();
  assert.equal(watcher.snapshot().event.kind, "completed");
  assert.ok(!JSON.stringify(watcher.snapshot()).includes("SECRET"));
});

test("disable clears feedback; re-enable and log truncation never replay a completion", async t => {
  const { directory, file, watcher } = await fixture(t);
  await watcher.configure({ directory, enabled: true });
  await appendFile(file, event("task_started")); await watcher.poll();
  await watcher.configure({ directory, enabled: false });
  assert.equal(watcher.snapshot().status, "off");
  await appendFile(file, event("task_complete"));
  await watcher.configure({ directory, enabled: true });
  assert.equal(watcher.snapshot().event, null);
  await writeFile(file, event("task_started", "x") + event("task_complete", "x"));
  await watcher.poll();
  assert.equal(watcher.snapshot().event, null);
});

test("resumed older dated sessions are discovered and missing directories report unavailable", async t => {
  const { directory, watcher } = await fixture(t);
  const oldFolder = path.join(directory, "sessions/2026/08/01");
  await mkdir(oldFolder, { recursive: true });
  const file = path.join(oldFolder, "old.jsonl");
  await writeFile(file, event("task_started", "old", time - 1000));
  await watcher.configure({ directory, enabled: true });
  await appendFile(file, event("task_started", "new")); await watcher.poll();
  assert.equal(watcher.snapshot().status, "running");
  await watcher.configure({ directory: path.join(directory, "missing"), enabled: true });
  assert.equal(watcher.snapshot().status, "unavailable");
  assert.equal(watcher.snapshot().event, null);
});

test("activity preferences change no economic state", () => {
  const before = initialState(time);
  const after = transition(before, { type: "activity", enabled: true, topics: false }, { now: time });
  assert.deepEqual(after, { ...before, settings: { ...before.settings, activityEnabled: true, activityTopics: false } });
  assert.throws(() => transition(before, { type: "activity", enabled: "true" }, { now: time }));
});
