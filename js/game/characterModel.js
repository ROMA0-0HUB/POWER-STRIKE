// Procedural anime-style 3D footballer: cel-shaded (toon) materials, ink
// outlines, sculpted hair styles, anime eyes and a jointed rig that the
// animation system drives (run, sprint, kick, slide tackle, dash, dive...).
import * as THREE from '../vendor/three.module.min.js';
import { toonGradient, makeFaceTexture, makeNumberTexture } from './textures.js';

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x07080f, side: THREE.BackSide });
const geoCache = {};
const G = (key, make) => geoCache[key] || (geoCache[key] = make());

function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

function mergeGeometries(list) {
  const pos = [], nor = [];
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    pos.push(...ng.attributes.position.array);
    nor.push(...ng.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

function spike(len, rad, x, y, z, rx, ry, rz) {
  const g = new THREE.ConeGeometry(rad, len, 5);
  g.translate(0, len / 2, 0);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function hairGeometry(style) {
  return G('hair-' + style, () => {
    const parts = [];
    // skull cap
    const cap = new THREE.SphereGeometry(0.226, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.44);
    cap.rotateX(-0.45);
    cap.translate(0, 0.015, -0.01);
    parts.push(cap);
    if (style === 'spiky') {
      // dramatic anime spikes swept back + fringe
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        parts.push(spike(0.24, 0.07, Math.sin(a) * 0.12, 0.12, Math.cos(a) * 0.12 - 0.04, -0.9 + Math.cos(a) * 0.4, 0, Math.sin(a) * -0.9));
      }
      parts.push(spike(0.3, 0.08, 0, 0.18, -0.06, -1.25, 0, 0));
      parts.push(spike(0.28, 0.07, 0.08, 0.16, -0.08, -1.4, 0, -0.4));
      parts.push(spike(0.28, 0.07, -0.08, 0.16, -0.08, -1.4, 0, 0.4));
      for (const x of [-0.12, -0.04, 0.05, 0.13]) parts.push(spike(0.14, 0.05, x, 0.15, 0.14, 2.3, 0, x * 2));
    } else if (style === 'swept') {
      for (let i = 0; i < 7; i++) {
        const x = -0.15 + i * 0.05;
        parts.push(spike(0.21, 0.07, x, 0.16, 0.08, 1.55, 0, -0.45 + i * 0.03));
      }
      for (let i = 0; i < 6; i++) parts.push(spike(0.24, 0.07, -0.13 + i * 0.05, 0.08, -0.14, -2.3, 0, 0));
      parts.push(spike(0.2, 0.06, 0.2, 0.0, 0.0, 0, 0, -2.6));
      parts.push(spike(0.2, 0.06, -0.2, 0.0, 0.0, 0, 0, 2.6));
    } else if (style === 'long') {
      for (let i = 0; i < 10; i++) {
        const a = Math.PI * 0.25 + (i / 9) * Math.PI * 1.5;
        parts.push(spike(0.42, 0.075, Math.sin(a) * 0.16, 0.08, Math.cos(a) * 0.16, Math.PI - Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25));
      }
      for (const x of [-0.11, -0.03, 0.06, 0.13]) parts.push(spike(0.15, 0.055, x, 0.15, 0.14, 2.35, 0, x * 1.5));
    } else {
      // buzz / short crop with a little fringe
      const top = new THREE.SphereGeometry(0.232, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
      top.rotateX(-0.4);
      top.translate(0, 0.02, -0.01); parts.push(top);
      for (const x of [-0.08, 0, 0.08]) parts.push(spike(0.1, 0.05, x, 0.17, 0.12, 1.9, 0, 0));
    }
    return mergeGeometries(parts);
  });
}

function capsule(r, len, seg = 8) { return G(`cap-${r}-${len}`, () => new THREE.CapsuleGeometry(r, len, 3, seg)); }

function withOutline(mesh, thickness = 1.07, enabled = true) {
  if (!enabled) return mesh;
  const o = new THREE.Mesh(mesh.geometry, OUTLINE);
  o.scale.setScalar(thickness);
  o.raycast = () => {};
  mesh.add(o);
  return mesh;
}

/**
 * @param look {hair, hairStyle, skin, eye, boots, number}
 * @param kit  {jersey, shorts, accent}
 */
export function buildCharacter(look, kit, { outlines = true, shadows = true } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // bob / lean / tilt
  root.add(body);
  const skinM = toon(look.skin);
  const jerseyM = toon(kit.jersey);
  const shortsM = toon(kit.shorts);
  const accentM = toon(kit.accent);
  const hairM = toon(look.hair);
  const bootM = toon(look.boots, { emissive: new THREE.Color(look.boots).multiplyScalar(0.1) });
  const sockM = toon(kit.jersey);

  const hips = new THREE.Group(); hips.position.y = 0.98; body.add(hips);
  // shorts
  const shorts = new THREE.Mesh(G('shorts', () => { const g = new THREE.CylinderGeometry(0.19, 0.21, 0.26, 10); g.translate(0, -0.06, 0); return g; }), shortsM);
  hips.add(withOutline(shorts, 1.06, outlines));

  // torso (pivot at hips)
  const torso = new THREE.Group(); hips.add(torso);
  const chest = new THREE.Mesh(G('chest', () => { const g = new THREE.CapsuleGeometry(0.2, 0.3, 4, 10); g.scale(1.12, 1, 0.78); g.translate(0, 0.3, 0); return g; }), jerseyM);
  torso.add(withOutline(chest, 1.06, outlines));
  // jersey collar + side stripes (accent)
  const collar = new THREE.Mesh(G('collar', () => new THREE.TorusGeometry(0.085, 0.022, 4, 12)), accentM);
  collar.rotation.x = Math.PI / 2; collar.position.y = 0.55; torso.add(collar);
  const stripe = new THREE.Mesh(G('stripe', () => { const g = new THREE.BoxGeometry(0.46, 0.05, 0.33); g.translate(0, 0.08, 0); return g; }), accentM);
  torso.add(stripe);
  // number on back
  const numTex = makeNumberTexture(look.number ?? 10, 0xffffff, kit.shorts);
  const num = new THREE.Mesh(G('numplane', () => new THREE.PlaneGeometry(0.26, 0.26)), new THREE.MeshBasicMaterial({ map: numTex, transparent: true }));
  num.position.set(0, 0.34, -0.165); num.rotation.y = Math.PI; torso.add(num);
  const numF = new THREE.Mesh(G('numplaneF', () => new THREE.PlaneGeometry(0.1, 0.1)), new THREE.MeshBasicMaterial({ map: numTex, transparent: true }));
  numF.position.set(0.09, 0.42, 0.162); torso.add(numF);

  // neck + head
  const neck = new THREE.Mesh(G('neck', () => new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8)), skinM);
  neck.position.y = 0.6; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.78; torso.add(head);
  const skull = new THREE.Mesh(G('skull', () => { const g = new THREE.SphereGeometry(0.2, 16, 12); g.scale(0.95, 1.05, 1); return g; }), skinM);
  head.add(withOutline(skull, 1.05, outlines));
  // chin / jaw for anime V-shape
  const jaw = new THREE.Mesh(G('jaw', () => { const g = new THREE.ConeGeometry(0.15, 0.16, 8); g.rotateX(Math.PI); g.translate(0, -0.13, 0.03); g.scale(1, 1, 0.9); return g; }), skinM);
  head.add(jaw);
  const faceGeo = G('face', () => new THREE.SphereGeometry(0.203, 16, 8, Math.PI / 2 - 0.62, 1.24, Math.PI / 2 - 0.32, 0.62));
  const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: makeFaceTexture(look.eye, look.hair), transparent: true, depthWrite: false }));
  face.scale.set(0.95, 1.05, 1);
  head.add(face);
  const hair = new THREE.Mesh(hairGeometry(look.hairStyle), hairM);
  head.add(withOutline(hair, 1.05, outlines));
  // ears
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(G('ear', () => new THREE.SphereGeometry(0.04, 6, 6)), skinM);
    ear.position.set(s * 0.19, -0.01, 0); ear.scale.set(0.5, 1, 0.8); head.add(ear);
  }

  // arms
  const mkArm = (s) => {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.27, 0.5, 0); torso.add(shoulder);
    const sleeve = new THREE.Mesh(G('sleeve', () => { const g = new THREE.CapsuleGeometry(0.07, 0.14, 2, 8); g.translate(0, -0.1, 0); return g; }), jerseyM);
    shoulder.add(withOutline(sleeve, 1.08, outlines));
    const upper = new THREE.Mesh(G('upper', () => { const g = new THREE.CapsuleGeometry(0.052, 0.18, 2, 8); g.translate(0, -0.17, 0); return g; }), skinM);
    shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.3; shoulder.add(elbow);
    const fore = new THREE.Mesh(G('fore', () => { const g = new THREE.CapsuleGeometry(0.047, 0.2, 2, 8); g.translate(0, -0.13, 0); return g; }), skinM);
    elbow.add(withOutline(fore, 1.1, outlines));
    const hand = new THREE.Mesh(G('hand', () => new THREE.SphereGeometry(0.058, 8, 6)), skinM);
    hand.position.y = -0.29; elbow.add(hand);
    return { shoulder, elbow, hand };
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // legs
  const mkLeg = (s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, -0.06, 0); hips.add(hip);
    const thigh = new THREE.Mesh(G('thigh', () => { const g = new THREE.CapsuleGeometry(0.078, 0.3, 2, 8); g.translate(0, -0.2, 0); return g; }), skinM);
    hip.add(withOutline(thigh, 1.07, outlines));
    const short = new THREE.Mesh(G('shortleg', () => { const g = new THREE.CylinderGeometry(0.1, 0.095, 0.17, 8); g.translate(0, -0.08, 0); return g; }), shortsM);
    hip.add(short);
    const knee = new THREE.Group(); knee.position.y = -0.43; hip.add(knee);
    const shin = new THREE.Mesh(G('shin', () => { const g = new THREE.CapsuleGeometry(0.068, 0.3, 2, 8); g.translate(0, -0.21, 0); return g; }), sockM);
    knee.add(withOutline(shin, 1.08, outlines));
    const ankle = new THREE.Group(); ankle.position.y = -0.45; knee.add(ankle);
    const boot = new THREE.Mesh(G('boot', () => { const g = new THREE.BoxGeometry(0.11, 0.08, 0.26, 1, 1, 1); g.translate(0, -0.03, 0.05); return g; }), bootM);
    ankle.add(withOutline(boot, 1.1, outlines));
    return { hip, knee, ankle };
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // GK gloves
  const gloveM = toon(0xffffff);
  const gloves = [armL.hand, armR.hand].map((h) => {
    const g = new THREE.Mesh(G('glove', () => new THREE.BoxGeometry(0.12, 0.13, 0.08)), gloveM);
    g.position.copy(h.position); g.visible = false; h.parent.add(g); return g;
  });

  root.traverse((o) => { if (o.isMesh && o.material !== OUTLINE) { o.castShadow = shadows; } });
  face.castShadow = false; num.castShadow = false; numF.castShadow = false;

  const rig = { root, body, hips, torso, head, armL, armR, legL, legR, jerseyM, sockM, shortsM, accentM, gloves, hair };
  rig.setKit = (k, isGK) => {
    jerseyM.color.setHex(k.jersey); sockM.color.setHex(k.jersey); shortsM.color.setHex(k.shorts); accentM.color.setHex(k.accent);
    gloves.forEach((g) => (g.visible = !!isGK));
  };
  rig.pose = createPoseState();
  return rig;
}

