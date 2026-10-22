const FRAME_MS = 1000 / 30;
const BASELINE_MOTION = new Set(['breathe', 'gentle-blink', 'gentle-tail', 'gentle-ear']);
const FRAME_METADATA = new Set(['offset', 'computedOffset', 'easing', 'composite']);

// SVG child transforms need layout/paint even on a flat part of a CSS animation.
// Keep the artwork and CSS timing, but sample those perpetual motions at 30 Hz.
export function changingSegments(keyframes) {
  return keyframes.slice(0, -1).map((from, index) => {
    const to = keyframes[index + 1];
    const properties = new Set([...Object.keys(from), ...Object.keys(to)]);
    return {
      from: from.computedOffset,
      to: to.computedOffset,
      changing: [...properties].some(key => !FRAME_METADATA.has(key) && from[key] !== to[key]),
    };
  });
}

export function sampleMotion(time, {duration, delay}, segments) {
  if (time < delay) return {segment: -1, changing: false, wait: delay - time};
  const phase = ((time - delay) % duration + duration) % duration / duration;
  const index = segments.findIndex(segment => phase >= segment.from && phase < segment.to);
  if (segments[index]?.changing) return {segment: index, changing: true, wait: FRAME_MS};
  const next = segments.find(segment => segment.changing && segment.from > phase)
    || segments.find(segment => segment.changing);
  const wait = next ? ((next.from - phase + 1) % 1) * duration : Infinity;
  return {segment: index, changing: false, wait};
}

export function createCatMotionClock(doc) {
  const view = doc.defaultView;
  const roots = new Map();
  const externallyControlled = new WeakSet();
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = null;
  let stopped = false;

  function schedule(delay = 0) {
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
    if (!stopped && !doc.hidden && Number.isFinite(delay)) timer = view.setTimeout(tick, delay);
  }

  function scan(root, state, now) {
    const current = new Set(root.getAnimations({subtree: true}));
    for (const animation of state.animations.keys()) {
      if (!current.has(animation)) state.animations.delete(animation);
    }
    for (const animation of current) {
      if (externallyControlled.has(animation) || !BASELINE_MOTION.has(animation.animationName)) continue;
      const motion = state.animations.get(animation);
      const timing = animation.effect.getTiming();
      if (timing.iterations !== Infinity || !(timing.duration > 0) || !Number.isFinite(timing.duration)
        || timing.direction !== 'normal' || timing.iterationStart !== 0 || animation.playbackRate !== 1) {
        if (motion) {
          state.animations.delete(animation);
          animation.currentTime = motion.origin + now - motion.start;
          animation.play();
        }
        continue;
      }
      if (motion) {
        motion.timing = timing;
        motion.segments = changingSegments(animation.effect.getKeyframes());
        motion.segment = null;
        continue;
      }
      if (animation.playState !== 'running') continue;
      const origin = Number(animation.currentTime) || 0;
      animation.pause();
      animation.currentTime = origin;
      state.animations.set(animation, {
        timing, origin, start: now, written: origin, segment: null,
        segments: changingSegments(animation.effect.getKeyframes()),
      });
    }
    state.dirty = false;
  }

  function tick() {
    timer = null;
    if (stopped || doc.hidden) return;
    const now = view.performance.now();
    let wait = Infinity;
    const writes = [];
    // Finish timing reads before any seeks, so CSS animations do not force a
    // separate style recalculation for each eye, ear and tail in the same frame.
    for (const [root, state] of roots) {
      if (root.isConnected && state.dirty) scan(root, state, now);
    }
    for (const [root, state] of roots) {
      if (!root.isConnected) continue;
      if (!state.visible) continue;
      for (const [animation, motion] of state.animations) {
        // Respect explicit external seeking/playback (including DevTools).
        // Browser animation times may round a seek to the nearest microsecond.
        if (animation.playState !== 'paused' || animation.currentTime === null
          || Math.abs(animation.currentTime - motion.written) > 1) {
          state.animations.delete(animation);
          externallyControlled.add(animation);
          continue;
        }
        const time = motion.origin + now - motion.start;
        const sample = sampleMotion(time, motion.timing, motion.segments);
        if (sample.changing || sample.segment !== motion.segment) {
          writes.push([animation, time]);
          motion.written = time;
          motion.segment = sample.segment;
        }
        wait = Math.min(wait, sample.wait);
      }
    }
    for (const [animation, time] of writes) animation.currentTime = time;
    schedule(Math.max(FRAME_MS, wait));
  }

  const visibility = () => schedule();
  const mediaChanged = () => {
    for (const state of roots.values()) state.dirty = true;
    schedule();
  };
  doc.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', mediaChanged);
  const intersection = new view.IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = roots.get(entry.target);
      if (state) {
        state.visible = entry.isIntersecting;
        state.dirty = true;
      }
    }
    schedule();
  });

  return {
    track(root) {
      const state = {animations: new Map(), visible: true, dirty: true};
      const changed = () => {
        state.dirty = true;
        schedule();
      };
      const observer = new view.MutationObserver(changed);
      observer.observe(root, {subtree: true, attributes: true, attributeFilter: ['class', 'style']});
      root.addEventListener('animationstart', changed);
      roots.set(root, state);
      intersection.observe(root);
      schedule();
      let tracked = true;
      const untrack = () => {
        if (!tracked) return;
        tracked = false;
        observer.disconnect();
        root.removeEventListener('animationstart', changed);
        intersection.unobserve(root);
        roots.delete(root);
        for (const [animation, motion] of state.animations) {
          if (animation.playState === 'paused' && animation.currentTime !== null
            && Math.abs(animation.currentTime - motion.written) <= 1) animation.play();
        }
        schedule();
      };
      state.untrack = untrack;
      return untrack;
    },
    get size() { return roots.size; },
    stop() {
      stopped = true;
      schedule();
      for (const state of [...roots.values()]) state.untrack();
      intersection.disconnect();
      doc.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', mediaChanged);
    },
  };
}

let clock;
export function trackCatMotion(root) {
  clock ||= createCatMotionClock(root.ownerDocument);
  const active = clock;
  const untrack = active.track(root);
  return () => {
    untrack();
    if (!active.size) {
      active.stop();
      if (clock === active) clock = null;
    }
  };
}
