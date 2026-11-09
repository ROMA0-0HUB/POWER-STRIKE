// AI for team-mates, opponents and goalkeepers. Decisions are made a few times
// per second (with difficulty-based reaction delays) while steering runs every
// frame for smooth movement.
import * as THREE from '../vendor/three.module.min.js';
import { FIELD, POSITIONS, PHYS } from '../config.js';

const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function updateAI(p, m, dt) {
  const ball = m.ball;
  p.ai.timer -= dt;
  const think = p.ai.timer <= 0;
  if (think) p.ai.timer = 0.1 + Math.random() * 0.12;

  if (m.phase !== 'play') {
    // stand still facing the ball during countdowns
    p.setIntent(0, 0, false, Math.atan2(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z));
    return;
  }
  if (p.isGK) return keeper(p, m, dt, think);
  const owner = ball.owner;
  if (owner === p) return carrier(p, m, dt, think);
  tryAerial(p, m, think);
  if (owner && owner.team === p.team) return support(p, m, think);
  if (owner && owner.team !== p.team) return defend(p, m, dt, think);
  return loose(p, m, think);
}

// ── helpers ─────────────────────────────────────────────────
function moveTo(p, x, z, { sprintDist = 7, arrive = 0.6, face = null, sprint = null } = {}) {
  const dx = x - p.pos.x, dz = z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < arrive) { p.setIntent(0, 0, false, face); return d; }
  const k = d < 2.5 ? d / 2.5 : 1;
  const s = sprint !== null ? sprint : d > sprintDist && p.stamina > 0.25;
  p.setIntent((dx / d) * k, (dz / d) * k, s, face);
  return d;
}

const faceBall = (p, m) => Math.atan2(m.ball.pos.x - p.pos.x, m.ball.pos.z - p.pos.z);

/** Formation spot in world coordinates, shifted by ball position and phase. */
export function formationSpot(p, m, out, phase = 'neutral') {
  const base = POSITIONS[p.role].base;
  const dir = p.team.dir;
  const ballF = m.ball.pos.z * dir;
  const ballLat = -dir * m.ball.pos.x;
  let f = base.f * 0.85 + ballF * 0.5;
  let lat = base.x * (phase === 'attack' ? 1.05 : 0.8) + ballLat * 0.3;
  if (phase === 'attack') f += 6; else if (phase === 'defend') f -= 4;
  switch (p.role) {
    case 'ST': f = clamp(f + 3, -6, FIELD.HL - 6); break;
    case 'LW': case 'RW': f = clamp(f, -FIELD.HL + 10, FIELD.HL - 7); break;
    case 'DF': f = clamp(Math.min(f, ballF - 7), -FIELD.HL + 6, 6); lat *= 0.6; break;
    default: break;
  }
  lat = clamp(lat, -FIELD.HW + 2.5, FIELD.HW - 2.5);
  out.set(-dir * lat, 0, f * dir);
  return out;
}

// separation from team-mates so the AI doesn't bunch up
function spread(p, out) {
  for (const q of p.team.players) {
    if (q === p) continue;
    const dx = out.x - q.pos.x, dz = out.z - q.pos.z, d = Math.hypot(dx, dz);
    if (d < 5 && d > 0.01) { out.x += (dx / d) * (5 - d) * 0.6; out.z += (dz / d) * (5 - d) * 0.6; }
  }
  out.x = clamp(out.x, -FIELD.HW + 1.5, FIELD.HW - 1.5);
  out.z = clamp(out.z, -FIELD.HL + 1.5, FIELD.HL - 1.5);
  return out;
}

function tryAerial(p, m, think) {
  const b = m.ball;
  if (b.owner || p.cd.header > 0) return;
  const dh = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
  const rel = b.pos.y - p.pos.y;
  if (think && p.grounded && dh < 2.2 && b.pos.y > 1.7 && b.pos.y < 3.4 && b.vel.y < 2 && p.canAct()) p.jump();
  if (dh < 0.85 && rel > 1.15 && rel < 2.3) {
    const attackHalf = p.pos.z * p.team.dir > 6;
    const tgt = attackHalf ? m.shotTarget(p, 0.6) : t3.set(p.pos.x * 0.5, 1.5, p.team.dir * FIELD.HL * 0.3);
    p.header(tgt);
  }
}

