const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
// Only pointer coordinates are consumed. No text, focused controls or app content.
export class CursorAttention {
  constructor({ random = Math.random } = {}) { this.random = random; this.nextAt = null; this.until = 0; this.lastAt = null; }
  step({ now, position, size, area, pointer, enabled, paused = false }) {
    const slept = this.lastAt !== null && now - this.lastAt > 2000;
    this.lastAt = now;
    const valid = pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y) && pointer.x >= area.x && pointer.x <= area.x + area.width && pointer.y >= area.y && pointer.y <= area.y + area.height;
    if (!enabled || paused || slept || !valid) {
      this.until = 0;
      this.nextAt = Math.max(this.nextAt ?? 0, now + 8000 + this.random() * 7000);
      return null;
    }
    if (this.nextAt === null) this.nextAt = now + 8000 + this.random() * 7000;
    if (now >= this.nextAt && now >= this.until) {
      this.until = now + 3000;
      this.nextAt = this.until + 25000 + this.random() * 25000;
    }
    if (now >= this.until) return null;
    const quantize = value => Math.round(clamp(value, -1, 1) * 10) / 10;
    return { x: quantize((pointer.x - position.x - size.width / 2) / (size.width * 2)),
      y: quantize((pointer.y - position.y - size.height * .43) / (size.height * 1.5)) };
  }
}

// A deliberate back-and-forth gesture over the pet, not ordinary cursor travel.
export class CursorTease {
  constructor(){this.cooldownUntil=0;this.reset();}
  reset(){this.previous=null;this.vector=null;this.reversals=0;this.distance=0;this.startedAt=null;}
  step({now,pointer,position,size,blocked=false}){
    const inside=pointer&&Number.isFinite(pointer.x)&&Number.isFinite(pointer.y)&&pointer.x>=position.x+size.width*.15&&pointer.x<=position.x+size.width*.85&&pointer.y>=position.y+size.height*.17&&pointer.y<=position.y+size.height*.9;
    if(blocked||!inside||now<this.cooldownUntil){this.reset();return false;}
    if(this.startedAt===null||now-this.startedAt>1800){this.reset();this.startedAt=now;this.previous={...pointer};return false;}
    const dx=pointer.x-this.previous.x,dy=pointer.y-this.previous.y,length=Math.hypot(dx,dy);
    if(length<Math.max(2,size.width/220*3))return false;
    this.previous={...pointer};this.distance+=length;
    if(this.vector&&dx*this.vector.x+dy*this.vector.y < -.3*length*Math.hypot(this.vector.x,this.vector.y))this.reversals++;
    this.vector={x:dx,y:dy};
    if(this.reversals>=3&&this.distance>=Math.max(20,size.width/220*36)){this.cooldownUntil=now+8000;this.reset();return true;}
    return false;
  }
}
