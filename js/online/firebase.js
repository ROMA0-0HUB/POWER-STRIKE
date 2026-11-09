// Online backend (Firebase Auth + Realtime Database). Loaded lazily, only when
// the player opens the Online screen, so offline play never touches the network.
const CONFIG = {
  apiKey: "AIzaSyCaEFoe9Ul0YGdoYs1_1K0SW9GEpHrJbpw",
  authDomain: "chat-fb2fd.firebaseapp.com",
  databaseURL: "https://chat-fb2fd-default-rtdb.firebaseio.com",
  projectId: "chat-fb2fd",
  storageBucket: "chat-fb2fd.firebasestorage.app",
  messagingSenderId: "21079227663",
  appId: "1:21079227663:web:fe7e42c8ea8a69ebf2527a",
};
const DB_URL = "https://chat-fb2fd-default-rtdb.firebaseio.com";
const SDK = "https://www.gstatic.com/firebasejs/13.2.0";
// Players log in with a name + password. Firebase Auth needs an email, so the
// name is mapped to a private address that players never see.
const VIRTUAL_DOMAIN = "players.powerstriker.app";

let fb = null;   // { auth, db, api }
let loading = null;

async function load() {
  if (fb) return fb;
  if (!loading) loading = (async () => {
    const [appM, authM, dbM] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`),
    ]);
    const app = appM.initializeApp(CONFIG);
    fb = {
      auth: authM.getAuth(app),
      db: dbM.getDatabase(app, DB_URL),
      api: { ...authM, ...dbM },
    };
    return fb;
  })();
  return loading;
}

export const NAME_RE = /^[\p{L}\p{N}_]{3,14}$/u;

const ERRORS = {
  'auth/email-already-in-use': 'هذا الاسم مستخدم',
  'auth/invalid-credential': 'الاسم أو كلمة السر غير صحيحة',
  'auth/wrong-password': 'كلمة السر غير صحيحة',
  'auth/user-not-found': 'هذا الحساب غير موجود',
  'auth/weak-password': 'كلمة السر ضعيفة (6 أحرف على الأقل)',
  'auth/too-many-requests': 'محاولات كثيرة، انتظر قليلاً',
  'auth/network-request-failed': 'تحقق من الاتصال بالإنترنت',
  'auth/operation-not-allowed': 'تسجيل الدخول بكلمة السر غير مفعّل في Firebase',
};

export function friendlyError(e) {
  const code = String(e?.code || '').toLowerCase();
  if (code.includes('permission-denied') || code.includes('permission_denied')) {
    return 'Firebase رفض الصلاحية. افتح Realtime Database ثم Rules وانشر قواعد المشروع الموجودة في firebase/database.rules.json';
  }
  if (code.includes('network')) return 'تعذر الاتصال بالإنترنت أو بخادم Firebase';
  if (code.includes('unauthorized-domain')) return 'أضف نطاق اللعبة في Firebase Authentication ثم Settings ثم Authorized domains';
  return ERRORS[e?.code] || (e?.message ? `تعذر الاتصال بالخادم (${e.code || 'خطأ غير معروف'})` : 'حدث خطأ');
}

const emailFor = (name) => `${name.toLowerCase()}@${VIRTUAL_DOMAIN}`;

export const online = {
  user: null,      // { uid, name }
  profile: null,   // { name, points, wins, draws, losses, coins, tier }

  /** Restores the session on page load (no UI shown). */
  async restore() {
    const f = await load();
    return new Promise((resolve) => {
      const off = f.api.onAuthStateChanged(f.auth, async (u) => {
        off();
        if (u) await this._setUser(u.uid);
        resolve(this.user);
      });
    });
  },

  async register(name, password) {
    if (!NAME_RE.test(name)) throw new Error('الاسم من 3 إلى 14 حرف أو رقم أو _');
    if (password.length < 6) throw new Error('كلمة السر 6 أحرف على الأقل');
    const f = await load();
    const key = name.toLowerCase();
    const taken = await f.api.get(f.api.ref(f.db, `usernames/${key}`));
    if (taken.exists()) throw new Error('هذا الاسم مستخدم');
    const cred = await f.api.createUserWithEmailAndPassword(f.auth, emailFor(name), password);
    const uid = cred.user.uid;
    await f.api.set(f.api.ref(f.db, `usernames/${key}`), uid);
    const profile = { name, points: 0, wins: 0, draws: 0, losses: 0, coins: 0, tier: 'bronze' };
    await f.api.set(f.api.ref(f.db, `users/${uid}`), profile);
    this.user = { uid, name }; this.profile = profile;
    return this.user;
  },

  async login(name, password) {
    const f = await load();
    const cred = await f.api.signInWithEmailAndPassword(f.auth, emailFor(name), password);
    await this._setUser(cred.user.uid);
    return this.user;
  },

  async logout() {
    const f = await load();
    await f.api.signOut(f.auth);
    this.user = null; this.profile = null;
  },

  async _setUser(uid) {
    const f = await load();
    const snap = await f.api.get(f.api.ref(f.db, `users/${uid}`));
    this.profile = snap.exists() ? snap.val() : { name: 'لاعب', points: 0, wins: 0, draws: 0, losses: 0, coins: 0 };
    this.user = { uid, name: this.profile.name };
  },

  /** Writes the updated ranked profile after a ranked match. */
  async saveProfile(profile) {
    const f = await load();
    const data = { points: profile.points, wins: profile.wins, draws: profile.draws, losses: profile.losses, coins: profile.coins, tier: profile.tier };
    await f.api.update(f.api.ref(f.db, `users/${this.user.uid}`), data);
    this.profile = { ...this.profile, ...data };
  },

  async leaderboard(n = 10) {
    const f = await load();
    const q = f.api.query(f.api.ref(f.db, 'users'), f.api.orderByChild('points'), f.api.limitToLast(n));
    const snap = await f.api.get(q);
    const rows = [];
    snap.forEach((c) => rows.push({ uid: c.key, ...c.val() }));
    return rows.sort((a, b) => (b.points || 0) - (a.points || 0));
  },

  /** Create a room for 1–5 real players on each side. */
  async createRoom(player, playersPerTeam = 1) {
    const f = await load();
    const capacity = Math.max(1, Math.min(5, Number(playersPerTeam) || 1));
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = Math.random().toString(36).slice(2, 7).toUpperCase();
      const roomRef = f.api.ref(f.db, `rooms/${code}`);
      const result = await f.api.runTransaction(roomRef, (current) => {
        if (current) return;
        return { host: this.user.uid, hostName: this.user.name, status: 'waiting',
          playersPerTeam: capacity, maxPlayers: capacity * 2, createdAt: Date.now(), protocol: 3 };
      }, { applyLocally: false });
      if (result.committed && result.snapshot.exists()) {
        await f.api.set(f.api.ref(f.db, `roomMembers/${code}/0`), {
          uid: this.user.uid, name: this.user.name, player, team: 0, slot: 0, joinedAt: Date.now(), host: true,
        });
        return code;
      }
    }
    throw new Error('تعذر إنشاء غرفة جديدة. تحقق من صلاحيات Firebase ثم حاول مجدداً');
  },

  async joinRoom(code, player) {
    const f = await load();
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) throw new Error('كود الغرفة يجب أن يتكون من 5 أحرف');
    const roomRef = f.api.ref(f.db, `rooms/${code}`);
    // A short retry protects against a just-created room being read from a
    // second device before the first server read has caught up.
    let room = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const roomSnap = await f.api.get(roomRef);
      room = roomSnap.exists() ? roomSnap.val() : null;
      if (room) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350));
    }
    if (!room) throw new Error('لم نعثر على هذه الغرفة. تأكد من الكود الظاهر عند المضيف وحاول نسخه من جديد.');
    if (room.status !== 'waiting') throw new Error('هذه الغرفة بدأت المباراة بالفعل أو أُغلقت. اطلب من المضيف إنشاء غرفة جديدة.');
    const membersRef = f.api.ref(f.db, `roomMembers/${code}`);
    const membersSnap = await f.api.get(membersRef);
    const members = membersSnap.val() || {};
    if (Object.values(members).some((m) => m?.uid === this.user.uid)) throw new Error('أنت موجود بالفعل في هذه الغرفة');
    const maxPlayers = Number(room.maxPlayers) || (Number(room.playersPerTeam) || 1) * 2;
    const perTeam = Number(room.playersPerTeam) || 1;
    let joined = false;
    for (let slot = 1; slot < maxPlayers && !joined; slot++) {
      if (members[slot]) continue;
      const slotRef = f.api.ref(f.db, `roomMembers/${code}/${slot}`);
      const result = await f.api.runTransaction(slotRef, (current) => current ? undefined : {
        uid: this.user.uid, name: this.user.name, player,
        team: Math.floor(slot / perTeam), slot, joinedAt: Date.now(), host: false,
      }, { applyLocally: false });
      joined = result.committed;
    }
    if (!joined) {
      const latest = await f.api.get(roomRef);
      const latestRoom = latest.exists() ? latest.val() : null;
      if (!latestRoom) throw new Error('اختفت الغرفة. اطلب من المضيف إنشاء غرفة جديدة.');
      if (latestRoom.status !== 'waiting') throw new Error('اكتمل عدد اللاعبين وبدأت المباراة قبل انضمامك. اطلب من المضيف غرفة جديدة.');
      throw new Error('الغرفة ممتلئة بالفعل. اطلب من المضيف إنشاء غرفة جديدة.');
    }
    return { ...room };
  },

  watchRoom(code, callback) {
    let active = true;
    let offRoom = () => {}, offMembers = () => {};
    let roomValue = null, membersValue = {};
    const emit = () => { if (active) callback(roomValue ? { ...roomValue,
      members: Object.values(membersValue || {}).filter(Boolean),
    } : null); };
    load().then((f) => {
      if (!active) return;
      offRoom = f.api.onValue(f.api.ref(f.db, `rooms/${code}`), (s) => { roomValue = s.exists() ? s.val() : null; emit(); }, emit);
      offMembers = f.api.onValue(f.api.ref(f.db, `roomMembers/${code}`), (s) => { membersValue = s.exists() ? s.val() : {}; emit(); }, emit);
    }).catch(() => { if (active) callback(null); });
    return () => { active = false; offRoom(); offMembers(); };
  },

  async launchRoom(code, settings) {
    const f = await load();
    const roomRef = f.api.ref(f.db, `rooms/${code}`);
    const [roomSnap, membersSnap] = await Promise.all([
      f.api.get(roomRef), f.api.get(f.api.ref(f.db, `roomMembers/${code}`)),
    ]);
    const room = roomSnap.val();
    const members = Object.values(membersSnap.val() || {}).filter(Boolean);
    if (!room || room.host !== this.user.uid) throw new Error('الغرفة لم تعد موجودة أو أنك لست المضيف');
    if (room.status !== 'waiting') throw new Error('المباراة بدأت بالفعل');
    if (members.length !== room.maxPlayers) throw new Error(`نحتاج ${room.maxPlayers - members.length} لاعب حقيقي إضافي لبدء المباراة`);
    const launchData = { status: 'playing', players: members, matchSettings: { ...settings, onlinePlayersPerTeam: room.playersPerTeam }, startedAt: Date.now() };
    await f.api.update(roomRef, launchData);
    return { ...room, ...launchData, members };
  },

  /** WebRTC handshake only: small messages, deleted as soon as they are read. */
  async sendSignal(code, toUid, msg) {
    const f = await load();
    await f.api.push(f.api.ref(f.db, `signals/${code}/${toUid}`), { ...msg, from: this.user.uid, at: Date.now() });
  },

  watchSignals(code, callback) {
    const uid = this.user.uid;
    let active = true, off = () => {};
    load().then((f) => {
      if (!active) return;
      off = f.api.onChildAdded(f.api.ref(f.db, `signals/${code}/${uid}`), (snap) => {
        const v = snap.val();
        if (v) callback(v);
        f.api.remove(snap.ref).catch(() => {});
      });
    }).catch(() => {});
    return () => { active = false; off(); };
  },

  async publishInput(code, input) {
    const f = await load();
    await f.api.set(f.api.ref(f.db, `roomInputs/${code}/${this.user.uid}`), { ...input, at: Date.now() });
  },

  watchInputs(code, callback, onError = () => {}) {
    let active = true, off = () => {};
    load().then((f) => {
      if (active) off = f.api.onValue(
        f.api.ref(f.db, `roomInputs/${code}`),
        (s) => callback(s.exists() ? s.val() : {}),
        (err) => { if (active) onError(err); },
      );
    }).catch((err) => { if (active) onError(err); });
    return () => { active = false; off(); };
  },

  watchState(code, callback) {
    let active = true, off = () => {};
    load().then((f) => { if (active) off = f.api.onValue(f.api.ref(f.db, `roomStates/${code}`), (s) => callback(s.exists() ? s.val() : null)); }).catch(() => {});
    return () => { active = false; off(); };
  },

  async publishState(code, state) {
    const f = await load();
    await f.api.set(f.api.ref(f.db, `roomStates/${code}`), state);
  },

  watchState(code, callback, onError = () => {}) {
    let active = true;
    let off = () => {};
    load().then((f) => {
      if (!active) return;
      off = f.api.onValue(
        f.api.ref(f.db, `roomStates/${code}`),
        (s) => callback(s.exists() ? s.val() : null),
        (err) => { if (active) onError(err); },
      );
    }).catch((err) => { if (active) onError(err); });
    return () => { active = false; off(); };
  },

  async closeRoom(code, reason = 'closed') {
    const f = await load();
    await f.api.update(f.api.ref(f.db, `rooms/${code}`), { status: reason, endedAt: Date.now() });
  },
};
