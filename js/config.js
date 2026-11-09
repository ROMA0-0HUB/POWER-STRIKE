// ─────────────────────────────────────────────────────────────
// POWER STRIKER — global game configuration
// All gameplay constants, the original character roster, positions
// and team definitions live here so tuning happens in one place.
// ─────────────────────────────────────────────────────────────

export const FIELD = {
  L: 64,          // pitch length (z axis)
  W: 40,          // pitch width (x axis)
  HL: 32,         // half length
  HW: 20,         // half width
  goalW: 7.2,     // goal mouth width
  goalH: 2.6,     // crossbar height
  goalD: 2.2,     // goal depth (net)
  boxL: 9,        // penalty box depth
  boxW: 20,       // penalty box width
  wallH: 7,       // visual glass wall height (ball cage is taller)
  ceiling: 15,
};

export const PHYS = {
  gravity: 24,
  ballR: 0.22,
  playerR: 0.42,
  playerGravity: 20,
  jumpV: 6.6,
};

export const MATCH_DEFAULTS = {
  duration: 180,        // seconds
  goldenGoal: 60,       // sudden-death extra time when tied
  kickoffCountdown: 3,
};

// Order matters: smaller team sizes take the first N roles.
export const ROLE_ORDER = ['GK', 'ST', 'DF', 'LW', 'RW'];

// f = forward distance from centre in the team's attacking direction,
// x = lateral offset (negative = team's left side).
export const POSITIONS = {
  ST: { id: 'ST', name: 'مهاجم', short: 'ST', icon: '⚡', desc: 'رأس الحربة — يعيش ليسجل', base: { f: 3, x: 0 } },
  LW: { id: 'LW', name: 'جناح هجومي أول', short: 'LW', icon: '◀', desc: 'سرعة على الطرف الأيسر', base: { f: -3, x: -11 } },
  RW: { id: 'RW', name: 'جناح هجومي ثانٍ', short: 'RW', icon: '▶', desc: 'اختراق من الطرف الأيمن', base: { f: -3, x: 11 } },
  DF: { id: 'DF', name: 'مدافع', short: 'DF', icon: '⛨', desc: 'الجدار الأخير قبل المرمى', base: { f: -17, x: 0 } },
  GK: { id: 'GK', name: 'حارس مرمى', short: 'GK', icon: '✋', desc: 'يحمي الشباك بيديه', base: { f: -30.4, x: 0 } },
};

export function rolesForSize(n) {
  // Keep a natural shape for small teams.
  const map = {
    1: ['ST'],
    2: ['ST', 'GK'],
    3: ['GK', 'ST', 'DF'],
    4: ['GK', 'ST', 'DF', 'LW'],
    5: ['GK', 'ST', 'LW', 'RW', 'DF'],
  };
  return map[n] || map[5];
}

export const TEAMS = [
  { id: 'nova', name: 'نوفا الزرقاء', latin: 'BLUE NOVA', jersey: 0x1d6bff, shorts: 0x0b1a3a, accent: 0x6ff3ff, gkJersey: 0x22d38a, css: '#2f7bff' },
  { id: 'fang', name: 'الناب القرمزي', latin: 'CRIMSON FANG', jersey: 0xe0283f, shorts: 0x1a0b10, accent: 0xffb13b, gkJersey: 0xf2d22e, css: '#ff3352' },
];

