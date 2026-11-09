// Online screen: account, rank card, ranked search (60 s, then a bot), friend
// rooms and leaderboard. Talks to the rest of the game only through DOM events:
//   emits  'ps:start'  {mode:'ranked'}   → main.js starts a match
//   listens 'ps:matchend'               → main.js reports the finished match
import { online, friendlyError, NAME_RE } from './firebase.js';
import { applyResult, tierIndex, tierProgress, TIERS } from './ranks.js';
import { RtcHub } from './rtc.js';

const $ = (id) => document.getElementById(id);
const SEARCH_SECONDS = 60;
let restored = null;        // promise: session restored once
let pendingRanked = false;  // true from "ranked" start until its result is saved
let searchT = null;

function showOnly(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── rendering ──────────────────────────────────────────────
async function render(msg = '') {
  const body = $('onlineBody');
  body.innerHTML = '<div class="group"><h3>جاري الاتصال</h3><p class="hint">لحظة...</p></div>';
  restored ??= online.restore().catch(() => null);
  await restored;
  if (!online.user) return renderAuth(msg);
  renderDashboard(msg);
}

function renderAuth(msg = '') {
  $('onlineBody').innerHTML = `
    <div class="group">
      <h3>تسجيل الدخول</h3>
      <div class="field"><label>الاسم</label><input id="authName" maxlength="14" autocomplete="username" placeholder="3 إلى 14 حرف"></div>
      <div class="field"><label>كلمة السر</label><input id="authPass" type="password" autocomplete="current-password" placeholder="6 أحرف على الأقل"></div>
      <p class="hint err" id="authErr">${esc(msg)}</p>
      <div class="foot-row">
        <button class="btn" id="btnRegister">حساب جديد</button>
        <button class="btn primary" id="btnLogin">دخول</button>
      </div>
    </div>`;
  const val = () => [$('authName').value.trim(), $('authPass').value];
  const err = (t) => { $('authErr').textContent = t; };
  $('btnLogin').onclick = async () => {
    const [n, p] = val(); err('');
    try { await online.login(n, p); render(); } catch (e) { err(friendlyError(e)); }
  };
  $('btnRegister').onclick = async () => {
    const [n, p] = val(); err('');
    try { await online.register(n, p); render(); } catch (e) { err(e.message && !e.code ? e.message : friendlyError(e)); }
  };
}

function renderDashboard(msg = '') {
  const p = online.profile;
  const idx = tierIndex(p.points || 0);
  const t = TIERS[idx];
  const next = TIERS[idx + 1];
  const prog = Math.round(tierProgress(p.points || 0) * 100);
  $('onlineBody').innerHTML = `
    <div class="group rank-card">
      <div class="rank-badge tier-${t.id}">${esc(t.name.charAt(0))}</div>
      <div class="rank-info">
        <b>${esc(online.user.name)}</b>
        <span class="tier-name">${esc(t.name)}</span>
        <div class="track"><div class="fill rankfill" style="width:${prog}%"></div></div>
        <small>${p.points || 0} نقطة ${next ? `· الترقية إلى ${esc(next.name)} عند ${next.min}` : '· أعلى رتبة'}</small>
      </div>
      <div class="rank-stats">
        <div><b>${p.wins || 0}</b>فوز</div><div><b>${p.draws || 0}</b>تعادل</div><div><b>${p.losses || 0}</b>خسارة</div><div><b>${p.coins || 0}</b>عملة</div>
      </div>
    </div>
    <p class="hint err" id="onlineMsg">${esc(msg)}</p>
    <div class="menu-grid">
      <button class="tile primary" id="btnRanked"><i>⚔</i><b>مباراة ضد الكمبيوتر</b><small>مباراة محلية — الأونلاين الحقيقي عبر غرف الأصدقاء</small></button>
      <button class="tile" id="btnRoom"><i>✉</i><b>غرفة أصدقاء</b><small>أنشئ كود أو ادخل كود صديقك</small></button>
      <button class="tile" id="btnBoard"><i>🏆</i><b>المتصدرون</b><small>أفضل 10 لاعبين</small></button>
      <button class="tile soon"><i>🛒</i><b>المتجر</b><small>قريباً</small></button>
      <button class="tile soon"><i>✔</i><b>المهمات والأحداث</b><small>قريباً</small></button>
      <button class="tile" id="btnLogout"><i>⏻</i><b>تسجيل الخروج</b><small>${esc(online.user.name)}</small></button>
    </div>
    <div id="onlinePane"></div>`;
  $('btnRanked').onclick = startRanked;
  $('btnRoom').onclick = roomPane;
  $('btnBoard').onclick = boardPane;
  $('btnLogout').onclick = async () => { await online.logout(); render('تم تسجيل الخروج'); };
}

async function boardPane() {
  const pane = $('onlinePane');
  pane.innerHTML = '<div class="group"><h3>المتصدرون</h3><p class="hint">جاري التحميل...</p></div>';
  try {
    const rows = await online.leaderboard(10);
    pane.innerHTML = `<div class="group"><h3>المتصدرون</h3>${rows.length ? rows.map((r, i) => `
      <div class="lb-row ${r.uid === online.user.uid ? 'me' : ''}"><span>${i + 1}</span><b>${esc(r.name)}</b>
      <em>${esc(TIERS[tierIndex(r.points || 0)].name)}</em><strong>${r.points || 0}</strong></div>`).join('') : '<p class="hint">لا يوجد لاعبون بعد</p>'}</div>`;
  } catch (e) { pane.innerHTML = `<p class="hint err">${esc(friendlyError(e))}</p>`; }
}

let roomOff = null;
function roomPane() {
  roomOff?.(); roomOff = null;
  $('onlinePane').innerHTML = `
    <div class="group">
      <h3>غرفة أصدقاء</h3>
      <div class="field"><label>عدد اللاعبين في كل فريق</label>
        <select id="roomSize" class="input"><option value="1">1 ضد 1</option><option value="2">2 ضد 2</option><option value="3">3 ضد 3</option><option value="4">4 ضد 4</option><option value="5">5 ضد 5</option></select>
      </div>
      <div class="foot-row"><button class="btn primary" id="btnMakeRoom">إنشاء غرفة</button></div>
      <div class="field"><label>كود الغرفة</label><input id="roomCode" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="مثال: K7P2Q" style="text-transform:uppercase"><button class="btn" id="btnJoinRoom">دخول</button></div>
      <div id="roomInvite" class="room-invite" hidden>
        <div class="hint">كود دعوتك — انسخه وأرسله لصديقك</div>
        <div id="roomInviteCode" class="room-invite-code" dir="ltr"></div>
        <button class="btn primary" id="btnCopyRoom">نسخ الكود</button>
      </div>
      <p class="hint" id="roomMsg" aria-live="polite"></p><div id="roomRoster"></div>
    </div>`;
  const msg = $('roomMsg'), roster = $('roomRoster');
  let launched = false, started = false, currentCode = null, isHost = false;
  const invite = $('roomInvite'), inviteCode = $('roomInviteCode');
  const showInvite = (code) => {
    invite.hidden = !code;
    inviteCode.textContent = code || '';
  };
  $('btnCopyRoom').onclick = async () => {
    if (!currentCode) return;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(currentCode);
      } else {
        const helper = document.createElement('textarea');
        helper.value = currentCode; helper.setAttribute('readonly', '');
        helper.style.position = 'fixed'; helper.style.opacity = '0';
        document.body.appendChild(helper); helper.select();
        const copied = document.execCommand('copy'); helper.remove();
        if (!copied) throw new Error('انسخ الكود يدوياً');
      }
      msg.textContent = 'تم نسخ الكود. أرسله لصديقك قبل بدء المباراة.';
    } catch (_) { msg.textContent = `انسخ الكود يدوياً: ${currentCode}`; }
  };
  const paint = (room) => {
    if (!room) { msg.textContent = 'الغرفة لم تعد متاحة'; return; }
    const players = room.members || [];
    const max = room.maxPlayers || (room.playersPerTeam || 1) * 2;
    const teamA = players.filter((m) => m.team === 0), teamB = players.filter((m) => m.team === 1);
    roster.innerHTML = `<div class="hint" style="margin-top:12px">اللاعبون: <b>${players.length}/${max}</b> · الفريق الأزرق ${teamA.length}/${room.playersPerTeam} · الفريق الأحمر ${teamB.length}/${room.playersPerTeam}<br>${players.map((m) => `<span>${esc(m.name)} ${m.host ? '👑' : ''} — ${m.team === 0 ? '🔵' : '🔴'}</span>`).join('<br>')}</div>`;
    if (room.status === 'playing' && !started) {
      started = true;
      roomOff?.();
      msg.textContent = 'جاري الاتصال المباشر بين اللاعبين...';
      // every human links directly to every other human (mesh)
      const peers = players.filter((m) => m.uid !== online.user.uid).map((m) => m.uid);
      const hub = new RtcHub({
        myUid: online.user.uid,
        signal: {
          send: (to, m) => online.sendSignal(currentCode, to, m),
          watch: (cb) => online.watchSignals(currentCode, cb),
        },
      });
      hub.connect(peers).then(() => {
        document.dispatchEvent(new CustomEvent('ps:online-start', {
          detail: { role: isHost ? 'host' : 'guest', code: currentCode, room, io: hub },
        }));
      }).catch((err) => {
        hub.close();
        started = false;
        msg.textContent = err.message || 'تعذر الاتصال المباشر';
      });
      return;
    }
    if (room.status !== 'waiting') return;
    if (isHost && players.length === max && !launched) {
      launched = true; msg.textContent = 'اكتمل الفريقان! جاري بدء المباراة...';
      online.launchRoom(currentCode, window.PS_GET_MATCH_SETTINGS?.() || {})
        .catch((e) => { launched = false; msg.textContent = e.message || friendlyError(e); });
    } else if (isHost) {
      msg.textContent = `أرسل الكود وانتظر ${max - players.length} لاعب حقيقي؛ لن تبدأ المباراة قبل اكتمال العدد.`;
    } else {
      msg.textContent = `تم الانضمام. ننتظر اكتمال الغرفة (${players.length}/${max})...`;
    }
  };
  const watch = (code, host) => {
    currentCode = code; isHost = host; launched = false; started = false;
    roomOff?.(); roomOff = online.watchRoom(code, paint);
  };
  $('btnMakeRoom').onclick = async () => {
    msg.textContent = 'جاري إنشاء الغرفة...';
    try {
      const player = window.PS_GET_PLAYER_CONFIG?.();
      if (!player) throw new Error('أعد تحميل اللعبة ثم حاول مرة أخرى');
      const size = Number($('roomSize').value) || 1;
      const code = await online.createRoom(player, size);
      showInvite(code);
      msg.textContent = `تم إنشاء الغرفة ${size} ضد ${size}. أرسل الكود وانتظر انضمام اللاعبين.`;
      watch(code, true);
    } catch (e) { msg.textContent = e.message && !e.code ? e.message : friendlyError(e); }
  };
  $('btnJoinRoom').onclick = async () => {
    msg.textContent = 'جاري الانضمام...';
    try {
      const player = window.PS_GET_PLAYER_CONFIG?.();
      if (!player) throw new Error('أعد تحميل اللعبة ثم حاول مرة أخرى');
      const code = $('roomCode').value.replace(/\s+/g, '').toUpperCase();
      await online.joinRoom(code, player);
      showInvite('');
      watch(code, false);
    } catch (e) { msg.textContent = e.message && !e.code ? e.message : friendlyError(e); }
  };
}

// ── ranked search ──────────────────────────────────────────
function startRanked() {
  if (!online.user) return;
  pendingRanked = false;
  document.dispatchEvent(new CustomEvent('ps:start', { detail: { mode: 'normal' } }));
}
$('queueCancel')?.addEventListener('click', () => {
  clearInterval(searchT);
  showOnly('online');
  render();
});

// ── results of a finished match ───────────────────────────
document.addEventListener('ps:matchend', async (e) => {
  const line = $('rankLine');
  if (!pendingRanked) { if (line) line.textContent = ''; return; }
  pendingRanked = false;
  if (!online.user) return;
  try {
    const next = applyResult(online.profile, e.detail.result);
    await online.saveProfile(next);
    line.textContent = `${next.delta >= 0 ? '+' : ''}${next.delta} نقطة تصنيف · ${TIERS[tierIndex(next.points)].name}${next.tierUp ? ' · ترقية!' : ''} · +${next.gained} عملة`;
  } catch (err) {
    line.textContent = 'تعذر حفظ نتيجة التصنيف، تحقق من الاتصال';
  }
});

// open the screen from the main menu
document.querySelector('[data-go="online"]')?.addEventListener('click', () => render());
export { render as renderOnline };
