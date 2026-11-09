// Bootstrap: renderer, menus, match lifecycle, HUD wiring and the main loop.
import * as THREE from './vendor/three.module.min.js';
import { CHARACTERS, POSITIONS, TEAMS, rolesForSize, DIFFICULTY, BOT_NAMES, HAIR_COLORS, SKIN_TONES, BOOT_COLORS, HAIR_STYLES } from './config.js';
import { store, save } from './storage.js';
import { audio } from './audio.js';
import { buildStadium } from './game/stadium.js';
import { Effects } from './game/effects.js';
import { Match } from './game/match.js';
import { GameCamera } from './game/camera.js';
import { createControls } from './input/controls.js';
import { online } from './online/firebase.js';
import './online/panel.js';
import { MatchSync } from './online/sync.js';
let netIO = online;   // Firebase fallback; replaced by the WebRTC adapter for online matches

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const PIXEL = { low: 0.75, medium: 1, high: 1.5 };

// ── renderer & scene ───────────────────────────────────────
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: store.settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06091a);
scene.fog = new THREE.Fog(0x0a1230, 60, 150);
const cam = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
const gcam = new GameCamera(cam);
const stadium = buildStadium(scene, store.settings.quality);
const fx = new Effects(scene, store.settings.quality);
const controls = createControls({ root: document.body, cam: gcam });

function applyQuality() {
  const q = store.settings.quality;
  renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL[q] * (q === 'high' ? 2 : 1.5)));
  renderer.shadowMap.enabled = q !== 'low';
  resize();
}
// Size the drawing buffer and camera from the canvas's real on-screen box, not
// from window.innerWidth/innerHeight: inside app WebViews those values can lag
// behind the layout (toolbars, safe areas, rotation), which stretched the scene.
let lastW = 0, lastH = 0;
function resize() {
  const w = Math.round(canvas.clientWidth || innerWidth);
  const h = Math.round(canvas.clientHeight || innerHeight);
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));
window.visualViewport?.addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);
applyQuality();

// ── screens ────────────────────────────────────────────────
let mode = 'menu';   // 'menu' | 'match'
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
  const to = b.dataset.go;
  if (to === 'chars') renderChars();
  if (to === 'cust') renderCust();
  if (to === 'profile') renderProfile();
  if (to === 'lineup') renderLineup();
  if (to === 'menu') renderMenuProfile();
  show(to);
}));
function renderMenuProfile() {
  const p = store.profile;
  const need = store.xpForLevel(p.level);
  $('pName').textContent = p.name;
  $('pMeta').textContent = `المستوى ${p.level}  ·  ${store.character().name}`;
  $('avatar').textContent = (p.name || 'S').trim().charAt(0).toUpperCase();
  $('pXp').style.width = Math.min(100, (p.xp / need) * 100).toFixed(1) + '%';
}

// ── characters ─────────────────────────────────────────────
function renderChars() {
  const bar = (v) => `<div class="stat"><span>${v.k}</span><i><b style="width:${v.v}%"></b></i></div>`;
  $('charList').innerHTML = CHARACTERS.map((c) => {
    const st = [['سرعة', c.stats.spd], ['تسديد', c.stats.sht], ['تمرير', c.stats.pas], ['مراوغة', c.stats.drb], ['دفاع', c.stats.def]]
      .map(([k, v]) => bar({ k, v })).join('');
    return `<div class="card ${c.id === store.characterId ? 'on' : ''}" data-id="${c.id}">
      <h3>${c.name}</h3><small>${c.title}</small>${st}
      <div class="ab">✦ ${c.ability.name}: ${c.ability.desc}</div></div>`;
  }).join('');
  $('charList').querySelectorAll('.card').forEach((el) => el.onclick = () => {
    store.characterId = el.dataset.id; renderChars(); renderMenuProfile();
  });
}

