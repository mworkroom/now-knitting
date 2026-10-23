export type ProjectIcon = { type: 'emoji' | 'image'; value: string } | null;
export interface Project {
  id: string; name: string; notionUrl: string; icon: ProjectIcon;
  progress: string | null; progressStatus: string | null; timeSpent: string | null; selected: boolean;
  conditions?: { cafe: boolean | null; mindless: boolean | null; summerBlocked: boolean | null };
}
export interface Session { id: string; projectId: string | null; startAt: string | null; notionUrl: string }
export interface AppState {
  selectedProject: Project | null; session: Session | null; sessionProject?: Project;
  selectedIds: string[]; openSessions: Session[]; issues: string[]; revision: string;
}
export interface Snapshot { projects: Project[]; state: AppState }
export interface MutationResult extends Snapshot { action?: 'started' | 'ended' | 'selected' | 'unchanged' }
export interface ErrorPayload { error: { code: string; message: string }; snapshot?: Snapshot; needsReview?: boolean }

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public uncertain = false) { super(message); }
}

export function buildState(selected: Project[], sessions: Session[]): AppState {
  const issues: string[] = [];
  if (selected.length > 1) issues.push('Multiple projects are selected in Notion. Choose one in Projects to repair the selection.');
  if (sessions.length > 1) issues.push('Multiple knitting sessions are open. Close the extra logs in Notion before continuing.');
  if (sessions.length === 1 && (!sessions[0].startAt || !Number.isFinite(Date.parse(sessions[0].startAt))))
    issues.push('The open session has no valid start time. Correct its Start in Notion.');
  return {
    selectedProject: selected.length === 1 ? selected[0] : null,
    session: sessions.length === 1 ? sessions[0] : null,
    selectedIds: selected.map(p => p.id), openSessions: sessions, issues,
    revision: JSON.stringify([selected.map(p => p.id).sort(), sessions.map(s => [s.id, s.startAt, s.projectId]).sort()]),
  };
}

export function validateStart(value: unknown, now: number): string {
  if (value === undefined) return new Date(now).toISOString();
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new AppError('invalid_start', 'Enter a valid start date and time.');
  const date = Date.parse(value);
  const calendar = value.slice(0, 10);
  const [year, month, day] = calendar.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.toISOString().slice(0, 10) !== calendar) throw new AppError('invalid_start', 'Enter a valid calendar date.');
  if (date > now) throw new AppError('future_start', 'The start time cannot be in the future.');
  return new Date(date).toISOString();
}

export function elapsed(start: string | null, now: number): string {
  const seconds = start ? Math.max(0, Math.floor((now - Date.parse(start)) / 1000)) : 0;
  if (!Number.isFinite(seconds)) return '—';
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
