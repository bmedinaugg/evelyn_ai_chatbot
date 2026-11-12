// Calendar days in Europe/Amsterdam (reports and metrics), as `YYYY-MM-DD` strings.
const ZONE = 'Europe/Amsterdam';
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Amsterdam date of an instant. */
export function amsterdamDay(instant: Date): string {
  return formatter.format(instant);
}

/** A real calendar date written as YYYY-MM-DD. */
export function isDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** UTC offset of Amsterdam (minutes) at an instant. */
function offsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((local - instant.getTime()) / 60_000);
}

/** The instant of local midnight at the start of `day`. */
function midnight(day: string): Date {
  const naive = new Date(`${day}T00:00:00Z`).getTime();
  // Two passes: the offset at the guess can differ from the offset at the answer near a DST change.
  let guess = naive - offsetMinutes(new Date(naive)) * 60_000;
  guess = naive - offsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess);
}

/** [start, end) of an Amsterdam calendar day: 23, 24 or 25 hours. */
export function amsterdamDayBounds(day: string): { start: Date; end: Date } {
  return { start: midnight(day), end: midnight(shiftDay(day, 1)) };
}
