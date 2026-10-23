import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { reset, runInDurableObject, evictDurableObject } from 'cloudflare:test';
import { AppError, buildState, validateStart, type Snapshot, type Project } from '../shared/model';
import { NotionClient, projectFromPage, type NotionPage } from '../worker/notion';

const p1: Project = { id: '11111111-1111-4111-8111-111111111111', name: 'Cardigan', notionUrl: 'https://app.notion.com/p/cardigan', icon: null, progress: '42%', progressStatus: 'WIP', timeSpent: '18h 24m', selected: true };
const p2: Project = { ...p1, id: '22222222-2222-4222-8222-222222222222', name: 'Socks', progressStatus: 'On Pause', selected: false };
const session = { id: 'log-1', projectId: p1.id, startAt: '2026-09-30T01:00:00.000Z', notionUrl: 'https://app.notion.com/p/log' };
const snapshot = (): Snapshot => ({ projects: [{ ...p1 }, { ...p2 }], state: buildState([p1], []) });
const post = (path: string, body: unknown = {}, id: string = crypto.randomUUID()) => exports.default.fetch(`https://knitting.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify(body) });
const stub = () => env.COORDINATOR.getByName(env.PROJECTS_SOURCE_ID);
beforeEach(async () => { await reset(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await reset(); });

describe('time and Notion data contracts', () => {
  it('does not bind global fetch to the NotionClient instance', async () => {
    vi.stubGlobal('fetch', function (this: unknown, input: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      expect(String(input)).toBe('https://api.notion.com/v1/users/me');
      return Promise.resolve(Response.json({ object: 'user', id: 'test-connection' }));
    });
    await expect(new NotionClient(env).request('/users/me')).resolves.toMatchObject({ id: 'test-connection' });
  });
  it('validates explicit time, rejects future, malformed and invalid calendar dates', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(validateStart(undefined, now)).toBe('2026-10-01T12:00:00.000Z');
    expect(validateStart('2026-10-01T18:00:00+09:00', now)).toBe('2026-10-01T09:00:00.000Z');
    for (const value of ['2026-10-02T00:00:00Z', '2026-02-30T00:00:00Z', 'bad', '2026-10-01', null]) expect(() => validateStart(value, now)).toThrow();
  });
  it('does not invent a selection or numeric formula value', () => {
    expect(buildState([], []).selectedProject).toBeNull();
    expect(buildState([p1, p2], []).selectedProject).toBeNull();
    const page: NotionPage = { id: p1.id, properties: { Progress: { formula: { type: 'boolean', boolean: true } }, 'Time Spent': { formula: { type: 'string', string: '' } } } };
    expect(projectFromPage(page)).toMatchObject({ progress: null, timeSpent: null, selected: false });
    expect(buildState([p1], [session, { ...session, id: 'log-2' }]).issues).toHaveLength(1);
  });
  it('creates the correct Daily Log and closes exactly that log', async () => {
    const writes: { path: string; body: unknown }[] = [];
    const client = new NotionClient(env, vi.fn(async (input, init) => { writes.push({ path: String(input), body: JSON.parse(String(init?.body)) }); return Response.json({ id: session.id }); }) as typeof fetch);
    vi.spyOn(client, 'snapshot').mockResolvedValue({ ...snapshot(), state: buildState([p1], [session]) });
    await client.toggle(snapshot(), '2026-09-30T10:00:00+09:00', Date.parse('2026-10-01T00:00:00Z'));
    expect(writes[0].body).toMatchObject({ parent: { data_source_id: env.DAILY_LOG_SOURCE_ID }, properties: { Name: { title: [{ text: { content: 'Cardigan' } }] }, Category: { select: { name: 'Knitting' } }, Start: { date: { start: '2026-09-30T10:00:00.000+09:00' } }, '🧵 Knitting Projects': { relation: [{ id: p1.id }] } } });
    await client.toggle({ ...snapshot(), state: buildState([p1], [session]) }, undefined, Date.parse('2026-10-01T00:00:00Z'));
    expect(writes[1]).toMatchObject({ path: `https://api.notion.com/v1/pages/${session.id}`, body: { properties: { End: { date: { start: '2026-10-01T09:00:00.000+09:00' } } } } });
    expect(writes[2]).toEqual({ path: `https://api.notion.com/v1/blocks/${p1.id}/children`, body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'mention', mention: { type: 'date', date: { start: '2026-10-01T09:00:00.000+09:00', end: null } } }] } }] } });
    expect(writes).toHaveLength(3);
  });
  it('saves automatic and custom starts and End in Korea across the UTC date boundary', async () => {
    const writes: { properties: { Start?: { date: { start: string } }; End?: { date: { start: string } } } }[] = [];
    const client = new NotionClient(env, vi.fn(async (_input, init) => { writes.push(JSON.parse(String(init?.body))); return Response.json({}); }) as typeof fetch);
    vi.spyOn(client, 'snapshot').mockResolvedValue(snapshot());
    const now = Date.parse('2026-10-03T17:04:12.345Z');
    await client.toggle(snapshot(), undefined, now);
    expect(writes[0].properties.Start?.date.start).toBe('2026-10-04T02:04:12.345+09:00');
    expect(Date.parse(writes[0].properties.Start!.date.start)).toBe(now);
    await client.toggle(snapshot(), '2026-10-04T01:10:00+09:00', now);
    expect(writes[1].properties.Start?.date.start).toBe('2026-10-04T01:10:00.000+09:00');
    await client.toggle({ ...snapshot(), state: buildState([p1], [session]) }, undefined, now);
    expect(writes[2].properties.End?.date.start).toBe('2026-10-04T02:04:12.345+09:00');
    expect(Date.parse(writes[2].properties.End!.date.start)).toBe(now);
    expect(Object.keys(writes[2].properties)).toEqual(['End']);
  });
  it('appends to the session project even when another project is selected', async () => {
    const writes: string[] = [];
    const client = new NotionClient(env, vi.fn(async input => { writes.push(String(input)); return Response.json({}); }) as typeof fetch);
    vi.spyOn(client, 'snapshot').mockResolvedValue(snapshot());
    await client.toggle({ ...snapshot(), state: buildState([p2], [session]) }, undefined, Date.parse('2026-10-01T00:00:00Z'));
    expect(writes).toEqual([`https://api.notion.com/v1/pages/${session.id}`, `https://api.notion.com/v1/blocks/${p1.id}/children`]);
  });
  it('rejects a missing project relation before writing End', async () => {
    const transport = vi.fn();
    await expect(new NotionClient(env, transport).toggle({ ...snapshot(), state: buildState([p1], [{ ...session, projectId: null }]) }, undefined, Date.parse('2026-10-01T00:00:00Z'))).rejects.toMatchObject({ code: 'invalid_project_relation' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects active-session selection, outside-Schedule START, multiple logs and invalid END without writing', async () => {
    const transport = vi.fn(); const client = new NotionClient(env, transport);
    const active = { ...snapshot(), state: buildState([p1], [session]) };
    await expect(client.select(active, p2.id)).rejects.toMatchObject({ code: 'session_active' });
    await expect(client.toggle({ projects: [], state: snapshot().state }, undefined)).rejects.toMatchObject({ code: 'outside_schedule' });
    await expect(client.toggle({ ...snapshot(), state: buildState([p1], [session, { ...session, id: 'second' }]) }, undefined)).rejects.toMatchObject({ code: 'notion_conflict' });
    await expect(client.toggle(active, undefined, Date.parse(session.startAt))).rejects.toMatchObject({ code: 'invalid_end' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('can end the one valid session before repairing multiple project selections', async () => {
    const client = new NotionClient(env, vi.fn(async () => Response.json({})));
    vi.spyOn(client, 'snapshot').mockResolvedValue({ ...snapshot(), state: buildState([p1, p2], []) });
    const result = await client.toggle({ ...snapshot(), state: buildState([p1, p2], [session]) }, undefined, Date.parse('2026-10-01T00:00:00Z'));
    expect(result.action).toBe('ended');
  });
  it('paginates Schedule references in order and preserves On Pause', async () => {
    const pages = [p2, p1].map(p => ({ id: p.id, properties: { Name: { title: [{ plain_text: p.name }] }, 'Progress Status': { select: { name: p.progressStatus! } } } }));
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries')) return Response.json({ id: 'query-1', results: [{ id: p2.id }], has_more: true, next_cursor: 'opaque cursor' });
      if (url.includes('/queries/query-1?')) { expect(url).toContain('start_cursor=opaque%20cursor'); return Response.json({ results: [{ id: p1.id }], has_more: false }); }
      return Response.json(pages.find(p => url.endsWith(p.id)));
    });
    const projects = await new NotionClient(env, transport as typeof fetch).projects();
    expect(projects.map(p => p.name)).toEqual(['Socks', 'Cardigan']); expect(projects[0].progressStatus).toBe('On Pause');
  });
  it('honors 429 Retry-After but never retries an uncertain Notion write', async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } })).mockResolvedValueOnce(Response.json({ id: 'ok' }));
    await new NotionClient(env, transport).request('/pages', 'POST', {}, true);
    expect(transport).toHaveBeenCalledTimes(2);
    const failed = vi.fn().mockRejectedValue(new Error('connection lost'));
    await expect(new NotionClient(env, failed).request('/pages', 'POST', {}, true)).rejects.toMatchObject({ code: 'outcome_unknown', uncertain: true });
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

describe('Worker mutation safety in the real Durable Object runtime', () => {
  it('persists condition property IDs across eviction and keeps renamed fields attached', async () => {
    let renamed = false;
    const schemaRead = vi.fn();
    vi.spyOn(NotionClient.prototype, 'request').mockImplementation(async path => {
      if (path === `/data_sources/${env.PROJECTS_SOURCE_ID}`) {
        schemaRead();
        return { properties: { '카뜨가능': { id: 'c1' }, '역행용': { id: 'm1' }, '여름불가': { id: 's1' } } };
      }
      if (path.endsWith('/queries')) return { results: [{ id: p1.id, properties: {
        [renamed ? 'New Cafe' : '카뜨가능']: { id: 'c1', formula: { type: 'string', string: 'Yes' } },
        [renamed ? 'New Mindless' : '역행용']: { id: 'm1', checkbox: true },
        [renamed ? 'New Summer' : '여름불가']: { id: 's1', checkbox: false },
      } }], has_more: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    for (const change of [false, true]) {
      renamed = change;
      if (change) await evictDurableObject(stub());
      const response = await exports.default.fetch('https://knitting.test/api/projects');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ projects: [{ conditions: { cafe: true, mindless: true, summerBlocked: false } }] });
    }
    expect(schemaRead).toHaveBeenCalledTimes(1);
    expect(await runInDurableObject(stub(), (_, state) => state.storage.get(`condition-bindings:v1:${env.PROJECTS_SOURCE_ID}`))).toEqual({ cafe: 'c1', mindless: 'm1', summerBlocked: 's1' });
  });
  it.each(['rejected', 'uncertain'] as const)('locks after a %s project append and never duplicates the writes on replay', async failure => {
    let closed = false;
    vi.spyOn(NotionClient.prototype, 'snapshot').mockImplementation(async () => ({ ...snapshot(), state: buildState([p1], closed ? [] : [session]) }));
    const writes: string[] = [];
    vi.spyOn(NotionClient.prototype, 'request').mockImplementation(async path => {
      writes.push(path);
      if (path.startsWith('/pages/')) { closed = true; return {}; }
      throw new AppError(failure === 'uncertain' ? 'outcome_unknown' : 'notion_error', 'fixture append failed', 502, failure === 'uncertain');
    });
    const id = crypto.randomUUID();
    const response = await post('/api/toggle', {}, id);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'project_log_incomplete' }, needsReview: true, snapshot: { state: { session: null } } });
    expect(await (await post('/api/toggle', {}, id)).json()).toMatchObject({ error: { code: 'project_log_incomplete' }, needsReview: true });
    expect(await (await post('/api/toggle')).json()).toMatchObject({ error: { code: 'review_required' }, needsReview: true });
    expect(writes).toEqual([`/pages/${session.id}`, `/blocks/${p1.id}/children`]);
  });
  it('replays a completed END without appending a second project timestamp', async () => {
    let closed = false;
    vi.spyOn(NotionClient.prototype, 'snapshot').mockImplementation(async () => ({ ...snapshot(), state: buildState([p1], closed ? [] : [session]) }));
    const writes: string[] = [];
    vi.spyOn(NotionClient.prototype, 'request').mockImplementation(async path => { writes.push(path); if (path.startsWith('/pages/')) closed = true; return {}; });
    const id = crypto.randomUUID();
    expect(await (await post('/api/toggle', {}, id)).json()).toMatchObject({ action: 'ended' });
    expect(await (await post('/api/toggle', {}, id)).json()).toMatchObject({ action: 'ended' });
    expect(writes).toEqual([`/pages/${session.id}`, `/blocks/${p1.id}/children`]);
  });
  it('preserves read error codes across the Durable Object boundary', async () => {
    vi.spyOn(NotionClient.prototype, 'snapshot').mockRejectedValue(new AppError('notion_error', 'Notion returned 403. Check the connection permissions and try refreshing.', 502));
    const response = await exports.default.fetch('https://knitting.test/api/state');
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'notion_error', message: expect.stringContaining('403') } });
    vi.spyOn(NotionClient.prototype, 'projects').mockRejectedValue(new AppError('notion_unavailable', 'Could not reach Notion.', 502));
    const projects = await exports.default.fetch('https://knitting.test/api/projects');
    expect(await projects.json()).toMatchObject({ error: { code: 'notion_unavailable' } });
  });
  it('rejects cross-origin, non-JSON, unknown methods and missing operation IDs', async () => {
    expect((await exports.default.fetch('https://knitting.test/api/toggle', { method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await exports.default.fetch('https://knitting.test/api/toggle', { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await exports.default.fetch('https://knitting.test/api/toggle')).status).toBe(405);
    expect((await exports.default.fetch('https://knitting.test/api/no-such-route')).status).toBe(404);
    expect((await post('/api/toggle', {}, '')).status).toBe(400);
  });
  it('replays the same receipt without a second toggle and blocks rapid distinct requests', async () => {
    const read = vi.spyOn(NotionClient.prototype, 'snapshot').mockResolvedValue(snapshot());
    const toggle = vi.spyOn(NotionClient.prototype, 'toggle').mockResolvedValue({ ...snapshot(), action: 'started' });
    const id = crypto.randomUUID();
    expect((await post('/api/toggle', {}, id)).status).toBe(200);
    const latest = { ...snapshot(), state: buildState([p1], [session]) };
    read.mockResolvedValue(latest);
    const repeated = await post('/api/toggle', {}, id);
    expect(repeated.status).toBe(200); expect(await repeated.json()).toMatchObject({ state: { session: { id: session.id } } });
    const receipt = await runInDurableObject(stub(), (_, state) => state.storage.get<{ response: unknown }>(`operation:${id}`));
    expect(receipt?.response).toEqual({ action: 'started' });
    const rapid = await post('/api/toggle'); expect(rapid.status).toBe(409); expect(await rapid.json()).toMatchObject({ error: { code: 'too_fast' } });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect((await post('/api/select-project', { projectId: p2.id }, id)).status).toBe(409);
  });
  it('blocks concurrent writes while a Notion request is pending', async () => {
    vi.spyOn(NotionClient.prototype, 'snapshot').mockResolvedValue(snapshot());
    const toggle = vi.spyOn(NotionClient.prototype, 'toggle').mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 400)); return { ...snapshot(), action: 'started' }; });
    const first = post('/api/toggle');
    while (!toggle.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 10));
    const second = await post('/api/toggle'); expect(second.status).toBe(409); expect(await second.json()).toMatchObject({ error: { code: 'busy' } });
    expect((await first).status).toBe(200); expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('requires explicit review after an unknown write, then unlocks without toggling', async () => {
    vi.spyOn(NotionClient.prototype, 'snapshot').mockResolvedValue(snapshot());
    const toggle = vi.spyOn(NotionClient.prototype, 'toggle').mockRejectedValue(new AppError('outcome_unknown', 'uncertain', 502, true));
    expect((await post('/api/toggle')).status).toBe(502);
    expect(await (await exports.default.fetch('https://knitting.test/api/state')).json()).toMatchObject({ needsReview: true });
    expect((await post('/api/toggle')).status).toBe(409);
    expect((await post('/api/reconcile', { reviewed: true })).status).toBe(200);
    expect(await (await exports.default.fetch('https://knitting.test/api/state')).json()).toMatchObject({ needsReview: false });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(await runInDurableObject(stub(), (_, state) => state.storage.get('gate'))).toBeUndefined();
  });
  it('detects a pending operation after eviction and refuses a stale UI revision', async () => {
    vi.spyOn(NotionClient.prototype, 'snapshot').mockResolvedValue(snapshot());
    const toggle = vi.spyOn(NotionClient.prototype, 'toggle');
    const stale = await post('/api/toggle', { revision: 'old' }); expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: { code: 'state_changed' } });
    await runInDurableObject(stub(), (_, state) => state.storage.put('gate', { until: Date.now() + 1000, pending: true }));
    await evictDurableObject(stub());
    const blocked = await post('/api/toggle'); expect(blocked.status).toBe(409); expect(await blocked.json()).toMatchObject({ error: { code: 'outcome_unknown' } });
    expect(toggle).not.toHaveBeenCalled();
  });
  it('repairs multiple selections but rereads and reports a partial selection failure', async () => {
    const client = new NotionClient(env, vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(new Response('', { status: 400 })));
    const original = { ...snapshot(), state: buildState([p1, p2], []) };
    await expect(client.select(original, p2.id)).rejects.toMatchObject({ code: 'notion_error' });
    vi.spyOn(NotionClient.prototype, 'snapshot').mockResolvedValueOnce(original).mockResolvedValue(snapshot());
    vi.spyOn(NotionClient.prototype, 'select').mockRejectedValue(new AppError('notion_error', 'partial selection', 502));
    const response = await post('/api/select-project', { projectId: p2.id });
    expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ snapshot: { state: { selectedIds: [p1.id] } }, needsReview: true });
  });
});
