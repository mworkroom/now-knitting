import { demo } from '../../api';
import { MAX_BATCH, mergeOperations, parsePattern, patternKey, type CloudPatternMeta, type PatternDocument, type PatternOperation } from '../../../shared/pattern';

export interface LocalPattern extends PatternDocument { key: string; syncedIds: string[]; lastSyncedAt?: number; lastPage?: number }
export type SyncStatus = { state: 'local' | 'syncing' | 'saved' | 'offline' | 'error'; message?: string };
const statuses = new Map<string, SyncStatus>();
const syncing = new Map<string, Promise<void>>();
let dbPromise: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('now-knitting-patterns', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('documents', { keyPath: 'key' });
      database.createObjectStore('pdfs', { keyPath: 'hash' });
      database.createObjectStore('bindings', { keyPath: 'projectId' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); dbPromise = undefined; }; resolve(request.result); };
    request.onerror = () => { dbPromise = undefined; reject(request.error); };
    request.onblocked = () => { dbPromise = undefined; reject(new Error('Close other Now Knitting tabs and try again.')); };
  });
}
function notify(key: string) { window.dispatchEvent(new CustomEvent('pattern-change', { detail: key })); }
function setStatus(key: string, status: SyncStatus) { statuses.set(key, status); notify(key); }
export function patternStatus(key: string): SyncStatus { return statuses.get(key) ?? { state: 'local' }; }
async function read<T>(store: string, key?: string): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store); const request = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T); request.onerror = () => reject(request.error);
  });
}
async function write(store: string, value: unknown): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite'); tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Local save failed.'));
  });
}
export const localPattern = (key: string) => read<LocalPattern | undefined>('documents', key);
export const allLocalPatterns = () => read<LocalPattern[]>('documents');
export async function boundPattern(projectId: string): Promise<LocalPattern | undefined> {
  const binding = await read<{ hash: string } | undefined>('bindings', projectId);
  return binding ? localPattern(patternKey(projectId, binding.hash)) : undefined;
}
export async function bindPattern(projectId: string, hash: string) { await write('bindings', { projectId, hash }); }
export async function pdfBytes(hash: string): Promise<ArrayBuffer | undefined> { return (await read<{ bytes: ArrayBuffer } | undefined>('pdfs', hash))?.bytes; }
export async function cachePdf(hash: string, bytes: ArrayBuffer) {
  await write('pdfs', { hash, bytes });
  // Request persistent storage as a best effort; the independent annotation cloud/backup remains necessary.
  void navigator.storage?.persist?.().catch(() => false);
}
export async function removeCachedPdf(hash: string) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('pdfs', 'readwrite'); tx.objectStore('pdfs').delete(hash);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

// Merge inside a read/write transaction so a cloud response cannot replace a newer local stroke.
async function update(key: string, change: (previous: LocalPattern | undefined) => LocalPattern): Promise<LocalPattern> {
  const database = await db();
  const result = await new Promise<LocalPattern>((resolve, reject) => {
    const tx = database.transaction('documents', 'readwrite'); const store = tx.objectStore('documents'); const request = store.get(key);
    let next: LocalPattern;
    request.onsuccess = () => { try { next = change(request.result); store.put(next); } catch (error) { reject(error); tx.abort(); } };
    tx.oncomplete = () => resolve(next); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Could not save annotations on this device.'));
  });
  notify(key); return result;
}
export function mergeLocal(document: PatternDocument, acknowledged: string[] = []): Promise<LocalPattern> {
  const key = patternKey(document.projectId, document.hash);
  return update(key, previous => {
    if (previous && previous.pageCount !== document.pageCount) throw new Error('This PDF has inconsistent page information.');
    return { ...previous, ...document, key, operations: mergeOperations(previous?.operations ?? [], document.operations), syncedIds: [...new Set([...(previous?.syncedIds ?? []), ...acknowledged])] };
  });
}
export async function recordOperation(key: string, operation: PatternOperation) {
  const result = await update(key, previous => {
    if (!previous) throw new Error('Open a PDF before adding annotations.');
    return { ...previous, operations: mergeOperations(previous.operations, [operation]) };
  });
  setStatus(key, { state: 'local' });
  void syncPattern(key); return result;
}
export async function rememberPage(key: string, page: number) { await update(key, previous => { if (!previous) throw new Error('No pattern.'); return { ...previous, lastPage: page }; }); }

