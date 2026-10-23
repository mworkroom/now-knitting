import { AppError, buildState, validateStart, type Snapshot, type Project, type MutationResult, type ErrorPayload } from '../shared/model';

export const demo = import.meta.env.DEV && import.meta.env.VITE_DEMO === 'true';
const demoProjects: Project[] = [
  { id: 'sample-cardigan', name: 'Weekend cardigan', notionUrl: 'https://www.notion.so/', icon: { type: 'emoji', value: '🧶' }, progress: '42%', progressStatus: 'WIP', timeSpent: '18h 24m', selected: false },
  { id: 'sample-vest', name: 'Cable vest', notionUrl: 'https://www.notion.so/', icon: { type: 'emoji', value: '🧵' }, progress: '15%', progressStatus: 'WIP', timeSpent: '6h 10m', selected: false },
  { id: 'sample-socks', name: 'Everyday socks', notionUrl: 'https://www.notion.so/', icon: { type: 'emoji', value: '🧦' }, progress: '80%', progressStatus: 'On Pause', timeSpent: '12h 5m', selected: false },
  { id: 'sample-tee', name: 'Summer tee', notionUrl: 'https://www.notion.so/', icon: null, progress: null, progressStatus: 'WIP', timeSpent: null, selected: false },
];
let preview: Snapshot = { projects: demoProjects, state: buildState([], []) };
export class ApiError extends Error {
  constructor(public payload: ErrorPayload, public status: number) { super(payload.error.message); }
}
export type StateResponse = Snapshot & { needsReview?: boolean };

export async function api(path: string, body?: Record<string, unknown>): Promise<StateResponse & Partial<MutationResult>> {
  if (demo) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (path === '/api/select-project' && body) {
      if (preview.state.session) throw new AppError('session_active', 'End the current session before changing projects.');
      const projects = preview.projects.map(p => ({ ...p, selected: p.id === body.projectId }));
      preview = { projects, state: buildState(projects.filter(p => p.selected), []) };
      return { ...preview, action: 'selected' };
    }
    if (path === '/api/toggle' && body) {
      if (preview.state.session) {
        preview = { ...preview, state: buildState(preview.projects.filter(p => p.selected), []) };
        return { ...preview, action: 'ended' };
      }
      if (!preview.state.selectedProject) throw new AppError('choose_project', 'Choose a project before starting.');
      const session = { id: crypto.randomUUID(), projectId: preview.state.selectedProject.id, startAt: validateStart(body.startAt, Date.now()), notionUrl: 'https://www.notion.so/' };
      preview = { ...preview, state: { ...buildState(preview.projects.filter(p => p.selected), [session]), sessionProject: preview.state.selectedProject } };
      return { ...preview, action: 'started' };
    }
    return preview;
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'manual',
      headers: body ? { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() } : undefined,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new ApiError({ error: { code: body ? 'outcome_unknown' : 'network_error', message: body ? 'The connection was interrupted. This action was not retried. Refresh to check Notion before continuing.' : 'Could not connect. Your last displayed state is kept. Refresh when the connection returns.' } }, 0);
  }
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403 || !response.headers.get('Content-Type')?.includes('application/json'))
    throw new ApiError({ error: { code: 'sign_in_required', message: 'Your sign-in may have expired. Sign in again to reconnect.' } }, response.status);
  let data: StateResponse | ErrorPayload;
  try { data = await response.json(); } catch { throw new ApiError({ error: { code: 'unreadable_response', message: 'The response could not be read. Refresh to check the current state.' } }, response.status); }
  if (!response.ok || 'error' in data) throw new ApiError(data as ErrorPayload, response.status);
  return data as StateResponse;
}