// ── customisation ──────────────────────────────────────────
function renderCust() {
  const c = store.character();
  const look = store.look();
  $('custTitle').textContent = `تخصيص ${c.name}`;
  const swatches = (list, key, cur) => list.map((v) =>
    `<button class="${v === cur ? 'on' : ''}" data-k="${key}" data-v="${v}" style="background:${hex(v)}"></button>`).join('');
  $('custStyles').innerHTML = HAIR_STYLES.map((s) =>
    `<button class="${s.id === look.hairStyle ? 'on' : ''}" data-k="hairStyle" data-v="${s.id}">${s.name}</button>`).join('');
  $('custHair').innerHTML = swatches(HAIR_COLORS, 'hair', look.hair);
  $('custSkin').innerHTML = swatches(SKIN_TONES, 'skin', look.skin);
  $('custBoots').innerHTML = swatches(BOOT_COLORS, 'boots', look.boots);
  $('custNumber').value = look.number;
  document.querySelectorAll('#cust [data-k]').forEach((el) => el.onclick = () => {
    const v = el.dataset.k === 'hairStyle' ? el.dataset.v : +el.dataset.v;
    store.setCustom(c.id, { [el.dataset.k]: v });
    renderCust();
  });
  $('custNumber').onchange = (e) => {
    store.setCustom(c.id, { number: Math.max(1, Math.min(99, +e.target.value || 10)) });
  };
}

// ── profile ────────────────────────────────────────────────
function renderProfile() {
  const p = store.profile;
  $('pname').value = p.name;
  $('pstats').innerHTML = [
    ['المستوى', p.level], ['الخبرة', `${p.xp}/${store.xpForLevel(p.level)}`],
    ['فوز', p.wins], ['تعادل', p.draws], ['خسارة', p.losses], ['أهداف', p.goals],
  ].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
}
$('pname').onchange = (e) => { store.setName(e.target.value.trim()); renderMenuProfile(); };

// ── settings ───────────────────────────────────────────────
const S = store.settings;
document.querySelectorAll('[data-set]').forEach((el) => {
  const k = el.dataset.set;
  if (el.type === 'checkbox') el.checked = !!S[k];
  else el.value = S[k];
  el.onchange = () => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.hasAttribute('data-num') || el.type === 'range') v = +v;
    store.setSetting(k, v);
    if (k === 'quality') applyQuality();
    if (k === 'music' || k === 'sfx' || k === 'muted') audio.applyVolumes();
  };
});

// ── lineup ─────────────────────────────────────────────────
let lineupRole = 'ST';

window.PS_GET_PLAYER_CONFIG = () => ({
  role: lineupRole,
  char: JSON.parse(JSON.stringify(store.character())),
  look: JSON.parse(JSON.stringify(store.look())),
  name: store.profile.name,
});
window.PS_GET_MATCH_SETTINGS = () => JSON.parse(JSON.stringify(store.settings));
function renderLineup() {
  const roles = rolesForSize(store.settings.teamSize);
  if (!roles.includes(lineupRole)) lineupRole = roles.find((r) => r !== 'GK') || roles[0];
  $('roleCards').innerHTML = roles.map((r) =>
    `<button class="role-card ${r === lineupRole ? 'on' : ''}" data-r="${r}">
       <span class="ic">${POSITIONS[r].icon}</span><b>${POSITIONS[r].name}</b><small>${POSITIONS[r].desc}</small>
     </button>`).join('');
  const describe = () => { $('roleDesc').textContent = `اخترت: ${POSITIONS[lineupRole].name} — ${POSITIONS[lineupRole].desc}`; };
  $('roleCards').querySelectorAll('.role-card').forEach((b) => b.onclick = () => {
    lineupRole = b.dataset.r;
    $('roleCards').querySelectorAll('.role-card').forEach((x) => x.classList.toggle('on', x === b));
    describe();
  });
  describe();
}