// ── ball carrier ────────────────────────────────────────────
function carrier(p, m, dt, think) {
  const dir = p.team.dir;
  const goal = t1.set(0, 0, p.team.attackZ);
  const distGoal = p.pos.distanceTo(goal);
  const near = m.nearestOpponent(p);
  const pressure = near ? near.d : 99;
  const diff = m.aiDiff(p.team);
  p.ai.hold += dt;

  if (think && p.canAct()) {
    // user on the same team called for the ball
    const req = m.passRequest;
    if (req && req.player.team === p.team && req.player !== p && m.time - req.t < 1.6) {
      m.passRequest = null;
      p.passTo(req.player, { through: req.player.speed > 4 });
      return;
    }
    const ab = p.char.ability.id;
    const shotAbility = ab === 'meteor' || ab === 'eagle' || ab === 'thunder';
    // shooting
    const angleOK = Math.abs(p.pos.x) < 14 || distGoal < 12;
    if (distGoal < 25 && angleOK) {
      const chance = (1 - distGoal / 25) * 0.55 + (pressure < 2.5 ? 0.15 : 0) + (distGoal < 10 ? 0.5 : 0);
      if (Math.random() < chance) {
        if (shotAbility && p.energy >= 1 && distGoal < 22) { p.useSpecial(); return; }
        const power = clamp(0.55 + distGoal / 40 + Math.random() * 0.25, 0.4, 1);
        p.shoot(power);
        return;
      }
    }
    // movement abilities under pressure
    if (!shotAbility && p.energy >= 1 && pressure < 5) { p.useSpecial(); }
    // passing under pressure / when holding too long
    if ((pressure < 3.4 && Math.random() < 0.5) || p.ai.hold > 3 + Math.random() * 2.5) {
      const best = m.bestPassOption(p);
      if (best && best.score > (p.ai.hold > 3 ? 0 : 0.25)) { p.passTo(best.mate); return; }
    }
    // skill move past a close defender
    if (pressure < 2.1 && p.cd.dash <= 0 && Math.random() < 0.3 * p.drbMul) {
      const o = near.pl;
      const ax = o.pos.x - p.pos.x, az = o.pos.z - p.pos.z;
      const side = Math.random() < 0.5 ? 1 : -1;
      // perpendicular to the defender, plus forward
      const pl = Math.hypot(ax, az) || 1;
      p.dash((-az / pl) * side, (ax / pl) * side + dir * 0.9);
      return;
    }
  }

  // steering towards goal with opponent avoidance
  let sx = goal.x - p.pos.x, sz = goal.z - p.pos.z;
  const l = Math.hypot(sx, sz) || 1; sx /= l; sz /= l;
  for (const o of m.other(p.team).players) {
    const dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z, d = Math.hypot(dx, dz);
    if (d < 6 && d > 0.01) {
      const ahead = (o.pos.z - p.pos.z) * dir > -1;
      const w = ((6 - d) / 6) * (ahead ? 1.5 : 0.5);
      sx += (dx / d) * w; sz += (dz / d) * w;
    }
  }
  if (Math.abs(p.pos.x) > FIELD.HW - 3) sx -= Math.sign(p.pos.x) * 0.8;
  const sl = Math.hypot(sx, sz) || 1;
  p.setIntent(sx / sl, sz / sl, pressure > 2.2 && p.stamina > 0.3 && diff.speed > 0.92);
}

