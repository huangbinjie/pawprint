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

test('mouse play watches first, approaches a fixed target briefly and cancels on interaction', () => {
 const sim=simulation({area:{x:0,y:0,width:1200,height:800},mouse:{x:700,y:420}});
 sim.relocate({x:320,y:300});sim.step();sim.director.requestBehavior('mouse');
 const start={...sim.position};assert.equal(sim.step().visual.phase,'watch');
 sim.run(200);assert.deepEqual(sim.position,start);
 sim.run(2300);assert.ok(sim.position.x>start.x);assert.ok(sim.position.x-start.x<=260);
 assert.equal(sim.step().visual.phase,'pounce');
 sim.settings.blocked=true;assert.equal(sim.step().visual.mode,'rest');
 const stopped={...sim.position};sim.run(3000);assert.deepEqual(sim.position,stopped);
});
test('mouse play watches without moving when the cursor is outside the current display', () => {
 const sim=simulation({mouse:{x:10000,y:10000}});sim.step();sim.director.requestBehavior('mouse');
 const before={...sim.position};assert.equal(sim.step().visual.phase,'watch');sim.run(3000);assert.deepEqual(sim.position,before);
});
test('manual edge peek reaches a bounded screen edge, hides, reveals and finishes with roaming off', () => {
 const sim=simulation({enabled:false,area:{x:0,y:0,width:700,height:500}});sim.relocate({x:100,y:180});sim.step();sim.director.requestBehavior('peek');
 const phases=new Set();for(let i=0;i<90;i++){const r=sim.step();if(r.visual.phase)phases.add(r.visual.phase);assert.ok(r.position.x>=0&&r.position.x<=480);assert.equal(r.position.y,180);}
 assert.deepEqual([...phases].sort(),['approach','hide','reveal']);assert.equal(sim.step().visual.mode,'rest');
});
test('autonomous surprises honor toy/mouse opt-outs and per-action cooldowns', () => {
 const d=new IdleDirector({random:()=>0});let position={x:300,y:100},seen=[];
 for(let now=0;now<120000;now+=100){const r=d.step({now,position,area:{x:0,y:0,width:1200,height:800},enabled:true,toys:false,mouseEnabled:false,mouse:{x:700,y:220},skill:'box'});position=r.position;if(r.visual.startedAt===now&&r.visual.mode!=='rest')seen.push([r.visual.mode,now]);assert.ok(!['ball','toyroll','mouse'].includes(r.visual.mode));}
 const observations=seen.filter(([id])=>id==='observe');assert.ok(observations.length>=2);assert.ok(observations[1][1]-observations[0][1]>=60000);
});
test('blocking discards pending manual surprises rather than surprising the user after a drag',()=>{
 const sim=simulation({blocked:true});sim.step();sim.director.requestBehavior('toyroll');assert.equal(sim.step().visual.mode,'rest');sim.settings.blocked=false;assert.equal(sim.step().visual.mode,'rest');
});
test('cursor opt-out survives unrelated idle preference edits and rejects malformed settings',()=>{
 const s=transition(initialState(1),{type:'idle-settings',enabled:true,route:'line',toys:true,mouse:false},{now:2});
 const next=transition(s,{type:'idle-settings',enabled:true,route:'edges',toys:false},{now:3});assert.equal(next.settings.idleMouse,false);
 assert.throws(()=>transition(next,{type:'idle-settings',enabled:true,route:'line',toys:true,mouse:'yes'},{now:4}));
});
test('explicit requests wait briefly for the native menu/hover to clear and expire if it does not',()=>{
 const sim=simulation({enabled:false,blocked:true,deferRequests:true});sim.step();sim.director.requestBehavior('toyroll');sim.run(2000);sim.settings.blocked=false;assert.equal(sim.step().visual.mode,'toyroll');
 sim.settings.blocked=true;sim.director.requestBehavior('peek');sim.run(7000);sim.settings.blocked=false;assert.equal(sim.step().visual.mode,'rest');
});
test('a manual mouse request can notice a newly nearby cursor without following it indefinitely',()=>{
 const sim=simulation({enabled:false,area:{x:0,y:0,width:1200,height:800},mouse:{x:10000,y:10000}});sim.relocate({x:320,y:300});sim.step();sim.director.requestBehavior('mouse');sim.run(1200);assert.equal(sim.step().visual.phase,'watch');
 sim.settings.mouse={x:700,y:420};sim.run(3000);assert.equal(sim.step().visual.phase,'pounce');sim.run(9000);assert.equal(sim.step().visual.mode,'rest');
});
test('autonomous shows use only the supplied owned birth talent',()=>{
 const values=[.5,.8,.5];const d=new IdleDirector({random:()=>values.shift()??.8});let p={x:300,y:100},last;
 for(let now=0;now<=8200;now+=100){last=d.step({now,position:p,area:{x:0,y:0,width:1200,height:800},enabled:true,toys:false,mouseEnabled:false,skill:'box',talent:'wave'});p=last.position;}
 assert.equal(last.visual.mode,'talent');assert.equal(last.visual.talentId,'wave');
});
test('approaching mouse play adjusts to cursor movement within its bounded pursuit area',()=>{
 const sim=simulation({enabled:false,area:{x:0,y:0,width:1200,height:800},mouse:{x:700,y:420}});sim.relocate({x:320,y:300});sim.step();sim.director.requestBehavior('mouse');sim.run(500);
 assert.equal(sim.step().visual.phase,'approach');
 sim.settings.mouse={x:650,y:420};sim.run(1500);assert.equal(sim.step().visual.phase,'pounce');assert.ok(sim.position.x<420);assert.ok(sim.position.x>=320);
 const finished={...sim.position};sim.settings.mouse={x:1000,y:600};sim.run(1500);assert.notDeepEqual(sim.position,finished);sim.run(13000);assert.equal(sim.step().visual.mode,'rest');
});
test('cursor chasing never starts passively even with an eligible pointer',()=>{
 const d=new IdleDirector({random:()=>.6});let p={x:320,y:300};
 for(let now=0;now<300000;now+=100){const r=d.step({now,position:p,area:{x:0,y:0,width:1200,height:800},enabled:true,toys:true,mouse:{x:700,y:420},skill:'groom'});p=r.position;assert.notEqual(r.visual.mode,'mouse');}
});
test('manual chasing reaches far and vertically offset cursors and can resume after a paw reach',()=>{
 const sim=simulation({enabled:false,area:{x:0,y:0,width:1500,height:1000},mouse:{x:1400,y:100}});sim.relocate({x:400,y:500});sim.step();sim.director.requestBehavior('mouse');
 assert.equal(sim.director.isManualChase(),true);sim.run(2400);assert.ok(sim.position.x>450);assert.ok(sim.position.y<490);assert.equal(sim.step().visual.manual,true);
 assert.ok(Math.hypot(sim.position.x-400,sim.position.y-500)<=261);
 const first={...sim.position};sim.settings.mouse={x:50,y:850};sim.run(3000);assert.notDeepEqual(sim.position,first);assert.ok(sim.position.x<first.x);assert.ok(sim.position.y>first.y);
 sim.run(13000);assert.equal(sim.director.isManualChase(),false);assert.equal(sim.step().visual.mode,'rest');
});
test('teasing watches the pointer over the pet, then follows for five seconds without a mode toggle',()=>{
 const sim=simulation({enabled:false,area:{x:0,y:0,width:1500,height:1000},mouse:{x:430,y:390}});sim.relocate({x:320,y:300});sim.step();sim.director.teaseMouse();
 const start={...sim.position};sim.run(1000);assert.equal(sim.step().visual.phase,'watch');assert.ok(sim.step().visual.gaze);assert.deepEqual(sim.position,start);
 sim.settings.mouse={x:1200,y:100};sim.run(2000);assert.ok(sim.position.x>start.x);assert.ok(sim.position.y<start.y);
 sim.run(4000);assert.equal(sim.step().visual.mode,'rest');assert.equal(sim.director.isManualChase(),false);
});
