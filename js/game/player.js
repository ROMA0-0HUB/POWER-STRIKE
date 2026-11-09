// A footballer on the pitch — shared by the user-controlled striker, AI
// team-mates and AI opponents. Handles movement, stamina, actions and the
// special abilities; the decision making lives in ai.js / userControl.js.
import * as THREE from '../vendor/three.module.min.js';
import { FIELD, PHYS, statSpeed, statShot, statPass, statDribble, statDefense } from '../config.js';
import { buildCharacter, animateCharacter } from './characterModel.js';
import { audio } from '../audio.js';
const _v = new THREE.Vector3();

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Player {
  constructor(match, { team, role, char, look, isUser = false, isRemote = false, name, speedMul = 1 }) {
    this.match = match;
    this.team = team;
    this.role = role;
    this.isGK = role === 'GK';
    this.char = char;
    this.look = look;
    this.isUser = isUser;
    this.isRemote = isRemote;
    this.isHuman = isUser || isRemote;
    this.name = name;
    const kit = { jersey: this.isGK ? team.def.gkJersey : team.def.jersey, shorts: team.def.shorts, accent: team.def.accent };
    const q = match.quality;
    this.rig = buildCharacter(look, kit, { outlines: q !== 'low', shadows: q !== 'low' });
    this.rig.setKit(kit, this.isGK);
    match.scene.add(this.rig.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.vy = 0;
    this.grounded = true;
    this.intent = { x: 0, z: 0, sprint: false, face: null };
    this.stamina = 1;
    this.energy = 0.15 + Math.random() * 0.25;
    this.cd = { control: 0, tackle: 0, dash: 0, kick: 0, header: 0 };
    this.stun = 0;
    this.dodge = 0;
    this.action = null;
    this.buff = null;     // { id, t }
    this.primed = null;   // ability waiting for the next shot
    this.charge = 0;
    this.holding = false; // GK holding the ball in hands
    this.sprinting = false;
    this.exhausted = false;   // set when stamina runs out; cleared at 30%
    this.baseSpeed = statSpeed(char) * speedMul;
    this.shotMul = statShot(char);
    this.passMul = statPass(char);
    this.drbMul = statDribble(char);
    this.defMul = statDefense(char);
    this.ai = { timer: Math.random() * 0.3, target: new THREE.Vector3(), hold: 0, reactT: 0, lastShotSeen: null, mark: null };
    this.stats = { goals: 0, shots: 0, passes: 0, tackles: 0, saves: 0 };
    this.ghostT = 0;
    this.time = 0;

    // ground ring (team colour) + user marker
    const ringGeo = new THREE.RingGeometry(0.5, 0.62, 28);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: team.def.css, transparent: true, opacity: 0.0, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    match.scene.add(this.ring);
    if (isUser) {
      this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), new THREE.MeshBasicMaterial({ color: 0x5ff6ff }));
      this.marker.rotation.x = Math.PI;
      match.scene.add(this.marker);
      this.ring.material.color.set(0x5ff6ff);
    }
  }

  get hasBall() { return this.match.ball.owner === this; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get dir() { return v3.set(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  canAct() { return !this.action && this.stun <= 0; }

  place(x, z, facing) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.facing = facing; this.vy = 0; this.grounded = true;
    this.action = null; this.stun = 0; this.dodge = 0; this.charge = 0; this.holding = false;
    this.cd.control = 0; this.cd.tackle = 0;
    this.rig.root.position.copy(this.pos); this.rig.root.rotation.y = facing;
  }

  setIntent(x, z, sprint = false, face = null) {
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    this.intent.x = x; this.intent.z = z; this.intent.sprint = sprint; this.intent.face = face;
  }

  startAction(type, dur, extra = {}) {
    this.action = { type, t: 0, dur, ...extra };
    return this.action;
  }

  // ── actions ───────────────────────────────────────────────
  /** Kick the ball towards a 3D target point. */
  kickTo(target, speed, { curve = 0, hot = 0, color = 0xffffff, type = 'shoot', shot = false, release = 0.1, after = null, ground = false, lift: liftOverride = null } = {}) {
    if (!this.hasBall && type !== 'volley' && type !== 'header') return false;
    const ball = this.match.ball;
    const fire = () => {
      if (type !== 'volley' && type !== 'header' && ball.owner !== this) return;
      this.holding = false;
      v1.set(target.x - ball.pos.x, 0, target.z - ball.pos.z);
      const D = Math.max(0.5, v1.length());
      let lift;
      if (Number.isFinite(liftOverride)) lift = liftOverride;
      else if (ground) lift = 0.22;
      else {
        const t = D / speed;
        lift = clamp((target.y - ball.pos.y + 0.5 * PHYS.gravity * t * t) / t, 0, 16);
      }
      ball.kick(v1, speed, { lift, curve, hot, color, by: this, shot });
      this.cd.control = 0.35;
      const power = clamp((speed - 10) / 28, 0, 1);
      if (type === 'shoot' || type === 'volley') audio.kick(power); else audio.pass();
      this.match.onKick(this, { type, power, hot, color });
    };
    // face the target immediately for readability
    this.facing = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    if (release <= 0) { fire(); this.startAction(type, 0.38, { after }); }
    else this.startAction(type === 'header' ? 'header' : type === 'volley' ? 'volley' : type === 'pass' ? 'pass' : 'shoot', 0.42, { release, fn: fire, after, side: 1 });
    this.cd.kick = 0.45;
    return true;
  }

  passTo(mate, { lofted = false, through = false } = {}) {
    if (!this.hasBall) return false;
    const lead = clamp(mate.pos.distanceTo(this.pos) / 18, 0.15, 0.8) + (through ? 0.4 : 0);
    v2.copy(mate.pos).addScaledVector(mate.vel, lead);
    if (through) v2.z += mate.team.dir * 2.5;
    v2.x = clamp(v2.x, -FIELD.HW + 1, FIELD.HW - 1);
    v2.z = clamp(v2.z, -FIELD.HL + 1, FIELD.HL - 1);
    const D = v2.distanceTo(this.pos);
    const blocked = this.match.laneBlocked(this, v2);
    const loft = lofted || D > 24 || blocked;
    const target = v2.clone(); target.y = loft ? 1.0 : 0.25;
    const speed = loft ? clamp(13 + D * 0.32, 14, 26) : clamp(8.5 + D * 0.62, 9, 25) * this.passMul;
    this.stats.passes++;
    this.match.passTarget = mate; this.match.passTime = this.match.time;
    if (this.holding) return this.throwTo(target, Math.min(speed, 20));
    return this.kickTo(target, speed, { type: 'pass', ground: !loft, release: 0.08 });
  }

  throwTo(target, speed) {
    const ball = this.match.ball;
    this.facing = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.startAction('throw', 0.45, {
      release: 0.22,
      fn: () => {
        if (ball.owner !== this) return;
        this.holding = false;
        v1.set(target.x - ball.pos.x, 0, target.z - ball.pos.z);
        const D = v1.length(), t = D / speed;
        ball.kick(v1, speed, { lift: clamp((0.4 - ball.pos.y + 0.5 * PHYS.gravity * t * t) / t, 0, 10), by: this });
        this.cd.control = 0.4;
        audio.pass();
      },
    });
    return true;
  }

  tackle() {
    if (!this.canAct() || this.cd.tackle > 0 || this.hasBall) return false;
    const holder = this.match.ball.owner;
    if (holder && holder.holding && holder.team !== this.team) return false; // a keeper in his hands is untouchable
    if (this.isGK) return this.dive();
    const d = this.dir;
    const sp = Math.max(this.speed + 3.5, 8.5);
    this.vel.set(d.x * sp, 0, d.z * sp);
    this.startAction('tackle', 0.55, { hit: false, after: () => { if (!this.action) this.startAction('getup', 0.28); } });
    this.cd.tackle = this.buff?.id === 'ironwall' ? 0.5 : 1.05;
    this.stamina = Math.max(0, this.stamina - 0.06);
    audio.tackle();
    this.match.fx.burst(v1.copy(this.pos).setY(0.1), 0x9fdc8f, 10, 4, 0.18, 0.5, 6, 0.5);
    return true;
  }

  dive(dirX, dirZ) {
    if (!this.canAct()) return false;
    const ball = this.match.ball;
    let dx = dirX, dz = dirZ;
    if (dx === undefined) {
      // dive towards the ball, or along the movement intent
      if (Math.hypot(this.intent.x, this.intent.z) > 0.3) { dx = this.intent.x; dz = this.intent.z; }
      else { dx = ball.pos.x - this.pos.x; dz = ball.pos.z - this.pos.z; }
    }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // local side: + = towards local +x
    const lx = dx * Math.cos(this.facing) - dz * Math.sin(this.facing);
    this.vel.set(dx * 8.2, 0, dz * 8.2);
    if (ball.pos.y > 1.2) { this.vy = 3.2; this.grounded = false; }
    this.startAction('dive', 0.85, { side: lx >= 0 ? 1 : -1, after: () => { if (!this.action) this.startAction('getup', 0.35); } });
    this.cd.tackle = 1.2;
    audio.whoosh();
    return true;
  }

  dash(dx, dz) {
    if (!this.canAct() || this.cd.dash > 0 || this.stamina < 0.08) return false;
    let l = Math.hypot(dx, dz);
    if (l < 0.2) { dx = Math.sin(this.facing); dz = Math.cos(this.facing); l = 1; }
    dx /= l; dz /= l;
    const sp = this.baseSpeed * 1.9;
    this.vel.set(dx * sp, 0, dz * sp);
    this.facing = Math.atan2(dx, dz);
    const spin = this.hasBall && Math.random() < 0.5 ? (Math.random() < 0.5 ? 1 : -1) : 0;
    this.startAction('dash', 0.32, { spin, side: Math.random() < 0.5 ? 1 : -1 });
    this.dodge = 0.3 + this.drbMul * 0.18;
    this.cd.dash = 1.0;
    this.stamina = Math.max(0, this.stamina - 0.08);
    audio.whoosh();
    this.match.fx.ring(v1.copy(this.pos).setY(0.05), this.char.ability.color, 1.6, 0.35);
    return true;
  }

  jump() {
    if (!this.grounded || (this.action && this.action.type !== 'dash')) return false;
    this.vy = this.buff?.id === 'thunder' ? 9 : PHYS.jumpV;
    this.grounded = false;
    audio.jump();
    return true;
  }

  header(target) {
    if (this.cd.header > 0) return false;
    this.cd.header = 0.5;
    return this.kickTo(target, 15, { type: 'header', release: 0 });
  }

  volley(target, power = 1) {
    return this.kickTo(target, (20 + power * 14) * this.shotMul, { type: 'volley', release: 0, shot: true });
  }

  /** Activate the character's signature ability. */
  useSpecial() {
    if (this.energy < 1 || this.stun > 0 || (this.action && this.action.type !== 'dash')) return false;
    const ab = this.char.ability;
    this.energy = 0;
    this.match.onSpecial(this, ab);
    switch (ab.id) {
      case 'storm': this.buff = { id: 'storm', t: 5 }; this.stamina = 1; break;
      case 'phantom': this.buff = { id: 'phantom', t: 4.5 }; break;
      case 'ironwall': this.buff = { id: 'ironwall', t: 6 }; break;
      case 'thunder':
        this.buff = { id: 'thunder', t: 1.5 };
        if (this.hasBall) {
          this.vy = 8.5; this.grounded = false;
          this.cd.control = 0.7;
          this.match.ball.owner = null; this.match.ball.vel.set(0, 8.8, 0); this.match.ball.pos.copy(this.pos).addScaledVector(this.dir, 0.4).setY(0.6);
          this.startAction('power', 0.48, { after: () => this.fireSpecialShot() });
        } else this.primed = { id: 'thunder', t: 10 };
        break;
      default: // meteor / eagle: charged signature shot
        if (this.hasBall) this.startAction('power', 0.5, { after: () => this.fireSpecialShot() });
        else this.primed = { id: ab.id, t: 10 };
    }
    return true;
  }

  fireSpecialShot() {
    const ab = this.char.ability;
    const target = this.match.shotTarget(this, 1, ab.id);
    this.stats.shots++;
    this.primed = null;
    if (ab.id === 'thunder') {
      this.startAction('volley', 0.4, { side: 1 });
      const ball = this.match.ball;
      v1.set(target.x - ball.pos.x, 0, target.z - ball.pos.z);
      const t = v1.length() / 40;
      ball.kick(v1, 40, { lift: clamp((target.y - ball.pos.y + 0.5 * PHYS.gravity * t * t) / t, -12, 10), hot: 2.5, color: ab.color, by: this, shot: true });
      this.cd.control = 0.4;
      audio.kick(1); audio.boom();
      this.match.onKick(this, { type: 'shoot', power: 1, hot: 2.5, color: ab.color, special: true });
      return;
    }
    if (!this.hasBall) return;
    const speed = ab.id === 'meteor' ? 44 : 31;
    const curve = ab.id === 'eagle' ? this.match.curveFor(this, target) : 0;
    this.kickTo(target, speed, { type: 'shoot', shot: true, hot: 2.5, color: ab.color, curve, release: 0 });
    audio.boom();
  }

  /** Shoot with a power 0..1 (from a held charge or AI decision). */
  shoot(power, curve = 0) {
    if (!this.hasBall || (this.action && this.action.type !== 'dash')) return false;
    if (this.primed && this.primed.id !== 'thunder') {
      this.match.onSpecial(this, this.char.ability, true);
      this.startAction('power', 0.35, { after: () => this.fireSpecialShot() });
      return true;
    }
    power = clamp(Number(power) || 0, 0, 1);
    const target = this.match.shotTarget(this, power);
    // A short tap must produce a gentle touch, not a full-speed shot.
    // The curve gives deliberate charging a much larger benefit.
    const charged = Math.pow(power, 1.9);
    const speed = (1.0 + charged * 20) * this.shotMul;
    // Keep low-power shots on the grass; only a charged shot gets real lift.
    const lift = 0.18 + Math.pow(power, 1.7) * 8.0;
    this.stats.shots++;
    return this.kickTo(target, speed, {
      type: 'shoot', shot: true, curve,
      hot: power > 0.92 ? 0.9 : 0,
      color: 0xbfefff, release: 0.1, lift,
    });
  }

  loseBall(stunTime = 0.65) {
    this.holding = false;
    this.stun = stunTime;
    this.charge = 0;
    this.startAction('stumble', stunTime);
  }

  // ── simulation ───────────────────────────────────────────
  update(dt) {
    const m = this.match, ball = m.ball;
    this.time += dt;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.dodge = Math.max(0, this.dodge - dt);
    if (this.buff) { this.buff.t -= dt; if (this.buff.t <= 0) this.buff = null; }
    if (this.primed) { this.primed.t -= dt; if (this.primed.t <= 0) this.primed = null; }
    if (this.buff?.id === 'phantom') this.dodge = Math.max(this.dodge, 0.1);
    this.energy = Math.min(1, this.energy + dt * (this.isHuman ? 0.035 : 0.028));

    // action timeline
    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.fn && !a.released && a.t >= a.release) { a.released = true; a.fn(); }
      if (a.type === 'tackle') this._tackleCheck(a);
      if (a.type === 'dive') m.gkReach(this);
      if (a.t >= a.dur) { this.action = null; if (a.after) a.after(); }
    }

    // desired velocity
    let maxSp = this.baseSpeed;
    const im = Math.hypot(this.intent.x, this.intent.z);
    const storm = this.buff?.id === 'storm';
    if (this.stamina <= 0.01) this.exhausted = true;
    if (this.exhausted && this.stamina >= 0.3) this.exhausted = false;
    this.sprinting = this.intent.sprint && im > 0.3 && !this.exhausted && (this.stamina > 0.04 || storm) && !this.charge;
    if (this.sprinting) {
      maxSp *= 1.38;
      if (!storm) this.stamina = Math.max(0, this.stamina - dt * (this.hasBall ? 0.4 : 0.34));
    } else this.stamina = Math.min(1, this.stamina + dt * (im < 0.1 ? 0.2 : 0.11));
    if (this.hasBall) maxSp *= 0.86 + this.drbMul * 0.08;
    if (this.charge > 0) maxSp *= 0.55;
    if (storm) maxSp *= 1.35;
    if (this.buff?.id === 'phantom') maxSp *= 1.12;
    if (this.holding) maxSp *= 0.6;
    if (this.stun > 0) maxSp *= 0.2;

    let ctrl = 1, decay = 0;
    if (a) {
      switch (a.type) {
        case 'tackle': ctrl = 0; decay = a.t > 0.3 ? 6 : 1.8; break;
        case 'dash': ctrl = 0.15; decay = 1.2; break;
        case 'dive': ctrl = 0; decay = a.t > 0.4 ? 5 : 0.8; break;
        case 'shoot': case 'pass': case 'kick': ctrl = 0.35; break;
        case 'power': ctrl = 0; decay = 8; break;
        case 'down': ctrl = 0; decay = 8; break;
        case 'volley': case 'header': ctrl = 0.3; break;
        default: ctrl = 0.25;
      }
    }
    if (decay) { const f = Math.max(0, 1 - decay * dt); this.vel.x *= f; this.vel.z *= f; }
    if (ctrl > 0) {
      const dx = this.intent.x * maxSp * ctrl, dz = this.intent.z * maxSp * ctrl;
      const accel = (this.hasBall ? 20 : 27) * (ctrl < 1 ? 0.5 : 1);
      let ex = dx - this.vel.x, ez = dz - this.vel.z;
      const el = Math.hypot(ex, ez), maxD = accel * dt;
      if (el > maxD) { ex *= maxD / el; ez *= maxD / el; }
      this.vel.x += ex; this.vel.z += ez;
    }

    // vertical
    if (!this.grounded) {
      this.vy -= PHYS.playerGravity * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.grounded = true; }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // arena bounds (keepers may step onto their goal line)
    const lim = FIELD.HL - (this.isGK ? 0.25 : 0.45);
    this.pos.x = clamp(this.pos.x, -FIELD.HW + 0.45, FIELD.HW - 0.45);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    // facing
    if (!a || a.type === 'dash' || a.type === 'getup' || a.type === 'stumble') {
      let targetF = null;
      if (this.intent.face !== null) targetF = this.intent.face;
      else if (this.speed > 0.6) targetF = Math.atan2(this.vel.x, this.vel.z);
      if (targetF !== null) {
        const turn = (this.hasBall ? 11 : 14) * dt;
        this.facing += clamp(angDiff(this.facing, targetF), -turn, turn);
      }
    }

    this.updateNetworkVisual(dt);
  }

  // Render-only update used by network guests. It advances the rig animation
  // without running local physics, so authoritative positions stay host-owned.
  updateNetworkVisual(dt = 0) {
    const m = this.match, a = this.action;
    // glide toward the last host position instead of teleporting 20 times a second
    const tg = this._netTarget;
    if (tg && dt > 0) {
      if (this.pos.distanceTo(_v.set(tg[0], tg[1], tg[2])) > 6) this.pos.set(tg[0], tg[1], tg[2]);
      else { const k = Math.min(1, dt * 16); this.pos.x += (tg[0] - this.pos.x) * k; this.pos.y += (tg[1] - this.pos.y) * k; this.pos.z += (tg[2] - this.pos.z) * k; }
    }
    if (this.sprinting && this.speed > 7 && m.fxOn && dt > 0) m.fx.speedStreak(this.pos, this.vel, this.isUser ? 0xbfefff : 0xffffff);
    if (a?.type === 'dash' || this.buff?.id === 'phantom') {
      this.ghostT -= dt;
      if (this.ghostT <= 0 && dt > 0) { this.ghostT = 0.06; m.fx.ghost(this.pos, this.facing, this.char.ability.color); }
    }
    if ((this.buff || this.primed) && dt > 0) m.fx.aura(this.pos, this.char.ability.color);

    const r = this.rig.root;
    r.position.copy(this.pos);
    r.rotation.y = this.facing;
    animateCharacter(this.rig, {
      dt, time: this.time, speed: this.speed, sprint: this.sprinting, airborne: !this.grounded && (!a || a.type === 'dash'),
      action: this.action, charging: this.charge, celebrate: m.celebrating === this,
    });
    if (this.action?.type === 'catch' || this.holding) {
      this.rig.armL.shoulder.rotation.x = -1.3; this.rig.armR.shoulder.rotation.x = -1.3;
    }
    const showRing = this.isHuman || this.hasBall;
    this.ring.position.set(this.pos.x, 0.03, this.pos.z);
    this.ring.material.opacity += ((showRing ? 0.85 : 0) - this.ring.material.opacity) * Math.min(1, dt * 8);
    if (this.hasBall && !this.isUser) this.ring.material.color.set(this.team.def.css);
    if (this.marker) {
      this.marker.position.set(this.pos.x, this.pos.y + 2.25 + Math.sin(this.time * 4) * 0.06, this.pos.z);
      this.marker.rotation.y += dt * 2;
    }
  }

  _tackleCheck(a) {
    if (a.hit || a.t < 0.04 || a.t > 0.42) return;
    const m = this.match, ball = m.ball;
    const iron = this.buff?.id === 'ironwall';
    const reach = 1.25 * (iron ? 1.8 : 1) * Math.sqrt(this.defMul);
    const foot = v1.copy(this.pos).addScaledVector(this.dir, 0.6);
    const owner = ball.owner;
    if (owner && owner.team !== this.team) {
      const dBall = Math.hypot(ball.pos.x - foot.x, ball.pos.z - foot.z);
      const dBody = Math.hypot(owner.pos.x - foot.x, owner.pos.z - foot.z);
      if (dBall < reach || dBody < reach * 0.8) {
        a.hit = true;
        if (owner.dodge > 0 && !iron) { m.onDodge(owner, this); return; }
        if (owner.holding) return; // can't tackle a keeper holding the ball
        m.onTackle(this, owner);
        owner.loseBall(0.7);
        this.energy = Math.min(1, this.energy + 0.12);
        this.stats.tackles++;
        if (iron || Math.random() < 0.5 * this.defMul) {
          m.givePossession(this);
        } else {
          v2.copy(this.dir).multiplyScalar(1).add(v3.set(Math.random() - 0.5, 0, Math.random() - 0.5));
          ball.kick(v2, 6 + Math.random() * 3, { lift: 1.5, by: this });
          this.cd.control = 0.1;
          owner.cd.control = 0.8;
        }
      }
    } else if (!owner) {
      const d = Math.hypot(ball.pos.x - foot.x, ball.pos.z - foot.z);
      if (d < 1.1 && ball.pos.y < 0.8) {
        a.hit = true;
        m.givePossession(this);
      }
    }
  }

  dispose() {
    this.match.scene.remove(this.rig.root, this.ring);
    if (this.marker) this.match.scene.remove(this.marker);
  }
}

export { angDiff, clamp };
