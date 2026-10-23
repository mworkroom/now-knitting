import { AppError } from '../shared/model';
import { MAX_BATCH, MAX_OPERATIONS, parsePattern, validateScope, type CloudPatternMeta, type PatternOperation } from '../shared/pattern';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

// Separate prefixes from timer receipts: the coordinator's 24-hour cleanup never touches these records.
export async function patternRequest(request: Request, storage: DurableObjectStorage): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      validateScope(projectId);
      if (url.pathname === '/api/patterns') {
        const records = await storage.list<CloudPatternMeta>({ prefix: `pattern-meta:${projectId}:` });
        return json({ patterns: [...records.values()].sort((a, b) => b.updatedAt - a.updatedAt) });
      }
      const hash = url.searchParams.get('hash'); validateScope(projectId, hash);
      const meta = await storage.get<CloudPatternMeta>(`pattern-meta:${projectId}:${hash}`);
      if (!meta) return json({ document: null });
      const records = await storage.list<PatternOperation>({ prefix: `pattern-op:${projectId}:${hash}:` });
      return json({ document: { version: 1, ...meta, operations: [...records.values()] } });
    }
    const raw = await request.text();
    if (raw.length > 120000) throw new AppError('pattern_too_large', 'Send annotations in smaller batches.', 413);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new AppError('invalid_pattern', 'Send valid annotation data.'); }
    const document = parsePattern(value, MAX_BATCH);
    const metaKey = `pattern-meta:${document.projectId}:${document.hash}`;
    const prefix = `pattern-op:${document.projectId}:${document.hash}:`;
    await storage.transaction(async tx => {
      const meta = await tx.get<CloudPatternMeta>(metaKey);
      if (meta && meta.pageCount !== document.pageCount) throw new AppError('annotation_conflict', 'This PDF has inconsistent page information.', 409);
      const previous = await tx.list<PatternOperation>({ prefix });
      const writes: Record<string, unknown> = {};
      let added = 0;
      for (const op of document.operations) {
        const key = `${prefix}${op.id}`; const existing = previous.get(key);
        if (existing && JSON.stringify(existing) !== JSON.stringify(op)) throw new AppError('annotation_conflict', 'An annotation ID has different contents.', 409);
        if (!existing) { writes[key] = op; added++; }
      }
      if (previous.size + added > MAX_OPERATIONS) throw new AppError('pattern_full', 'This pattern has reached its annotation limit. Export a backup.', 413);
      writes[metaKey] = { projectId: document.projectId, hash: document.hash, fileName: document.fileName, pageCount: document.pageCount, updatedAt: Date.now() } satisfies CloudPatternMeta;
      await tx.put(writes);
    });
    return json({ acceptedIds: document.operations.map(op => op.id) });
  } catch (error) {
    const e = error instanceof AppError ? error : new AppError('pattern_unavailable', 'Cloud annotations could not be saved. Your local copy is kept.', 503);
    return json({ error: { code: e.code, message: e.message } }, e.status);
  }
}
