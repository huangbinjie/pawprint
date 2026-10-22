import test from 'node:test';
import assert from 'node:assert/strict';
import {changingSegments, sampleMotion, createCatMotionClock} from '../src/cat-motion.js';

const frames = [
  {computedOffset: 0, transform: 'scaleY(1)'},
  {computedOffset: .4, transform: 'scaleY(1)'},
  {computedOffset: .43, transform: 'scaleY(.05)'},
  {computedOffset: .46, transform: 'scaleY(1)'},
  {computedOffset: 1, transform: 'scaleY(1)'},
];

function fixture(name = 'breathe', keyframes = [frames[0], {...frames[2], computedOffset: 1}]) {
  let now = 0, nextId = 0;
  const timers = new Map();
  const media = new EventTarget();
  const intersections = [];
  const mutations = [];
  const doc = new EventTarget();
  doc.hidden = false;
  doc.defaultView = {
    performance: {now: () => now}, matchMedia: () => media,
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, {fn, at: now + delay}); return id; },
    clearTimeout: id => timers.delete(id),
    IntersectionObserver: class {
      constructor(callback) { intersections.push(callback); }
      observe() {} unobserve() {} disconnect() {}
    },
    MutationObserver: class {
      constructor(callback) { mutations.push(callback); }
      observe() {} disconnect() {}
    },
  };
  function animation(animationName = name, iterations = Infinity) {
    let time = 0;
    return {
      animationName, playState: 'running', playbackRate: 1, writes: 0,
      get currentTime() { return time; },
      set currentTime(value) { time = Math.round(value * 1000) / 1000; this.writes++; },
      pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; },
      effect: {
        getTiming: () => ({duration: 10000, delay: 0, iterations, direction: 'normal', iterationStart: 0}),
        getKeyframes: () => keyframes,
      },
    };
  }
  const baseline = animation();
  const root = new EventTarget();
  root.isConnected = true;
  root.animations = [baseline];
  root.getAnimations = () => root.animations;
  function advance(ms) {
    const until = now + ms;
    for (let count = 0; count < 10000; count++) {
      const entry = [...timers].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) { now = until; return; }
      timers.delete(entry[0]); now = entry[1].at; entry[1].fn();
    }
    throw Error('Timer loop did not settle');
  }
  const clock = createCatMotionClock(doc);
  return {clock, doc, root, baseline, animation, advance, timers, media,
    visible: value => intersections[0]([{target: root, isIntersecting: value}]),
    mutate: () => mutations[0](),
  };
}

test('flat keyframe intervals sleep until the next gesture, including negative CSS delays', () => {
  const segments = changingSegments(frames);
  assert.deepEqual(segments.map(s => s.changing), [false, true, true, false]);
  const timing = {duration: 10000, delay: 0};
  assert.ok(Math.abs(sampleMotion(1000, timing, segments).wait - 3000) < .001);
  assert.equal(sampleMotion(4200, timing, segments).changing, true);
  assert.ok(Math.abs(sampleMotion(6000, timing, segments).wait - 8000) < .001);
  assert.equal(sampleMotion(0, {duration: 10000, delay: -4200}, segments).changing, true);
  assert.equal(sampleMotion(100, {duration: 10000, delay: 500}, segments).wait, 400);
});

test('a shared clock bounds continuous motion at 30 Hz without slowing its timeline', () => {
  const f = fixture();
  const untrack = f.clock.track(f.root);
  f.advance(1000);
  assert.equal(f.baseline.playState, 'paused');
  assert.ok(f.baseline.writes >= 29 && f.baseline.writes <= 32, f.baseline.writes);
  assert.ok(f.baseline.currentTime > 950);
  untrack(); f.clock.stop();
  assert.equal(f.baseline.playState, 'running');
  assert.equal(f.timers.size, 0);
});

test('a blink does not keep waking the renderer throughout its still interval', () => {
  const f = fixture('gentle-blink', frames);
  f.clock.track(f.root);
  f.advance(3500);
  assert.equal(f.baseline.writes, 2); // Pause and establish the first still pose.
  f.advance(800);
  assert.ok(f.baseline.writes > 5);
  f.clock.stop();
});

test('hidden documents and offscreen portraits stop updates and resume without catch-up frames', () => {
  const f = fixture();
  f.clock.track(f.root); f.advance(100);
  f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'));
  const before = f.baseline.writes;
  f.advance(10000);
  assert.equal(f.baseline.writes, before);
  assert.equal(f.timers.size, 0);
  f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange')); f.advance(0);
  assert.equal(f.baseline.writes, before + 1);
  f.visible(false); f.advance(10000);
  const offscreen = f.baseline.writes;
  assert.equal(f.timers.size, 0);
  f.visible(true); f.advance(0);
  assert.equal(f.baseline.writes, offscreen + 1);
  f.clock.stop();
});

test('initially offscreen SVG animations are paused rather than left on the native frame loop', () => {
  const f = fixture();
  f.clock.track(f.root); f.visible(false); f.advance(1000);
  assert.equal(f.baseline.playState, 'paused');
  assert.equal(f.timers.size, 0);
  f.clock.stop();
});

test('temporary performances stay native; replacements and reduced motion refresh ownership', () => {
  const f = fixture();
  const performance = f.animation('attention-head', 1);
  f.root.animations.push(performance);
  f.clock.track(f.root); f.advance(100);
  assert.equal(performance.playState, 'running');
  f.root.animations = []; f.media.dispatchEvent(new Event('change')); f.advance(0);
  assert.equal(f.timers.size, 0);
  const replacement = f.animation('gentle-tail');
  f.root.animations = [replacement, performance]; f.mutate(); f.advance(100);
  assert.equal(replacement.playState, 'paused');
  assert.ok(replacement.currentTime > 0);
  assert.equal(performance.playState, 'running');
  const timing = replacement.effect.getTiming();
  replacement.effect.getTiming = () => ({...timing, iterations: 2});
  f.mutate(); f.advance(100);
  assert.equal(replacement.playState, 'running');
  f.clock.stop();
});

test('explicit external seeking is preserved instead of being overwritten by the clock', () => {
  const f = fixture();
  f.clock.track(f.root); f.advance(100);
  f.baseline.currentTime = 4200;
  f.advance(500);
  assert.equal(f.baseline.currentTime, 4200);
  assert.equal(f.timers.size, 0);
  f.clock.stop();
});
