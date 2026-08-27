export const MODULES = ['recipes', 'meals', 'shopping', 'trips', 'calendar', 'tasks', 'profile'] as const;
export type FamilyModule = (typeof MODULES)[number];
export type PermissionLevel = 'VIEW' | 'EDIT' | 'MANAGE';

