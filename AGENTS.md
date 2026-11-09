# AGENTS.md

Read `PLAN.md` first — only the iPhone playtest and tuning (milestone 12) remain.

## Architecture
- `js/config.js` — all constants: FIELD, PHYS, POSITIONS, TEAMS, CHARACTERS (original roster + abilities), DIFFICULTY.
- `js/storage.js` — localStorage profile/settings/customization (`store`).
- `js/audio.js` — procedural Web Audio engine (`audio`); call `audio.unlock()` on first user gesture (iOS).
- `js/online/` — `firebase.js` (accounts, profiles, leaderboard, rooms; lazy-loaded), `ranks.js` (rank tiers and points, pure logic), `panel.js` (Online screen, ranked search with 60 s bot fallback). Talks to main via `ps:start` / `ps:matchend` DOM events.
- `js/main.js` — bootstrap, menus, match lifecycle, HUD, main loop. `js/input/controls.js` — touch + keyboard → `userInput(p, dt)`. `js/game/camera.js` — orbit camera (`forwardFlat`, `pitch`).
- `js/game/` — `stadium.js` (arena, returns `{update, rippleNet, drawScore}`), `characterModel.js` (toon rig + `animateCharacter`), `effects.js`, `ball.js`, `player.js`, `ai.js`, `match.js`.
- `Match` constructor expects `{scene, stadium, fx, cam, settings, user:{role,char,look,name}, lineup, hooks}`; `cam` must provide `forwardFlat` (Vector3) and `pitch`. Hooks: kickoff, countdown, toast, goal, shake, special, possess, end.
- Team 0 (Blue Nova) attacks −z (dir −1); team 1 starts each match in possession.

## Conventions
- No build step; ES modules importing `../vendor/three.module.min.js`. Do not add CDN links — all assets local. Exception: the Online screen loads the Firebase SDK from gstatic.com via dynamic import in `js/online/firebase.js` (never at startup).
- UI text in Arabic (RTL). Textures are procedural; only `assets/img/menu-bg.png` is a bitmap.
- Keep mobile performance in mind: pooled effects, instanced meshes, quality presets (low/medium/high).
