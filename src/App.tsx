import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Session, Snapshot } from '../shared/model';
import { api, ApiError, demo } from './api';
import { Icon, ProjectList } from './components';
import { Timer } from './Timer';
import { ProjectDetail } from './ProjectDetail';
import { EMPTY_FILTERS, type ProjectFilters } from '../shared/conditions';

export function App() {
  const [tab, setTab] = useState<'timer' | 'projects'>('timer');
  const [filters, setFilters] = useState<ProjectFilters>({ ...EMPTY_FILTERS });
  const [search, setSearch] = useState('');
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lastEndedSession, setLastEndedSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(true);
  const [review, setReview] = useState(false);
  const inFlight = useRef(false);
  const lastRead = useRef(0);
  function navigate(next: 'timer' | 'projects') { setTab(next); setDetailProject(null); }

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true);
    try {
      const result = await api('/api/state');
      setSnapshot(result); setReview(result.needsReview === true); setStale(false); setError(''); setErrorCode(''); lastRead.current = Date.now();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not refresh.'); setErrorCode(e instanceof ApiError ? e.payload.error.code : ''); setStale(true); }
    finally { inFlight.current = false; setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const onResume = () => { if (document.visibilityState === 'visible' && Date.now() - lastRead.current > 15000) void refresh(); };
    const onOffline = () => { setStale(true); setError('Offline. Reconnect and refresh before changing the timer.'); };
    document.addEventListener('visibilitychange', onResume); window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume); window.addEventListener('offline', onOffline);
    return () => { document.removeEventListener('visibilitychange', onResume); window.removeEventListener('focus', onResume); window.removeEventListener('online', onResume); window.removeEventListener('offline', onOffline); };
  }, [refresh]);

  async function mutate(path: string, body: Record<string, unknown>): Promise<boolean> {
    if (inFlight.current || !snapshot || stale || (review && path !== '/api/reconcile')) return false;
    inFlight.current = true; setBusy(true); setPendingProjectId(path === '/api/select-project' ? body.projectId as string : null); setNotice(''); setError(''); setErrorCode('');
    try {
      const result = await api(path, { ...body, revision: snapshot.state.revision });
      if (result.action === 'ended') setLastEndedSession(snapshot.state.session);
      else if (result.action === 'started' || result.action === 'selected') setLastEndedSession(null);
      setSnapshot(result); setStale(false); setReview(false); lastRead.current = Date.now();
      setNotice(result.action === 'started' ? 'Session started.' : result.action === 'ended' ? 'Session ended.' : path === '/api/reconcile' ? 'State checked. Changes are unlocked.' : 'Project selected.');
      if (path === '/api/select-project') setTab('timer');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.'); setErrorCode(e instanceof ApiError ? e.payload.error.code : '');
      if (e instanceof ApiError) {
        if (e.payload.snapshot) setSnapshot(e.payload.snapshot);
        if (e.payload.needsReview) setReview(true);
      }
      // A failed toggle is never retried. Require a fresh read before another mutation.
      setStale(true); return false;
    } finally { inFlight.current = false; setBusy(false); setPendingProjectId(null); }
  }

  const state = snapshot?.state;
  const disabled = stale || review || loading || !!state?.issues.some(issue => !(state.session && issue.startsWith('Multiple projects')));
  return <main className="app-shell">
    <header className="app-header"><div className="brand"><Icon name="yarn" size={34} /><h1>Now Knitting</h1></div><button className={`icon-button refresh-button${loading ? ' is-loading' : ''}`} aria-label="Refresh from Notion" disabled={busy || loading} onClick={() => { setNotice(''); void refresh(); }}><Icon name="refresh" /></button></header>
    <nav className="tabs" aria-label="Main navigation"><button aria-current={tab === 'timer' ? 'page' : undefined} className={tab === 'timer' ? 'active' : ''} onClick={() => navigate('timer')}>Timer</button><button aria-current={tab === 'projects' ? 'page' : undefined} className={tab === 'projects' ? 'active' : ''} onClick={() => navigate('projects')}>Projects</button></nav>
    {demo ? <p className="demo-note">Demo · sample projects. Notion is unchanged.</p> : null}
    {error ? <div className="notice error-notice" role="alert"><p>{error}</p>{errorCode === 'sign_in_required' ? <a className="text-button" href="/">Sign in again</a> : <button className="text-button" onClick={() => void refresh()} disabled={busy || loading}>Refresh state</button>}</div> : null}
    {review ? <div className="notice"><p>A write needs review. Check the logs in Notion and refresh this app before unlocking changes.</p><a className="text-button" href="https://app.notion.com/p/60a2155c1def4a08bd32b5c581cd7213" target="_blank" rel="noreferrer">Review logs in Notion <Icon name="external" size={16} /></a><button className="text-button" disabled={busy || loading || stale || !!state?.issues.length} onClick={() => void mutate('/api/reconcile', { reviewed: true })}>I checked Notion — unlock changes</button></div> : null}
    {state?.issues.map(issue => <div className="notice" role="alert" key={issue}>{issue}{issue.startsWith('Multiple projects') ? <button className="text-button" onClick={() => setTab('projects')}>Choose one project</button> : <a className="text-button" href="https://app.notion.com/p/60a2155c1def4a08bd32b5c581cd7213" target="_blank" rel="noreferrer">Open Daily Log in Notion</a>}</div>)}
    <div className="status" role="status" aria-live="polite">{busy ? pendingProjectId ? 'Selecting project…' : 'Saving to Notion…' : loading && snapshot ? 'Refreshing from Notion…' : notice ? `${demo ? 'Demo: ' : ''}${notice}` : ''}</div>
    {detailProject ? <ProjectDetail project={snapshot?.projects.find(p => p.id === detailProject.id) ?? detailProject} onBack={() => setDetailProject(null)} /> : !snapshot ? <div className="loading-state">{loading ? 'Loading your knitting projects…' : <><Icon name="yarn" size={64} /><h2>Let’s connect your projects</h2><p>Refresh after the Notion connection is ready.</p></>}</div> : tab === 'timer' ? <Timer state={snapshot.state} lastEndedSession={lastEndedSession} busy={busy} disabled={disabled} onChoose={() => navigate('projects')} onToggle={startAt => mutate('/api/toggle', startAt ? { startAt } : {})} onDetail={setDetailProject} /> : <ProjectList filters={filters} onFiltersChange={setFilters} search={search} onSearchChange={setSearch} projects={snapshot.projects} pendingProjectId={pendingProjectId} locked={!!snapshot.state.openSessions.length} busy={busy || stale || review || loading} onTimer={() => navigate('timer')} onDetail={setDetailProject} onSelect={id => { if (snapshot.state.selectedIds.length === 1 && snapshot.state.selectedIds[0] === id) setTab('timer'); else void mutate('/api/select-project', { projectId: id }); }} />}
  </main>;
}