async function cloud<T>(path: string, body?: PatternDocument): Promise<T> {
  if (demo) {
    const url = new URL(path, window.location.origin); const projectId = url.searchParams.get('projectId');
    const records: Record<string, PatternDocument> = JSON.parse(localStorage.getItem('nk-demo-pattern-cloud') ?? '{}');
    if (body) {
      const key = patternKey(body.projectId, body.hash); records[key] = { ...body, operations: mergeOperations(records[key]?.operations ?? [], body.operations) };
      localStorage.setItem('nk-demo-pattern-cloud', JSON.stringify(records)); return { acceptedIds: body.operations.map(op => op.id) } as T;
    }
    if (url.pathname === '/api/patterns') return { patterns: Object.values(records).filter(doc => doc.projectId === projectId).map(doc => ({ ...doc, updatedAt: 0 })) } as T;
    return { document: records[patternKey(projectId!, url.searchParams.get('hash')!)] ?? null } as T;
  }
  const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'manual', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (response.type === 'opaqueredirect' || !response.headers.get('Content-Type')?.includes('application/json') || [401, 403].includes(response.status)) throw new Error('Sign in again to save annotations to the cloud.');
  const data = await response.json() as T & { error?: { message: string } };
  if (!response.ok || data.error) throw new Error(data.error?.message ?? 'Cloud save failed. The local copy is kept.');
  return data;
}
export async function cloudPatterns(projectId: string): Promise<CloudPatternMeta[]> {
  return (await cloud<{ patterns: CloudPatternMeta[] }>(`/api/patterns?projectId=${encodeURIComponent(projectId)}`)).patterns;
}
export function syncPattern(key: string): Promise<void> {
  const running = syncing.get(key); if (running) return running;
  const task = (async () => {
    if (!navigator.onLine) { setStatus(key, { state: 'offline' }); return; }
    setStatus(key, { state: 'syncing' });
    try {
      let current = await localPattern(key); if (!current) return;
      const remote = await cloud<{ document: PatternDocument | null }>(`/api/annotations?projectId=${encodeURIComponent(current.projectId)}&hash=${current.hash}`);
      if (remote.document) {
        const parsed = parsePattern(remote.document);
        if (patternKey(parsed.projectId, parsed.hash) !== key) throw new Error('The cloud returned a different pattern.');
        current = await mergeLocal(parsed, parsed.operations.map(op => op.id));
      }
      // Register even a PDF with no marks, so a lost local cache can still be identified from cloud metadata.
      let register = !remote.document;
      while (true) {
        current = (await localPattern(key))!;
        const known = new Set(current.syncedIds); const pending = current.operations.filter(op => !known.has(op.id)).slice(0, MAX_BATCH);
        if (!register && !pending.length) break;
        const result = await cloud<{ acceptedIds: string[] }>('/api/annotations', { version: 1, projectId: current.projectId, hash: current.hash, fileName: current.fileName, pageCount: current.pageCount, operations: pending });
        if (!Array.isArray(result.acceptedIds) || pending.some(op => !result.acceptedIds.includes(op.id))) throw new Error('Cloud save was not confirmed. Retry to check it.');
        await update(key, previous => ({ ...previous!, syncedIds: [...new Set([...previous!.syncedIds, ...result.acceptedIds])], lastSyncedAt: Date.now() }));
        register = false;
      }
      setStatus(key, { state: 'saved' });
    } catch (error) { setStatus(key, { state: navigator.onLine ? 'error' : 'offline', message: error instanceof Error ? error.message : 'Cloud save failed. Local annotations are kept.' }); }
  })().finally(() => { syncing.delete(key); });
  syncing.set(key, task); return task;
}
export function startPatternSync(): () => void {
  const resume = () => { if (document.visibilityState === 'visible') void allLocalPatterns().then(docs => Promise.all(docs.map(doc => syncPattern(doc.key)))).catch(() => {}); };
  window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume); resume();
  return () => { window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
}
export function downloadPatternBackup(document: PatternDocument) {
  const payload = parsePattern(document); const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = window.document.createElement('a'); link.href = url;
  link.download = `${document.fileName.replace(/\.pdf$/i, '')}.annotations.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
