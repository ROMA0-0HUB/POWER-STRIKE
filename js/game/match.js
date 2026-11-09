// Match orchestration: teams, kickoffs, possession, captures & saves, goals,
// clock, golden goal and the final result.
import * as THREE from '../vendor/three.module.min.js';
import { FIELD, PHYS, POSITIONS, TEAMS, CHARACTERS, DIFFICULTY, rolesForSize, MATCH_DEFAULTS } from '../config.js';
import { Player } from './player.js';
import { Ball } from './ball.js';
import { updateAI } from './ai.js';
import { audio } from '../audio.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

const MARK_MAP = { DF: 'ST', LW: 'RW', RW: 'LW', ST: 'DF' };

export class Match {
  /**
   * opts: { scene, stadium, fx, cam, settings, user: { role, char, look, name }, lineup: { [role]: botName }, hooks }
   */
  constructor(opts) {
    this.scene = opts.scene;
    this.stadium = opts.stadium;
    this.fx = opts.fx;
    this.cam = opts.cam;
    this.hooks = opts.hooks;
    this.remoteInput = opts.remoteInput || null;
    this.networkGuest = !!opts.networkGuest;
    this.net = opts.net || null;          // online: { isHost }
    this.ballAuth = true;                 // does this client simulate the ball right now?
    this._ballTarget = null;
    this.userTeamIndex = opts.userTeamIndex ?? 0;
    this.settings = opts.settings;
    this.quality = opts.settings.quality;
    this.fxOn = true;
    this.diff = DIFFICULTY[opts.settings.difficulty] || DIFFICULTY.normal;
    this.time = 0;
    this.clock = opts.settings.duration || MATCH_DEFAULTS.duration;
    this.golden = false;
    this.phase = 'countdown';
    this.phaseT = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.celebrating = null;
    this.passRequest = null;
    this.passTarget = null;
    this.lastPossession = null;
    this.possession = [0, 0];
    this.shots = [0, 0];
    this.events = [];

    this.ball = new Ball(this.scene);
    this.ball.onEvent = (type, k) => this._ballEvent(type, k);

    this.training = !!opts.training;
    const onlinePlayers = opts.networkPlayers || null;
    const onlineCount = Math.max(1, Math.min(5, Number(opts.settings.onlinePlayersPerTeam) || 1));
    const outfieldRoles = ['ST', 'DF', 'LW', 'RW', 'ST'];
    const roles = this.training ? [opts.user.role] : onlinePlayers
      ? ['GK', ...outfieldRoles.slice(0, onlineCount)]
      : rolesForSize(opts.settings.teamSize || 5);
    this.teams = TEAMS.map((def, i) => ({
      index: i, def, dir: i === 0 ? -1 : 1, score: 0, players: [],
      get attackZ() { return this.dir * FIELD.HL; },
      get ownZ() { return -this.dir * FIELD.HL; },
    }));
    const pool = [...CHARACTERS];
    const pick = (exclude) => {
      const c = pool.filter((q) => q.id !== exclude);
      return c[(Math.random() * c.length) | 0];
    };
    for (const team of this.teams) {
      if (this.training && team.index === 1) continue; // empty stadium for practice
      for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
        const role = roles[roleIndex];
        const userTeamIndex = opts.userTeamIndex ?? 0;
        const descriptor = onlinePlayers
          ? (role === 'GK' ? null : onlinePlayers.filter((m) => m.team === team.index)[roleIndex - 1]?.descriptor)
          : null;
        const isUser = onlinePlayers ? !!descriptor?.isLocal : team.index === userTeamIndex && role === opts.user.role;
        const isRemote = onlinePlayers ? !!descriptor && !isUser : team.index !== userTeamIndex && !!opts.remoteUser && role === opts.remoteUser.role;
        const chosen = descriptor || (isUser ? opts.user : isRemote ? opts.remoteUser : null);
        const char = chosen?.char || pick(opts.user.char.id);
        const look = chosen?.look || {
          hair: char.hair, hairStyle: char.hairStyle, skin: char.skin, eye: char.eye,
          boots: [0xffffff, 0x111111, 0xffd23f][(Math.random() * 3) | 0], number: role === 'GK' ? 1 : 2 + ((Math.random() * 20) | 0),
        };
        const name = chosen?.name || (team.index === 0 ? (opts.lineup?.[role] || char.latin) : char.latin.split(' ')[0]);
        const speedMul = team.index === 1 ? this.diff.speed : 1;
        const p = new Player(this, { team, role, char, look, isUser, isRemote, name, speedMul });
        if (descriptor) p.networkUid = descriptor.uid;
        team.players.push(p);
        if (isUser) this.user = p;
      }
    }
    this.players = [...this.teams[0].players, ...this.teams[1].players];
    if (this.net) for (const p of this.players) p.isGhost = !!(p.isRemote || (!this.net.isHost && !p.isUser));
    // marking assignments
    for (const team of this.teams) {
      const other = this.other(team);
      for (const p of team.players) p.ai.mark = other.players.find((q) => q.role === MARK_MAP[p.role]) || null;
    }
    // per spec: the opponents start the match in possession
    this.kickoff(this.teams[1].players.length ? this.teams[1] : this.teams[0]);
  }

  other(team) { return this.teams[1 - team.index]; }

  /** Online: the local human holding the ball, or the host when the ball is free or held by an AI. */
  _ballAuthority() {
    const o = this.ball.owner;
    if (!o) return this.net.isHost;
    return !!o.isUser || (this.net.isHost && !o.isGhost);
  }
  aiDiff(team) { return team.index === 1 ? this.diff : DIFFICULTY.normal; }

  // ── flow ──────────────────────────────────────────────────
  kickoff(team) {
    this.phase = 'countdown';
    this.phaseT = MATCH_DEFAULTS.kickoffCountdown;
    this.celebrating = null;
    this.kickoffTeam = team;
    this.ball.reset(0, 0);
    this.passRequest = null;
    this._placeKickoff(team);
    const st = team.players.find((p) => p.role === 'ST') || team.players.find((p) => !p.isGK);
    this.givePossession(st, false, true);
    this.lastPossession = team;
    this.hooks.kickoff?.(team);
  }

  _placeKickoff(team) {
    for (const t of this.teams) {
      for (const p of t.players) {
        const b = POSITIONS[p.role].base;
        let f = Math.min(b.f * 0.9, -2.5);
        if (p.isGK) f = -FIELD.HL + 1.2;
        if (t !== team && !p.isGK) f = Math.min(f, -7.5);
        const sameRole = t.players.filter((q) => q.role === p.role);
        const duplicateOffset = (sameRole.indexOf(p) - (sameRole.length - 1) / 2) * 5.2;
        const lat = clamp(b.x + duplicateOffset, -FIELD.HW + 3, FIELD.HW - 3);
        p.place(-t.dir * lat, f * t.dir, t.dir > 0 ? 0 : Math.PI);
        p.stamina = Math.max(p.stamina, 0.7);
      }
    }
    const st = team.players.find((p) => p.role === 'ST') || team.players.find((p) => !p.isGK);
    st.place(0, -team.dir * 0.65, team.dir > 0 ? 0 : Math.PI);
  }

  update(rawDt, userInput) {
    // slow motion
    if (this.slowT > 0) { this.slowT -= rawDt; this.timeScale += (0.3 - this.timeScale) * Math.min(1, rawDt * 12); }
    else this.timeScale += (1 - this.timeScale) * Math.min(1, rawDt * 5);
    const dt = rawDt * this.timeScale;
    this.time += dt;

    const clockOwner = !this.net || this.net.isHost;   // the host is the referee
    if (!clockOwner) {
      // clients receive phase and clock from the host
    } else if (this.phase === 'countdown') {
      const before = Math.ceil(this.phaseT);
      this.phaseT -= rawDt;
      const after = Math.ceil(this.phaseT);
      if (after !== before && after > 0) { this.hooks.countdown?.(after); audio.countdown(false); }
      if (this.phaseT <= 0) { this.phase = 'play'; this.hooks.countdown?.(0); audio.whistle(); }
    } else if (this.phase === 'goal') {
      this.phaseT -= rawDt;
      if (this.phaseT <= 0) this.kickoff(this.concededTeam);
    } else if (this.phase === 'play') {
      if (!this.training) this.clock -= dt;
      if (!this.training && this.clock <= 0) {
        this.clock = 0;
        if (this.teams[0].score === this.teams[1].score && !this.golden && this.settings.goldenGoal !== false) {
          this.golden = true;
          this.clock = MATCH_DEFAULTS.goldenGoal;
          this.hooks.toast?.('هدف ذهبي! أول هدف يحسم المباراة', '#ffd23f', 2.5);
          audio.whistle(true);
        } else return this.finish();
      }
    }

    // players
    for (const p of this.players) {
      if (p.isGhost) continue;   // another player's character: its owner moves it
      if (p.isUser) userInput?.(p, dt);
      else if (p.isRemote) this.remoteInput?.(p, dt, this);
      else updateAI(p, this, dt);
      if (this.phase === 'countdown' && !p.isUser) p.setIntent(0, 0, false, p.intent.face);
      if (this.phase === 'countdown' && p.isUser) {
        // during countdown the user can only look around
        p.intent.x = 0; p.intent.z = 0;
      }
      p.update(dt);
    }
    this._separate();
    this.ballAuth = !this.net || this._ballAuthority();
    if (this.ballAuth) { this._ballTarget = null; this.ball.update(dt, this.time); }
    if (this.phase === 'play' && clockOwner) {
      if (this.ballAuth) { this._captures(); this._checkGoal(); }
      if (this.ball.owner) this.possession[this.ball.owner.team.index] += dt;
    }
    // crowd excitement based on how close the ball is to a goal
    const near = 1 - Math.min(1, (FIELD.HL - Math.abs(this.ball.pos.z)) / 14);
    this.excite = this.phase === 'goal' ? 1 : 0.15 + near * 0.5 + (this.ball.hot > 0 ? 0.3 : 0);
    audio.setCrowd(0.25 + this.excite * 0.6);
  }

  finish() {
    this.phase = 'ended';
    audio.whistle(true);
    const [a, b] = this.teams;
    const mine = this.teams[this.userTeamIndex].score;
    const theirs = this.teams[1 - this.userTeamIndex].score;
    const result = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
    const tot = this.possession[0] + this.possession[1] || 1;
    this.hooks.end?.({
      result, score: [a.score, b.score],
      possession: [Math.round((this.possession[0] / tot) * 100), Math.round((this.possession[1] / tot) * 100)],
      shots: this.shots, user: this.user.stats, events: this.events,
    });
  }

  // ── possession & captures ────────────────────────────────
  givePossession(p, hold = false, silent = false) {
    const b = this.ball;
    const prevTeam = b.owner ? b.owner.team : b.lastTouch?.team;
    b.owner = p; b.vel.set(0, 0, 0); b.spin.set(0, 0, 0); b.hot = 0; b.lastTouch = p; b.inGoal = 0;
    p.holding = hold && p.isGK;
    p.ai.hold = 0;
    if (hold) p.startAction('catch', 0.35);
    if (this.passTarget === p && this.time - this.passTime < 4) {
      const passer = this.players.find((q) => q.team === p.team && q !== p && q.stats.passes > 0);
      if (passer) passer.energy = Math.min(1, passer.energy + 0.05);
      p.energy = Math.min(1, p.energy + 0.03);
    }
    this.passTarget = null;
    this.lastPossession = p.team;
    if (!silent) {
      audio.touch();
      if (prevTeam && prevTeam !== p.team) {
        if (p.team.index === 0) this.hooks.toast?.(p.isUser ? 'افتكاك ناجح!' : 'استعدنا الكرة', '#5ff6ff', 1.1);
        else if (prevTeam.index === 0 && b.lastTouch?.isUser) {}
      }
      if (p.isUser) this.hooks.possess?.();
    }
  }

  _captures() {
    const b = this.ball;
    if (b.owner) return;
    let best = null, bestD = Infinity, bestReach = 0;
    for (const p of this.players) {
      if (p.cd.control > 0 || p.stun > 0) continue;
      const a = p.action?.type;
      if (a === 'tackle' || a === 'power') continue;
      const inBox = p.isGK && this._inOwnBox(p);
      const diving = a === 'dive';
      const reach = diving ? 1.45 : inBox ? 0.95 : 0.72;
      const maxY = diving ? 2.6 : inBox ? 2.45 : 1.05;
      const fx = p.pos.x + Math.sin(p.facing) * (inBox ? 0.1 : 0.32);
      const fz = p.pos.z + Math.cos(p.facing) * (inBox ? 0.1 : 0.32);
      const dh = Math.hypot(b.pos.x - fx, b.pos.z - fz);
      const rel = b.pos.y - p.pos.y;
      if (dh < reach && rel < maxY && rel > -0.3 && dh < bestD) { best = p; bestD = dh; bestReach = inBox || diving; }
    }
    if (!best) return;
    const sp = b.speed;
    const shotOnGoal = b.shotBy && b.shotBy.team !== best.team;
    if (bestReach) {
      // goalkeeper save
      const skill = best.isUser ? 0.9 : this.aiDiff(best.team).gk;
      const catchLimit = 22 + skill * 12 - (b.hot > 0 ? 9 : 0);
      if (sp > catchLimit || (b.hot > 0 && Math.random() > skill * 0.6)) {
        // parry away from goal
        const dir = best.team.dir;
        b.vel.set(b.vel.x * 0.25 + (Math.random() - 0.5) * 8, Math.abs(b.vel.y) * 0.3 + 3 + Math.random() * 3, Math.abs(b.vel.z) * 0.35 * dir);
        b.hot = 0;
        best.cd.control = 0.6;
        b.lastTouch = best;
        if (shotOnGoal) this._save(best, false);
        audio.save();
        return;
      }
      if (shotOnGoal) this._save(best, true);
      this.givePossession(best, true);
      audio.save();
      return;
    }
    // outfield first touch: very fast balls deflect off the body
    if (sp > 24 || (sp > 17 && b.pos.y - best.pos.y > 0.55)) {
      b.vel.multiplyScalar(-0.25); b.vel.y = Math.abs(b.vel.y) + 1.5;
      b.vel.x += (Math.random() - 0.5) * 4; b.vel.z += (Math.random() - 0.5) * 4;
      b.hot = 0; b.lastTouch = best; best.cd.control = 0.35;
      audio.bounce(0.4);
      this.fx.burst(v1.copy(b.pos), 0xffffff, 8, 4, 0.2, 0.3);
      return;
    }
    this.givePossession(best);
  }

  _save(gk, caught) {
    gk.stats.saves++;
    gk.energy = Math.min(1, gk.energy + 0.15);
    this.hooks.toast?.(caught ? `تصدٍّ رائع — ${gk.name}` : `${gk.name} يبعد الكرة!`, gk.team.index === 0 ? '#5ff6ff' : '#ff3352', 1.3);
    this.fx.ring(v1.copy(this.ball.pos), 0xffffff, 2.2, 0.45, true);
    audio.cheer(0.5);
  }

  gkReach() { /* reach during dives is handled in _captures */ }

  _inOwnBox(p) {
    const f = p.pos.z * -p.team.dir; // distance towards own goal
    return f > FIELD.HL - FIELD.boxL - 0.5 && Math.abs(p.pos.x) < FIELD.boxW / 2 + 0.5;
  }

  _separate() {
    const ps = this.players;
    const R2 = PHYS.playerR * 2;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (a.isGhost || b.isGhost) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < R2 && d > 0.0001) {
        const push = (R2 - d) / 2, nx = dx / d, nz = dz / d;
        // tacklers and dashers barge through more
        const wa = a.action?.type === 'tackle' ? 0.2 : 1, wb = b.action?.type === 'tackle' ? 0.2 : 1;
        a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa;
        b.pos.x += nx * push * wb; b.pos.z += nz * push * wb;
      }
    }
  }

  _checkGoal() {
    const b = this.ball;
    if (!b.inGoal) return;
    if (b.pos.z * b.inGoal < FIELD.HL + PHYS.ballR) return;
    const side = b.inGoal;
    const scoring = this.teams.find((t) => t.dir === side);
    const conceded = this.other(scoring);
    let scorer = b.lastTouch;
    const own = scorer && scorer.team !== scoring;
    if (own) {
      // an own goal does not count: the ball bounces back into play
      b.inGoal = 0;
      b.pos.z = side * (FIELD.HL - 0.8);
      b.vel.z = -side * Math.max(7, Math.abs(b.vel.z) * 0.6);
      b.vel.x *= 0.5;
      audio.bounce(0.5);
      return;
    }
    scoring.score++;
    if (scorer) scorer.stats.goals++;
    this.events.push({ t: this.clock, team: scoring.index, name: scorer?.name || '', own });
    this.phase = 'goal';
    this.phaseT = 3.6;
    this.concededTeam = conceded;
    this.celebrating = own ? null : scorer;
    this.slowT = 1.1;
    this.stadium.rippleNet(side, b.pos.x, b.pos.y);
    this.fx.confetti(v1.set(b.pos.x, 1, side * FIELD.HL));
    this.fx.ring(v1.set(b.pos.x, 1.2, side * FIELD.HL), scoring.index === 0 ? 0x5ff6ff : 0xff3352, 6, 0.9, true);
    audio.cheer(scoring.index === 0 ? 1.2 : 0.7);
    audio.net();
    audio.whistle();
    if (scoring.index === 1) audio.groan();
    this.hooks.goal?.({ team: scoring, scorer, own, golden: this.golden });
    this.hooks.shake?.(0.5);
    if (this.golden) { this.phaseT = 3.2; setTimeout(() => this.phase === 'goal' && this.finish(), 3000); }
  }

  _ballEvent(type, k) {
    if (type === 'bounce') audio.bounce(k * 0.4);
    if (type === 'post') { audio.post(); this.hooks.shake?.(0.25); this.hooks.toast?.('القائم!', '#ffffff', 0.9); audio.groan(); }
    if (type === 'wall') audio.bounce(k * 0.6);
    if (type === 'net') { if (k > 0.5) audio.net(); }
  }

  // ── events from players ─────────────────────────────────
  onKick(p, { type, power, hot, color, special }) {
    const pos = v1.copy(this.ball.pos);
    if (type === 'shoot' || type === 'volley') {
      this.shots[p.team.index]++;
      p.energy = Math.min(1, p.energy + 0.06);
      this.fx.ring(pos, hot ? color : 0xffffff, 1.2 + power * 1.8, 0.35, true, 0.8);
      this.fx.burst(pos, hot ? color : 0xdff6ff, 8 + power * 18, 5 + power * 6, 0.25, 0.4);
      this.fx.setTrail(hot ? color : p.team.index === 0 ? 0x5ff6ff : 0xff6a7a, hot ? 0.3 : 0.16);
      if (power > 0.75 || special) this.hooks.shake?.(special ? 0.7 : 0.28 * power);
      if (special) this.slowT = 0.35;
    } else {
      this.fx.setTrail(0xffffff, 0.1);
    }
  }

  onSpecial(p, ab, fromPrimed = false) {
    audio.special();
    this.fx.ring(v1.copy(p.pos).setY(0.05), ab.color, 4, 0.7);
    this.fx.burst(v1.copy(p.pos).setY(1), ab.color, 40, 7, 0.4, 0.8, 0, 0.6);
    if (!fromPrimed) this.hooks.special?.(p, ab);
    this.slowT = Math.max(this.slowT, 0.45);
  }

  onTackle(tackler, victim) {
    audio.steal();
    this.fx.burst(v1.copy(victim.pos).setY(0.6), 0xffffff, 14, 5, 0.25, 0.4);
    this.fx.ring(v1.copy(victim.pos).setY(0.05), tackler.team.index === 0 ? 0x5ff6ff : 0xff3352, 2.2, 0.4);
    if (tackler.isUser) this.hooks.shake?.(0.2);
    if (victim.isUser) this.hooks.toast?.('فقدت الكرة!', '#ff3352', 1);
  }

  onDodge(dodger, tackler) {
    this.fx.burst(v1.copy(dodger.pos).setY(1), dodger.char.ability.color, 16, 6, 0.3, 0.5);
    if (dodger.isUser) this.hooks.toast?.('مراوغة!', dodger.char.ability.color ? '#' + dodger.char.ability.color.toString(16).padStart(6, '0') : '#fff', 0.9);
    // the defender is left on the ground for 2.5 s, then gets back up
    tackler.stun = Math.max(tackler.stun, 2.5);
    tackler.vel.set(0, 0, 0);
    tackler.startAction('down', 2.5, { after: () => { if (!tackler.action) tackler.startAction('getup', 0.45); } });
  }

  requestPass(p) {
    this.passRequest = { player: p, t: this.time };
  }

  // ── queries used by AI / players ─────────────────────────
  nearestTo(list, pos) {
    let best = null, bd = Infinity;
    for (const q of list) { const d = q.pos.distanceTo(pos); if (d < bd) { bd = d; best = q; } }
    return best ? { pl: best, d: bd } : null;
  }
  nearestOpponent(p) { return this.nearestTo(this.other(p.team).players, p.pos); }

  /** Closest AI outfielder to the ball carrier — he presses. */
  presser(team) {
    if (this._presserCache?.t === this.time && this._presserCache.team === team) return this._presserCache.p;
    const owner = this.ball.owner;
    let best = null, bd = Infinity;
    for (const q of team.players) {
      if (q.isGK || q.isUser || q.isRemote) continue;
      const d = q.pos.distanceTo(owner ? owner.pos : this.ball.pos);
      if (d < bd) { bd = d; best = q; }
    }
    // if the user is already pressing, the AI presser holds a covering position instead
    if (this.user && this.user.team === team && owner) {
      const du = this.user.pos.distanceTo(owner.pos);
      if (du < 3.5 && du < bd) best = null;
    }
    this._presserCache = { t: this.time, team, p: best };
    return best;
  }

  /** Who on this team should chase a loose ball (AI only). */
  chaser(team) {
    const key = '_chaser' + team.index;
    if (this[key]?.t === this.time) return this[key].p;
    let best = null, bt = Infinity;
    for (const q of team.players) {
      if (q.isUser || q.isRemote || (q.isGK && !this._ballInBox(team))) continue;
      const ip = this.interceptPoint(q, v2);
      const t = q.pos.distanceTo(ip) / (q.baseSpeed * 1.3);
      if (t < bt) { bt = t; best = q; }
    }
    if (this.user && this.user.team === team) {
      const du = this.user.pos.distanceTo(this.ball.pos);
      if (du < 2.5) best = null;
    }
    this[key] = { t: this.time, p: best };
    return best;
  }

  _ballInBox(team) {
    const b = this.ball.pos;
    return b.z * -team.dir > FIELD.HL - FIELD.boxL && Math.abs(b.x) < FIELD.boxW / 2;
  }

  interceptPoint(p, out) {
    const b = this.ball;
    const sp = p.baseSpeed * 1.25;
    for (let t = 0; t <= 2.4; t += 0.12) {
      const k = (1 - Math.exp(-0.85 * t)) / 0.85;
      const x = clamp(b.pos.x + b.vel.x * k, -FIELD.HW + 0.5, FIELD.HW - 0.5);
      const z = clamp(b.pos.z + b.vel.z * k, -FIELD.HL + 0.5, FIELD.HL - 0.5);
      if (Math.hypot(x - p.pos.x, z - p.pos.z) / sp <= t) return out.set(x, 0, z);
    }
    const k = (1 - Math.exp(-0.85 * 2.4)) / 0.85;
    return out.set(clamp(b.pos.x + b.vel.x * k, -FIELD.HW + 0.5, FIELD.HW - 0.5), 0, clamp(b.pos.z + b.vel.z * k, -FIELD.HL + 0.5, FIELD.HL - 0.5));
  }

  laneBlocked(p, target) {
    const ax = p.pos.x, az = p.pos.z, bx = target.x - ax, bz = target.z - az;
    const L2 = bx * bx + bz * bz || 1;
    for (const o of this.other(p.team).players) {
      const t = clamp(((o.pos.x - ax) * bx + (o.pos.z - az) * bz) / L2, 0, 1);
      if (t < 0.08 || t > 0.95) continue;
      const cx = ax + bx * t, cz = az + bz * t;
      if (Math.hypot(o.pos.x - cx, o.pos.z - cz) < 1.25) return true;
    }
    return false;
  }

  bestPassOption(p) {
    const dir = p.team.dir;
    let best = null;
    for (const q of p.team.players) {
      if (q === p || q.stun > 0) continue;
      if (q.isGK && !p.isGK) continue;
      const d = q.pos.distanceTo(p.pos);
      if (d < 4 || d > 38) continue;
      const gain = ((q.pos.z - p.pos.z) * dir) / 20;
      const opp = this.nearestOpponent(q);
      const open = Math.min(1, (opp ? opp.d : 10) / 6);
      const lane = this.laneBlocked(p, q.pos) ? -0.5 : 0;
      const score = gain * 0.6 + open * 0.7 + lane + (q.isUser ? 0.3 : 0) - (d > 28 ? 0.3 : 0);
      if (!best || score > best.score) best = { mate: q, score, d };
    }
    return best;
  }

  /** User pass: choose the team-mate best aligned with the aim direction. */
  pickPassTarget(p, ax, az) {
    let best = null, bs = -Infinity;
    for (const q of p.team.players) {
      if (q === p) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
      const align = (dx * ax + dz * az) / d;
      const s = align * 2 - d / 30 - (q.isGK ? 0.6 : 0) - (this.laneBlocked(p, q.pos) ? 0.3 : 0);
      if (s > bs) { bs = s; best = q; }
    }
    return best;
  }

  /** Where a shot from player p should go. Users aim with the camera. */
  shotTarget(p, power, special = null) {
    const dir = p.team.dir;
    const gz = p.team.attackZ + dir * 0.6;
    const gw = FIELD.goalW / 2;
    if ((p.isUser && this.cam) || p.isRemote) {
      const f = p.isUser ? this.cam.forwardFlat : { x: Math.sin(p.facing), z: Math.cos(p.facing) };
      let ax = f.x, az = f.z;
      // If the aim faces away from goal, fall back to the player's facing.
      if (az * dir < 0.15) { ax = Math.sin(p.facing); az = Math.cos(p.facing); }
      if (az * dir > 0.15) {
        const t = (gz - p.pos.z) / az;
        let x = p.pos.x + ax * t;
        const dist = Math.hypot(x - p.pos.x, gz - p.pos.z);
        const assist = dist < 38 ? 0.65 : 0.2;
        const lim = gw - 0.5;
        if (Math.abs(x) > lim) x = x + (Math.sign(x) * lim - x) * assist * (Math.abs(x) < gw + 5 ? 1 : 0.4);
        const pitch = p.isUser ? this.cam.pitch : 0.42;
        let h = 0.35 + power * 1.2 + (0.42 - pitch) * 3.4;
        if (special) { h = Math.min(h, 1.9); x = clamp(x, -lim, lim); }
        return new THREE.Vector3(x, clamp(h, 0.25, 5), gz);
      }
      return new THREE.Vector3(p.pos.x + ax * 25, 0.6 + power * 3, p.pos.z + az * 25);
    }
    // AI: aim for the corner away from the keeper
    const gk = this.other(p.team).players.find((q) => q.isGK);
    let side = gk ? (gk.pos.x > 0 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.25) side = -side;
    const dist = Math.hypot(p.pos.x, p.pos.z - p.team.attackZ);
    const diff = this.aiDiff(p.team);
    const err = special ? 0.15 : diff.shotErr * (0.35 + dist / 28) * (1 - power * 0.25);
    const x = side * (gw - 0.7) + gauss() * err * 1.4;
    const h = special ? 0.8 + Math.random() * 0.8 : 0.3 + Math.random() * 1.8 + gauss() * err * 0.4;
    return new THREE.Vector3(x, clamp(h, 0.2, 4), gz);
  }

  /** Signature curve: offsets the target so the Magnus bend brings it back in. */
  curveFor(p, target) {
    const side = target.x > p.pos.x ? 1 : -1;
    const c = 7 * side;
    const speed = 31;
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z, D = Math.hypot(dx, dz) || 1;
    const disp = Math.min(6, (0.03 * Math.abs(c) * D * D) / speed);
    // magnus accel direction for spin (0,c,0) and velocity v: (c*vz, 0, -c*vx)
    const px = (dz / D) * Math.sign(c), pz = (-dx / D) * Math.sign(c);
    target.x -= px * disp; target.z -= pz * disp * 0.2;
    return c;
  }

  /** Compact authoritative state sent from the room host to the guest. */
  networkState() {
    const v = (q) => [q.x, q.y, q.z];
    return {
      at: Date.now(), time: this.time, clock: this.clock, phase: this.phase, phaseT: this.phaseT,
      golden: this.golden, scores: this.teams.map((t) => t.score),
      possession: [...this.possession], shots: [...this.shots], events: this.events.slice(-30),
      celebrating: this.celebrating ? this.players.indexOf(this.celebrating) : -1,
      players: this.players.map((p) => ({
        pos: v(p.pos), vel: v(p.vel), facing: p.facing, stamina: p.stamina,
        energy: p.energy, vy: p.vy, grounded: p.grounded, charge: p.charge, time: p.time,
        sprinting: p.sprinting, holding: p.holding,
        stats: { ...p.stats },
        action: p.action ? { type: p.action.type, t: p.action.t, dur: p.action.dur } : null,
      })),
      ball: {
        pos: v(this.ball.pos), vel: v(this.ball.vel), spin: v(this.ball.spin),
        owner: this.ball.owner ? this.players.indexOf(this.ball.owner) : -1,
        hot: this.ball.hot, hotColor: this.ball.hotColor, inGoal: this.ball.inGoal,
      },
    };
  }

  /** Apply host state on a guest. Guests never run local physics or AI. */
  applyNetworkState(state) {
    if (!state || !Array.isArray(state.players) || state.players.length !== this.players.length) return false;
    this.time = Number(state.time) || this.time;
    this.clock = Number(state.clock) || 0;
    this.phase = state.phase || this.phase;
    this.phaseT = Number(state.phaseT) || 0;
    this.golden = !!state.golden;
    if (Array.isArray(state.scores)) this.teams.forEach((t, i) => { t.score = Number(state.scores[i]) || 0; });
    if (Array.isArray(state.possession)) this.possession = [...state.possession];
    if (Array.isArray(state.shots)) this.shots = [...state.shots];
    if (Array.isArray(state.events)) this.events = [...state.events];
    this.celebrating = Number.isInteger(state.celebrating) && state.celebrating >= 0 ? this.players[state.celebrating] : null;
    this.players.forEach((p, i) => {
      const q = state.players[i]; if (!q) return;
      if (!p._netInit) { p.pos.set(...q.pos); p._netInit = true; }
      p._netTarget = q.pos; p.vel.set(...q.vel); p.facing = Number(q.facing) || 0;
      p.stamina = Number(q.stamina) || 0; p.energy = Number(q.energy) || 0;
      p.vy = Number(q.vy) || 0; p.grounded = !!q.grounded; p.charge = Number(q.charge) || 0;
      p.time = Number.isFinite(q.time) ? q.time : p.time;
      p.sprinting = !!q.sprinting; p.holding = !!q.holding;
      if (q.stats) p.stats = { ...p.stats, ...q.stats };
      if (q.action) p.action = { ...q.action, released: true }; else p.action = null;
      p.updateNetworkVisual(0);
    });
    const b = state.ball;
    if (b) {
      if (!this._ballNetInit) { this.ball.pos.set(...b.pos); this._ballNetInit = true; }
      this._ballTarget = b.pos; this.ball.vel.set(...b.vel); this.ball.spin.set(...b.spin);
      this.ball.owner = b.owner >= 0 ? this.players[b.owner] : null;
      this.ball.hot = Number(b.hot) || 0; this.ball.hotColor = Number(b.hotColor) || 0xffffff;
      this.ball.inGoal = Number(b.inGoal) || 0;
      this.ball._sync();
    }
    this.excite = this.phase === 'goal' ? 1 : 0.25;
    return true;
  }

  updateNetworkVisuals(dt) {
    if (!this.networkGuest) return;
    if (this._ballTarget && dt > 0) {
      const t = this._ballTarget, k = Math.min(1, dt * 16), b = this.ball.pos;
      b.x += (t[0] - b.x) * k; b.y += (t[1] - b.y) * k; b.z += (t[2] - b.z) * k;
    }
    for (const p of this.players) if (p.isGhost) p.updateNetworkVisual(dt);
    this.ball._sync();
  }

  dispose() {
    for (const p of this.players) p.dispose();
    this.scene.remove(this.ball.mesh, this.ball.shadow);
  }
}
