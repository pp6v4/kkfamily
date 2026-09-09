import { isCalendarDate, shanghaiDate } from './trip-form';

const DAY = 86_400_000;
export function todayInShanghai(now = new Date()) { return shanghaiDate(now.toISOString()); }

export function shiftMonth(month: string, delta: number) {
  if (!isCalendarDate(month)) throw new Error('请选择有效日期');
  const value = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + delta);
  const next = value.toISOString().slice(0, 10);
  if (!isCalendarDate(next)) throw new Error('超出日历日期范围');
  return next;
}

export function monthGrid(month: string) {
  if (!isCalendarDate(month)) throw new Error('请选择有效日期');
  // UTC arithmetic represents pure dates; device timezone/DST must not shift cells.
  const first = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  const start = first.getTime() - first.getUTCDay() * DAY;
  return Array.from({ length: 42 }, (_, index) => {
    const key = new Date(start + index * DAY).toISOString().slice(0, 10);
    return { key, day: Number(key.slice(8)), isCurrent: key.slice(0, 7) === month.slice(0, 7) };
  });
}

export function gridRange(month: string) {
  const grid = monthGrid(month);
  const next = new Date(Date.parse(`${grid[41].key}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
  // Fetch every visible cell, including adjacent-month dates that can be opened.
  return { from: `${grid[0].key}T00:00:00+08:00`, to: `${next}T00:00:00+08:00` };
}

export function overlapsDay(event: { startsAt: string; endsAt?: string | null }, day: string) {
  const start = Date.parse(`${day}T00:00:00+08:00`), end = start + DAY;
  const eventStart = Date.parse(event.startsAt), eventEnd = event.endsAt ? Date.parse(event.endsAt) : eventStart;
  return eventStart < end && (eventEnd > eventStart ? eventEnd > start : eventStart >= start);
}
