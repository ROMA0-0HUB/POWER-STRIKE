// Ranking rules (pure logic, no network). Points move with each ranked result.
// Tune the numbers here; everything else reads from this file.
export const BASE = 20;                       // one "unit" of rank points
export const MULT = { win: 1.3, draw: 0.3, loss: -1.0 };
export const COINS = { win: 100, draw: 40, loss: 15, tierUp: 500 };

export const TIERS = [
  { id: 'bronze',  name: 'برونز',   min: 0 },
  { id: 'silver',  name: 'فضة',     min: 200 },
  { id: 'gold',    name: 'ذهب',     min: 400 },
  { id: 'diamond', name: 'دايموند', min: 700 },
  { id: 'elite',   name: 'النخبة',  min: 1100 },
  { id: 'master',  name: 'الماستر', min: 1600 },
];

export function tierIndex(points) {
  let idx = 0;
  TIERS.forEach((t, i) => { if (points >= t.min) idx = i; });
  return idx;
}

/** 0..1 progress inside the current tier (1 for the top tier). */
export function tierProgress(points) {
  const i = tierIndex(points);
  if (i === TIERS.length - 1) return 1;
  const lo = TIERS[i].min, hi = TIERS[i + 1].min;
  return Math.max(0, Math.min(1, (points - lo) / (hi - lo)));
}

/** Points change for one result. Never drops below 0. */
export function pointsDelta(result, points) {
  const m = MULT[result] ?? MULT.loss;
  let d = Math.round(BASE * m);
  if (points + d < 0) d = -points;
  return d === 0 ? 0 : d;
}

/**
 * Apply a ranked result to a profile snapshot.
 * profile: { points, wins, draws, losses, coins }
 * returns the new profile plus what changed (for the results screen).
 */
export function applyResult(profile, result) {
  const before = tierIndex(profile.points || 0);
  const delta = pointsDelta(result, profile.points || 0);
  const points = (profile.points || 0) + delta;
  const after = tierIndex(points);
  const tierUp = after > before;
  const coins = (profile.coins || 0) + COINS[result] + (tierUp ? COINS.tierUp * (after - before) : 0);
  return {
    ...profile,
    points,
    wins: (profile.wins || 0) + (result === 'win' ? 1 : 0),
    draws: (profile.draws || 0) + (result === 'draw' ? 1 : 0),
    losses: (profile.losses || 0) + (result === 'loss' ? 1 : 0),
    coins,
    tier: TIERS[after].id,
    delta, tierUp,
    gained: COINS[result] + (tierUp ? COINS.tierUp * (after - before) : 0),
  };
}
