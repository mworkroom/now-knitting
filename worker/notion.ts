import { AppError, buildState, validateStart, type Project, type Session, type Snapshot, type MutationResult } from '../shared/model';

export interface NotionConfig {
  NOTION_TOKEN?: string; PROJECTS_SOURCE_ID: string; SCHEDULE_VIEW_ID: string; DAILY_LOG_SOURCE_ID: string; NOTION_VERSION: string;
}
type Property = {
  id?: string;
  type?: string; title?: { plain_text?: string; text?: { content?: string } }[];
  checkbox?: boolean; select?: { name?: string } | null;
  formula?: { type?: string; string?: string | null; number?: number | null; boolean?: boolean | null; date?: { start?: string } | null };
  date?: { start?: string } | null; relation?: { id: string }[];
};
export interface NotionPage {
  object?: string; id: string; url?: string; properties?: Record<string, Property>;
  parent?: { data_source_id?: string }; archived?: boolean; in_trash?: boolean;
  icon?: { type: string; emoji?: string; file?: { url: string }; external?: { url: string }; custom_emoji?: { url?: string }; icon?: { url?: string } } | null;
}
interface NotionList { results: NotionPage[]; has_more?: boolean; next_cursor?: string | null; id?: string; request_status?: { type?: string } }
export const CONDITION_PROPERTY_NAMES = { cafe: '카뜨가능', mindless: '역행용', summerBlocked: '여름불가' } as const;
export type ConditionBindings = Partial<Record<keyof typeof CONDITION_PROPERTY_NAMES, string>>;
export interface ConditionBindingStore {
  load(): Promise<ConditionBindings | undefined>;
  save(bindings: ConditionBindings): Promise<void>;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function propertyId(id: string): string {
  try { return decodeURIComponent(id); } catch { return id; }
}
function conditionProperty(properties: Record<string, Property>, key: keyof ConditionBindings, bindings: ConditionBindings): Property | undefined {
  const id = bindings[key];
  // Once bound, a missing/deleted property stays unknown; never rebind to an unrelated namesake.
  return id ? Object.values(properties).find(p => p.id && propertyId(p.id) === propertyId(id)) : properties[CONDITION_PROPERTY_NAMES[key]];
}

export function formulaText(property?: Property): string | null {
  const f = property?.formula;
  if (f?.type === 'string' && typeof f.string === 'string' && f.string.trim()) return f.string;
  if (f?.type === 'number' && typeof f.number === 'number' && Number.isFinite(f.number)) return String(f.number);
  return null;
}
function httpsUrl(url?: string): string | null {
  if (!url) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}
export function projectFromPage(page: NotionPage, bindings: ConditionBindings = {}): Project {
  const p = page.properties ?? {};
  const image = httpsUrl(page.icon?.file?.url ?? page.icon?.external?.url ?? page.icon?.custom_emoji?.url ?? page.icon?.icon?.url);
  return {
    id: page.id,
    name: p.Name?.title?.map(t => t.plain_text ?? t.text?.content ?? '').join('') || 'Untitled project',
    notionUrl: httpsUrl(page.url) ?? `https://app.notion.com/p/${page.id.replaceAll('-', '')}`,
    icon: page.icon?.type === 'emoji' && page.icon.emoji ? { type: 'emoji', value: page.icon.emoji } : image ? { type: 'image', value: image } : null,
    progress: formulaText(p.Progress), progressStatus: p['Progress Status']?.select?.name ?? null,
    timeSpent: formulaText(p['Time Spent']), selected: p['Now Knitting']?.checkbox === true,
    conditions: {
      cafe: booleanProperty(conditionProperty(p, 'cafe', bindings)),
      mindless: booleanProperty(conditionProperty(p, 'mindless', bindings)),
      summerBlocked: booleanProperty(conditionProperty(p, 'summerBlocked', bindings)),
    },
  };
}
function booleanProperty(property?: Property): boolean | null {
  if (typeof property?.checkbox === 'boolean') return property.checkbox;
  if (property?.formula?.type === 'boolean' && typeof property.formula.boolean === 'boolean') return property.formula.boolean;
  if (property?.formula?.type === 'string') {
    const text = property.formula.string?.trim().toLowerCase();
    if (text === 'yes') return true;
    if (text === 'no') return false;
  }
  return null;
}
function sessionFromPage(page: NotionPage): Session {
  return { id: page.id, projectId: page.properties?.['🧵 Knitting Projects']?.relation?.length === 1 ? page.properties['🧵 Knitting Projects'].relation[0].id : null,
    startAt: page.properties?.Start?.date?.start ?? null,
    notionUrl: httpsUrl(page.url) ?? `https://app.notion.com/p/${page.id.replaceAll('-', '')}` };
}

// Keep the instant unchanged while giving Notion's date editor a Korean UTC offset.
function koreanDate(value: string | number): { start: string } {
  const instant = typeof value === 'number' ? value : Date.parse(value);
  return { start: new Date(instant + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00') };
}

export class NotionClient {
  private nextRequestAt = 0;
  private conditionBindings: ConditionBindings = {};
  // Native Worker fetch requires its global receiver; do not invoke it as this.transport().
  constructor(private config: NotionConfig, private transport: typeof fetch = (input, init) => fetch(input, init), private bindingStore?: ConditionBindingStore) {}

  private async bindConditions(): Promise<void> {
    if (!this.bindingStore) return;
    const stored = await this.bindingStore.load() ?? {};
    this.conditionBindings = stored;
    const keys = Object.keys(CONDITION_PROPERTY_NAMES) as (keyof ConditionBindings)[];
    if (keys.every(key => stored[key])) return;
    const schema = await this.request<{ properties: Record<string, Property> }>(`/data_sources/${this.config.PROJECTS_SOURCE_ID}`);
    const bindings = { ...stored };
    for (const key of keys) {
      const id = schema.properties?.[CONDITION_PROPERTY_NAMES[key]]?.id;
      if (!bindings[key] && id) bindings[key] = id;
    }
    this.conditionBindings = bindings;
    if (keys.some(key => bindings[key] !== stored[key])) await this.bindingStore.save(bindings);
  }

  async request<T>(path: string, method = 'GET', body?: unknown, mutation = false): Promise<T> {
    if (!this.config.NOTION_TOKEN) throw new AppError('setup_required', 'Notion is not connected yet. Add the Worker secret to finish setup.', 503);
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = Math.max(0, this.nextRequestAt - Date.now());
      this.nextRequestAt = Date.now() + wait + 350;
      if (wait) await sleep(wait);
      let response: Response;
      try {
        response = await this.transport(`https://api.notion.com/v1${path}`, {
          method, headers: { Authorization: `Bearer ${this.config.NOTION_TOKEN}`, 'Notion-Version': this.config.NOTION_VERSION, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(mutation ? 20000 : 60000),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : 'UnknownError';
        const message = error instanceof Error ? error.message.replaceAll(this.config.NOTION_TOKEN, '[redacted]') : 'Unknown transport failure';
        console.error({ event: 'notion_transport_error', operation: mutation ? 'write' : 'read', name, message });
        throw new AppError(mutation ? 'outcome_unknown' : 'notion_unavailable', mutation ? 'Notion did not confirm the write. Read the current state before doing anything else.' : 'Could not reach Notion. Try refreshing when the connection returns.', 502, mutation);
      }
      if (response.status === 429 && attempt < 3) {
        const seconds = Number(response.headers.get('Retry-After') ?? '1');
        if (!Number.isFinite(seconds) || seconds > 60) throw new AppError('rate_limited', 'Notion is busy. Wait a moment, then refresh.', 429);
        await sleep(Math.max(1, seconds) * 1000); continue;
      }
      if (!response.ok) {
        const unknown = mutation && response.status >= 500;
        throw new AppError(unknown ? 'outcome_unknown' : 'notion_error', unknown ? 'The write result is uncertain. Review the current Notion state before continuing.' : `Notion returned ${response.status}. Check the connection permissions and try refreshing.`, response.status === 429 ? 429 : 502, unknown);
      }
      try { return await response.json() as T; }
      catch { throw new AppError(mutation ? 'outcome_unknown' : 'notion_error', 'Notion returned an unreadable response. Refresh to check its current state.', 502, mutation); }
    }
    throw new AppError('rate_limited', 'Notion is busy. Wait a moment, then refresh.', 429);
  }

  async query(source: string, filter: unknown): Promise<NotionPage[]> {
    const pages: NotionPage[] = []; let cursor: string | undefined;
    do {
      const data: NotionList = await this.request(`/data_sources/${source}/query`, 'POST', { filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      pages.push(...data.results);
      if (data.has_more && !data.next_cursor) throw new AppError('incomplete_results', 'Notion returned an incomplete list. Refresh before continuing.', 502);
      cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
    } while (cursor);
    return pages;
  }

  async projects(): Promise<Project[]> {
    await this.bindConditions();
    const view = this.config.SCHEDULE_VIEW_ID;
    let data = await this.request<NotionList>(`/views/${view}/queries`, 'POST', { page_size: 100 });
    const queryId = data.id;
    const refs: NotionPage[] = [];
    while (true) {
      if (data.request_status?.type === 'incomplete') throw new AppError('incomplete_schedule', 'The Schedule query is incomplete. Narrow the Notion view before continuing.', 502);
      refs.push(...data.results);
      if (!data.has_more) break;
      if (!queryId || !data.next_cursor) throw new AppError('incomplete_schedule', 'The Schedule query could not be paginated.', 502);
      data = await this.request(`/views/${view}/queries/${queryId}?page_size=100&start_cursor=${encodeURIComponent(data.next_cursor)}`);
    }
    const projects: Project[] = [];
    // Resolve in order and pace requests: Schedule references do not contain page properties.
    for (const ref of refs) {
      const page = ref.properties ? ref : await this.request<NotionPage>(`/pages/${ref.id}`);
      if (!page.archived && !page.in_trash) projects.push(projectFromPage(page, this.conditionBindings));
    }
    return projects;
  }

  async snapshot(): Promise<Snapshot> {
    const [projects, selectedPages, logs] = await Promise.all([
      this.projects(), this.query(this.config.PROJECTS_SOURCE_ID, { property: 'Now Knitting', checkbox: { equals: true } }),
      this.query(this.config.DAILY_LOG_SOURCE_ID, { and: [{ property: 'Category', select: { equals: 'Knitting' } }, { property: 'End', date: { is_empty: true } }] }),
    ]);
    const selected = selectedPages.map(page => projectFromPage(page, this.conditionBindings));
    const state = buildState(selected, logs.map(sessionFromPage));
    if (state.session) {
      if (!state.session.projectId) state.issues.push('The open session must relate to exactly one knitting project. Fix its relation in Notion.');
      else {
        state.sessionProject = projects.find(p => p.id === state.session?.projectId)
          ?? projectFromPage(await this.request<NotionPage>(`/pages/${state.session.projectId}`), this.conditionBindings);
      }
    }
    const ids = new Set(state.selectedIds);
    return { projects: projects.map(p => ({ ...p, selected: ids.has(p.id) })), state };
  }

  async select(snapshot: Snapshot, id: string): Promise<MutationResult> {
    if (snapshot.state.openSessions.length) throw new AppError('session_active', 'End the current session before changing projects.', 409);
    if (!snapshot.projects.some(p => p.id === id)) throw new AppError('invalid_project', 'Choose a project from the current Schedule.', 400);
    if (snapshot.state.selectedIds.length === 1 && snapshot.state.selectedIds[0] === id) return { ...snapshot, action: 'unchanged' };
    for (const previous of snapshot.state.selectedIds.filter(previous => previous !== id))
      await this.request(`/pages/${previous}`, 'PATCH', { properties: { 'Now Knitting': { checkbox: false } } }, true);
    await this.request(`/pages/${id}`, 'PATCH', { properties: { 'Now Knitting': { checkbox: true } } }, true);
    return { ...await this.snapshot(), action: 'selected' };
  }

  async toggle(snapshot: Snapshot, startAt: unknown, now = Date.now()): Promise<MutationResult> {
    const state = snapshot.state;
    const blockingIssues = state.issues.filter(issue => !(state.session && issue.startsWith('Multiple projects')));
    if (blockingIssues.length) throw new AppError('notion_conflict', blockingIssues.join(' '), 409);
    if (state.session) {
      if (!state.session.startAt || Date.parse(state.session.startAt) >= now) throw new AppError('invalid_end', 'The end time must be after Start. Correct Start in Notion.', 409);
      if (!state.session.projectId) throw new AppError('invalid_project_relation', 'The open session must relate to exactly one knitting project. Fix its relation in Notion.', 409);
      const end = koreanDate(now);
      await this.request(`/pages/${state.session.id}`, 'PATCH', { properties: { End: { date: end } } }, true);
      try {
        await this.request(`/blocks/${state.session.projectId}/children`, 'PATCH', {
          children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [
            { type: 'mention', mention: { type: 'date', date: { ...end, end: null } } },
          ] } }],
        }, true);
      } catch {
        // End is already saved. Never report completion or automatically repeat the append.
        throw new AppError('project_log_incomplete', 'Daily Log End was saved, but the project-page timestamp was not confirmed. Check Daily Log and the project page in Notion before unlocking changes.', 502, true);
      }
      return { ...await this.snapshot(), action: 'ended' };
    }
    const project = state.selectedProject;
    if (!project) throw new AppError('choose_project', 'Choose a project before starting.', 409);
    if (!snapshot.projects.some(p => p.id === project.id)) throw new AppError('outside_schedule', 'The selected project is outside Schedule. Choose a project in Projects.', 409);
    const start = validateStart(startAt, now);
    await this.request('/pages', 'POST', {
      parent: { type: 'data_source_id', data_source_id: this.config.DAILY_LOG_SOURCE_ID },
      properties: { Name: { title: [{ text: { content: project.name } }] }, Category: { select: { name: 'Knitting' } },
        Start: { date: koreanDate(start) }, '🧵 Knitting Projects': { relation: [{ id: project.id }] } },
    }, true);
    return { ...await this.snapshot(), action: 'started' };
  }
}
