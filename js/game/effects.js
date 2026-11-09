// Lightweight GPU-friendly effects: a single pooled particle system, a ball
// trail ribbon, shockwave rings and dash afterimages. Everything is pooled to
// avoid garbage collection hitches on mobile Safari.
import * as THREE from '../vendor/three.module.min.js';

const MAX_P = 700;

export class Effects {
  constructor(scene, quality = 'medium') {
    this.scene = scene;
    this.scale = quality === 'low' ? 0.5 : quality === 'high' ? 1 : 0.75;
    // ── particles ──
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_P * 3);
    this.pCol = new Float32Array(MAX_P * 3);
    this.pSize = new Float32Array(MAX_P);
    this.pAlpha = new Float32Array(MAX_P);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vC = aColor; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA; if (a < 0.01) discard;
          gl_FragColor = vec4(vC * (1.0 + (0.5 - d)), a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
    for (let i = 0; i < MAX_P; i++) this.parts.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 1, c: new THREE.Color(), g: 0, drag: 0 });
    this.pIdx = 0;

    // ── ball trail ribbon ──
    this.trailN = 22;
    this.trailPts = [];
    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(this.trailN * 2 * 3);
    this.tA = new Float32Array(this.trailN * 2);
    const idx = [];
    for (let i = 0; i < this.trailN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    tg.setIndex(idx);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('aA', new THREE.BufferAttribute(this.tA, 1).setUsage(THREE.DynamicDrawUsage));
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x5ff6ff) }, uOpacity: { value: 0 } },
      vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor * 1.4, vA * uOpacity); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.trail = new THREE.Mesh(tg, this.trailMat);
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.trailColor = new THREE.Color(0x5ff6ff);
    this.trailWidth = 0.18;

    // ── shockwave rings ──
    this.rings = [];
    const rgeo = new THREE.RingGeometry(0.8, 1, 40);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(rgeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; scene.add(m);
      this.rings.push({ m, t: 0, dur: 1, s: 1, active: false, face: false });
    }
    // ── afterimages ──
    this.ghosts = [];
    const ggeo = new THREE.CapsuleGeometry(0.28, 1.1, 2, 8);
    ggeo.translate(0, 0.85, 0);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ggeo, new THREE.MeshBasicMaterial({ color: 0x5ff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; scene.add(m);
      this.ghosts.push({ m, t: 0, dur: 0.4, active: false });
    }
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  spawn(pos, vel, color, size = 0.3, life = 0.6, gravity = 0, drag = 1.5) {
    const p = this.parts[this.pIdx];
    this.pIdx = (this.pIdx + 1) % MAX_P;
    p.alive = true; p.p.copy(pos); p.v.copy(vel); p.c.set(color); p.size = size; p.life = life; p.max = life; p.g = gravity; p.drag = drag;
  }

  burst(pos, color, count = 20, speed = 5, size = 0.3, life = 0.6, gravity = 0, up = 0) {
    const n = Math.max(3, Math.round(count * this.scale));
    for (let i = 0; i < n; i++) {
      this._v.set(Math.random() - 0.5, Math.random() - 0.5 + up, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.spawn(pos, this._v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity);
    }
  }

  confetti(pos) {
    const cols = [0x5ff6ff, 0x2f7bff, 0xffffff, 0xffd23f, 0xff3cac];
    const n = Math.round(160 * this.scale);
    for (let i = 0; i < n; i++) {
      this._v.set((Math.random() - 0.5) * 14, 6 + Math.random() * 10, (Math.random() - 0.5) * 14);
      this.spawn(pos, this._v, cols[i % cols.length], 0.25 + Math.random() * 0.2, 2.5 + Math.random(), 9, 0.8);
    }
  }

  ring(pos, color = 0xffffff, scale = 3, dur = 0.5, face = false, opacity = 0.9) {
    const r = this.rings.find((q) => !q.active) || this.rings[0];
    r.active = true; r.t = 0; r.dur = dur; r.s = scale; r.face = face; r.o = opacity;
    r.m.visible = true; r.m.position.copy(pos); r.m.material.color.set(color);
    if (!face) r.m.rotation.set(-Math.PI / 2, 0, 0);
  }

  ghost(pos, yaw, color) {
    const g = this.ghosts.find((q) => !q.active) || this.ghosts[0];
    g.active = true; g.t = 0; g.m.visible = true; g.m.position.copy(pos); g.m.rotation.y = yaw; g.m.material.color.set(color);
  }

  /** Speed streaks behind a sprinting player. */
  speedStreak(pos, vel, color = 0xbfefff) {
    if (Math.random() > this.scale) return;
    this._v.copy(vel).multiplyScalar(-0.15);
    this._w.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y + 0.3 + Math.random() * 1.2, pos.z + (Math.random() - 0.5) * 0.6);
    this.spawn(this._w, this._v, color, 0.12, 0.25, 0, 0);
  }

  aura(pos, color) {
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 0.3;
      this._w.set(pos.x + Math.cos(a) * r, pos.y + Math.random() * 0.5, pos.z + Math.sin(a) * r);
      this._v.set(0, 2 + Math.random() * 2.5, 0);
      this.spawn(this._w, this._v, color, 0.35, 0.6, 0, 0.5);
    }
  }

  setTrail(color, width = 0.18) { this.trailColor.set(color); this.trailWidth = width; }

  update(dt, camera, ballPos, ballSpeed, hot) {
    // particles
    let n = 0;
    for (let i = 0; i < MAX_P; i++) {
      const p = this.parts[i];
      if (!p.alive) { this.pAlpha[i] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; this.pAlpha[i] = 0; continue; }
      p.v.y -= p.g * dt;
      p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.p.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      this.pPos[i * 3] = p.p.x; this.pPos[i * 3 + 1] = p.p.y; this.pPos[i * 3 + 2] = p.p.z;
      this.pCol[i * 3] = p.c.r; this.pCol[i * 3 + 1] = p.c.g; this.pCol[i * 3 + 2] = p.c.b;
      this.pSize[i] = p.size * (0.5 + k * 0.5);
      this.pAlpha[i] = Math.min(1, k * 2);
      n++;
    }
    const ga = this.points.geometry.attributes;
    ga.position.needsUpdate = ga.aColor.needsUpdate = ga.aSize.needsUpdate = ga.aAlpha.needsUpdate = true;

    // trail
    const want = hot || ballSpeed > 17;
    this.trailPts.unshift(ballPos.clone());
    if (this.trailPts.length > this.trailN) this.trailPts.pop();
    const targetO = want ? 0.85 : 0;
    this.trailMat.uniforms.uOpacity.value += (targetO - this.trailMat.uniforms.uOpacity.value) * Math.min(1, dt * 10);
    this.trailMat.uniforms.uColor.value.copy(this.trailColor);
    const camPos = camera.position;
    for (let i = 0; i < this.trailN; i++) {
      const pt = this.trailPts[Math.min(i, this.trailPts.length - 1)];
      const nx = this.trailPts[Math.min(i + 1, this.trailPts.length - 1)];
      this._v.subVectors(pt, nx);
      if (this._v.lengthSq() < 1e-6) this._v.set(0, 0, 1);
      this._w.subVectors(camPos, pt).cross(this._v).normalize();
      const w = this.trailWidth * (1 - i / this.trailN) * (hot ? 2.2 : 1);
      this.tPos[i * 6] = pt.x + this._w.x * w; this.tPos[i * 6 + 1] = pt.y + this._w.y * w; this.tPos[i * 6 + 2] = pt.z + this._w.z * w;
      this.tPos[i * 6 + 3] = pt.x - this._w.x * w; this.tPos[i * 6 + 4] = pt.y - this._w.y * w; this.tPos[i * 6 + 5] = pt.z - this._w.z * w;
      const a = (1 - i / this.trailN);
      this.tA[i * 2] = this.tA[i * 2 + 1] = a * a;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.aA.needsUpdate = true;
    if (hot && Math.random() < 0.8) this.spawn(ballPos, this._v.set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), this.trailColor, 0.4, 0.4);

    // rings
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.active = false; r.m.visible = false; continue; }
      const s = 0.2 + r.s * (1 - Math.pow(1 - k, 3));
      r.m.scale.set(s, s, s);
      r.m.material.opacity = (1 - k) * r.o;
      if (r.face) r.m.quaternion.copy(camera.quaternion);
    }
    for (const g of this.ghosts) {
      if (!g.active) continue;
      g.t += dt;
      const k = g.t / g.dur;
      if (k >= 1) { g.active = false; g.m.visible = false; continue; }
      g.m.material.opacity = (1 - k) * 0.45;
    }
    return n;
  }
}
