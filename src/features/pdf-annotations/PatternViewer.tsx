import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Eraser, FileUp, Hand, Highlighter, Minus, Plus, RotateCcw, RefreshCw, Trash2 } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Project } from '../../../shared/model';
import { HIGHLIGHT_COLORS, parsePattern, patternKey, visibleHighlights, type CloudPatternMeta, type Highlight, type HighlightColor, type PatternDocument, type PatternOperation } from '../../../shared/pattern';
import { allLocalPatterns, bindPattern, boundPattern, cachePdf, cloudPatterns, downloadPatternBackup, localPattern, mergeLocal, patternStatus, pdfBytes, recordOperation, rememberPage, removeCachedPdf, syncPattern, type LocalPattern } from './patternStore';
import { demo } from '../../api';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const colors = { yellow: '#f4d24a', pink: '#ee91b3', blue: '#72b7ef' };
type Mode = 'pan' | 'highlight' | 'erase';
const documentOptions = { isEvalSupported: false, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/' };

export default function PatternViewer({ project, onBack }: { project: Project; onBack: () => void }) {
  const [document, setDocument] = useState<LocalPattern>();
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy>();
  const [available, setAvailable] = useState<CloudPatternMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cloudListError, setCloudListError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<Mode>('pan');
  const [color, setColor] = useState<HighlightColor>('yellow');
  const [width, setWidth] = useState(600);
  const [pageSize, setPageSize] = useState({ width: 600, height: 800 });
  const [rendering, setRendering] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const [draft, setDraft] = useState<Highlight>();
  const [localSaving, setLocalSaving] = useState(false);
  const [reloadPdf, setReloadPdf] = useState(0);
  const [undo, setUndo] = useState<PatternOperation[]>([]);
  const [, updateStatus] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ pointerId: number; x: number; y: number } | undefined>(undefined);
  const saveInFlight = useRef(false);
  const renderQueue = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);
  const key = document?.key;
  const marks = useMemo(() => visibleHighlights(document?.operations ?? []).filter(mark => mark.page === page), [document?.operations, page]);
  const status = key ? patternStatus(key) : undefined;
  const statusText = status?.state === 'saved' ? demo ? 'Saved · demo storage' : 'Saved to cloud' : status?.state === 'syncing' ? 'Saved on device · syncing…' : status?.state === 'offline' ? 'Saved on device · offline' : status?.state === 'error' ? 'Saved on device · cloud save needs attention' : 'Saved on device';

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const current = await boundPattern(project.id);
        if (!alive.current) return;
        if (current) { setDocument(current); setPage(current.lastPage ?? 1); void syncPattern(current.key); }
        const local = (await allLocalPatterns()).filter(doc => doc.projectId === project.id).map(doc => ({ ...doc, updatedAt: 0 }));
        if (alive.current) { setAvailable(local); if (!current) setLoading(false); }
        try {
          const remote = await cloudPatterns(project.id);
          const merged = new Map([...local, ...remote].map(meta => [meta.hash, meta]));
          if (alive.current) setAvailable([...merged.values()]);
        } catch (e) { if (alive.current) setCloudListError(e instanceof Error ? e.message : 'Cloud patterns are unavailable.'); }
      } catch (e) { if (alive.current) setError(localError(e)); }
      finally { if (alive.current) setLoading(false); }
    })();
    return () => { alive.current = false; };
  }, [project.id]);

  useEffect(() => {
    if (!key) return;
    const changed = (event: Event) => { if ((event as CustomEvent).detail === key) { void localPattern(key).then(doc => { if (alive.current) setDocument(doc); }); updateStatus(n => n + 1); } };
    window.addEventListener('pattern-change', changed); return () => window.removeEventListener('pattern-change', changed);
  }, [key]);

  useEffect(() => {
    if (!document?.hash) return;
    let cancelled = false; let task: pdfjs.PDFDocumentLoadingTask | undefined;
    setPdf(undefined); setError(''); setLoading(true);
    void pdfBytes(document.hash).then(async bytes => {
      if (cancelled || !bytes) return;
      task = pdfjs.getDocument({ ...documentOptions, data: new Uint8Array(bytes) });
      const result = await task.promise;
      if (!cancelled) { setPdf(result); setPage(value => Math.min(result.numPages, Math.max(1, value))); }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open this PDF.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [document?.hash, reloadPdf]);

  useEffect(() => {
    if (!scroll.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width - 32)));
    observer.observe(scroll.current); return () => observer.disconnect();
  }, [!!pdf]);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false; let task: pdfjs.RenderTask | undefined;
    setRendering(true); setRenderFailed(false); setDraft(undefined); gesture.current = undefined;
    renderQueue.current = renderQueue.current.catch(() => {}).then(async () => {
      const pdfPage = await pdf.getPage(page); if (cancelled || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / base.width * zoom });
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const element = canvas.current; const context = element.getContext('2d'); if (!context) throw new Error('PDF canvas is unavailable.');
      element.width = Math.floor(viewport.width * scale); element.height = Math.floor(viewport.height * scale);
      setPageSize({ width: viewport.width, height: viewport.height });
      task = pdfPage.render({ canvas: element, canvasContext: context, viewport, transform: scale === 1 ? undefined : [scale, 0, 0, scale, 0, 0] });
      await task.promise;
    }).catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not render this page.'); setRenderFailed(true); } }).finally(() => { if (!cancelled) setRendering(false); });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, zoom, width]);

  useEffect(() => { if (key && pdf) void rememberPage(key, page).catch(e => setError(localError(e))); }, [key, page, !!pdf]);

  function localError(e: unknown) { return `Could not save on this device. ${e instanceof Error ? e.message : 'Check available storage.'} Export your annotations before closing.`; }
  async function selectSaved(meta: CloudPatternMeta) {
    setLoading(true); setError(''); setUndo([]); setPage(1); setZoom(1);
    try {
      const local = await mergeLocal({ version: 1, projectId: project.id, hash: meta.hash, fileName: meta.fileName, pageCount: meta.pageCount, operations: [] });
      await bindPattern(project.id, meta.hash); setDocument(local); await syncPattern(local.key);
    } catch (e) { setError(localError(e)); } finally { setLoading(false); }
  }
  async function openFile(file?: File) {
    if (!file) return;
    setLoading(true); setError('');
    let validation: pdfjs.PDFDocumentLoadingTask | undefined;
    try {
      if (file.size > MAX_PDF_BYTES) throw new Error('Choose a PDF smaller than 64 MB.');
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
      // Selecting a restore target must never attach its marks to a different PDF.
      if (document && !pdf && hash !== document.hash) throw new Error(`This is a different PDF. Select the original “${document.fileName}”, or choose another saved pattern.`);
      validation = pdfjs.getDocument({ ...documentOptions, data: new Uint8Array(bytes.slice(0)) });
      const parsedPdf = await validation.promise;
      const meta: PatternDocument = { version: 1, projectId: project.id, hash, fileName: file.name, pageCount: parsedPdf.numPages, operations: [] };
      const local = await mergeLocal(parsePattern(meta));
      await cachePdf(hash, bytes); await bindPattern(project.id, hash);
      setDocument(local); setUndo([]); setPage(local.lastPage ?? 1); setZoom(1);
      setAvailable(previous => [...previous.filter(meta => meta.hash !== hash), { ...meta, updatedAt: Date.now() }]);
      // Re-open even when the same file was chosen after local eviction.
      setReloadPdf(value => value + 1);
      void syncPattern(local.key);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open or save this PDF.'); }
    finally { void validation?.destroy(); setLoading(false); if (input.current) input.current.value = ''; }
  }
  async function commit(operation: PatternOperation, addToUndo = true) {
    if (!key || saveInFlight.current) return false;
    saveInFlight.current = true; setLocalSaving(true); setError('');
    try { await recordOperation(key, operation); if (addToUndo) setUndo(previous => [...previous, operation]); return true; }
    catch (e) { setError(localError(e)); return false; }
    finally { saveInFlight.current = false; setLocalSaving(false); }
  }
  function point(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  }
  function begin(event: React.PointerEvent<HTMLDivElement>) {
    if (mode !== 'highlight' || loading || rendering || renderFailed || saveInFlight.current || event.button !== 0) return;
    if (!event.isPrimary) { gesture.current = undefined; setDraft(undefined); return; }
    // CSS touch-action controls the drawing gesture without suppressing subsequent touch clicks.
    const p = point(event); gesture.current = { pointerId: event.pointerId, ...p }; event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ id: crypto.randomUUID(), page, ...p, width: 0, height: 0, color });
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const start = gesture.current; if (!start || event.pointerId !== start.pointerId) return;
    const p = point(event);
    setDraft(previous => previous ? { ...previous, x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(start.x - p.x), height: Math.abs(start.y - p.y) } : undefined);
  }
  function finish(event: React.PointerEvent<HTMLDivElement>) {
    const start = gesture.current; if (!start || event.pointerId !== start.pointerId) return;
    const p = point(event);
    const mark = draft ? { ...draft, x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(start.x - p.x), height: Math.abs(start.y - p.y) } : undefined;
    gesture.current = undefined; setDraft(undefined);
    if (mark && mark.width > .003 && mark.height > .003) void commit({ id: mark.id, type: 'add', mark });
  }
  async function undoLast() {
    const last = undo.at(-1); if (!last || !document) return;
    let saved = false;
    let restored: PatternOperation | undefined;
    if (last.type === 'add') saved = await commit({ id: crypto.randomUUID(), type: 'remove', targetId: last.id }, false);
    else {
      const added = document.operations.find(op => op.id === last.targetId);
      if (added?.type === 'add') { const id = crypto.randomUUID(); restored = { id, type: 'add', mark: { ...added.mark, id } }; saved = await commit(restored, false); }
    }
    // Restoring a deleted mark creates a new immutable ID. Earlier undo entries must follow it.
    if (saved) setUndo(previous => previous.slice(0, -1).map(op => restored && last.type === 'remove' && op.type === 'add' && op.id === last.targetId ? restored : op));
  }
  async function importBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2000000) throw new Error('This annotation backup is too large.');
      const parsed = parsePattern(JSON.parse(await file.text()));
      if (parsed.projectId !== project.id || (document && parsed.hash !== document.hash)) throw new Error('This backup belongs to another project or PDF. Open the matching pattern first.');
      const local = await mergeLocal(parsed); await bindPattern(project.id, parsed.hash); setDocument(local); setUndo([]);
      void syncPattern(local.key); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not import this backup.'); }
    finally { if (backupInput.current) backupInput.current.value = ''; }
  }

  return <section className="pattern-viewer" aria-label="Pattern viewer">
    <div className="detail-topbar"><button className="text-button" onClick={onBack}><ArrowLeft size={20} />Back</button><span>Pattern</span><button className="text-button" onClick={() => input.current?.click()} disabled={loading}><FileUp size={18} />{pdf ? 'Choose PDF' : 'Open PDF'}</button></div>
    <h2 className="pattern-title">{project.name}</h2>
    <input ref={input} className="visually-hidden" tabIndex={-1} type="file" accept="application/pdf,.pdf" aria-label="Choose pattern PDF" onChange={e => void openFile(e.target.files?.[0])} />
    <input ref={backupInput} className="visually-hidden" tabIndex={-1} type="file" accept="application/json,.json" aria-label="Import annotation backup" onChange={e => void importBackup(e.target.files?.[0])} />
    {document ? <div className="pattern-info"><span className="pattern-file-name">{document.fileName}</span><span className={`save-status save-status--${status?.state}`} role="status">{localSaving ? 'Saving on device…' : statusText}</span></div> : null}
    {error ? <p className="input-error" role="alert">{error}</p> : null}
    {status?.state === 'error' || status?.state === 'offline' ? <div className="notice pattern-sync-notice"><p>{status.message ?? 'Annotations are kept on this device. Reconnect to save them to the cloud.'}</p><button className="text-button" onClick={() => key && void syncPattern(key)}><RefreshCw size={16} />Retry cloud save</button>{status.message?.includes('Sign in') ? <a className="text-button" href="/">Sign in again</a> : null}</div> : null}
    {!pdf ? <div className="pattern-empty">
      <FileUp size={44} strokeWidth={1.5} />
      <h3>{loading ? 'Opening pattern…' : document ? 'Select the original PDF' : 'Keep your place in the pattern'}</h3>
      <p>{document ? `Choose “${document.fileName}” from Files or iCloud Drive. Its saved highlights will return when the PDF matches.` : 'Choose a PDF from Files or iCloud Drive. The PDF stays on this device; your highlights are saved separately.'}</p>
      <button className="primary-button" disabled={loading} onClick={() => input.current?.click()}>Choose PDF</button>
      {available.length ? <div className="saved-patterns"><h4>Saved patterns</h4>{available.map(meta => <button key={meta.hash} className="saved-pattern" onClick={() => void selectSaved(meta)} disabled={loading || meta.hash === document?.hash}><span>{meta.fileName}</span><ChevronRight size={20} /></button>)}</div> : null}
      {document && !loading ? <button className="text-button" onClick={() => { setDocument(undefined); setPdf(undefined); setError(''); }}>Use a different PDF</button> : null}
      {cloudListError ? <p className="muted" role="status">{cloudListError} A matching PDF or backup can still be loaded.</p> : null}
    </div> : <>
      <div className="pattern-toolbar" aria-label="PDF tools">
        <div className="tool-group" aria-label="Page navigation"><button className="icon-button" aria-label="Previous page" disabled={page === 1 || rendering} onClick={() => setPage(page - 1)}><ChevronLeft /></button><label className="page-input"><input aria-label="Page number" type="number" min={1} max={pdf.numPages} value={page} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= pdf.numPages) setPage(n); }} /><span>/ {pdf.numPages}</span></label><button className="icon-button" aria-label="Next page" disabled={page === pdf.numPages || rendering} onClick={() => setPage(page + 1)}><ChevronRight /></button></div>
        <div className="tool-group"><button className="icon-button" aria-label="Zoom out" disabled={zoom <= .75 || rendering} onClick={() => setZoom(n => Math.max(.75, n - .25))}><Minus /></button><button className="zoom-label" onClick={() => setZoom(1)} aria-label="Fit page width">{Math.round(zoom * 100)}%</button><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 3 || rendering} onClick={() => setZoom(n => Math.min(3, n + .25))}><Plus /></button></div>
        <div className="tool-group modes"><button aria-pressed={mode === 'pan'} onPointerUp={e => { if (e.pointerType === 'touch') setMode('pan'); }} onClick={() => setMode('pan')}><Hand size={19} />View</button><button aria-pressed={mode === 'highlight'} onPointerUp={e => { if (e.pointerType === 'touch') setMode('highlight'); }} onClick={() => setMode('highlight')}><Highlighter size={19} />Highlight</button><button aria-pressed={mode === 'erase'} onPointerUp={e => { if (e.pointerType === 'touch') setMode('erase'); }} onClick={() => setMode('erase')}><Eraser size={19} />Erase</button></div>
        <div className="tool-group"><div className="highlight-colors" aria-label="Highlight colors">{HIGHLIGHT_COLORS.map(value => <button key={value} className={`color-choice color-choice--${value}`} aria-label={`${value} highlight`} aria-pressed={color === value} onClick={() => { setColor(value); setMode('highlight'); }} />)}</div><button className="icon-button" aria-label="Undo last annotation" disabled={!undo.length || localSaving} onClick={() => void undoLast()}><RotateCcw size={20} /></button></div>
      </div>
      <p className="pattern-hint">{mode === 'highlight' ? 'Drag across a number to highlight it. Switch to View to scroll.' : mode === 'erase' ? 'Tap a highlight to remove it.' : 'Scroll to read. Choose Highlight to mark a number.'}{rendering ? ' Rendering page…' : ''}</p>
      <div ref={scroll} className="pdf-scroll"><div className="pdf-sheet" style={{ width: pageSize.width, height: pageSize.height }}>
        <canvas ref={canvas} style={{ width: pageSize.width, height: pageSize.height }} aria-label={`Pattern PDF page ${page}`} />
        <div className={`annotation-layer annotation-layer--${mode}`} aria-label="PDF highlights" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = undefined; setDraft(undefined); }}>
          {marks.map(mark => mode === 'erase' ? <button key={mark.id} className="pdf-highlight pdf-highlight--erase" aria-label={`Erase ${mark.color} highlight on page ${page}`} disabled={localSaving || rendering || renderFailed} style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: `${mark.width * 100}%`, height: `${mark.height * 100}%`, background: colors[mark.color] }} onClick={() => void commit({ id: crypto.randomUUID(), type: 'remove', targetId: mark.id })} /> : <span key={mark.id} className="pdf-highlight" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: `${mark.width * 100}%`, height: `${mark.height * 100}%`, background: colors[mark.color] }} />)}
          {draft ? <span className="pdf-highlight" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%`, background: colors[draft.color] }} /> : null}
        </div>
      </div></div>
    </>}
    <details className="pattern-storage"><summary>Pattern files &amp; backup</summary><p>Your original PDF is unchanged. This backup contains highlights, not the PDF. Keep it with the original in iCloud Drive.</p><div className="backup-actions"><button className="text-button" disabled={!document} onClick={() => { if (document) downloadPatternBackup(document); }}><Download size={18} />Export annotations</button><button className="text-button" onClick={() => backupInput.current?.click()}><FileUp size={18} />Import annotations</button>{pdf && document ? <button className="text-button" onClick={() => { if (window.confirm('Remove this PDF from device storage? Saved annotations are kept. Keep the original PDF in iCloud Drive so it can be reopened.')) void removeCachedPdf(document.hash).then(() => setReloadPdf(value => value + 1)).catch(e => setError(localError(e))); }}><Trash2 size={18} />Remove local PDF</button> : null}</div></details>
  </section>;
}
