import { FLOAT_SIZE } from "./desktop.mjs";

export const IDLE_ROUTES = ["line", "edges"];
export const restingPose = () => ({ mode: "rest", facing: 1, edge: "bottom", startedAt: 0 });
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function walkingBounds(area, size = FLOAT_SIZE) {
  return { left: area.x, top: area.y,
    right: area.x + Math.max(0, area.width - size.width),
    bottom: area.y + Math.max(0, area.height - size.height) };
}
const corners = b => [
  { x: b.left, y: b.top }, { x: b.right, y: b.top },
  { x: b.right, y: b.bottom }, { x: b.left, y: b.bottom },
];

// A bounded desktop choreography. No game currency, screen capture or window inspection.
export class IdleDirector {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.visual = restingPose();
    this.point = null;
    this.nextAt = 0;
    this.lastAt = null;
    this.requestedBall = false;
    this.requestedMotion = false;
    this.cooldowns = new Map();
  }
  reset(now) {
    this.visual = restingPose();
    this.point = null;
    this.nextAt = now + 8000;
    this.lastAt = now;
    this.requestedBall = false;
    this.requestedMotion = false;
    this.previewUntil = 0;
    this.jumpAt = Infinity;
    this.target = null;
    this.requestedBehavior = null;
    this.requestDeadline = null;
    this.manualBehavior = false;
    this.arrivedAt = undefined;
    this.behaviorTarget = null;
    this.chaseOrigin = null;
    this.mouseTeased = false;
    this.teaseDepartedAt = null;
  }
  playBall() { this.requestedBall = true; }
  requestBehavior(id) { this.requestedBehavior = id; }
  teaseMouse() { this.mouseTeased = true; this.requestBehavior("mouse"); }
  isManualChase() { return this.requestedBehavior === "mouse" || (this.manualBehavior && this.visual.mode === "mouse"); }
  previewMotion() { this.requestedMotion = true; }
  start(mode, now, duration) {
    this.visual = { ...this.visual, mode, startedAt: now };
    this.until = now + duration;
  }
  step({ now, position, area, enabled, route = "line", toys = true, blocked = false, size = FLOAT_SIZE, skill = "stretch", talent = null, mouse = null, deferRequests = false, preferences = null }) {
    const b = walkingBounds(area, size);
    const signature = JSON.stringify([b, route, enabled, toys, skill]);
    const slept = this.lastAt !== null && now - this.lastAt > 2000;
    const relocated = this.point && Math.hypot(position.x - Math.round(this.point.x), position.y - Math.round(this.point.y)) > 2;
    if (signature !== this.signature || slept || relocated || !this.point) {
      const requested = this.requestedBall, motion = this.requestedMotion, behavior = this.requestedBehavior, teased = this.mouseTeased && !slept && !relocated;
      this.reset(now);
      this.requestedBall = requested;
      this.requestedMotion = motion;
      this.requestedBehavior = behavior;
      this.mouseTeased = teased;
      this.point = { x: clamp(position.x, b.left, b.right), y: clamp(position.y, b.top, b.bottom) };
      this.signature = signature;
      this.visual.facing = this.point.x > (b.left + b.right) / 2 ? -1 : 1;
    }
    const dt = clamp((now - this.lastAt) / 1000, 0, 0.1);
    this.lastAt = now;
    if (blocked || (!enabled && !this.requestedBall && !this.requestedMotion && !this.requestedBehavior && !this.manualBehavior && now >= this.previewUntil && this.visual.mode !== "ball")) {
      this.visual = { ...this.visual, mode: "rest" };
      if (!enabled) this.visual = restingPose();
      this.nextAt = now + 5000;
      this.target = null;
      this.behaviorTarget = null;
      this.manualBehavior = false;
      this.mouseTeased = false;
      const waiting = deferRequests && (this.requestedBehavior || this.requestedBall || this.requestedMotion);
      if (waiting && !this.requestDeadline) this.requestDeadline = now + 6000;
      if (!waiting || now >= this.requestDeadline) {
        this.requestedBehavior = null;
        this.requestedBall = false;
        this.requestedMotion = false;
        this.requestDeadline = null;
      }
      this.visual = restingPose();
      return this.result();
    }
    this.requestDeadline = null;
    if (this.requestedBehavior) {
      const id = this.requestedBehavior;
      this.requestedBehavior = null;
      this.manualBehavior = true;
      this.beginBehavior(id, now, b, size, mouse);
    } else if (this.requestedMotion) {
      this.requestedMotion = false;
      this.previewUntil = now + 6500;
      this.baseGait = "run";
      this.jumpAt = now + 1800;
      this.target = null;
      this.visual.edge = "bottom";
      this.start("walk", now, 6500);
    } else if (this.requestedBall) {
      this.requestedBall = false;
      this.start("ball", now, 8000);
      this.visual.edge = "bottom";
    } else if (this.visual.mode !== "rest" && now >= this.until) {
      this.visual = restingPose();
      this.manualBehavior = false;
      this.mouseTeased = false;
      this.nextAt = now + 12000 + this.random() * 10_000;
      this.target = null;
    } else if (this.visual.mode === "rest" && enabled && now >= this.nextAt) {
      const roll = this.random();
      const available = ["observe", "doze", "wash", skill, ...(talent ? ["talent"] : []),
        ...(toys ? ["toyroll", "ball"] : []),
        ...(Math.min(this.point.x - b.left, b.right - this.point.x) < 180 ? ["peek"] : [])]
        .filter(id => now >= (this.cooldowns.get(id) || 0));
      const movingChance = preferences ? .25 + preferences.energy * .25 : .35;
      const weighted = available.flatMap(id => {
        if (!preferences) return [id];
        const weight = ["ball", "toyroll"].includes(id) ? 1 + Math.round(preferences.energy * 3) : id === "doze" ? 1 + Math.round((1 - preferences.energy) * 3) : id === "observe" ? 1 + Math.round(preferences.curiosity * 2) : id === "talent" ? 1 + Math.round(preferences.talkative * 2) : 1;
        return Array(weight).fill(id);
      });
      const mode = roll < 1 - movingChance && weighted.length ? weighted[Math.floor(this.random() * weighted.length)] : "walk";
      this.cooldowns.set(mode, now + (["mouse", "peek", "toyroll", "talent"].includes(mode) ? 120000 : 60000));
      this.beginBehavior(mode, now, b, size, mouse);
      if (mode === "walk") this.until = now + 6000 + this.random() * 6000;
      if (mode === "talent") this.visual.talentId = talent;
      if (mode === "walk") {
        this.baseGait = this.random() < .35 ? "run" : "walk";
        this.jumpAt = this.random() < .3 ? now + 2200 : Infinity;
      }
      if (mode !== "walk" || route === "line") this.visual.edge = "bottom";
      this.target = null;
    }
    if (["peek", "mouse"].includes(this.visual.mode)) this.moveBehavior(now, dt, size, mouse, b);
    if (this.visual.mode === "walk") {
      const onLine = route === "line" || now < this.previewUntil;
      if (onLine) this.visual.edge = "bottom";
      const jumping = onLine && now >= this.jumpAt && now < this.jumpAt + 1350;
      this.visual.gait = jumping ? "jump" : this.baseGait || "walk";
      this.visual.motionAt = jumping ? this.jumpAt : this.visual.startedAt;
      const ramp = Math.min(1, (now - this.visual.startedAt) / 400, Math.max(0, (this.until - now) / 450));
      const speed = (this.visual.gait === "walk" ? 30 : 55) * (size.width / FLOAT_SIZE.width) * ramp;
      if (!onLine) this.walkEdges(b, dt, speed);
      else {
        let x = this.point.x + this.visual.facing * speed * dt;
        if (x <= b.left || x >= b.right) this.visual.facing *= -1;
        this.point.x = clamp(x, b.left, b.right);
      }
    }
    return this.result();
  }
  canChase(mouse, size, b) {
    return !!mouse && Number.isFinite(mouse.x) && Number.isFinite(mouse.y) &&
      mouse.x >= b.left && mouse.x <= b.right + size.width && mouse.y >= b.top && mouse.y <= b.bottom + size.height;
  }
  chaseTarget(mouse, size, b) {
    const dx = mouse.x - this.point.x - size.width / 2, dy = mouse.y - this.point.y - size.height / 2;
    const distance = Math.hypot(dx, dy), clearance = Math.hypot(size.width / 2 + 28, size.height / 2 + 28) + 8;
    const step = Math.max(0, distance - clearance);
    let x = this.point.x + (distance ? dx / distance * step : 0), y = this.point.y + (distance ? dy / distance * step : 0);
    const ox = x - this.chaseOrigin.x, oy = y - this.chaseOrigin.y, radius = 260 * size.width / FLOAT_SIZE.width, length = Math.hypot(ox, oy);
    if (length > radius) { x = this.chaseOrigin.x + ox / length * radius; y = this.chaseOrigin.y + oy / length * radius; }
    return { x: clamp(x, b.left, b.right), y: clamp(y, b.top, b.bottom) };
  }
  beginBehavior(mode, now, b, size, mouse) {
    this.visual = { ...restingPose(), facing: this.visual.facing };
    this.behaviorTarget = null;
    this.arrivedAt = undefined;
    this.chaseOrigin = null;
    this.start(mode, now, mode === "observe" ? 4000 : 8000);
    if (mode === "peek") {
      const left = this.point.x - b.left <= b.right - this.point.x;
      this.visual.peekSide = left ? "left" : "right";
      this.visual.facing = left ? 1 : -1;
      this.behaviorTarget = { x: left ? b.left : b.right, y: this.point.y };
      this.until = now + Math.abs(this.point.x - this.behaviorTarget.x) / 90 * 1000 + 5000;
    }
    if (mode === "mouse") {
      this.visual.phase = "watch";
      this.visual.teased = this.mouseTeased;
      this.teaseDepartedAt = null;
      this.until = this.mouseTeased ? now + 9000 : now + 6000;
      if (!this.canChase(mouse, size, b)) return;
      this.chaseOrigin = { ...this.point };
      this.visual.facing = this.mouseTeased ? 1 : mouse.x > this.point.x + size.width / 2 ? 1 : -1;
      this.behaviorTarget = this.chaseTarget(mouse, size, b);
    }
  }
  moveBehavior(now, dt, size, mouse, b) {
    if (this.visual.mode === "mouse") {
      if (!this.chaseOrigin && this.canChase(mouse, size, b)) {
        this.chaseOrigin = { ...this.point };
        this.visual.startedAt = now;
        this.until = this.mouseTeased ? now + 9000 : now + 6000;
      }
      if (!this.chaseOrigin || !this.canChase(mouse, size, b)) { this.visual.phase = "watch"; return; }
      const near = mouse.x >= this.point.x - 28 && mouse.x <= this.point.x + size.width + 28 && mouse.y >= this.point.y - 28 && mouse.y <= this.point.y + size.height + 28;
      if (this.mouseTeased && this.teaseDepartedAt === null && near) {
        this.visual.phase = "watch";
        this.visual.facing = 1;
        this.visual.gaze = { x: clamp((mouse.x - this.point.x - size.width / 2) / (size.width / 2), -1, 1), y: clamp((mouse.y - this.point.y - size.height * .43) / size.height, -1, 1) };
        return;
      }
      if (this.mouseTeased && this.teaseDepartedAt === null) { this.teaseDepartedAt = now; this.until = now + 5000; }
      this.visual.gaze = null;
      this.behaviorTarget = this.chaseTarget(mouse, size, b);
      const watching = now - this.visual.startedAt < 350;
      const dx = this.behaviorTarget.x - this.point.x, dy = this.behaviorTarget.y - this.point.y, distance = Math.hypot(dx, dy);
      this.visual.facing = mouse.x >= this.point.x + size.width / 2 ? 1 : -1;
      if (!watching && distance) {
        const amount = Math.min(distance, dt * 140 * size.width / FLOAT_SIZE.width);
        this.point.x += dx / distance * amount; this.point.y += dy / distance * amount;
      }
      const arrived = Math.hypot(this.behaviorTarget.x - this.point.x, this.behaviorTarget.y - this.point.y) < 1;
      if (arrived && this.arrivedAt === undefined) this.arrivedAt = now;
      if (!arrived) this.arrivedAt = undefined;
      this.visual.phase = watching ? "watch" : arrived ? "pounce" : "approach";
      this.visual.phaseAt = arrived ? this.arrivedAt : this.visual.startedAt;
      return;
    }
    if (!this.behaviorTarget) return;
    const distance = this.behaviorTarget.x - this.point.x;
    this.point.x += Math.sign(distance) * Math.min(Math.abs(distance), dt * 90 * size.width / FLOAT_SIZE.width);
    const arrived = Math.abs(this.behaviorTarget.x - this.point.x) < 1;
    this.visual.facing = arrived ? this.visual.peekSide === "left" ? 1 : -1 : distance < 0 ? -1 : 1;
    if (arrived && this.arrivedAt === undefined) this.arrivedAt = now;
    if (!arrived) this.arrivedAt = undefined;
    this.visual.phase = !arrived ? "approach" : now - this.arrivedAt < 2600 ? "hide" : "reveal";
    this.visual.phaseAt = arrived ? this.arrivedAt : this.visual.startedAt;
    if (arrived) this.until = Math.min(this.until, this.arrivedAt + 4800);
  }

  walkEdges(b, dt, speed = 34) {
    if (!this.target) {
      const options = [
        { x: this.point.x, y: b.top, next: 1, edge: "top" },
        { x: b.right, y: this.point.y, next: 2, edge: "right" },
        { x: this.point.x, y: b.bottom, next: 3, edge: "bottom" },
        { x: b.left, y: this.point.y, next: 0, edge: "left" },
      ].sort((a, c) => Math.hypot(a.x - this.point.x, a.y - this.point.y) - Math.hypot(c.x - this.point.x, c.y - this.point.y));
      this.target = options[0];
      this.corner = this.target.next;
      this.visual.edge = "bottom";
    }
    let distance = Math.hypot(this.target.x - this.point.x, this.target.y - this.point.y);
    if (distance < 0.5) {
      this.visual.edge = this.target.edge;
      const edge = ["left", "top", "right", "bottom"][this.corner];
      this.target = { ...corners(b)[this.corner], edge };
      this.corner = (this.corner + 1) % 4;
      distance = Math.hypot(this.target.x - this.point.x, this.target.y - this.point.y);
      this.visual.edge = edge;
    }
    if (!distance) return;
    const dx = this.target.x - this.point.x, dy = this.target.y - this.point.y;
    const amount = Math.min(distance, speed * dt);
    this.point.x = clamp(this.point.x + dx / distance * amount, b.left, b.right);
    this.point.y = clamp(this.point.y + dy / distance * amount, b.top, b.bottom);
    // Relative to the rotated body: bottom walks left, the other edges clockwise.
    this.visual.facing = this.visual.edge === "bottom" ? (dx < 0 ? -1 : 1) : -1;
  }
  result() { return { position: { x: Math.round(this.point.x), y: Math.round(this.point.y) }, visual: { ...this.visual, manual: this.manualBehavior, teased: this.mouseTeased && this.visual.mode === "mouse" } }; }
}