function createPoseState() {
  return { phase: 0, blend: 0, look: 0 };
}

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

/**
 * Drive the rig.
 * s = { speed, maxSpeed, sprint, airborne, action: {type,t,dur,side}, hasBall, celebrate, dt, time }
 */
export function animateCharacter(rig, s) {
  const p = rig.pose;
  const dt = s.dt;
  const k = 1 - Math.exp(-dt * 14);
  const run = Math.min(1, s.speed / 6);
  const sprintAmt = s.sprint ? Math.min(1, s.speed / 8) : 0;
  p.phase += dt * (s.speed * 1.55 + 1.5 * run);
  const ph = p.phase;

  // base targets — idle / run cycle
  const T = {
    bodyY: 0, bodyX: 0, bodyZ: 0, bodySpin: 0,
    torsoX: 0.05 + run * 0.18 + sprintAmt * 0.2, torsoY: Math.sin(ph) * 0.18 * run, torsoZ: 0,
    headX: -0.05 - run * 0.1,
    lHip: Math.sin(ph) * (0.15 + run * 0.75 + sprintAmt * 0.25), rHip: -Math.sin(ph) * (0.15 + run * 0.75 + sprintAmt * 0.25),
    lKnee: Math.max(0, -Math.cos(ph)) * (0.2 + run * 1.2) + 0.05, rKnee: Math.max(0, Math.cos(ph)) * (0.2 + run * 1.2) + 0.05,
    lSh: Math.sin(ph) * (0.1 + run * 0.7), rSh: -Math.sin(ph) * (0.1 + run * 0.7),
    lShZ: 0.12 + run * 0.08, rShZ: -0.12 - run * 0.08,
    lEl: -0.25 - run * 0.9, rEl: -0.25 - run * 0.9,
    hipsY: 0.98 - Math.abs(Math.cos(ph)) * 0.05 * run,
  };
  if (s.speed < 0.3) {
    const br = Math.sin(s.time * 2.2) * 0.02;
    T.torsoX = 0.04 + br; T.lHip = 0.05; T.rHip = -0.05; T.lKnee = 0.12; T.rKnee = 0.12;
    T.lSh = 0.05; T.rSh = 0.05; T.lEl = -0.35; T.rEl = -0.35; T.hipsY = 0.96 + br * 0.4;
  }
  if (s.airborne) {
    T.lHip = -0.6; T.rHip = 0.2; T.lKnee = 1.2; T.rKnee = 0.5; T.lSh = -1.6; T.rSh = -1.6; T.lShZ = 0.5; T.rShZ = -0.5;
  }
  if (s.celebrate) {
    const c = Math.sin(s.time * 9);
    T.lSh = -2.8; T.rSh = -2.8; T.lShZ = 0.4 + c * 0.2; T.rShZ = -0.4 - c * 0.2; T.lEl = -0.1; T.rEl = -0.1;
    T.torsoX = -0.25; T.headX = -0.4;
  }

  const a = s.action;
  let instant = false;
  if (a) {
    const t = Math.min(1, a.t / a.dur);
    const side = a.side || 1; // 1 = right foot
    switch (a.type) {
      case 'kick': case 'shoot': case 'pass': {
        const power = a.type === 'shoot' ? 1 : 0.6;
        // wind-up → strike → follow-through
        const wind = t < 0.35 ? ease(t / 0.35) : 0;
        const strike = t >= 0.35 ? ease(Math.min(1, (t - 0.35) / 0.25)) : 0;
        const back = 1 - (t > 0.7 ? ease((t - 0.7) / 0.3) : 0);
        const legSwing = (wind * 1.1 * power - strike * (1.1 * power + 1.3 * power)) * back;
        const knee = wind * 1.5 * power * (1 - strike) + 0.1;
        if (side > 0) { T.rHip = legSwing; T.rKnee = knee; T.lHip = 0.15; T.lKnee = 0.25; }
        else { T.lHip = legSwing; T.lKnee = knee; T.rHip = 0.15; T.rKnee = 0.25; }
        T.torsoX = 0.1 - strike * 0.3 * power * back + wind * 0.15;
        T.torsoY = side * (wind * 0.4 - strike * 0.5) * back;
        T.lSh = -0.6 * power; T.rSh = 0.5 * power; T.lShZ = 0.9 * power; T.rShZ = -0.9 * power;
        instant = true;
        break;
      }
      case 'volley': {
        const tt = ease(t);
        T.bodyZ = -side * 1.1 * Math.sin(tt * Math.PI);
        T.rHip = -2.0 * Math.sin(tt * Math.PI); T.rKnee = 0.2; T.lHip = 0.6; T.lKnee = 1.2;
        T.lSh = -1.2; T.rSh = -0.6; T.lShZ = 1.4; T.rShZ = -1.4;
        instant = true;
        break;
      }
      case 'header': {
        const tt = Math.sin(t * Math.PI);
        T.torsoX = -0.4 + tt * 0.9; T.headX = 0.6 * tt; T.lSh = -0.6; T.rSh = -0.6; T.lShZ = 0.8; T.rShZ = -0.8;
        T.lHip = -0.3; T.rHip = 0.3; T.lKnee = 1.0; T.rKnee = 1.0;
        break;
      }
      case 'tackle': {
        // slide tackle
        const inT = Math.min(1, t / 0.2), outT = t > 0.75 ? (t - 0.75) / 0.25 : 0;
        const w = ease(inT) * (1 - ease(outT));
        T.hipsY = lerp(T.hipsY, 0.35, w);
        T.bodyX = -0.85 * w;
        T.rHip = lerp(T.rHip, -1.45, w); T.rKnee = lerp(T.rKnee, 0.05, w);
        T.lHip = lerp(T.lHip, 0.2, w); T.lKnee = lerp(T.lKnee, 2.0, w);
        T.torsoX = lerp(T.torsoX, 0.3, w);
        T.lSh = lerp(T.lSh, 0.6, w); T.rSh = lerp(T.rSh, -1.2, w); T.lShZ = lerp(0.1, 1.0, w); T.rShZ = lerp(-0.1, -0.6, w);
        instant = true;
        break;
      }
      case 'dash': {
        T.bodySpin = (a.spin || 0) * ease(t) * Math.PI * 2;
        T.torsoX += 0.25; T.lShZ = 0.8; T.rShZ = -0.8; T.lSh = 0.3; T.rSh = 0.3;
        T.bodyZ = side * 0.25 * Math.sin(t * Math.PI);
        instant = true;
        break;
      }
      case 'dive': {
        const w = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1);
        T.bodyZ = -side * 1.35 * w;
        T.bodyY = 0.4 * w;
        T.lSh = -2.9 * w; T.rSh = -2.9 * w; T.lShZ = 0.2; T.rShZ = -0.2; T.lEl = -0.05; T.rEl = -0.05;
        T.lHip = -0.2 * w; T.rHip = 0.2 * w; T.lKnee = 0.3; T.rKnee = 0.3;
        instant = true;
        break;
      }
      case 'stumble': {
        const w = Math.sin(t * Math.PI);
        T.torsoX = -0.5 * w; T.bodyX = -0.2 * w; T.lSh = -1.4 * w; T.rSh = -1.0 * w; T.lShZ = 1.2 * w; T.rShZ = -1.2 * w;
        T.lKnee = 0.6; T.rKnee = 0.6;
        break;
      }
      case 'down': {
        // flat on the back: body low, arms spread, knees bent
        T.hipsY = 0.4; T.torsoX = -1.35; T.bodyX = 0;
        T.lSh = -0.3; T.rSh = -0.3; T.lShZ = 1.5; T.rShZ = -1.5;
        T.lKnee = 0.4; T.rKnee = 0.4;
        break;
      }
      case 'getup': {
        T.hipsY = lerp(0.4, T.hipsY, ease(t)); T.torsoX = 0.6 * (1 - t);
        break;
      }
      case 'catch': {
        T.lSh = -1.4; T.rSh = -1.4; T.lShZ = 0.35; T.rShZ = -0.35; T.lEl = -0.9; T.rEl = -0.9; T.torsoX = 0.3;
        break;
      }
      case 'throw': {
        const tt = ease(t);
        T.rSh = lerp(-3.0, -0.6, tt); T.lSh = -0.6; T.torsoX = lerp(-0.3, 0.35, tt);
        T.lHip = -0.4; T.rHip = 0.4;
        break;
      }
      case 'power': {
        // special ability charge-up pose
        const w = Math.sin(Math.min(1, t * 2) * Math.PI * 0.5);
        T.torsoX = -0.25 * w; T.headX = -0.3 * w; T.lSh = -0.4; T.rSh = -0.4; T.lShZ = 1.2 * w; T.rShZ = -1.2 * w;
        T.lEl = -1.6 * w; T.rEl = -1.6 * w; T.lHip = 0.3; T.rHip = -0.3; T.lKnee = 0.5; T.rKnee = 0.5; T.hipsY = 0.9;
        break;
      }
    }
  }
  if (s.charging && !a) {
    // shot charge: plant foot, pull leg back
    T.rHip = 0.9 * s.charging; T.rKnee = 1.2 * s.charging; T.torsoX = 0.2 + 0.15 * s.charging; T.lShZ = 0.7; T.rShZ = -0.5;
  }

  const kk = instant ? 1 - Math.exp(-dt * 30) : k;
  rig.body.position.y = lerp(rig.body.position.y, T.bodyY, kk);
  rig.body.rotation.x = lerp(rig.body.rotation.x, T.bodyX, kk);
  rig.body.rotation.z = lerp(rig.body.rotation.z, T.bodyZ, kk);
  rig.body.rotation.y = T.bodySpin;
  rig.hips.position.y = lerp(rig.hips.position.y, T.hipsY, kk);
  rig.torso.rotation.x = lerp(rig.torso.rotation.x, T.torsoX, kk);
  rig.torso.rotation.y = lerp(rig.torso.rotation.y, T.torsoY, kk);
  rig.torso.rotation.z = lerp(rig.torso.rotation.z, T.torsoZ, kk);
  rig.head.rotation.x = lerp(rig.head.rotation.x, T.headX, kk);
  rig.legL.hip.rotation.x = lerp(rig.legL.hip.rotation.x, -T.lHip, kk);
  rig.legR.hip.rotation.x = lerp(rig.legR.hip.rotation.x, -T.rHip, kk);
  rig.legL.knee.rotation.x = lerp(rig.legL.knee.rotation.x, T.lKnee, kk);
  rig.legR.knee.rotation.x = lerp(rig.legR.knee.rotation.x, T.rKnee, kk);
  rig.legL.ankle.rotation.x = lerp(rig.legL.ankle.rotation.x, -T.lKnee * 0.3, kk);
  rig.legR.ankle.rotation.x = lerp(rig.legR.ankle.rotation.x, -T.rKnee * 0.3, kk);
  rig.armL.shoulder.rotation.x = lerp(rig.armL.shoulder.rotation.x, T.lSh, kk);
  rig.armR.shoulder.rotation.x = lerp(rig.armR.shoulder.rotation.x, T.rSh, kk);
  rig.armL.shoulder.rotation.z = lerp(rig.armL.shoulder.rotation.z, -T.lShZ, kk);
  rig.armR.shoulder.rotation.z = lerp(rig.armR.shoulder.rotation.z, -T.rShZ, kk);
  rig.armL.elbow.rotation.x = lerp(rig.armL.elbow.rotation.x, T.lEl, kk);
  rig.armR.elbow.rotation.x = lerp(rig.armR.elbow.rotation.x, T.rEl, kk);
  // hair sway
  rig.hair.rotation.x = lerp(rig.hair.rotation.x, -run * 0.08 - sprintAmt * 0.06, k);
}
