import { AppError } from './model';

export const PATTERN_VERSION = 1;
export const MAX_OPERATIONS = 5000;
// Leave room for the metadata entry within Durable Object bulk put's 128-entry limit.
export const MAX_BATCH = 100;
export const HIGHLIGHT_COLORS = ['yellow', 'pink', 'blue'] as const;
export type HighlightColor = typeof HIGHLIGHT_COLORS[number];
export interface Highlight {
  id: string; page: number; x: number; y: number; width: number; height: number; color: HighlightColor;
}
export type PatternOperation = { id: string; type: 'add'; mark: Highlight } | { id: string; type: 'remove'; targetId: string };
export interface PatternMeta { projectId: string; hash: string; fileName: string; pageCount: number }
export interface PatternDocument extends PatternMeta { version: 1; operations: PatternOperation[] }
export interface CloudPatternMeta extends PatternMeta { updatedAt: number }

export function patternKey(projectId: string, hash: string): string { return `${projectId}:${hash}`; }
export function validateScope(projectId: unknown, hash?: unknown): void {
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(projectId)) throw new AppError('invalid_pattern', 'Invalid project.');
  if (hash !== undefined && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new AppError('invalid_pattern', 'Invalid PDF fingerprint.');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_pattern', 'The annotation data is invalid.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value)) throw new AppError('invalid_pattern', 'Invalid annotation ID.');
  return value;
}
export function parsePattern(value: unknown, maxOperations = MAX_OPERATIONS): PatternDocument {
  const data = object(value);
  validateScope(data.projectId, data.hash);
  if (data.version !== PATTERN_VERSION) throw new AppError('invalid_pattern', 'Unsupported annotation backup version.');
  if (typeof data.fileName !== 'string' || !data.fileName.trim() || data.fileName.length > 255 ||
    !Number.isInteger(data.pageCount) || (data.pageCount as number) < 1 || (data.pageCount as number) > 5000 ||
    !Array.isArray(data.operations) || data.operations.length > maxOperations) throw new AppError('invalid_pattern', 'The annotation data is invalid or too large.');
  const seen = new Set<string>();
  const operations: PatternOperation[] = data.operations.map(value => {
    const op = object(value); const operationId = id(op.id);
    if (seen.has(operationId)) throw new AppError('invalid_pattern', 'Duplicate annotation IDs.');
    seen.add(operationId);
    if (op.type === 'remove') return { id: operationId, type: 'remove', targetId: id(op.targetId) };
    if (op.type !== 'add') throw new AppError('invalid_pattern', 'Unsupported annotation operation.');
    const mark = object(op.mark);
    if (mark.id !== operationId || !Number.isInteger(mark.page) || (mark.page as number) < 1 || (mark.page as number) > (data.pageCount as number) ||
      !HIGHLIGHT_COLORS.includes(mark.color as HighlightColor)) throw new AppError('invalid_pattern', 'Invalid highlight.');
    for (const key of ['x', 'y', 'width', 'height']) {
      if (typeof mark[key] !== 'number' || !Number.isFinite(mark[key]) || (mark[key] as number) < 0 || (mark[key] as number) > 1) throw new AppError('invalid_pattern', 'Invalid highlight position.');
    }
    if (!(mark.width as number) || !(mark.height as number) || (mark.x as number) + (mark.width as number) > 1.000001 || (mark.y as number) + (mark.height as number) > 1.000001) throw new AppError('invalid_pattern', 'Highlight is outside the page.');
    return { id: operationId, type: 'add', mark: { id: operationId, page: mark.page as number, x: mark.x as number, y: mark.y as number, width: mark.width as number, height: mark.height as number, color: mark.color as HighlightColor } };
  });
  return { version: 1, projectId: data.projectId as string, hash: data.hash as string, fileName: data.fileName, pageCount: data.pageCount as number, operations };
}
// Immutable operations make retries safe, and merge offline/device edits without replacing another copy.
export function mergeOperations(a: PatternOperation[], b: PatternOperation[]): PatternOperation[] {
  const result = new Map(a.map(op => [op.id, op]));
  for (const op of b) {
    const existing = result.get(op.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(op)) throw new AppError('annotation_conflict', 'An annotation ID has different contents. Export a backup before retrying.', 409);
    result.set(op.id, op);
  }
  if (result.size > MAX_OPERATIONS) throw new AppError('pattern_full', 'This pattern has reached its annotation limit. Export a backup.', 413);
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function visibleHighlights(operations: PatternOperation[]): Highlight[] {
  const removed = new Set(operations.filter(op => op.type === 'remove').map(op => op.targetId));
  return operations.flatMap(op => op.type === 'add' && !removed.has(op.id) ? [op.mark] : []);
}
