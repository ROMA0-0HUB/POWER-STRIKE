// Online match sync. Authority is split so that nobody waits for anybody:
//   • Each human moves and animates their OWN character locally.
//   • The host also moves the AI players (they belong to the host).
//   • The ball belongs to whoever holds it (the holder's client simulates it).
//     A free ball belongs to the host. Ownership changes are decided by the host.
//   • The host is the referee: score, clock, phases, goals, tackles and kick-offs.
// Everything travels over the WebRTC mesh (hub), not through the host.
const R = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export class MatchSync {
  constructor({ hub, isHost, myUid, hostUid, hooks }) {
    this.hub = hub;
    this.isHost = isHost;
    this.myUid = myUid;
    this.hostUid = hostUid;
    this.origHooks = hooks;
    this.m = null;
    this.sendAt = 0;
    this.gameAt = 0;
    this.prevOwner = null;
    this.prevStun = [];
    this.closed = false;
    this.hooks = isHost ? this._wrapHooks(hooks) : hooks;
    this.off = [
      hub.onState((msg, from) => this._onState(msg, from)),
      hub.onEvent((msg, from) => this._onEvent(msg, from)),
    ];
  }

  attach(match) {
    this.m = match;
    this.prevOwner = match.ball.owner;
    this.prevStun = match.players.map((p) => p.stun || 0);
    const me = match.user, self = this;
    if (!me || this.isHost) return;   // the host resolves tackles itself
    // clients only animate a tackle; the host decides who got the ball
    me.tackle = function () {
      if (this.cd.tackle > 0 || this.stun > 0) return false;
      this.cd.tackle = 0.9;
      this.startAction('tackle', 0.5);
      self._send({ t: 'act', a: 'tackle', i: match.players.indexOf(me) });
      return true;
    };
    const orig = match.requestPass.bind(match);
    match.requestPass = (p) => {
      if (p === me) self._send({ t: 'act', a: 'req', i: match.players.indexOf(p) });
      else orig(p);
    };
  }

  // ── outgoing ──────────────────────────────────────────────
  _send(obj) { this.hub.sendEvent(obj); }

  _pack(p) {
    return {
      p: [R(p.pos.x), R(p.pos.y), R(p.pos.z)],
      v: [R(p.vel.x, 2), R(p.vel.y, 2), R(p.vel.z, 2)],
      f: R(p.facing), gr: p.grounded ? 1 : 0, a: p.action ? p.action.type : '',
      ch: R(p.charge || 0, 2), sp: p.sprinting ? 1 : 0, hd: p.holding ? 1 : 0,
      t: R(p.time, 2), s: R(p.stun || 0, 2), e: R(p.energy || 0), st: R(p.stamina || 0),
    };
  }

  _packBall(b) {
    return { p: [R(b.pos.x), R(b.pos.y), R(b.pos.z)], v: [R(b.vel.x, 2), R(b.vel.y, 2), R(b.vel.z, 2)], h: b.hot, c: b.hotColor, g: b.inGoal ? 1 : 0 };
  }

  _sendKick() {
    const m = this.m, b = m.ball, me = m.user, i = m.players.indexOf(me);
    const shot = b.shotBy === me;
    this._send({
      t: 'kick', i, p: [R(b.pos.x), R(b.pos.y), R(b.pos.z)], v: [R(b.vel.x, 2), R(b.vel.y, 2), R(b.vel.z, 2)],
      h: b.hot, c: b.hotColor, sh: shot ? 1 : 0,
      pa: m.passTarget ? 1 : 0, pt: m.players.indexOf(m.passTarget),
    });
  }

  /** Called once per frame after match.update(). */
  tick(now) {
    const m = this.m;
    if (!m || this.closed) return;
    const owner = m.ball.owner;

    // a kick or pass released the ball we were holding
    if (this.prevOwner === m.user && owner !== m.user) this._sendKick();
    // the host announces every ownership change
    if (this.isHost && owner !== this.prevOwner) this._send({ t: 'own', i: owner ? m.players.indexOf(owner) : -1 });
    this.prevOwner = owner;

    // the host announces new stuns (tackles, dodges) so the victim's client can react
    m.players.forEach((p, i) => {
      const s = p.stun || 0;
      if (this.isHost && s > 0 && this.prevStun[i] <= 0) this._send({ t: 'stun', i, d: R(s, 2) });
      this.prevStun[i] = s;
    });

    // state at 20 Hz: the entities this client controls
    if (now - this.sendAt >= 50) {
      this.sendAt = now;
      const pl = {};
      m.players.forEach((p, i) => { if (p.isUser || (this.isHost && !p.isGhost)) pl[i] = this._pack(p); });
      const msg = { t: 's', i: pl };
      if (m.ballAuth) msg.b = this._packBall(m.ball);
      this.hub.sendState(msg);
    }

    // referee data at 5 Hz (host only)
    if (this.isHost && now - this.gameAt >= 200) {
      this.gameAt = now;
      this._send({
        t: 'g', ph: m.phase, pt: m.phaseT, ck: m.clock, gd: m.golden ? 1 : 0,
        sc: m.teams.map((t) => t.score), po: [...m.possession], sh: [...m.shots],
        sv: m.players.map((p) => [p.stats.goals || 0, p.stats.saves || 0]),
      });
    }
  }

  // ── incoming state ────────────────────────────────────────
  _onState(msg, from) {
    const m = this.m;
    if (!m || this.closed || msg.t !== 's') return;
    for (const k of Object.keys(msg.i || {})) {
      const p = m.players[+k], q = msg.i[k];
      if (!p || !q || p.isUser || !p.isGhost) continue;
      const owner = p.networkUid || this.hostUid;     // a player's state comes from its owner only
      if (from !== owner) continue;
      p._netTarget = q.p;
      p.vel.set(q.v[0], q.v[1], q.v[2]);
      p.facing = q.f; p.grounded = !!q.gr; p.charge = q.ch; p.sprinting = !!q.sp;
      p.holding = !!q.hd; p.time = q.t; p.stun = q.s; p.energy = q.e; p.stamina = q.st;
      p.action = q.a ? { type: q.a, t: 0.2, dur: 0.6 } : null;
    }
    if (msg.b && !m.ballAuth) {
      const expect = m.ball.owner?.networkUid || this.hostUid;   // the ball comes from its holder (or host if free)
      if (from === expect) {
        m._ballTarget = msg.b.p;
        m.ball.vel.set(msg.b.v[0], msg.b.v[1], msg.b.v[2]);
        m.ball.hot = msg.b.h; m.ball.hotColor = msg.b.c; m.ball.inGoal = msg.b.g;
      }
    }
  }

  // ── incoming events ───────────────────────────────────────
  _onEvent(msg, from) {
    const m = this.m;
    if (!m || this.closed) return;
    switch (msg.t) {
      case 'own': {
        if (this.isHost) break;
        const o = msg.i >= 0 ? m.players[msg.i] : null;
        m.ball.owner = o;
        this.prevOwner = o;      // this is not our own release, do not echo it back
        break;
      }
      case 'kick': if (this.isHost) this._applyKick(msg, from); break;
      case 'act': if (this.isHost) this._applyAct(msg, from); break;
      case 'stun': {
        const p = m.players[msg.i];
        if (p && p.isUser && !this.isHost) {
          p.stun = msg.d;
          p.startAction('down', msg.d, { after: () => { if (!p.action) p.startAction('getup', 0.45); } });
        }
        break;
      }
      case 'g': if (!this.isHost && from === this.hostUid) this._applyGame(msg); break;
      case 'h': if (!this.isHost && from === this.hostUid) this._applyHook(msg); break;
      case 'kickoff': if (!this.isHost) m._placeKickoff(m.teams[msg.i]); break;
    }
  }

  _applyKick(msg, from) {
    const m = this.m, b = m.ball, kicker = m.players[msg.i];
    if (!kicker || kicker.networkUid !== from) return;   // only the holder can kick
    b.pos.set(msg.p[0], msg.p[1], msg.p[2]);
    b.vel.set(msg.v[0], msg.v[1], msg.v[2]);
    b.hot = msg.h; b.hotColor = msg.c; b.inGoal = 0;
    b.owner = null;
    b.lastKicker = kicker; b.lastTouch = kicker;
    kicker.cd.control = 0.45;   // same as a local kick: the kicker cannot re-take the ball instantly
    if (msg.sh) { b.shotBy = kicker; m.shots[kicker.team.index]++; }
    if (msg.pa) { m.passTarget = m.players[msg.pt] || null; m.passTime = m.time; }
    this.prevOwner = null;
  }

  _applyAct(msg, from) {
    const m = this.m, p = m.players[msg.i];
    if (!p || p.networkUid !== from) return;     // only the owner may request an action for its player
    if (msg.a === 'tackle') p.tackle();
    else if (msg.a === 'req') m.requestPass(p);
  }

  _applyGame(g) {
    const m = this.m;
    m.phase = g.ph; m.phaseT = g.pt; m.clock = g.ck; m.golden = !!g.gd;
    g.sc.forEach((s, i) => { m.teams[i].score = s; });
    m.possession = [...g.po]; m.shots = [...g.sh];
    g.sv.forEach((s, i) => { const p = m.players[i]; if (p) { p.stats.goals = s[0]; p.stats.saves = s[1]; } });
  }

  _applyHook(msg) {
    const m = this.m, d = msg.d, hk = this.origHooks;
    switch (msg.k) {
      case 'goal': hk.goal?.({ team: m.teams[d.t], scorer: d.n ? { name: d.n } : null, own: !!d.o, golden: !!d.g }); break;
      case 'toast': hk.toast?.(d.x, d.c, d.d); break;
      case 'countdown': hk.countdown?.(d.n); break;
      case 'shake': hk.shake?.(d.a); break;
      case 'end': {
        const mine = m.players.indexOf(m.user), t = m.user.team.index, sc = d.s;
        const result = sc[t] > sc[1 - t] ? 'win' : sc[t] < sc[1 - t] ? 'loss' : 'draw';
        hk.end?.({ result, score: sc, possession: d.p, shots: d.h, user: d.st[mine] });
        break;
      }
    }
  }

  // ── host: forward the referee's events to everybody ─────────
  _wrapHooks(hk) {
    const send = (k, d) => this._send({ t: 'h', k, d });
    const w = { ...hk };
    w.goal = (x) => { send('goal', { t: x.team.index, n: x.scorer?.name || '', o: !!x.own, g: !!x.golden }); hk.goal?.(x); };
    w.toast = (text, color, dur) => { send('toast', { x: text, c: color, d: dur }); hk.toast?.(text, color, dur); };
    w.countdown = (n) => { send('countdown', { n }); hk.countdown?.(n); };
    w.shake = (a) => { send('shake', { a }); hk.shake?.(a); };
    w.kickoff = (team) => { this._send({ t: 'kickoff', i: team.index }); hk.kickoff?.(team); };
    w.end = (res) => {
      send('end', { s: res.score, p: res.possession, h: res.shots, st: this.m.players.map((p) => ({ ...p.stats })) });
      hk.end?.(res);
    };
    return w;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.off.forEach((f) => f?.());
  }
}
