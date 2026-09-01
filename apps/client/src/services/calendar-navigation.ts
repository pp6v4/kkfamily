export interface CalendarTarget { type: 'MEAL' | 'TRIP'; date: string; sourceId?: string; mealType?: string }
let pending: CalendarTarget | undefined;
// Navigation intent only; never use this as resource authorization.
export function setCalendarTarget(target: CalendarTarget) { pending = { ...target }; }
export function takeCalendarTarget(type: CalendarTarget['type']) {
  if (pending?.type !== type) return undefined;
  const target = pending; pending = undefined; return target;
}
