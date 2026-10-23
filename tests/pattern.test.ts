import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { MAX_BATCH, mergeOperations, parsePattern, visibleHighlights, type PatternDocument, type PatternOperation } from '../shared/pattern';
import { NotionClient, projectFromPage } from '../worker/notion';

const projectId = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);
const add: PatternOperation = { id: '11111111-1111-4111-8111-111111111110', type: 'add', mark: { id: '11111111-1111-4111-8111-111111111110', page: 2, x: .2, y: .3, width: .1, height: .02, color: 'yellow' } };
const remove: PatternOperation = { id: '11111111-1111-4111-8111-111111111112', type: 'remove', targetId: add.id };
const doc = (operations: PatternOperation[] = [add]): PatternDocument => ({ version: 1, projectId, hash, fileName: 'Pattern.pdf', pageCount: 3, operations });
const post = (body: unknown) => exports.default.fetch('https://knitting.test/api/annotations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = (id = projectId, fingerprint = hash) => exports.default.fetch(`https://knitting.test/api/annotations?projectId=${id}&hash=${fingerprint}`);
beforeEach(async () => { await reset(); });
afterEach(async () => { vi.restoreAllMocks(); await reset(); });

describe('annotation restore and backup contracts', () => {
  it('merges offline additions and removals independent of delivery order, without duplicate marks', () => {
    expect(visibleHighlights(mergeOperations([remove], [add, remove]))).toEqual([]);
    expect(mergeOperations([add], [add])).toEqual([add]);
    expect(parsePattern(JSON.parse(JSON.stringify(doc())))).toEqual(doc());
  });
  it('rejects malformed, foreign-version, out-of-page and conflicting backup operations', () => {
    for (const invalid of [ { ...doc(), version: 2 }, { ...doc(), hash: 'wrong' }, { ...doc(), operations: [add, add] }, { ...doc(), operations: [{ ...add, mark: { ...add.mark, page: 4 } }] }, { ...doc(), operations: [{ ...add, mark: { ...add.mark, width: .9 } }] } ]) expect(() => parsePattern(invalid)).toThrow();
    expect(() => mergeOperations([add], [{ ...add, mark: { ...add.mark, color: 'blue' } }])).toThrow();
  });
  it('preserves real condition values and leaves missing flags unknown', () => {
    const project = projectFromPage({ id: projectId, properties: { '카뜨가능': { checkbox: false }, '역행용': { checkbox: true } } });
    expect(project.conditions).toEqual({ cafe: false, mindless: true, summerBlocked: null });
  });
});

describe('durable annotation API', () => {
  it('stores only metadata and marks, without needing Notion or an idempotency token', async () => {
    const notion = vi.spyOn(NotionClient.prototype, 'snapshot').mockRejectedValue(new Error('Notion unavailable'));
    expect((await post(doc())).status).toBe(200);
    const result = await (await get()).json() as { document: PatternDocument };
    expect(parsePattern(result.document)).toEqual(doc());
    expect(notion).not.toHaveBeenCalled();
    const list = await exports.default.fetch(`https://knitting.test/api/patterns?projectId=${projectId}`);
    expect(await list.json()).toMatchObject({ patterns: [{ hash, fileName: 'Pattern.pdf', pageCount: 3 }] });
  });
  it('retries safely and preserves independent edits and deletion tombstones', async () => {
    expect((await post(doc())).status).toBe(200);
    expect((await post(doc())).status).toBe(200);
    expect((await post(doc([remove]))).status).toBe(200);
    expect((await post(doc())).status).toBe(200);
    const result = await (await get()).json() as { document: PatternDocument };
    expect(result.document.operations).toHaveLength(2);
    expect(visibleHighlights(result.document.operations)).toEqual([]);
  });
  it('accepts a full offline batch within storage bulk limits and retries it without duplicates', async () => {
    const batch = Array.from({ length: MAX_BATCH }, (_, i): PatternOperation => ({ ...add, id: `batch-operation-${i.toString().padStart(4, '0')}`, mark: { ...add.mark, id: `batch-operation-${i.toString().padStart(4, '0')}` } }));
    const response = await post(doc(batch));
    expect(response.status).toBe(200);
    expect((await response.json() as { acceptedIds: string[] }).acceptedIds).toHaveLength(MAX_BATCH);
    await (await post(doc(batch))).json();
    const result = await (await get()).json() as { document: PatternDocument };
    expect(result.document.operations).toHaveLength(MAX_BATCH);
  });
  it('keeps identical PDFs isolated by project and different PDFs isolated by hash', async () => {
    await post(doc());
    expect(await (await get('22222222-2222-4222-8222-222222222222')).json()).toEqual({ document: null });
    expect(await (await get(projectId, 'b'.repeat(64))).json()).toEqual({ document: null });
    await post({ ...doc([]), projectId: '22222222-2222-4222-8222-222222222222' });
    expect(await (await get('22222222-2222-4222-8222-222222222222')).json()).toMatchObject({ document: { operations: [] } });
  });
  it('preserves year-old annotations through object eviction and timer receipt cleanup', async () => {
    // Consume the response before eviction: the runtime waits for response streams to drain.
    await (await post(doc())).json();
    const stub = env.COORDINATOR.getByName(env.PROJECTS_SOURCE_ID);
    await runInDurableObject(stub, async (_, state) => {
      await state.storage.put('operation:old', { status: 'done', created: Date.now() - 366 * 86400000 });
      const metaKey = `pattern-meta:${projectId}:${hash}`;
      const meta = await state.storage.get<Record<string, unknown>>(metaKey);
      await state.storage.put(metaKey, { ...meta, updatedAt: Date.now() - 366 * 86400000 });
      await state.storage.setAlarm(Date.now() + 86400000);
    });
    await evictDurableObject(stub);
    expect(await (await get()).json()).toMatchObject({ document: { operations: [add] } });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runInDurableObject(stub, (_, state) => state.storage.get('operation:old'))).toBeUndefined();
    expect(await (await get()).json()).toMatchObject({ document: { operations: [add] } });
  });
  it('rejects an ID collision atomically, without replacing already saved highlights', async () => {
    await post(doc());
    const changed = { ...add, mark: { ...add.mark, color: 'pink' } };
    expect((await post(doc([remove, changed] as PatternOperation[]))).status).toBe(409);
    const result = await (await get()).json() as { document: PatternDocument };
    expect(result.document.operations).toEqual([add]);
  });
  it('validates request sizes and scopes and preserves existing API origin protections', async () => {
    expect((await exports.default.fetch('https://knitting.test/api/annotations?projectId=../x&hash=no')).status).toBe(400);
    expect((await post({ ...doc(), operations: Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ ...remove, id: `operation-00000000-${i}` })) })).status).toBe(400);
    expect((await exports.default.fetch('https://knitting.test/api/annotations', { method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: JSON.stringify(doc()) })).status).toBe(403);
    expect((await exports.default.fetch('https://knitting.test/api/annotations', { method: 'POST', body: '{}' })).status).toBe(415);
  });
});
