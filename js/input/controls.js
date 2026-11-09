// Unified input for the user-controlled player: on-screen touch controls
// (joystick, look zone, action buttons) and a keyboard fallback. The result is
// fed to Match.update through userInput(p, dt).
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ACTIONS = ['shoot', 'pass', 'dribble', 'sprint', 'tackle', 'special', 'jump'];

export function createControls({ root, cam }) {
  const held = Object.fromEntries(ACTIONS.map((k) => [k, false]));
  const prev = { ...held };
  const state = { mx: 0, mz: 0, held, charge: 0, charging: false, enabled: false };
  const keys = new Set();
  const KEYMAP = { Space: 'shoot', KeyE: 'pass', KeyF: 'dribble', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyQ: 'tackle', KeyR: 'special', KeyC: 'jump' };

  // ── keyboard ──
  addEventListener('keydown', (e) => {
    if (!state.enabled) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (KEYMAP[e.code]) held[KEYMAP[e.code]] = true;
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (KEYMAP[e.code]) held[KEYMAP[e.code]] = false;
  });
  addEventListener('blur', () => { keys.clear(); ACTIONS.forEach((k) => (held[k] = false)); state.mx = state.mz = 0; });

  // ── touch: joystick ──
  const joy = root.querySelector('#joy');
  const knob = root.querySelector('#joyKnob');
  let joyId = null, jx0 = 0, jy0 = 0;
  const R = 56;
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  joy.addEventListener('pointerdown', (e) => {
    joyId = e.pointerId; joy.setPointerCapture(e.pointerId);
    const r = joy.getBoundingClientRect();
    jx0 = r.left + r.width / 2; jy0 = r.top + r.height / 2;
  });
  joy.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - jx0, dy = e.clientY - jy0;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    setKnob(dx, dy);
    state.mx = dx / R;
    state.mz = -dy / R;   // screen up = forward
  });
  const joyEnd = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null; setKnob(0, 0); state.mx = state.mz = 0;
  };
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);

  // ── touch: camera look zone ──
  const look = root.querySelector('#look');
  let lookId = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', (e) => { lookId = e.pointerId; look.setPointerCapture(e.pointerId); lx = e.clientX; ly = e.clientY; });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    cam.drag(e.clientX - lx, e.clientY - ly);
    lx = e.clientX; ly = e.clientY;
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  look.addEventListener('pointerup', lookEnd);
  look.addEventListener('pointercancel', lookEnd);

  // ── touch: action buttons (hold-aware) ──
  root.querySelectorAll('[data-act]').forEach((el) => {
    const act = el.dataset.act;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); held[act] = true; el.classList.add('on'); });
    const up = () => { held[act] = false; el.classList.remove('on'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  });

  state.setEnabled = (v) => {
    state.enabled = v;
    if (!v) { ACTIONS.forEach((k) => (held[k] = false)); state.mx = state.mz = 0; state.charging = false; state.charge = 0; }
  };

  // Read the guest's controls without running a local simulation. The host
  // consumes this world-space input and remains authoritative for physics.
  state.getNetworkInput = () => {
    const kx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const kz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const mx = clamp(state.mx + kx, -1, 1);
    const mz = clamp(state.mz + kz + (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0), -1, 1);
    const f = cam.forwardFlat, rx = -f.z, rz = f.x;
    let x = rx * mx + f.x * mz, z = rz * mx + f.z * mz;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z, face: held.shoot ? Math.atan2(f.x, f.z) : null, held: { ...held } };
  };

  /** Called by Match every frame for the user's player. */
  state.apply = (p, dt, match) => {
    if (!state.enabled) { p.setIntent(0, 0, false, null); return; }
    // keyboard movement folds into the stick
    const kx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const kz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    // arrow keys orbit the camera (300 px/s of drag)
    if (keys.has('ArrowLeft')) cam.drag(-300 * dt, 0);
    if (keys.has('ArrowRight')) cam.drag(300 * dt, 0);
    const mx = clamp(state.mx + kx, -1, 1), mz = clamp(state.mz + kz + (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0), -1, 1);

    const f = cam.forwardFlat;
    const rx = -f.z, rz = f.x;                 // camera right
    const dx = rx * mx + f.x * mz;
    const dz = rz * mx + f.z * mz;
    const moving = Math.hypot(mx, mz) > 0.2;
    const camFace = Math.atan2(f.x, f.z);
    const edge = (k) => held[k] && !prev[k];

    // shooting: hold to charge, release to shoot (or tackle when not in possession)
    if (edge('shoot')) {
      if (p.hasBall) { state.charging = true; state.charge = 0; }
      else p.tackle();
    }
    if (state.charging) {
      if (held.shoot && p.hasBall) {
        state.charge = Math.min(1, state.charge + dt / 1.1);
        p.charge = state.charge;
      } else {
        state.charging = false;
        p.charge = 0;
        if (p.hasBall) p.shoot(0.12 + 0.88 * state.charge);
        state.charge = 0;
      }
    }

    p.setIntent(moving || state.charging ? dx * (state.charging ? 0.4 : 1) : 0,
                moving || state.charging ? dz * (state.charging ? 0.4 : 1) : 0,
                held.sprint, state.charging ? camFace : null);

    if (edge('pass')) {
      if (p.hasBall) {
        const best = match.bestPassOption(p);
        if (best) p.passTo(best.mate);
      } else {
        match.requestPass(p);
      }
    }
    if (edge('tackle')) p.tackle();
    if (edge('dribble')) p.dash(dx, dz);
    if (edge('special')) p.useSpecial();
    if (edge('jump')) p.jump();

    for (const k of ACTIONS) prev[k] = held[k];
  };

  return state;
}