// ── HUD helpers ────────────────────────────────────────────
let toastT = 0, bigT = 0, lastSec = -1, paused = false, ended = false;
function showToast(text, color = '#ffffff', dur = 1.2) {
  const el = $('toast');
  el.textContent = text; el.style.color = color; el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  toastT = dur;
}
function showBig(text, dur) {
  const el = $('big');
  el.textContent = text; el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  bigT = dur;
}
const fmt = (sec) => { const c = Math.max(0, Math.ceil(sec)); return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`; };

// ── match lifecycle ────────────────────────────────────────
let match = null;

let currentMode = 'normal';   // 'normal' | 'training' | 'ranked' | 'online'
let networkSession = null;
let netSync = null, netHub = null, netWarned = false;
let remotePrev = {};
let remoteCharge = 0;
let remoteCharging = false;
function startMatch(kind = 'normal', network = null) {
  currentMode = network ? 'online' : kind;
  networkSession = network ? { ...network, inputs: {}, lastSend: 0, lastInput: 0, lastStateAt: 0, inputWriteBusy: false, stateWriteBusy: false, inputSeq: 0, ended: false, offInput: null, offState: null } : null;
  remotePrev = {}; remoteCharge = 0; remoteCharging = false;
  audio.unlock();
  audio.playMusic('match');
  if (match) { match.dispose(); match = null; }
  const s = network?.room?.matchSettings || store.settings;
  const training = kind === 'training';
  const localPlayer = network?.localPlayer || null;
  const remotePlayer = network?.remotePlayer || null;
  const onlinePlayers = network?.room?.players?.map((m) => ({
    ...m, descriptor: { ...(m.player || {}), uid: m.uid, name: m.name, isLocal: m.uid === online.user?.uid },
  })) || null;
  netWarned = false;
  if (localPlayer) lineupRole = localPlayer.role;
  const roles = training ? ['ST'] : rolesForSize(s.teamSize);
  if (localPlayer && !roles.includes(localPlayer.role)) localPlayer.role = roles.find((r) => r !== 'GK') || roles[0];
  if (remotePlayer && !roles.includes(remotePlayer.role)) remotePlayer.role = roles.find((r) => r !== 'GK') || roles[0];
  if (!roles.includes(lineupRole)) lineupRole = roles.find((r) => r !== 'GK') || roles[0];
  const names = shuffle(BOT_NAMES);
  const lineup = {};
  for (const r of roles) if (r !== lineupRole) lineup[r] = names.pop();

  const hooks = {
    kickoff: () => {},
    countdown: (n) => {
      if (n > 0) showBig(String(n), 0.9);
      else showBig('انطلق!', 0.8);
    },
    toast: (text, color, dur) => showToast(text, color, dur),
    goal: ({ team, scorer, own, golden }) => {
      const label = own ? 'هدف في مرماك!' : team.index === 0 ? 'هدف!' : 'هدف للمنافس';
      showToast(`${label}${scorer ? '  ' + scorer.name : ''}${golden ? '  (ذهبي)' : ''}`, team.index === 0 ? '#5ff6ff' : '#ff3352', 2.2);
      showBig('⚽ GOAL', 1.6);
    },
    shake: (a) => gcam.shake(a * 1.2),
    possess: () => {},
    special: (p, ab) => { if (p.isUser) showToast(`✦ ${ab.name}`, '#' + ab.color.toString(16).padStart(6, '0'), 1.4); },
    end: (res) => {
      if (networkSession?.role === 'host') online.closeRoom(networkSession.code, 'ended').catch(() => {});
      document.dispatchEvent(new CustomEvent('ps:matchend', { detail: { ...res, mode: currentMode } }));
      showResults(res);
    },
  };

  netHub = network?.io || null;
  netSync = network && netHub ? new MatchSync({ hub: netHub, isHost: network.role === 'host', myUid: online.user?.uid, hostUid: network.room?.host, hooks }) : null;
  const matchHooks = netSync ? netSync.hooks : hooks;
  const localNet = onlinePlayers?.find((m) => m.uid === online.user?.uid)?.descriptor || null;
  const userDescriptor = localNet || localPlayer || { role: training ? 'ST' : lineupRole, char: store.character(), look: store.look(), name: store.profile.name };
  match = new Match({
    scene, stadium, fx, cam: gcam, settings: s,
    user: userDescriptor,
    remoteUser: remotePlayer,
    networkPlayers: onlinePlayers,
    userTeamIndex: localNet ? (network.room.players.find((m) => m.uid === online.user?.uid)?.team ?? 0) : network?.role === 'guest' ? 1 : 0,
    networkGuest: !!network,
    net: network ? { isHost: network.role === 'host' } : null,
    lineup, hooks: matchHooks, training,
  });
  netSync?.attach(match);
  gcam.snap(match.user);
  mode = 'match';
  paused = false; ended = false; lastSec = -1;
  show(null);
  $('hud').classList.remove('hidden');
  $('touch').classList.remove('hidden');
  controls.setEnabled(true);
  $('pauseMenu').classList.add('hidden');
  $('clock').textContent = training ? 'تدريب' : fmt(match.clock);

}

function endToMenu() {
  if (networkSession) {
    netSync?.close(); netSync = null; netHub?.close(); netHub = null;
    if (networkSession.role === 'host') online.closeRoom(networkSession.code, 'closed').catch(() => {});
    networkSession = null;
  }
  if (match) { match.dispose(); match = null; }
  controls.setEnabled(false);
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  $('big').classList.add('hidden');
  $('toast').classList.add('hidden');
  mode = 'menu';
  audio.playMusic('menu');
  renderMenuProfile();
  show('menu');
}

function showResults(res) {
  ended = true;
  controls.setEnabled(false);
  const goals = res.user.goals;
  const r = store.addResult({ result: res.result, goals });
  const [a, b] = TEAMS;
  $('resTitle').textContent = res.result === 'win' ? 'فوز' : res.result === 'draw' ? 'تعادل' : 'خسارة';
  $('resBody').innerHTML = `
    <div class="score-line"><div>${a.name}</div><b>${res.score[0]}</b><span>—</span><b>${res.score[1]}</b><div>${b.name}</div></div>
    <div class="res-stats">
      <div>الاستحواذ <b>${res.possession[0]}% · ${res.possession[1]}%</b></div>
      <div>التسديدات <b>${res.shots[0]} · ${res.shots[1]}</b></div>
      <div>أهدافك <b>${goals}</b></div>
      <div>تصدياتك <b>${res.user.saves}</b></div>
    </div>
    <div class="xp-line">+${r.gained} خبرة${r.levelUps ? ` · ارتفعت إلى المستوى ${store.profile.level}` : ''}</div>`;
  setTimeout(() => {
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    mode = 'menu';
    if (networkSession) {
      netSync?.close(); netSync = null; netHub?.close(); netHub = null;
      networkSession = null;
    }
    audio.playMusic('menu');
    show('results');
  }, 1600);
}

// pause
function pause(v) {
  if (mode !== 'match' || ended) return;
  if (networkSession) { showToast('لا يمكن إيقاف مباراة الأونلاين', '#ffd23f', 1.5); return; }
  paused = v;
  controls.setEnabled(!v);
  $('pauseMenu').classList.toggle('hidden', !v);
}
$('pause').onclick = () => pause(true);
$('resume').onclick = () => pause(false);
$('quit').onclick = () => { endToMenu(); };
addEventListener('keydown', (e) => { if (e.code === 'Escape' || e.code === 'KeyP') { if (paused) pause(false); else pause(true); } });

// kick off
$('kick').onclick = () => startMatch('normal');
$('btnTraining').onclick = () => startMatch('training');
// online panel asks to start a ranked match (vs a bot after the search timeout)
document.addEventListener('ps:start', (e) => startMatch(e.detail?.mode || 'ranked'));
document.addEventListener('ps:online-start', (e) => {
  const d = e.detail;
  if (!d) return;
  const room = d.room;
  const local = room.players?.find((m) => m.uid === online.user?.uid);
  if (!local) return;
  startMatch('online', { role: d.role, code: d.code, room, localPlayer: local.player, io: d.io });
});

// first gesture unlocks the Web Audio engine (iOS requirement)
// UI sound: every menu/screen button gives a soft click (primary ones a chime)
addEventListener('pointerdown', (e) => {
  const el = e.target.closest?.('button:not(.btn-act), .card, .role-card, .nav-btn, .swatches button, .chips button, input[type=checkbox].toggle');
  if (!el || el.disabled || el.closest('#hud, #touch')) return;
  if (el.classList.contains('primary') || el.classList.contains('nav-btn') && el.classList.contains('primary')) audio.select();
  else audio.click();
});
addEventListener('pointerdown', () => {
  audio.unlock();
  const root = document.documentElement;
  if (root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
  screen.orientation?.lock?.('landscape').catch(() => {});
}, { once: true });

// ── HUD update ─────────────────────────────────────────────
function updateHud(dt) {
  const m = match, u = m.user;
  $('sA').textContent = m.teams[0].score;
  $('sB').textContent = m.teams[1].score;
  const sec = Math.ceil(m.clock);
  if (m.training) {
    if (lastSec !== -2) { lastSec = -2; $('clock').textContent = 'تدريب'; stadium.drawScore(m.teams[0].score, m.teams[1].score, 'تدريب', 'NOVA', 'FANG'); }
  } else if (sec !== lastSec) {
    lastSec = sec;
    $('clock').textContent = m.golden ? 'ذهبي' : fmt(m.clock);
    stadium.drawScore(m.teams[0].score, m.teams[1].score, m.golden ? 'ذهبي' : fmt(m.clock), 'NOVA', 'FANG');
  }
  $('energyFill').style.width = (u.energy * 100).toFixed(1) + '%';
  $('staminaFill').style.width = (u.stamina * 100).toFixed(1) + '%';
  $('chargeBox').classList.toggle('hidden', !controls.charging);
  $('chargeFill').style.width = (controls.charge * 100).toFixed(1) + '%';
  $('btnSpecial').classList.toggle('ready', u.energy >= 1);
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.add('hidden'); }
  if (bigT > 0) { bigT -= dt; if (bigT <= 0) $('big').classList.add('hidden'); }
}

// ── debug line: open the game with ?debug=1 to see network counters on screen ──
const DEBUG = new URLSearchParams(location.search).has('debug');
const dbgEl = DEBUG ? Object.assign(document.createElement('pre'), { style: 'position:fixed;left:4px;bottom:4px;z-index:50;background:rgba(0,0,0,.65);color:#9ff59f;font:11px/1.35 monospace;padding:4px 6px;margin:0;pointer-events:none;direction:ltr' }) : null;
if (dbgEl) document.body.appendChild(dbgEl);
function connectionCheck() {
  if (!netHub || netWarned) return;
  const t = Object.values(netHub.lastHeard || {});
  if (t.length && Date.now() - Math.max(...t) > 8000) { netWarned = true; showToast('انقطع الاتصال مع أحد اللاعبين', '#ff3352', 3); }
}
function debugLine() {
  if (!dbgEl || !networkSession) return;
  const s = networkSession, now = Date.now();
  const ins = Object.values(s.inputs || {});
  const inAge = ins.length ? now - Math.max(...ins.map((e) => e.recv || 0)) : -1;
  dbgEl.textContent =
    `build=authority-1 ${s.role} room=${s.code} phase=${match?.phase} players=${match?.players.length}\n` +
    `rtc: ${netHub ? netHub.status() : '-'}\n` +
    `state rx=${s.stateCount || 0} age=${s.stateAt ? now - s.stateAt : -1}ms tx=${s.stateSent || 0}\n` +
    `input tx=${s.inputSent || 0} rx-age=${inAge}ms\n` +
    `last error: ${s.lastErr || '-'}`;
}

// ── main loop ──────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  resize();   // cheap: only acts when the real canvas size changed
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (mode === 'match' && match) {
    if (!paused && !ended) {
      match.update(dt, (p, d) => controls.apply(p, d, match));
      netSync?.tick(performance.now());
      match.updateNetworkVisuals(dt);   // other players' characters and a ball held by someone else
      connectionCheck();
      if (!ended) updateHud(dt);
      debugLine();
    }
    stadium.update(match.time, dt, match.excite ?? 0.2);
    fx.update(dt, cam, match.ball.pos, match.ball.speed, match.ball.hot);
    gcam.update(dt, match.user);
  } else {
    // menu: slow orbit around the empty stadium
    const t = now / 1000;
    cam.position.set(Math.sin(t * 0.08) * 36, 13, Math.cos(t * 0.08) * 36);
    cam.lookAt(0, 1, 0);
    stadium.update(t, dt, 0.15);
    fx.update(dt, cam, new THREE.Vector3(0, -10, 0), 0, 0);
  }
  renderer.render(scene, cam);
}

renderMenuProfile();
audio.playMusic('menu');
requestAnimationFrame(frame);
