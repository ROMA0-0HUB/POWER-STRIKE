// The Power Striker arena: an enclosed, futuristic training dome.
import * as THREE from '../vendor/three.module.min.js';
import { FIELD } from '../config.js';
import { makePitchTexture, makeNoiseTexture, makeNetTexture, makeBannerTexture, makeGlowTexture } from './textures.js';

export function buildStadium(scene, quality = 'medium') {
  const group = new THREE.Group();
  scene.add(group);
  const hi = quality === 'high', lo = quality === 'low';

  // ── lighting ──────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x1c3a22, 1.1);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(14, 38, 18);
  sun.castShadow = !lo;
  const sz = hi ? 2048 : 1024;
  sun.shadow.mapSize.set(sz, sz);
  const sc = sun.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 38; sc.bottom = -38; sc.near = 5; sc.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  group.add(sun); group.add(sun.target);
  const rim = new THREE.DirectionalLight(0x4fb8ff, 0.8);
  rim.position.set(-20, 15, -30);
  group.add(rim);

  // ── pitch ─────────────────────────────────────────────
  const { tex, size } = makePitchTexture(lo ? 1024 : 2048);
  const bump = makeNoiseTexture(256, 60);
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(size.w, size.l),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, bumpMap: bump, bumpScale: 0.6 })
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  group.add(pitch);

  // 3D grass tufts scattered over the pitch (instanced, very cheap)
  if (!lo) {
    const tuftGeo = new THREE.ConeGeometry(0.035, 0.12, 3, 1, true);
    tuftGeo.translate(0, 0.06, 0);
    const count = hi ? 9000 : 4500;
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshLambertMaterial({ color: 0x3a9a46 }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      p.set((Math.random() - 0.5) * (FIELD.W - 1), 0, (Math.random() - 0.5) * FIELD.L);
      e.set((Math.random() - 0.5) * 0.5, Math.random() * 6, (Math.random() - 0.5) * 0.5); q.setFromEuler(e);
      const k = 0.7 + Math.random() * 0.8; s.set(k, k, k);
      m.compose(p, q, s); tufts.setMatrixAt(i, m);
      col.setHSL(0.31 + Math.random() * 0.04, 0.55, 0.28 + Math.random() * 0.12); tufts.setColorAt(i, col);
    }
    group.add(tufts);
  }

  // outer floor (dark tech floor around the pitch)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 160),
    new THREE.MeshStandardMaterial({ color: 0x070b16, roughness: 0.5, metalness: 0.6 })
  );
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02;
  group.add(floor);

  // ── walls: LED dasher boards + glass ─────────────────
  const boardTex = makeBannerTexture('POWER STRIKER', '', 1024, 96, '#5ff6ff');
  boardTex.wrapS = THREE.RepeatWrapping;
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x050a18, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 1.1, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.4, side: THREE.DoubleSide, depthWrite: false });
  const neonCyan = new THREE.MeshBasicMaterial({ color: 0x5ff6ff });
  const neonBlue = new THREE.MeshBasicMaterial({ color: 0x2f7bff });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0e1526, metalness: 0.8, roughness: 0.35 });

  const boardH = 0.9, gH = FIELD.wallH;
  const addWall = (len, x, z, rotY, withOpening = false) => {
    const segs = withOpening ? [[-len / 2, -FIELD.goalW / 2 - 0.1], [FIELD.goalW / 2 + 0.1, len / 2]] : [[-len / 2, len / 2]];
    for (const [a, b] of segs) {
      const L = b - a, mid = (a + b) / 2;
      const w = new THREE.Group();
      w.position.set(x, 0, z); w.rotation.y = rotY;
      const tb = boardTex.clone(); tb.repeat.set(L / 14, 1); tb.needsUpdate = true;
      const bm = boardMat.clone(); bm.emissiveMap = tb;
      const board = new THREE.Mesh(new THREE.BoxGeometry(L, boardH, 0.25), bm);
      board.position.set(mid, boardH / 2, 0); board.receiveShadow = true;
      w.add(board);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(L, gH - boardH), glassMat);
      glass.position.set(mid, boardH + (gH - boardH) / 2, 0);
      w.add(glass);
      const top = new THREE.Mesh(new THREE.BoxGeometry(L, 0.08, 0.08), neonCyan);
      top.position.set(mid, gH, 0); w.add(top);
      const base = new THREE.Mesh(new THREE.BoxGeometry(L, 0.05, 0.3), neonBlue);
      base.position.set(mid, boardH + 0.02, 0); w.add(base);
      // vertical frame posts
      const n = Math.max(1, Math.round(L / 6));
      for (let i = 0; i <= n; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, gH, 0.12), frameMat);
        post.position.set(a + (L * i) / n, gH / 2, 0); w.add(post);
      }
      group.add(w);
    }
    if (withOpening) {
      // wall above the goal
      const w = new THREE.Group(); w.position.set(x, 0, z); w.rotation.y = rotY;
      const above = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.goalW + 0.2, gH - FIELD.goalH - 0.6), glassMat);
      above.position.set(0, FIELD.goalH + 0.6 + (gH - FIELD.goalH - 0.6) / 2, 0); w.add(above);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(FIELD.goalW + 0.2, 0.6, 0.25), bm2());
      lip.position.set(0, FIELD.goalH + 0.3, 0); w.add(lip);
      group.add(w);
    }
  };
  const bm2 = () => new THREE.MeshStandardMaterial({ color: 0x050a18, emissive: 0x2f7bff, emissiveIntensity: 0.6 });
  addWall(FIELD.L, -FIELD.HW - 0.13, 0, Math.PI / 2);
  addWall(FIELD.L, FIELD.HW + 0.13, 0, -Math.PI / 2);
  addWall(FIELD.W, 0, -FIELD.HL - 0.13, 0, true);
  addWall(FIELD.W, 0, FIELD.HL + 0.13, Math.PI, true);

  // ── goals ─────────────────────────────────────────────
  const goals = [];
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.3, emissive: 0x223344 });
  const netTex = makeNetTexture();
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const gz = s * FIELD.HL;
    const R = 0.07;
    const postGeo = new THREE.CylinderGeometry(R, R, FIELD.goalH, 12);
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(sx * FIELD.goalW / 2, FIELD.goalH / 2, gz); p.castShadow = true; g.add(p);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, FIELD.goalH, 6), postMat);
      back.position.set(sx * FIELD.goalW / 2, FIELD.goalH / 2, gz + s * FIELD.goalD); g.add(back);
      const topSide = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, FIELD.goalD, 6), postMat);
      topSide.rotation.x = Math.PI / 2; topSide.position.set(sx * FIELD.goalW / 2, FIELD.goalH, gz + s * FIELD.goalD / 2); g.add(topSide);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(R, R, FIELD.goalW + R * 2, 12), postMat);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, FIELD.goalH, gz); bar.castShadow = true; g.add(bar);
    // glowing goal line
    const line = new THREE.Mesh(new THREE.BoxGeometry(FIELD.goalW, 0.02, 0.14), new THREE.MeshBasicMaterial({ color: s < 0 ? 0xff3352 : 0x2f7bff }));
    line.position.set(0, 0.01, gz); g.add(line);

    const netMat = (rx, ry) => {
      const t = netTex.clone(); t.repeat.set(rx, ry); t.needsUpdate = true;
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: 0xe8f4ff });
    };
    const cell = 0.22;
    const backGeo = new THREE.PlaneGeometry(FIELD.goalW, FIELD.goalH, 14, 6);
    const back = new THREE.Mesh(backGeo, netMat(FIELD.goalW / cell, FIELD.goalH / cell));
    back.position.set(0, FIELD.goalH / 2, gz + s * FIELD.goalD); g.add(back);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.goalD, FIELD.goalH), netMat(FIELD.goalD / cell, FIELD.goalH / cell));
      side.rotation.y = Math.PI / 2; side.position.set(sx * FIELD.goalW / 2, FIELD.goalH / 2, gz + s * FIELD.goalD / 2); g.add(side);
    }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.goalW, FIELD.goalD), netMat(FIELD.goalW / cell, FIELD.goalD / cell));
    top.rotation.x = Math.PI / 2; top.position.set(0, FIELD.goalH, gz + s * FIELD.goalD / 2); g.add(top);
    group.add(g);
    goals.push({ side: s, back, base: backGeo.attributes.position.array.slice(), ripple: -1, rx: 0, ry: 0 });
  }

  // ── stands + crowd ────────────────────────────────────
  const standMat = new THREE.MeshStandardMaterial({ color: 0x0c1324, metalness: 0.5, roughness: 0.6 });
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x17223d, metalness: 0.3, roughness: 0.7 });
  const seats = [];
  const tiers = 8, tierD = 1.1, tierH = 0.65;
  const buildStand = (len, cx, cz, rotY, startOff) => {
    const sg = new THREE.Group(); sg.position.set(cx, 0, cz); sg.rotation.y = rotY;
    for (let t = 0; t < tiers; t++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, tierH * (t + 1) + 1.4, tierD), t % 2 ? standMat : stepMat);
      step.position.set(0, (tierH * (t + 1) + 1.4) / 2, -(startOff + t * tierD + tierD / 2));
      sg.add(step);
      // neon rail on every other tier
      if (t % 3 === 0) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), t % 2 ? neonBlue : neonCyan);
        rail.position.set(0, tierH * (t + 1) + 1.42, -(startOff + t * tierD + 0.05)); sg.add(rail);
      }
      for (let x = -len / 2 + 0.5; x < len / 2 - 0.4; x += 0.75) {
        seats.push({ g: sg, x: x + (Math.random() - 0.5) * 0.2, y: tierH * (t + 1) + 1.4, z: -(startOff + t * tierD + tierD * 0.5) });
      }
    }
    group.add(sg);
    return sg;
  };
  const sides = [
    buildStand(FIELD.L + 8, -FIELD.HW, 0, Math.PI / 2, 1.2),
    buildStand(FIELD.L + 8, FIELD.HW, 0, -Math.PI / 2, 1.2),
    buildStand(FIELD.W, 0, -FIELD.HL - FIELD.goalD, 0, 1.0),
    buildStand(FIELD.W, 0, FIELD.HL + FIELD.goalD, Math.PI, 1.0),
  ];
  sides.forEach((s) => s.updateMatrixWorld(true));

  const fanRatio = lo ? 0.3 : hi ? 1 : 0.6;
  const fanSeats = seats.filter(() => Math.random() < fanRatio);
  const fanGeo = new THREE.CapsuleGeometry(0.2, 0.45, 2, 6);
  fanGeo.translate(0, 0.42, 0);
  const crowdMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, excite: { value: 0.2 } },
    vertexShader: `
      uniform float time; uniform float excite;
      varying vec3 vColor; varying float vShade;
      void main(){
        vec4 wp = instanceMatrix * vec4(position, 1.0);
        float seed = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 0.71;
        float jump = abs(sin(time * (6.0 + fract(seed) * 4.0) + seed * 3.0));
        wp.y += jump * (0.05 + excite * 0.45) * step(0.35, fract(seed * 7.3) + excite * 0.6);
        vColor = instanceColor;
        vShade = 0.55 + 0.45 * normal.y + 0.25 * (position.y);
        gl_Position = projectionMatrix * modelViewMatrix * wp;
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vShade;
      void main(){ gl_FragColor = vec4(vColor * vShade, 1.0); }`,
  });
  const crowd = new THREE.InstancedMesh(fanGeo, crowdMat, fanSeats.length);
  const m = new THREE.Matrix4(), v = new THREE.Vector3(), col = new THREE.Color();
  const palette = [0x2f7bff, 0x5ff6ff, 0xffffff, 0xe0283f, 0x1b2a4a, 0xffb13b, 0x2f7bff, 0x8899bb];
  fanSeats.forEach((s, i) => {
    v.set(s.x, s.y, s.z).applyMatrix4(s.g.matrixWorld);
    m.makeTranslation(v.x, v.y, v.z); crowd.setMatrixAt(i, m);
    col.setHex(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.55 + Math.random() * 0.45);
    crowd.setColorAt(i, col);
  });
  crowd.frustumCulled = false;
  group.add(crowd);

  // enclosing dome shell
  const shell = new THREE.Mesh(new THREE.BoxGeometry(72, 18.6, 98), new THREE.MeshStandardMaterial({ color: 0x060a14, roughness: 0.8, metalness: 0.4, side: THREE.BackSide }));
  shell.position.y = 9.2; group.add(shell);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 96), k === 1 ? neonBlue : neonCyan);
    strip.position.set(sx * 35.9, 9 + k * 2.2, 0); group.add(strip);
  }

  // ── roof: dome frame, hex light panels, light beams ──
  const roofY = 17;
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(120, 140), new THREE.MeshBasicMaterial({ color: 0x03060e, side: THREE.DoubleSide }));
  roof.rotation.x = Math.PI / 2; roof.position.y = roofY + 0.3; group.add(roof);
  const hexGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.12, 6, 1, true);
  const hexCount = lo ? 40 : 90;
  const hexMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(1.45, 0.06, 4, 6), new THREE.MeshBasicMaterial({ color: 0x5ff6ff }), hexCount);
  hexGeo.dispose();
  let hi2 = 0;
  for (let r = 0; r < 14 && hi2 < hexCount; r++) for (let c = 0; c < 8 && hi2 < hexCount; c++) {
    const x = (c - 3.5) * 2.6 * 1.0 + (r % 2 ? 1.3 : 0), z = (r - 6.5) * 2.25 * 2;
    if (Math.abs(x) > 18 || Math.abs(z) > 30) continue;
    m.compose(new THREE.Vector3(x, roofY, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI / 6)), new THREE.Vector3(1, 1, 1));
    hexMesh.setMatrixAt(hi2++, m);
  }
  hexMesh.count = hi2;
  group.add(hexMesh);
  // long neon beams on the roof
  for (const x of [-14, 14]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, FIELD.L + 10), neonCyan);
    b.position.set(x, roofY - 0.2, 0); group.add(b);
  }
  for (let z = -30; z <= 30; z += 12) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(FIELD.W + 16, 0.6, 0.6), frameMat);
    b.position.set(0, roofY - 0.4, z); group.add(b);
    const n = new THREE.Mesh(new THREE.BoxGeometry(FIELD.W + 16, 0.06, 0.06), neonBlue);
    n.position.set(0, roofY - 0.75, z); group.add(n);
  }
  // volumetric light cones
  if (!lo) {
    const coneMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const coneGeo = new THREE.ConeGeometry(5, roofY, 20, 1, true);
    for (const [x, z] of [[-10, -18], [10, -18], [-10, 0], [10, 0], [-10, 18], [10, 18]]) {
      const c = new THREE.Mesh(coneGeo, coneMat);
      c.position.set(x, roofY / 2, z); group.add(c);
    }
  }

  // ── big screens above the ends ───────────────────────
  const screens = [];
  const scoreCanvas = document.createElement('canvas'); scoreCanvas.width = 512; scoreCanvas.height = 192;
  const scoreTex = new THREE.CanvasTexture(scoreCanvas); scoreTex.colorSpace = THREE.SRGBColorSpace;
  for (const s of [-1, 1]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.25), new THREE.MeshBasicMaterial({ map: scoreTex }));
    scr.position.set(0, 12, s * (FIELD.HL + 12)); scr.rotation.y = s < 0 ? 0 : Math.PI; group.add(scr);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(14.6, 5.8, 0.3), frameMat);
    frame.position.copy(scr.position); frame.position.z += s * 0.2; group.add(frame);
    screens.push(scr);
  }
  const drawScore = (a = 0, b = 0, time = '3:00', teamA = 'NOVA', teamB = 'FANG', msg = '') => {
    const g = scoreCanvas.getContext('2d');
    g.fillStyle = '#020615'; g.fillRect(0, 0, 512, 192);
    g.strokeStyle = '#5ff6ff'; g.lineWidth = 4; g.strokeRect(6, 6, 500, 180);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 italic 30px Impact, Arial Black, sans-serif';
    g.fillStyle = '#2f7bff'; g.fillText(teamA, 110, 44);
    g.fillStyle = '#ff3352'; g.fillText(teamB, 402, 44);
    g.font = '900 96px Impact, Arial Black, sans-serif'; g.fillStyle = '#ffffff';
    g.fillText(`${a}`, 110, 120); g.fillText(`${b}`, 402, 120);
    g.font = '700 42px monospace'; g.fillStyle = '#5ff6ff'; g.fillText(msg || time, 256, 120);
    g.font = '900 italic 22px Impact, Arial Black, sans-serif'; g.fillStyle = '#7f8db0'; g.fillText('POWER STRIKER', 256, 44);
    scoreTex.needsUpdate = true;
  };
  drawScore();

  // ── ambient floating dust/glow sprites ───────────────
  const glowTex = makeGlowTexture();
  const glows = [];
  for (const [x, z] of [[-FIELD.HW, -FIELD.HL], [FIELD.HW, -FIELD.HL], [-FIELD.HW, FIELD.HL], [FIELD.HW, FIELD.HL]]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x5ff6ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(x, FIELD.wallH, z); sp.scale.set(5, 5, 1); group.add(sp); glows.push(sp);
  }

  return {
    group, sun, goals, drawScore,
    update(t, dt, excite) {
      crowdMat.uniforms.time.value = t;
      crowdMat.uniforms.excite.value += (excite - crowdMat.uniforms.excite.value) * Math.min(1, dt * 3);
      boardTex.offset.x = (t * 0.05) % 1;
      glows.forEach((g, i) => { g.material.opacity = 0.45 + Math.sin(t * 2 + i) * 0.15; });
      for (const g of goals) {
        if (g.ripple < 0) continue;
        g.ripple += dt;
        const pos = g.back.geometry.attributes.position;
        const amp = Math.exp(-g.ripple * 2.5) * 0.9;
        for (let i = 0; i < pos.count; i++) {
          const bx = g.base[i * 3], by = g.base[i * 3 + 1];
          const d = Math.hypot(bx - g.rx, by - g.ry);
          pos.array[i * 3 + 2] = g.side * Math.max(0, 1 - d / 3) * amp * Math.cos(g.ripple * 14 - d * 3);
        }
        pos.needsUpdate = true;
        if (g.ripple > 2) { g.ripple = -1; pos.array.set(g.base); pos.needsUpdate = true; }
      }
    },
    rippleNet(side, x, y) {
      const g = goals.find((q) => q.side === side);
      if (!g) return;
      g.ripple = 0; g.rx = x; g.ry = y - FIELD.goalH / 2;
    },
  };
}