// Original Power Striker roster. Stats are 0-100.
export const CHARACTERS = [
  {
    id: 'kaito', name: 'بهيمة', latin: 'بهيمة', title: 'المفترس',
    hair: 0x18233f, hairStyle: 'spiky', skin: 0xf3cfae, eye: 0x29a8ff,
    stats: { spd: 82, sht: 94, pas: 68, drb: 76, def: 42 },
    ability: { id: 'meteor', name: 'ضربة النيزك', desc: 'تسديدة نارية خارقة تخترق أي دفاع', color: 0xff5a1f },
  },
  {
    id: 'sora', name: 'حافوزليق', latin: 'حافوزليق', title: 'العاصفة',
    hair: 0xf0f3ff, hairStyle: 'swept', skin: 0xf6d8bd, eye: 0x7ef9ff,
    stats: { spd: 97, sht: 72, pas: 70, drb: 84, def: 48 },
    ability: { id: 'storm', name: 'عاصفة السرعة', desc: 'سرعة هائلة وطاقة لا تنفد لعدة ثوانٍ', color: 0x5ff6ff },
  },
  {
    id: 'yuto', name: 'الروماني', latin: 'الروماني', title: 'الشبح',
    hair: 0x6b2bd9, hairStyle: 'long', skin: 0xeec4a0, eye: 0xd17bff,
    stats: { spd: 86, sht: 74, pas: 78, drb: 97, def: 40 },
    ability: { id: 'phantom', name: 'خطوة الشبح', desc: 'يصبح شبحًا لا يمكن افتكاك الكرة منه', color: 0xb26bff },
  },
  {
    id: 'daiki', name: 'شوشوع', latin: 'شوشوع', title: 'الحصن',
    hair: 0x2b2b2b, hairStyle: 'buzz', skin: 0xc98e64, eye: 0xffc93b,
    stats: { spd: 74, sht: 70, pas: 72, drb: 60, def: 97 },
    ability: { id: 'ironwall', name: 'الجدار الحديدي', desc: 'افتكاك مضمون بمدى مضاعف', color: 0xffc93b },
  },
  {
    id: 'haruto', name: 'قريدس', latin: 'قريدس', title: 'عين الصقر',
    hair: 0x1ea37a, hairStyle: 'swept', skin: 0xf3d2b4, eye: 0x47ffb8,
    stats: { spd: 80, sht: 84, pas: 96, drb: 78, def: 55 },
    ability: { id: 'eagle', name: 'عين الصقر', desc: 'تسديدة منحنية تتجه للزاوية البعيدة', color: 0x47ffb8 },
  },
  {
    id: 'ryu', name: 'رونالدو من تيمو', latin: 'رونالدو من تيمو', title: 'الرعد',
    hair: 0xffd23f, hairStyle: 'spiky', skin: 0xf0c49c, eye: 0xfff05a,
    stats: { spd: 84, sht: 90, pas: 66, drb: 72, def: 58 },
    ability: { id: 'thunder', name: 'صاعقة الرعد', desc: 'قفزة عالية وتسديدة طائرة صاعقة', color: 0xfff05a },
  },
];

export const HAIR_COLORS = [0x18233f, 0x0d0d0d, 0xf0f3ff, 0xffd23f, 0xe0283f, 0x6b2bd9, 0x1ea37a, 0x29a8ff, 0xff7ab8, 0x8a4b22];
export const SKIN_TONES = [0xf6d8bd, 0xf3cfae, 0xeec4a0, 0xd9a77e, 0xc98e64, 0x8d5a3b];
export const BOOT_COLORS = [0xffffff, 0x111111, 0x5ff6ff, 0xff5a1f, 0xffd23f, 0xff3cac, 0x47ffb8];
export const HAIR_STYLES = [
  { id: 'spiky', name: 'شائك' },
  { id: 'swept', name: 'منسدل' },
  { id: 'long', name: 'طويل' },
  { id: 'buzz', name: 'قصير' },
];

export const DIFFICULTY = {
  easy:   { name: 'سهل',  react: 0.38, shotErr: 1.6, tackle: 0.25, speed: 0.9,  gk: 0.72 },
  normal: { name: 'عادي', react: 0.24, shotErr: 1.0, tackle: 0.45, speed: 0.97, gk: 0.84 },
  hard:   { name: 'صعب',  react: 0.14, shotErr: 0.6, tackle: 0.65, speed: 1.03, gk: 0.93 },
};

export const BOT_NAMES = [
  'Neo_Striker', 'زئير99', 'Hiro.X', 'Ghost_10', 'نيزك', 'Volt', 'K1ng_Eg0', 'سهم_أزرق', 'Zero', 'Blaze7',
  'ريح_الشمال', 'Ace', 'Kuro', 'Fenix', 'رعد', 'Shade', 'Nova_9', 'Taka', 'صقر', 'Riku',
];

// Stat helpers -------------------------------------------------
export const statSpeed = (c) => 6.1 + (c.stats.spd / 100) * 2.0;     // m/s jog top speed
export const statShot = (c) => 0.8 + (c.stats.sht / 100) * 0.35;
export const statPass = (c) => 0.75 + (c.stats.pas / 100) * 0.3;
export const statDribble = (c) => 0.7 + (c.stats.drb / 100) * 0.4;
export const statDefense = (c) => 0.7 + (c.stats.def / 100) * 0.45;
