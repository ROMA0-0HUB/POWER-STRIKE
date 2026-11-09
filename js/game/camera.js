// Third-person orbit camera. It follows the user's player, eases behind the
// movement direction when the player is not dragging, and exposes the values
// the match needs for camera-relative aiming (forwardFlat, pitch).
import * as THREE from '../vendor/three.module.min.js';
import { angDiff } from './player.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class GameCamera {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0;             // horizontal orbit angle (camera sits at yaw from the player)
    this.p = 0.42;            // downward tilt in radians (also used for shot height)
    this.dist = 9.5;
    this.sens = 1;
    this.invert = false;
    this.auto = 0;            // seconds until auto-follow resumes after a drag
    this.shakeT = 0;
    this.forwardFlat = new THREE.Vector3(0, 0, -1);
    this.cur = new THREE.Vector3();
    this._inited = false;
  }

  get pitch() { return this.p; }

  /** Touch/mouse drag on the look zone. */
  drag(dx, dy) {
    this.yaw -= dx * 0.0065 * this.sens;
    this.p = clamp(this.p + (this.invert ? -1 : 1) * dy * 0.004 * this.sens, 0.12, 0.9);
    this.auto = 1.6;
  }

  shake(amount) { this.shakeT = Math.max(this.shakeT, amount); }

  update(dt, user) {
    if (!user) return;
    this.auto = Math.max(0, this.auto - dt);
    if (this.auto <= 0 && user.speed > 0.8) {
      // ease behind the direction of travel
      const want = user.facing + Math.PI;
      this.yaw += angDiff(this.yaw, want) * Math.min(1, dt * 2.2);
    }
    const ox = Math.sin(this.yaw), oz = Math.cos(this.yaw);
    const target = new THREE.Vector3(user.pos.x, user.pos.y + 1.2, user.pos.z);
    if (!this._inited) { this.cur.copy(target); this._inited = true; }
    this.cur.lerp(target, Math.min(1, dt * 10));

    const h = Math.cos(this.p) * this.dist;
    const v = Math.sin(this.p) * this.dist;
    this.shakeT = Math.max(0, this.shakeT - dt * 2.5);
    const s = this.shakeT * 0.3;
    const jx = (Math.random() - 0.5) * s, jy = (Math.random() - 0.5) * s;
    this.cam.position.set(this.cur.x + ox * h + jx, this.cur.y + v + jy, this.cur.z + oz * h);
    this.cam.lookAt(this.cur);
    this.forwardFlat.set(-ox, 0, -oz).normalize();
  }

  /** Snap to a clean behind-the-player view (used when a match starts). */
  snap(user) {
    this.yaw = user.facing + Math.PI;
    this._inited = false;
    this.auto = 0;
  }
}
