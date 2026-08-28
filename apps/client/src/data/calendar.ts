export type EventKind = 'anniversary' | 'meal' | 'camping' | 'task';

export interface CalendarEvent {
  id: string;
  date: string;
  kind: EventKind;
  title: string;
  target: 'meal' | 'camping' | 'shopping' | 'task';
}

export const calendarEvents: CalendarEvent[] = [
  { id: 'anniversary-1', date: '2026-08-29', kind: 'anniversary', title: '在一起纪念日', target: 'task' },
  { id: 'meal-1', date: '2026-08-29', kind: 'meal', title: '晚餐：番茄牛腩', target: 'meal' },
  { id: 'task-1', date: '2026-08-30', kind: 'task', title: '清洗空调滤网', target: 'task' },
  { id: 'camping-1', date: '2026-09-05', kind: 'camping', title: '怀柔露营', target: 'camping' },
  { id: 'camping-2', date: '2026-09-06', kind: 'camping', title: '怀柔露营', target: 'camping' },
];

export const eventLabels: Record<EventKind, string> = {
  anniversary: '纪念日',
  meal: '吃什么',
  camping: '去露营',
  task: '家庭待办',
};

export const eventStamps: Record<EventKind, string> = {
  anniversary: '❤',
  meal: '🍲',
  camping: '⛺',
  task: '✓',
};
