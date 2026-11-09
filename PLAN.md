# POWER STRIKER — Plan

1. ✅ Project skeleton, local Three.js (js/vendor), config & original roster (js/config.js)
2. ✅ Save system (js/storage.js) and procedural Web Audio SFX/music (js/audio.js)
3. ✅ Procedural textures, futuristic arena with goals/nets/stands/crowd/roof (js/game/textures.js, stadium.js)
4. ✅ Cel-shaded anime character model + animation rig (js/game/characterModel.js)
5. ✅ Effects (particles, trails, rings, afterimages) and ball physics (effects.js, ball.js)
6. ✅ Player actions & abilities, AI (teammates/opponents/GK), match rules (player.js, ai.js, match.js)
7. ✅ Third-person orbit camera with touch-drag look, smoothing and shake (js/game/camera.js — must expose `forwardFlat`, `pitch`)
8. ✅ Touch controls: left joystick, camera-drag zone, buttons (shoot/pass/dribble/sprint/tackle/special/jump) + keyboard fallback (js/input/)
9. ✅ User control mapping (camera-relative movement, shot charge) → passed as `userInput(p, dt)` to `Match.update`
10. ✅ index.html + css: Arabic RTL main menu (logo, PLAY, character select, customization, settings, sound, profile), position-select screen with countdown & reserved slots, HUD (score, clock, stamina/energy), results screen
11. ✅ Main loop/bootstrap (js/main.js): renderer, quality presets, wiring hooks (goal/toast/shake/end)
12. 🟨 Packaging script (tools/package.sh) and headless smoke test (tools/smoke_test.py) done; real-device playtest on iPhone Safari still to do

## Phase 2 status
- ✅ Training mode (empty stadium, no clock), 1v1 and 2v2 layouts, keepers cannot be tackled, own goals do not count.
- ✅ Online foundation: accounts (name + password), profiles, unique names, rank tiers and points, leaderboard, friend rooms (create/join by code), ranked search with 60 s bot fallback.
- ⬜ Live multiplayer match sync (host-authoritative state + input relay) — needed before human-vs-human play.
- ⬜ Shop, missions, events, rewards spending.
- ⬜ Ranked results should be computed by a server function (Cloud Functions) instead of the client, so points cannot be edited from the browser.
