import test from "node:test";
import assert from "node:assert/strict";
import { IdleDirector, walkingBounds } from "../core/idle.mjs";
import { initialState, transition } from "../core/game.mjs";

const area = { x: -1440, y: 25, width: 1440, height: 875 };
function simulation(options = {}) {
  const director = new IdleDirector({ random: () => 0.8 });
  let now = 0, position = { x: -1200, y: 300 }, last;
  const settings = { area, enabled: true, route: "line", toys: true, blocked: false, ...options };
  return {
    director, settings,
    get position() { return position; },
    relocate(value) { position = value; },
    step(ms = 100) { now += ms; last = director.step({ now, position, ...settings }); position = last.position; return last; },
    run(ms) { for (let i = 0; i < ms / 100; i++) this.step(); return last; },
  };
}
test("horizontal roaming stays at the current height and inside a negative-coordinate screen", () => {
  const sim = simulation();
  const start = { ...sim.position };
  sim.run(12_000);
  assert.notEqual(sim.position.x, start.x);
  assert.equal(sim.position.y, start.y);
  const b = walkingBounds(area);
  for (let i = 0; i < 20_000; i++) {
    sim.step();
    assert.ok(sim.position.x >= b.left && sim.position.x <= b.right);
    assert.equal(sim.position.y, start.y);
  }
});
test("edge patrol traverses all four sides without leaving the display", () => {
  const sim = simulation({ route: "edges", area: { x: 0, y: 0, width: 500, height: 500 } });
  sim.relocate({ x: 280, y: 150 });
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const result = sim.step();
    if (result.visual.mode === "walk") seen.add(result.visual.edge);
    assert.ok(sim.position.x >= 0 && sim.position.x <= 280);
    assert.ok(sim.position.y >= 0 && sim.position.y <= 258);
  }
  assert.deepEqual([...seen].sort(), ["bottom", "left", "right", "top"]);
});
test("hover/work/performance blocking pauses immediately, and sleep never produces a jump", () => {
  const sim = simulation();
  sim.run(12_000);
  const before = { ...sim.position };
  sim.settings.blocked = true;
  assert.equal(sim.run(2000).visual.mode, "rest");
  assert.deepEqual(sim.position, before);
  sim.settings.blocked = false;
  assert.equal(sim.step(3600_000).visual.mode, "rest");
  assert.deepEqual(sim.position, before);
  sim.run(12_000);
  assert.notDeepEqual(sim.position, before);
});
test("drag relocates the route, and removed/small screens clamp the position safely", () => {
  const sim = simulation();
  sim.run(12_000);
  sim.relocate({ x: -900, y: 100 });
  assert.equal(sim.step().visual.mode, "rest");
  assert.equal(sim.run(12_000).position.y, 100);
  sim.settings.area = { x: 10, y: 20, width: 150, height: 180 };
  sim.settings.route = "edges";
  assert.deepEqual(sim.run(12_000).position, { x: 10, y: 20 });
});
test("manual ball works with roaming off, finishes, and blocking prevents autonomous play", () => {
  const sim = simulation({ enabled: false });
  assert.equal(sim.run(30_000).visual.mode, "rest");
  sim.director.playBall();
  assert.equal(sim.step().visual.mode, "ball");
  const start = { ...sim.position };
  assert.equal(sim.run(8100).visual.mode, "rest");
  assert.deepEqual(sim.position, start);
  sim.settings.enabled = true;
  sim.settings.blocked = true;
  assert.equal(sim.run(60_000).visual.mode, "rest");
});
test("movement preview runs, jumps and lands without changing the baseline or leaving the display", () => {
  const sim = simulation({ enabled: false });
  sim.step(); sim.director.previewMotion();
  const gaits = new Set();
  const startY = sim.position.y;
  for (let i = 0; i < 80; i++) {
    const r = sim.step(); if (r.visual.mode === "walk") gaits.add(r.visual.gait);
    assert.equal(r.position.y, startY);
    assert.ok(r.position.x >= -1440 && r.position.x <= -220);
  }
  assert.ok(gaits.has("run")); assert.ok(gaits.has("jump"));
  assert.equal(sim.step().visual.mode, "rest");
});
test("changing idle settings preserves assets, rejects unknown routes and supports disabling", () => {
  const before = initialState(1);
  const after = transition(before, { type: "idle-settings", enabled: true, route: "edges", toys: false }, { now: 2 });
  assert.deepEqual({ ...after, settings: before.settings }, before);
  assert.equal(after.settings.idleRoute, "edges");
  assert.throws(() => transition(before, { type: "idle-settings", enabled: true, route: "anywhere", toys: false }, { now: 2 }));
  const sim = simulation(); sim.run(12_000);
  sim.settings.enabled = false;
  assert.equal(sim.step().visual.mode, "rest");
  const stopped = { ...sim.position }; sim.run(30_000);
  assert.deepEqual(sim.position, stopped);
});
