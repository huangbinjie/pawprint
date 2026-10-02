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

const thread='01a0f1ea-4534-7651-b950-045a233fe631';
const child='01a0f5f7-5a51-7483-9fe6-9e028bc08226';
const meta=(id,extra={})=>JSON.stringify({type:'session_meta',payload:{id,instructions:'PRIVATE instructions',...extra}})+'\n';

test('last reply-ended state and exact chat target survive the transient bubble without exposing paths',()=>{
 const tracker=new ActivityTracker({since:time});tracker.bind('/PRIVATE/path',thread);tracker.consume(event('task_started'),' /ignored',time);
 tracker.consume(event('task_started','linked'),'/PRIVATE/path',time);tracker.consume(event('task_complete','linked'),'/PRIVATE/path',time);
 tracker.consume(event('turn_aborted','a'),' /ignored',time);
 const value=tracker.snapshot(time+9000);assert.equal(value.event,null);assert.equal(value.status,'stopped');assert.ok(!JSON.stringify(value).includes('/PRIVATE'));
 const one=new ActivityTracker({since:time});one.bind('/PRIVATE/path',thread);one.consume(event('task_started'),'/PRIVATE/path',time);one.consume(event('task_complete'),'/PRIVATE/path',time);
 assert.equal(one.snapshot(time+9000).status,'completed');assert.equal(one.snapshot(time+9000).target.threadId,thread);assert.equal(one.snapshot(time+31*60000).target,null);
});
test('progress without an observed start is unknown; a later explicit end does not trigger celebration',()=>{
 const tracker=new ActivityTracker({since:time});tracker.bind('source',thread);tracker.consume(event('token_count'),'source',time);
 assert.equal(tracker.snapshot(time).status,'unknown');assert.equal(tracker.snapshot(time).event,null);
 tracker.consume(event('task_complete'),'source',time);assert.equal(tracker.snapshot(time).status,'completed');assert.equal(tracker.snapshot(time).event,null);
});
test('a file gap clears an old completion and requires new evidence',()=>{
 const tracker=new ActivityTracker({since:time});tracker.bind('source',thread);tracker.consume(event('task_started'),'source',time);tracker.consume(event('task_complete'),'source',time);
 tracker.forget('source',time+1,true);tracker.bind('source',thread);const value=tracker.snapshot(time+1);assert.equal(value.status,'unknown');assert.equal(value.event,null);assert.equal(value.target.threadId,thread);
 tracker.bind('source',child);assert.equal(tracker.snapshot(time+1).target.threadId,child);
});
test('known session mirrors cannot double count the same turn',()=>{
 const tracker=new ActivityTracker({since:time});tracker.bind('one',thread);tracker.bind('mirror',thread);tracker.consume(event('task_started'),'one',time);tracker.consume(event('task_started'),'mirror',time);assert.equal(tracker.snapshot(time).activeCount,1);
 tracker.consume(event('task_complete'),'mirror',time);assert.equal(tracker.snapshot(time).status,'completed');const id=tracker.event.id;tracker.consume(event('task_complete'),'one',time);assert.equal(tracker.event.id,id);
});
test('tailer reads only the leaf identity; ancestor metadata cannot replace the return target',async t=>{
 const {directory,file,watcher}=await fixture(t);await writeFile(file,meta(thread));await watcher.configure({directory,enabled:true});
 await appendFile(file,meta(child)+event('task_started'));await watcher.poll();assert.equal(watcher.snapshot().target.threadId,thread);assert.ok(!JSON.stringify(watcher.snapshot()).includes('PRIVATE'));
});
test('new subagent files exclude inherited lifecycle records by the explicit ordinal',async t=>{
 const {directory,file,watcher}=await fixture(t);await watcher.configure({directory,enabled:true});
 const newFile=path.join(path.dirname(file),'child.jsonl');await writeFile(newFile,meta(child,{subagent_history_start_ordinal:3})+meta(thread)+event('task_started','parent')+event('task_started','child'));
 await watcher.poll();assert.equal(watcher.snapshot().activeCount,1);assert.equal(watcher.snapshot().target.threadId,child);
});

test('invalid identities never produce a link and a fresh start clears the last ended state',()=>{
 const tracker=new ActivityTracker({since:time});tracker.bind('source','new?prompt=bad');tracker.consume(event('task_started'),'source',time);assert.equal(tracker.snapshot(time).target,null);
 tracker.consume(event('task_complete'),'source',time);assert.equal(tracker.snapshot(time).status,'completed');tracker.bind('source',thread);tracker.consume(event('task_started','new',time+1),'source',time+1);assert.equal(tracker.snapshot(time+1).status,'running');assert.equal(tracker.snapshot(time+1).lastOutcome,null);
});

test('topic preference changes preserve the current round and do not reset or replay lifecycle events',async t=>{
 const {directory,file,watcher}=await fixture(t);await writeFile(file,meta(thread));await watcher.configure({directory,enabled:true,topics:false});
 await appendFile(file,event('task_started'));await watcher.poll();const target=watcher.snapshot().target;
 await watcher.configure({directory,enabled:true,topics:true});assert.equal(watcher.snapshot().status,'running');assert.deepEqual(watcher.snapshot().target,target);
 await appendFile(file,event('task_complete'));await watcher.poll();assert.equal(watcher.snapshot().status,'completed');
});

test('one ended reply cannot conceal a different stale unresolved round',()=>{
 const tracker=new ActivityTracker({since:time});tracker.bind('one',thread);tracker.bind('two',child);
 tracker.consume(event('task_started','one'),'one',time);tracker.consume(event('task_started','two'),'two',time);
 tracker.consume(event('token_count','one',time+121000),'one',time+121000);tracker.consume(event('task_complete','one',time+121001),'one',time+121001);
 assert.equal(tracker.snapshot(time+121001).status,'unknown');assert.equal(tracker.snapshot(time+121001).uncertainCount,1);assert.equal(tracker.snapshot(time+121001).activeCount,0);
});
