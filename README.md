# POWER STRIKER

An original anime-style 3D arena football game (5v5, third-person, touch controls) that runs in mobile browsers. Pure static HTML/CSS/JS with Three.js bundled locally — no build step, deployable to GitHub Pages or Netlify.

## Tech
HTML5, CSS3, JavaScript ES modules, Three.js (WebGL) in `js/vendor/`, Web Audio API (all sounds synthesized), canvas-generated textures, localStorage saves.

## Run locally
Serve the folder with any static server, e.g. `npx serve .` or `netlify dev --port 8889`, then open the URL (ES modules require http, not file://).

## Deploy to GitHub Pages
1. Push this repository to GitHub (branch `main`).
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes the site on every push to `main`. The game is then available at `https://<user>.github.io/<repo>/`.

All asset paths are relative, so the game works from a sub-path such as `/<repo>/`.

## Roadmap
All game systems, the camera, touch and keyboard controls, menus, HUD and the main loop are written. Remaining: tuning and a real-device playtest on iPhone Safari. See `PLAN.md`.

## Online setup (Firebase)
1. Firebase console → **Authentication → Sign-in method** → enable **Email/Password**.
2. **Realtime Database** → create it, then paste the complete rules from `firebase/database.rules.json` into the **Rules** tab and publish them.
3. Players create accounts. The host chooses a room size from 1v1 through 5v5 and shares the five-character room code.
4. A room starts only after every human slot is filled. Players are balanced into the two teams; AI-controlled goalkeepers are added separately and never count toward the selected player limit. The host runs the authoritative match simulation, receives each remote player's input, and broadcasts the match state to everyone else.
5. All devices must be signed in and connected to the internet. Offline play remains local and does not require Firebase.
6. In Google Cloud, restrict the web API key to your site's domain (Credentials → API key → Website restrictions).

**Important:** The random ranked queue is not implemented yet; the Online screen labels the computer match as local and the real multiplayer path is Friend Rooms. Firebase project settings and Realtime Database rules must be enabled/published before testing between two devices.

## Testing & packaging
- `python3 tools/smoke_test.py http://localhost:8765/index.html` plays a short headless match and fails on JavaScript errors (needs Python `playwright`).
- `tools/package.sh` builds a clean copy in `dist/` and a zip.

## License
The game code has no license yet; add a `LICENSE` file to choose one. Three.js is MIT licensed (see `js/vendor/THREE_LICENSE`).
