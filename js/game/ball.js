// Ball physics: gravity, air drag, rolling friction, Magnus curve, bounces off
// the arena walls, posts, crossbar and goal nets.
import * as THREE from '../vendor/three.module.min.js';
import { FIELD, PHYS } from '../config.js';
import { makeBallTexture, toonGradient } from './textures.js';

const R = PHYS.ballR;
const POST_R = 0.07;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), closest = new THREE.Vector3();

export class Ball {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(R, 24, 16);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.4, metalness: 0.05, emissive: 0x000000 }));
    this.mesh.castShadow = true;
    const outline = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x05060a, side: THREE.BackSide }));
    outline.scale.setScalar(1.08);
    this.mesh.add(outline);
    scene.add(this.mesh);
    // blob shadow for readability of height
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(R * 1.2, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);
    this.pos = new THREE.Vector3(0, R, 0);
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();  // angular-ish vector for Magnus curve
    this.owner = null;
    this.lastTouch = null;
    this.lastKicker = null;
    this.hot = 0;          // > 0 while a power/special shot is in flight
    this.hotColor = 0xffffff;
    this.shotBy = null;    // player who last shot (for stats/goal credit)
    this.onEvent = () => {};
    this.dribbleT = 0;
    this.lastBounce = 0;
    this.inGoal = 0;
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, R, z); this.vel.set(0, 0, 0); this.spin.set(0, 0, 0);
    this.owner = null; this.hot = 0; this.shotBy = null; this.inGoal = 0;
  }

  get speed() { return this.vel.length(); }

  kick(dir, speed, { lift = 0, curve = 0, hot = 0, color = 0xffffff, by = null, shot = false } = {}) {
    this.owner = null;
    this.vel.copy(dir).setY(0).normalize().multiplyScalar(speed);
    this.vel.y = lift;
    // curve: spin around vertical axis bends the path sideways
    this.spin.set(0, curve, 0);
    this.hot = hot; this.hotColor = color;
    this.lastKicker = by; this.lastTouch = by;
    if (shot) this.shotBy = by;
  }

  update(dt, time) {
    if (this.owner) {
      const o = this.owner;
      // dribble: ball rolls a little ahead of the feet, with small touches
      this.dribbleT += dt * (1 + o.speed * 0.9);
      const touch = 0.45 + (Math.sin(this.dribbleT * 3.2) * 0.5 + 0.5) * 0.18 * Math.min(1, o.speed / 4);
      const fx = Math.sin(o.facing), fz = Math.cos(o.facing);
      const tx = o.pos.x + fx * (touch + o.speed * 0.025), tz = o.pos.z + fz * (touch + o.speed * 0.025);
      const k = 1 - Math.exp(-dt * 25);
      const lx = this.pos.x, lz = this.pos.z;
      this.pos.x += (tx - this.pos.x) * k;
      this.pos.z += (tz - this.pos.z) * k;
      this.pos.y = o.holding ? o.pos.y + 1.15 : R + Math.max(0, o.pos.y);
      if (o.holding) { this.pos.x = o.pos.x + fx * 0.35; this.pos.z = o.pos.z + fz * 0.35; }
      this.pos.x = Math.max(-FIELD.HW + R, Math.min(FIELD.HW - R, this.pos.x));
      this.pos.z = Math.max(-FIELD.HL + R, Math.min(FIELD.HL - R, this.pos.z));
      this.vel.set((this.pos.x - lx) / Math.max(dt, 1e-4), 0, (this.pos.z - lz) / Math.max(dt, 1e-4));
      this._roll(dt);
      this._sync();
      return;
    }

    // Magnus effect (curve)
    if (this.spin.lengthSq() > 0.0001) {
      tmp.crossVectors(this.spin, this.vel).multiplyScalar(0.06 * dt);
      this.vel.add(tmp);
      this.spin.multiplyScalar(Math.max(0, 1 - dt * 0.6));
    }
    this.vel.y -= PHYS.gravity * dt;
    const airDrag = this.pos.y > R + 0.05 ? 0.06 : 0;
    this.vel.multiplyScalar(1 - airDrag * dt);
    this.pos.addScaledVector(this.vel, dt);

    // ground
    if (this.pos.y < R) {
      this.pos.y = R;
      if (this.vel.y < -1.6) {
        const v = -this.vel.y;
        this.vel.y = v * 0.55;
        this.vel.x *= 0.88; this.vel.z *= 0.88;
        if (time - this.lastBounce > 0.15) { this.onEvent('bounce', Math.min(1, v / 14)); this.lastBounce = time; }
      } else {
        this.vel.y = 0;
        // rolling friction
        const f = Math.max(0, 1 - dt * 1.35);
        this.vel.x *= f; this.vel.z *= f;
        if (Math.hypot(this.vel.x, this.vel.z) < 0.15) { this.vel.x = 0; this.vel.z = 0; }
      }
    }
    if (this.pos.y > FIELD.ceiling - R) { this.pos.y = FIELD.ceiling - R; this.vel.y = -Math.abs(this.vel.y) * 0.5; }

    if (this.hot > 0) this.hot -= dt;
    if (this.vel.lengthSq() < 30 && this.hot > 0) this.hot = 0;

    this._collideArena();
    this._roll(dt);
    this._sync();
  }

  _collideArena() {
    const p = this.pos, v = this.vel;
    const HW = FIELD.HW, HL = FIELD.HL, gw = FIELD.goalW / 2, gh = FIELD.goalH;
    // side walls
    if (p.x > HW - R) { p.x = HW - R; if (v.x > 0) { v.x *= -0.7; this._wallHit(); } }
    if (p.x < -HW + R) { p.x = -HW + R; if (v.x < 0) { v.x *= -0.7; this._wallHit(); } }
    const inMouth = Math.abs(p.x) < gw - R * 0.3 && p.y < gh - R * 0.3;
    for (const s of [-1, 1]) {
      const over = s * p.z;
      if (this.inGoal !== s) {
        if (over > HL - R) {
          if (inMouth) { if (over > HL) this.inGoal = s; }
          else { p.z = s * (HL - R); if (s * v.z > 0) { v.z *= -0.7; this._wallHit(); } }
        }
      } else {
        // inside goal: net box
        const back = HL + FIELD.goalD - R;
        if (over > back) { p.z = s * back; if (s * v.z > 0) { v.z *= -0.12; v.x *= 0.5; v.y *= 0.5; this.onEvent('net', 1); } }
        if (Math.abs(p.x) > gw - R) { p.x = Math.sign(p.x) * (gw - R); v.x *= -0.15; v.z *= 0.7; this.onEvent('net', 0.4); }
        if (p.y > gh - R) { p.y = gh - R; v.y = -Math.abs(v.y) * 0.2; v.z *= 0.7; }
        if (over < HL - R) this.inGoal = 0;
      }
      // posts and crossbar
      for (const sx of [-1, 1]) this._collideSegment(sx * gw, 0, s * HL, sx * gw, gh, s * HL);
      this._collideSegment(-gw, gh, s * HL, gw, gh, s * HL);
    }
  }

  _wallHit() {
    const sp = this.vel.length();
    if (sp > 4) this.onEvent('wall', Math.min(1, sp / 25));
  }

  _collideSegment(ax, ay, az, bx, by, bz) {
    tmp.set(bx - ax, by - ay, bz - az);
    const len2 = tmp.lengthSq();
    tmp2.set(this.pos.x - ax, this.pos.y - ay, this.pos.z - az);
    const t = Math.max(0, Math.min(1, tmp2.dot(tmp) / len2));
    closest.set(ax + tmp.x * t, ay + tmp.y * t, az + tmp.z * t);
    tmp2.subVectors(this.pos, closest);
    const d = tmp2.length();
    const minD = R + POST_R;
    if (d < minD && d > 1e-5) {
      tmp2.divideScalar(d);
      this.pos.copy(closest).addScaledVector(tmp2, minD);
      const vn = this.vel.dot(tmp2);
      if (vn < 0) {
        this.vel.addScaledVector(tmp2, -1.75 * vn);
        if (-vn > 3) this.onEvent('post', Math.min(1, -vn / 20));
      }
    }
  }

  _roll(dt) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.01) {
      const axis = tmp.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(axis, (sp * dt) / R);
    }
  }

  _sync() {
    this.mesh.position.copy(this.pos);
    this.shadow.position.set(this.pos.x, 0.015, this.pos.z);
    const h = Math.max(0, this.pos.y - R);
    this.shadow.material.opacity = Math.max(0.08, 0.4 - h * 0.05);
    this.shadow.scale.setScalar(1 + h * 0.15);
    const e = this.mesh.material.emissive;
    if (this.hot > 0) e.set(this.hotColor).multiplyScalar(0.8); else e.setRGB(0, 0, 0);
  }
}

export { toonGradient };
