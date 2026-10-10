// Rolls the "Next Meeting" date on the homepage forward by 2 weeks.
// Run by .github/workflows/next-meeting.yml every Tuesday.
// It only changes the date once the listed meeting day has arrived
// and it's 9 AM or later in Dallas (Central time), so extra runs are harmless.
//
// Test overrides: TODAY=YYYY-MM-DD and HOUR=0-23 (Central time).

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/pages/index.astro';
const TZ = 'America/Chicago';
const RUN_HOUR = 9;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Current date and hour in Central time
const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]),
);
const todayStr = process.env.TODAY || `${parts.year}-${parts.month}-${parts.day}`;
const hour = process.env.HOUR !== undefined ? Number(process.env.HOUR) : Number(parts.hour);

// Work with plain calendar dates (UTC midnight) to avoid DST issues
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const today = toDate(todayStr);

const src = readFileSync(FILE, 'utf8');

const monthRe = /(<div class="month">)([A-Z]{3})(<\/div>)/;
const dayRe = /(<div class="day">)(\d{1,2})(<\/div>)/;
const lineRe = /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), ([A-Z][a-z]+) (\d{1,2})(st|nd|rd|th)\b/;

const m = src.match(monthRe);
const d = src.match(dayRe);
const l = src.match(lineRe);
if (!m || !d || !l) {
  console.error('Could not find the Next Meeting date markup in', FILE);
  process.exit(1);
}

const monthIdx = MONTHS.findIndex((name) => name.slice(0, 3).toUpperCase() === m[2]);
if (monthIdx < 0) {
  console.error('Unrecognized month badge:', m[2]);
  process.exit(1);
}

// The page has no year, so pick the year that puts the listed date closest to today
const y = today.getUTCFullYear();
const candidates = [y - 1, y, y + 1].map((yr) => new Date(Date.UTC(yr, monthIdx, Number(d[2]))));
const listed = candidates.reduce((a, b) => (Math.abs(b - today) < Math.abs(a - today) ? b : a));
const fmt = (x) => x.toISOString().slice(0, 10);

console.log(`Today (Central): ${todayStr} ${hour}:00 | Listed next meeting: ${fmt(listed)}`);

if (today < listed) {
  console.log('Meeting day has not arrived yet. No change.');
  process.exit(0);
}
if (today.getTime() === listed.getTime() && hour < RUN_HOUR) {
  console.log(`It's meeting day but before ${RUN_HOUR} AM Central. No change yet.`);
  process.exit(0);
}

// Move forward in 2-week steps until the date is in the future
let next = addDays(listed, 14);
while (next <= today) next = addDays(next, 14);

const ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
};
const nDay = next.getUTCDate();
const nMonth = MONTHS[next.getUTCMonth()];

const out = src
  .replace(monthRe, `$1${nMonth.slice(0, 3).toUpperCase()}$3`)
  .replace(dayRe, `$1${nDay}$3`)
  .replace(lineRe, `${DAYS[next.getUTCDay()]}, ${nMonth} ${nDay}${ordinal(nDay)}`);

writeFileSync(FILE, out);
console.log(`Updated Next Meeting: ${fmt(listed)} -> ${fmt(next)}`);
