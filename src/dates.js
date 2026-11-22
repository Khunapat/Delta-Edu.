// Day-level dates for tasks and classes: keys are 'YYYY-MM-DD' in the team's time zone.
// parseDate() reads English ("friday", "next fri", "tomorrow", "20/11", "20 Nov",
// "in 3 days") and Thai ("ศุกร์หน้า", "พรุ่งนี้", "20 พ.ย.") and never guesses:
// "next week" (Friday or Sunday?) comes back as a question with options.
// Everything the bot shows is English: "Fri 20 Nov", "in 3 days".

const pad = (n) => String(n).padStart(2, '0');
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
export const arabic = (s) => String(s).replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));

export function makeKey(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
export function isDayKey(k) { return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(Date.parse(k + 'T00:00:00Z')); }
function utc(k) { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function fromUtc(ms) { const d = new Date(ms); return makeKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
export function addDays(k, n) { return fromUtc(utc(k) + n * 86400000); }
/** b - a in whole days. */
export function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
/** 0 = Sunday ... 6 = Saturday */
export function dow(k) { return new Date(utc(k)).getUTCDay(); }
/** Monday of the week containing k. */
export function weekStart(k) { return addDays(k, -((dow(k) + 6) % 7)); }
export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function todayKey(timeZone = 'Asia/Bangkok', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** Hour 0-23 and weekday in the given zone. */
export function zonedClock(timeZone = 'Asia/Bangkok', now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { hour: Number(parts.hour), weekday: wd };
}

/**
 * Accepts what people (or Sheets) put in a date cell: 2026-11-20, 20/11/2026,
 * 20/11/2569 (Buddhist year), 20-11-2026. Returns a key or ''.
 */
export function normalizeDate(v) {
  if (v === null || v === undefined) return '';
  const s = arabic(String(v)).trim();
  if (!s) return '';
  if (isDayKey(s)) return s;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) { const k = makeKey(+m[1], +m[2], +m[3]); return isDayKey(k) ? k : ''; }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y > 50 ? 2500 : 2000;
    if (y > 2400) y -= 543;
    const k = makeKey(y, +m[2], +m[1]);
    return validDate(y, +m[2], +m[1]) ? k : '';
  }
  return '';
}
function validDate(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m); }

const EN_DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TH_MON_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_MON_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const EN_MON = ['january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'sept', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const enMonth = (w) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(w.slice(0, 3)) + 1;

/** "Fri 20 Nov" (adds the year when it is not this year: "Mon 4 Jan 2027"). */
export function formatDay(k, today) {
  if (!isDayKey(k)) return '';
  const [y, m, d] = k.split('-').map(Number);
  const base = `${EN_DOW_SHORT[dow(k)]} ${d} ${EN_MON_SHORT[m - 1]}`;
  const thisYear = today ? Number(today.slice(0, 4)) : y;
  return y === thisYear ? base : `${base} ${y}`;
}
export function weekdayName(k) { return EN_DOW[dow(k)]; }

/** "today", "tomorrow", "in 3 days", "1 day late", "4 days late" for diff = due - today. */
export function relDays(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return '1 day late';
  return n > 1 ? `in ${n} days` : `${-n} days late`;
}

// ---- parsing ---------------------------------------------------------------

const WEEKDAYS = [
  // longest spellings first so "พฤหัสบดี" wins over "พฤหัส"
  ['พฤหัสบดี', 4], ['พฤหัส', 4], ['อาทิตย์', 0], ['จันทร์', 1], ['อังคาร', 2], ['พุธ', 3], ['ศุกร์', 5], ['เสาร์', 6],
  ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['saturday', 6],
  // No "sat": it is the SAT exam far more often than Saturday here ("saturday" works).
  ['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5],
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_WORDS = [
  ...TH_MON_FULL.map((w, i) => [w, i + 1]),
  ...TH_MON_SHORT.map((w, i) => [w, i + 1]),
  ...TH_MON_SHORT.map((w, i) => [w.replace(/\./g, ''), i + 1]),
  ...EN_MON.map((w) => [w, enMonth(w)]),
].sort((a, b) => b[0].length - a[0].length);
const MONTH_RE = MONTH_WORDS.map(([w]) => esc(w)).join('|');

/** Next date (on or after today) with day d of month m; year optional. */
function dayMonth(today, d, m, y) {
  if (y) {
    if (y < 100) y += 2000;
    if (y > 2400) y -= 543;
    return validDate(y, m, d) ? makeKey(y, m, d) : null;
  }
  let yr = Number(today.slice(0, 4));
  for (let i = 0; i < 2; i++, yr++) {
    if (validDate(yr, m, d)) {
      const k = makeKey(yr, m, d);
      if (k >= today) return k;
    }
  }
  return null;
}

function nextWeekday(today, wd) {
  // on or after today
  return addDays(today, (wd - dow(today) + 7) % 7);
}

/**
 * Find the first date phrase in `text`.
 *   { date: 'YYYY-MM-DD', word }
 *   { ambiguous: true, word, options: [{ date, label }] }
 *   null
 */
export function parseThaiDate(text, today) {
  if (!text) return null;
  const s = arabic(String(text)).toLowerCase();
  let m;

  if ((m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) {
    const k = makeKey(+m[1], +m[2], +m[3]);
    return isDayKey(k) && validDate(+m[1], +m[2], +m[3]) ? { date: k, word: m[0] } : null;
  }
  if ((m = /\b(this|next) weekend\b/.exec(s))) {
    const sat = addDays(weekStart(today), m[1] === 'next' ? 12 : 5);
    return { ambiguous: true, word: m[0], options: [sat, addDays(sat, 1)].filter((d) => d >= today).map((d) => ({ date: d, label: `${weekdayName(d)} · ${formatDay(d, today)}` })) };
  }
  if ((m = /(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d])/.exec(s))) {
    const k = dayMonth(today, +m[1], +m[2], m[3] ? +m[3] : 0);
    if (k) return { date: k, word: m[0].trim() };
  }
  const reDm = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTH_RE})(?![a-z])(?:\\s*(\\d{4}|\\d{2}(?!:)))?`);
  if ((m = reDm.exec(s))) {
    const mon = MONTH_WORDS.find(([w]) => w === m[2])?.[1];
    const k = mon && dayMonth(today, +m[1], mon, m[3] ? +m[3] : 0);
    if (k) return { date: k, word: m[0] };
  }
  const reMd = new RegExp(`\\b(${EN_MON.filter((w) => w !== 'may').join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`);
  if ((m = reMd.exec(s))) {
    const k = dayMonth(today, +m[2], enMonth(m[1]), m[3] ? +m[3] : 0);
    if (k) return { date: k, word: m[0] };
  }

  if ((m = /มะรืน(?:นี้)?|day after tomorrow/.exec(s))) return { date: addDays(today, 2), word: m[0] };
  if ((m = /พรุ่งนี้|พรุ่งนี|tomorrow/.exec(s))) return { date: addDays(today, 1), word: m[0] };
  if ((m = /วันนี้|คืนนี้|today|tonight/.exec(s))) return { date: today, word: m[0] };

  if ((m = /อีก\s*(\d+)\s*วัน|in\s+(\d+)\s+days?/.exec(s))) {
    return { date: addDays(today, Number(m[1] ?? m[2])), word: m[0] };
  }
  if ((m = /อีก\s*(\d+)\s*(?:สัปดาห์|อาทิตย์|week)|in\s+(\d+)\s+weeks?/.exec(s))) {
    return { date: addDays(today, 7 * Number(m[1] ?? m[2])), word: m[0] };
  }
  if ((m = /สิ้นเดือน(หน้า)?|end of (?:the )?(next )?month/.exec(s))) {
    let [y, mo] = today.split('-').map(Number);
    if (m[1] || m[2]) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
    return { date: makeKey(y, mo, daysInMonth(y, mo)), word: m[0] };
  }

  // "อาทิตย์หน้า" / "สัปดาห์หน้า" without "วัน": next Sunday, or sometime next week?
  if ((m = /(?<!วัน)(?:อาทิตย์|สัปดาห์)(นี้|หน้า)|(this|next) week(?!end)/.exec(s))) {
    const next = (m[1] || m[2]) === 'หน้า' || m[2] === 'next';
    const mon = addDays(weekStart(today), next ? 7 : 0);
    const fri = addDays(mon, 4);
    const sun = addDays(mon, 6);
    const options = [{ date: fri, label: `Friday · ${formatDay(fri, today)}` }];
    if (/อาทิตย์/.test(m[0])) options.unshift({ date: sun, label: `Sunday · ${formatDay(sun, today)}` });
    else options.push({ date: sun, label: `End of week · ${formatDay(sun, today)}` });
    return { ambiguous: true, word: m[0], options: options.filter((o) => o.date >= today) };
  }

  for (const [name, wd] of WEEKDAYS) {
    const isEn = /^[a-z]/.test(name);
    const re = isEn
      ? new RegExp(`(next\\s+|this\\s+|coming\\s+)?\\b${name}\\b`)
      : new RegExp(`(?:วัน)?${name}(นี้|หน้า|ถัดไป)?`);
    if ((m = re.exec(s))) {
      const mod = m[1]?.trim();
      let k;
      if (mod === 'หน้า' || mod === 'ถัดไป' || mod === 'next') {
        k = addDays(addDays(weekStart(today), 7), (wd + 6) % 7);
      } else {
        k = nextWeekday(today, wd);
      }
      return { date: k, word: m[0].trim() };
    }
  }
  return null;
}

/** Same parser, English name. */
export const parseDate = parseThaiDate;
