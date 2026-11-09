// Player profile + settings, saved on the device (localStorage) so the game
// works fully offline on any static host.
import { CHARACTERS } from './config.js';

const KEY = 'power-striker:v1';

const defaults = () => ({
  profile: { name: 'ستراكر', level: 1, xp: 0, wins: 0, draws: 0, losses: 0, goals: 0, matches: 0 },
  characterId: CHARACTERS[0].id,
  custom: {}, // per-character overrides: { [id]: { hair, hairStyle, skin, boots, number } }
  settings: {
    quality: 'medium', duration: 180, difficulty: 'normal', teamSize: 5,
    sensitivity: 1, invertY: false, music: 0.5, sfx: 0.8, muted: false, minimap: true,
  },
});

let state = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) return defaults();
    const d = defaults();
    return {
      profile: { ...d.profile, ...raw.profile },
      characterId: CHARACTERS.some((c) => c.id === raw.characterId) ? raw.characterId : d.characterId,
      custom: raw.custom || {},
      settings: { ...d.settings, ...raw.settings },
    };
  } catch {
    return defaults();
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export const store = {
  get profile() { return state.profile; },
  get settings() { return state.settings; },
  get characterId() { return state.characterId; },
  set characterId(id) { state.characterId = id; save(); },
  character(id = state.characterId) {
    return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
  },
  /** Character merged with the player's customisation. */
  look(id = state.characterId) {
    const c = this.character(id);
    const o = state.custom[id] || {};
    return {
      hair: o.hair ?? c.hair,
      hairStyle: o.hairStyle ?? c.hairStyle,
      skin: o.skin ?? c.skin,
      eye: c.eye,
      boots: o.boots ?? 0xffffff,
      number: o.number ?? 10,
    };
  },
  setCustom(id, patch) {
    state.custom[id] = { ...(state.custom[id] || {}), ...patch };
    save();
  },
  setSetting(k, v) { state.settings[k] = v; save(); },
  setName(n) { state.profile.name = n.slice(0, 14) || 'ستراكر'; save(); },
  xpForLevel: (lvl) => 100 + (lvl - 1) * 60,
  addResult({ result, goals }) {
    const p = state.profile;
    p.matches += 1;
    p.goals += goals;
    if (result === 'win') p.wins += 1; else if (result === 'draw') p.draws += 1; else p.losses += 1;
    const gained = (result === 'win' ? 120 : result === 'draw' ? 60 : 35) + goals * 25;
    p.xp += gained;
    let levelUps = 0;
    while (p.xp >= this.xpForLevel(p.level)) { p.xp -= this.xpForLevel(p.level); p.level += 1; levelUps++; }
    save();
    return { gained, levelUps };
  },
};