// ── supporting the carrier ──────────────────────────────────
function support(p, m, think) {
  const owner = m.ball.owner;
  const dir = p.team.dir;
  const spot = formationSpot(p, m, t1, 'attack');
  const ownerF = owner.pos.z * dir;
  if (p.role === 'ST') spot.z = clamp(ownerF + 9, -4, FIELD.HL - 7) * dir;
  if (p.role === 'LW' || p.role === 'RW') spot.z = clamp(ownerF + 3 + (p.role === 'LW' ? 1 : 0), -FIELD.HL + 8, FIELD.HL - 6) * dir;
  if (p.role === 'DF') spot.z = clamp(ownerF - 12, -FIELD.HL + 6, 4) * dir;
  // move away from the carrier for an open passing lane
  const dx = spot.x - owner.pos.x, dz = spot.z - owner.pos.z, d = Math.hypot(dx, dz);
  if (d < 7 && d > 0.01) { spot.x += (dx / d) * (7 - d); spot.z += (dz / d) * (7 - d); }
  spread(p, spot);
  moveTo(p, spot.x, spot.z, { face: faceBall(p, m), sprintDist: 9 });
}

// ── defending ───────────────────────────────────────────────
function defend(p, m, dt, think) {
  const owner = m.ball.owner;
  const own = t2.set(0, 0, p.team.ownZ);
  const diff = m.aiDiff(p.team);
  const presser = m.presser(p.team);
  if (p === presser) {
    // goal-side pressure, then tackle
    const gx = own.x - owner.pos.x, gz = own.z - owner.pos.z, gl = Math.hypot(gx, gz) || 1;
    const tx = owner.pos.x + owner.vel.x * 0.3 + (gx / gl) * 0.7;
    const tz = owner.pos.z + owner.vel.z * 0.3 + (gz / gl) * 0.7;
    const d = moveTo(p, tx, tz, { sprintDist: 3, arrive: 0.2, face: Math.atan2(owner.pos.x - p.pos.x, owner.pos.z - p.pos.z) });
    const dd = p.pos.distanceTo(owner.pos);
    if (dd < 2.6) p.ai.reactT += dt; else p.ai.reactT = 0;
    if (think && dd < 1.9 && p.ai.reactT > diff.react && p.canAct() && p.cd.tackle <= 0) {
      if (Math.random() < diff.tackle) {
        p.facing = Math.atan2(owner.pos.x + owner.vel.x * 0.15 - p.pos.x, owner.pos.z + owner.vel.z * 0.15 - p.pos.z);
        if (p.buff?.id !== 'ironwall' && p.energy >= 1 && p.char.ability.id === 'ironwall') p.useSpecial();
        p.tackle();
      }
    }
    if (think && p.energy >= 1 && (p.char.ability.id === 'storm' || p.char.ability.id === 'ironwall') && d > 4) p.useSpecial();
    return;
  }
  // marking: stay goal-side of the assigned attacker
  let mark = p.ai.mark;
  if (!mark || mark === owner) {
    // cover: between ball and goal
    const k = p.role === 'DF' ? 0.55 : 0.3;
    const tx = owner.pos.x + (own.x - owner.pos.x) * k;
    const tz = owner.pos.z + (own.z - owner.pos.z) * k;
    moveTo(p, tx, tz, { face: faceBall(p, m), sprintDist: 6 });
    return;
  }
  const gx = own.x - mark.pos.x, gz = own.z - mark.pos.z, gl = Math.hypot(gx, gz) || 1;
  const gap = p.role === 'ST' ? 5 : 2.2;
  // lean towards the passing lane between owner and mark
  const lx = (owner.pos.x - mark.pos.x) * 0.2, lz = (owner.pos.z - mark.pos.z) * 0.2;
  let tx = mark.pos.x + (gx / gl) * gap + lx, tz = mark.pos.z + (gz / gl) * gap + lz;
  if (p.role === 'ST') { tz = clamp(tz * p.team.dir, -8, FIELD.HL) * p.team.dir; }
  moveTo(p, tx, tz, { face: faceBall(p, m), sprintDist: 5 });
}

