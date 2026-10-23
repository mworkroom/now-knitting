import { DurableObject } from 'cloudflare:workers';
import { AppError, type ErrorPayload, type MutationResult } from '../shared/model';
import { NotionClient } from './notion';
import { patternRequest } from './pattern';

declare global { interface Env { NOTION_TOKEN?: string } }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
type Receipt = Pick<MutationResult, 'action'> & Partial<Pick<ErrorPayload, 'error' | 'needsReview'>>;
interface Operation { path: string; body: Record<string, unknown>; status: 'pending' | 'done'; response?: Receipt; httpStatus?: number; created: number }

// One coordinator per data source. Timer receipts and durable annotation journals use separate prefixes.
export class KnittingCoordinator extends DurableObject<Env> {
  private busy = false;

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api/patterns' || path === '/api/annotations') return patternRequest(request, this.ctx.storage);
    const bindingKey = `condition-bindings:v1:${this.env.PROJECTS_SOURCE_ID}`;
    const notion = new NotionClient(this.env, undefined, {
      load: () => this.ctx.storage.get(bindingKey),
      save: bindings => this.ctx.storage.put(bindingKey, bindings),
    });
    if (request.method === 'GET') {
      try {
        if (path === '/api/projects') return json({ projects: await notion.projects() });
        const snapshot = await notion.snapshot();
        return json({ ...snapshot, needsReview: (await this.ctx.storage.get<boolean>('needsReview')) === true });
      } catch (error) {
        // Return the error before crossing the Durable Object boundary, which strips custom Error fields.
        const e = error instanceof AppError ? error : new AppError('request_failed', 'Could not read Notion. Refresh to try again.', 502);
        return json({ error: { code: e.code, message: e.message } }, e.status);
      }
    }
    if (this.busy) return json({ error: { code: 'busy', message: 'A change is already in progress. Wait, then refresh.' } }, 409);
    this.busy = true;
    let requestId = ''; let operation: Operation | undefined; let writeStarted = false;
    try {
      const bodyText = await request.text();
      if (bodyText.length > 4096) throw new AppError('invalid_request', 'The request is too large.');
      let body: Record<string, unknown>;
      try { const parsed: unknown = JSON.parse(bodyText || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); body = parsed as Record<string, unknown>; }
      catch { throw new AppError('invalid_request', 'Send a valid JSON object.'); }
      if (path === '/api/reconcile') {
        if (body.reviewed !== true) throw new AppError('review_required', 'Review the logs in Notion first.');
        const snapshot = await notion.snapshot();
        if (snapshot.state.issues.length) throw new AppError('notion_conflict', snapshot.state.issues.join(' '), 409);
        await this.ctx.storage.delete('needsReview');
        await this.ctx.storage.delete('gate');
        return json(snapshot);
      }
      requestId = request.headers.get('Idempotency-Key') ?? '';
      if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) throw new AppError('request_id_required', 'A unique Idempotency-Key is required.');
      const previous = await this.ctx.storage.get<Operation>(`operation:${requestId}`);
      if (previous) {
        if (previous.path !== path || JSON.stringify(previous.body) !== JSON.stringify(body)) throw new AppError('request_id_reused', 'This request ID was already used for a different action.', 409);
        if (previous.status === 'done') {
          const fresh = await notion.snapshot();
          const receipt = previous.response ?? {};
          return json(receipt.error ? { ...receipt, snapshot: fresh } : { ...fresh, ...receipt }, previous.httpStatus);
        }
        await this.ctx.storage.put('needsReview', true);
        throw new AppError('outcome_unknown', 'A previous write was interrupted. Review Notion before continuing.', 409, true);
      }
      if (await this.ctx.storage.get<boolean>('needsReview')) throw new AppError('review_required', 'A write result needs review. Refresh, inspect Notion, then unlock changes.', 409, true);
      const gate = await this.ctx.storage.get<{ until: number; pending: boolean }>('gate');
      if (gate?.pending) {
        await this.ctx.storage.put('needsReview', true);
        throw new AppError('outcome_unknown', 'A previous write was interrupted. Review Notion before continuing.', 409, true);
      }
      if (gate && gate.until > Date.now()) throw new AppError('too_fast', 'The last action just finished. Wait a moment before the next one.', 409);
      const snapshot = await notion.snapshot();
      if (body.revision !== undefined && body.revision !== snapshot.state.revision) throw new AppError('state_changed', 'The Notion state changed. Refresh before trying again.', 409);
      if (path === '/api/select-project' && typeof body.projectId !== 'string') throw new AppError('invalid_project', 'Choose a project from Schedule.');
      operation = { path, body, status: 'pending', created: Date.now() };
      await this.ctx.storage.put({ [`operation:${requestId}`]: operation, gate: { until: Date.now() + 2500, pending: true } });
      writeStarted = true;
      const result = path === '/api/toggle' ? await notion.toggle(snapshot, body.startAt) : await notion.select(snapshot, body.projectId as string);
      operation = { ...operation, status: 'done', response: { action: result.action }, httpStatus: 200 };
      await this.ctx.storage.put({ [`operation:${requestId}`]: operation, gate: { until: Date.now() + 2500, pending: false } });
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
      return json(result);
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError('request_failed', 'The request could not be completed. Refresh to check Notion.', 502, writeStarted);
      const payload: ErrorPayload = { error: { code: appError.code, message: appError.message } };
      if (writeStarted || appError.uncertain) {
        // A validation error proves no write occurred. Read/transport errors after a write may not.
        const uncertain = appError.uncertain || (writeStarted && ['notion_error', 'notion_unavailable', 'request_failed', 'incomplete_results', 'incomplete_schedule'].includes(appError.code));
        if (uncertain) { await this.ctx.storage.put('needsReview', true); payload.needsReview = true; }
        try { payload.snapshot = await notion.snapshot(); } catch { /* Preserve the prior display when reread also fails. */ }
        if (operation) {
          await this.ctx.storage.put({ [`operation:${requestId}`]: { ...operation, status: 'done', response: { error: payload.error, needsReview: payload.needsReview }, httpStatus: appError.status }, gate: { until: Date.now() + 2500, pending: false } });
          await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
        }
      }
      return json(payload, appError.status);
    } finally { this.busy = false; }
  }

  async alarm(): Promise<void> {
    const records = await this.ctx.storage.list<Operation>({ prefix: 'operation:' });
    const expired = [...records].filter(([, r]) => r.status === 'done' && r.created < Date.now() - 24 * 60 * 60 * 1000).map(([key]) => key);
    if (expired.length) await this.ctx.storage.delete(expired);
    if (records.size > expired.length) await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const expected = { '/api/projects': 'GET', '/api/state': 'GET', '/api/select-project': 'POST', '/api/toggle': 'POST', '/api/reconcile': 'POST', '/api/patterns': 'GET', '/api/annotations': 'GET|POST' } as Record<string, string>;
    if (!expected[path]) return json({ error: { code: 'not_found', message: 'Unknown API route.' } }, 404);
    if (!expected[path].split('|').includes(request.method)) return json({ error: { code: 'method_not_allowed', message: 'Unsupported request method.' } }, 405);
    if (request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) return json({ error: { code: 'invalid_origin', message: 'Use this app to make changes.' } }, 403);
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: { code: 'invalid_content_type', message: 'JSON is required.' } }, 415);
    }
    try { return await env.COORDINATOR.getByName(env.PROJECTS_SOURCE_ID).fetch(request); }
    catch (error) {
      const e = error instanceof AppError ? error : new AppError('request_failed', 'Could not read Notion. Refresh to try again.', 502);
      return json({ error: { code: e.code, message: e.message } }, e.status);
    }
  },
} satisfies ExportedHandler<Env>;
