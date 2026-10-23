import type { Project } from './model';

export const CONDITIONS = [
  { key: 'cafe', label: 'Cafe' },
  { key: 'mindless', label: 'Mindless' },
  { key: 'summer', label: 'Summer' },
] as const;
export type ConditionKey = typeof CONDITIONS[number]['key'];
export type ProjectFilters = Record<ConditionKey, boolean>;
export const EMPTY_FILTERS: ProjectFilters = { cafe: false, mindless: false, summer: false };

export function conditionAvailability(project: Project, key: ConditionKey): boolean | null {
  if (key === 'summer') {
    const blocked = project.conditions?.summerBlocked;
    return typeof blocked === 'boolean' ? !blocked : null;
  }
  return project.conditions?.[key] ?? null;
}

export function matchesProject(project: Project, search: string, filters: ProjectFilters): boolean {
  return project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && CONDITIONS.every(({ key }) => !filters[key] || conditionAvailability(project, key) === true);
}