// ── loose ball ──────────────────────────────────────────────
function loose(p, m, think) {
  const chaser = m.chaser(p.team);
  const b = m.ball;
  if (p === chaser) {
    const ip = m.interceptPoint(p, t1);
    moveTo(p, ip.x, ip.z, { sprintDist: 2.5, arrive: 0.1, sprint: p.stamina > 0.1 });
    return;
  }
  // second man hunts the pass receiver area / formation
  const phase = m.lastPossession === p.team ? 'attack' : 'defend';
  const spot = spread(p, formationSpot(p, m, t1, phase));
  moveTo(p, spot.x, spot.z, { face: faceBall(p, m) });
}

// ── goalkeeper ──────────────────────────────────────────────
function keeper(p, m, dt, think) {
  const b = m.ball, dir = p.team.dir, ownZ = p.team.ownZ;
  const diff = m.aiDiff(p.team);
  if (b.owner === p) {
    p.ai.hold += dt;
    p.setIntent(0, 0, false, dir > 0 ? 0 : Math.PI);
    if (p.ai.hold > 1.1 && p.canAct()) {
      const best = m.bestPassOption(p);
      if (best) p.passTo(best.mate, { lofted: best.d > 20 });
      else p.passTo(p.team.players.find((q) => q !== p));
    }
    return;
  }
  p.ai.hold = 0;
  // shot detection
  const vzTo = b.vel.z * -dir; // >0 when travelling towards our goal
  let reacting = false;
  if (!b.owner && vzTo > 4) {
    const t = (ownZ - b.pos.z) / b.vel.z;
    if (t > 0 && t < 1.6) {
      const px = b.pos.x + b.vel.x * t;
      const py = Math.max(0.2, b.pos.y + b.vel.y * t - 0.5 * PHYS.gravity * t * t);
      if (Math.abs(px) < FIELD.goalW / 2 + 0.7 && py < FIELD.goalH + 0.6) {
        reacting = true;
        if (p.ai.lastShotSeen === null) p.ai.lastShotSeen = m.time;
        const seen = m.time - p.ai.lastShotSeen;
        if (seen > diff.react * 0.8) {
          const lat = px - p.pos.x;
          const skillReach = 0.7 + diff.gk * 0.6;
          if (Math.abs(lat) > skillReach && t < 0.85 && p.canAct()) {
            p.dive(lat, dir * 0.2);
          } else {
            moveTo(p, clamp(px, -FIELD.goalW / 2, FIELD.goalW / 2), ownZ + dir * 0.6, { sprint: true, arrive: 0.1, face: faceBall(p, m) });
          }
        } else p.setIntent(0, 0, false, faceBall(p, m));
      }
    }
  }
  if (!reacting) p.ai.lastShotSeen = null; else return;

  const dGoal = Math.hypot(b.pos.x, b.pos.z - ownZ);
  // rush a loose ball in the box
  if (!b.owner && dGoal < 10) {
    const opp = m.nearestTo(m.other(p.team).players, b.pos);
    const myD = p.pos.distanceTo(b.pos);
    if (myD < (opp ? opp.d : 99) + 1.5 && b.pos.y < 2.2) {
      moveTo(p, b.pos.x, b.pos.z, { sprint: true, arrive: 0.05 });
      return;
    }
  }
  // angle play: stand on the line between the ball and the goal centre
  const out = b.owner && b.owner.team !== p.team && dGoal < 9 ? 3.2 : Math.min(2.4, dGoal * 0.12 + 0.6);
  const gx = b.pos.x, gz = b.pos.z - ownZ, gl = Math.hypot(gx, gz) || 1;
  let tx = (gx / gl) * out, tz = ownZ + (gz / gl) * out;
  tx = clamp(tx, -FIELD.goalW / 2 + 0.3, FIELD.goalW / 2 - 0.3);
  // tackle-dive at a close attacker
  if (b.owner && b.owner.team !== p.team && think) {
    const dd = p.pos.distanceTo(b.owner.pos);
    if (dd < 1.8 && p.canAct() && Math.random() < 0.35) { p.dive(b.owner.pos.x - p.pos.x, b.owner.pos.z - p.pos.z); return; }
  }
  moveTo(p, tx, tz, { arrive: 0.25, face: faceBall(p, m), sprintDist: 4 });
}
