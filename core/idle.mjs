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
  }
  playBall() { this.requestedBall = true; }
  previewMotion() { this.requestedMotion = true; }
  start(mode, now, duration) {
    this.visual = { ...this.visual, mode, startedAt: now };
    this.until = now + duration;
  }
  step({ now, position, area, enabled, route = "line", toys = true, blocked = false, size = FLOAT_SIZE, skill = "stretch" }) {
    const b = walkingBounds(area, size);
    const signature = JSON.stringify([b, route, enabled, toys, skill]);
    const slept = this.lastAt !== null && now - this.lastAt > 2000;
    const relocated = this.point && Math.hypot(position.x - Math.round(this.point.x), position.y - Math.round(this.point.y)) > 2;
    if (signature !== this.signature || slept || relocated || !this.point) {
      const requested = this.requestedBall, motion = this.requestedMotion;
      this.reset(now);
      this.requestedBall = requested;
      this.requestedMotion = motion;
      this.point = { x: clamp(position.x, b.left, b.right), y: clamp(position.y, b.top, b.bottom) };
      this.signature = signature;
      this.visual.facing = this.point.x > (b.left + b.right) / 2 ? -1 : 1;
    }
    const dt = clamp((now - this.lastAt) / 1000, 0, 0.1);
    this.lastAt = now;
    if (blocked || (!enabled && !this.requestedBall && !this.requestedMotion && now >= this.previewUntil && this.visual.mode !== "ball")) {
      this.visual = { ...this.visual, mode: "rest" };
      if (!enabled) this.visual = restingPose();
      this.nextAt = now + 5000;
      this.target = null;
      return this.result();
    }
    if (this.requestedMotion) {
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
      this.visual = { ...this.visual, mode: "rest" };
      this.nextAt = now + 6000 + this.random() * 10_000;
      this.target = null;
    } else if (this.visual.mode === "rest" && enabled && now >= this.nextAt) {
      const roll = this.random();
      const mode = toys && roll < 0.25 ? "ball" : roll < 0.5 ? skill : "walk";
      this.start(mode, now, mode === "walk" ? 6000 + this.random() * 6000 : 8000);
      if (mode === "walk") {
        this.baseGait = this.random() < .35 ? "run" : "walk";
        this.jumpAt = this.random() < .3 ? now + 2200 : Infinity;
      }
      if (mode !== "walk" || route === "line") this.visual.edge = "bottom";
      this.target = null;
    }
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
  result() { return { position: { x: Math.round(this.point.x), y: Math.round(this.point.y) }, visual: { ...this.visual } }; }
}
