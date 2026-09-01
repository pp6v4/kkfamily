export const MODULES = ['recipes', 'meals', 'inventory', 'shopping', 'trips', 'packing_templates', 'tasks', 'favorites', 'archive', 'dashboard', 'members', 'calendar', 'notifications'] as const;
export type ModuleCode = typeof MODULES[number];
export type Level = 'VIEW' | 'EDIT' | 'MANAGE';
export type Permissions = Partial<Record<ModuleCode, Level>>;
export interface Override { module: string; level: Level; effect: 'ALLOW' | 'DENY' }
export const RANK: Record<Level, number> = { VIEW: 1, EDIT: 2, MANAGE: 3 };
export const ROLE_DEFAULTS: Record<string, Permissions> = {
  ADMIN: Object.fromEntries(MODULES.map(module => [module, 'MANAGE'])) as Permissions,
  MEMBER: { recipes: 'VIEW', meals: 'EDIT', inventory: 'EDIT', shopping: 'EDIT', trips: 'EDIT', packing_templates: 'EDIT', tasks: 'EDIT', favorites: 'EDIT', archive: 'VIEW', dashboard: 'VIEW', members: 'VIEW', calendar: 'EDIT', notifications: 'VIEW' },
  CHEF: { recipes: 'EDIT', meals: 'MANAGE', inventory: 'VIEW', shopping: 'EDIT' },
  CAMPER: { trips: 'EDIT' },
  GUEST: {},
};

export function effectivePermissions(roles: string[], overrides: Override[]): Permissions {
  const result: Permissions = {};
  for (const role of roles) for (const [module, level] of Object.entries(ROLE_DEFAULTS[role] ?? {})) {
    const key = module as ModuleCode;
    if (RANK[level!] > (result[key] ? RANK[result[key]!] : 0)) result[key] = level;
  }
  // Explicit levels replace role defaults; DENY wins even with malformed duplicates.
  for (const entry of overrides) if (MODULES.includes(entry.module as ModuleCode) && entry.effect === 'ALLOW') result[entry.module as ModuleCode] = entry.level;
  for (const entry of overrides) if (entry.effect === 'DENY') delete result[entry.module as ModuleCode];
  return result;
}

export function permits(permissions: Permissions, module: ModuleCode, level: Level = 'VIEW') {
  return (permissions[module] ? RANK[permissions[module]!] : 0) >= RANK[level];
}
