import { useEffect, useState } from 'react';
import { elapsed, type AppState, type Project, type ProjectIcon } from '../shared/model';
import { formatProgress } from './presentation';
import { EMPTY_FILTERS, matchesProject, type ProjectFilters } from '../shared/conditions';
import { ConditionFilters } from './ConditionBadges';

export function Icon({ name, size = 22 }: { name: 'yarn' | 'refresh' | 'external' | 'search' | 'check' | 'chevron'; size?: number }) {
  const paths = {
    yarn: <><circle cx="11" cy="11" r="8" /><path d="m5 6 11 11M3 10l10 9M9 3l10 10M4 15l11-11M7 18 18 7M15 18c4 0 2 4 7 2" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2" /></>,
    external: <><path d="M14 3h7v7M21 3l-10 10M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></>,
    search: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    chevron: <path d="m6 9 6 6 6-6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Thumbnail({ icon, large = false }: { icon: ProjectIcon; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [icon?.value]);
  return <span className={`thumbnail${large ? ' thumbnail--large' : ''}`}>
    {icon?.type === 'image' && !broken ? <img src={icon.value} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : icon?.type === 'emoji' ? <span aria-hidden="true">{icon.value}</span> : <Icon name="yarn" size={large ? 54 : 30} />}
  </span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function ElapsedTimer({ state }: { state: AppState }) {
  const [now, setNow] = useState(Date.now);
  const start = state.session?.startAt ?? null;
  useEffect(() => {
    setNow(Date.now());
    if (!start) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [start]);
  return <div className="elapsed" role="timer" aria-label="Elapsed knitting time">{elapsed(start, now)}</div>;
}

export function ProjectList({ projects, locked, busy, pendingProjectId, onSelect, onTimer, onDetail, filters, onFiltersChange, search, onSearchChange }: {
  projects: Project[]; locked: boolean; busy: boolean; pendingProjectId: string | null; onSelect: (id: string) => void; onTimer: () => void; onDetail: (project: Project) => void;
  filters: ProjectFilters; onFiltersChange: (filters: ProjectFilters) => void; search: string; onSearchChange: (search: string) => void;
}) {
  const filtered = projects.filter(p => matchesProject(p, search, filters));
  const hasFilters = Object.values(filters).some(Boolean);
  return <section aria-label="Projects">
    {locked ? <div className="notice">End the current session before changing projects. <button className="text-button" onClick={onTimer}>Go to Timer</button></div> : null}
    <label className="search"><Icon name="search" /><input aria-label="Search projects" placeholder="Search projects" value={search} onChange={e => onSearchChange(e.target.value)} type="search" /></label>
    <ConditionFilters filters={filters} onChange={onFiltersChange} />
    <div className="project-list">
      {filtered.map(p => <div key={p.id} className={`project-row${p.selected ? ' project-row--selected' : ''}${pendingProjectId === p.id ? ' project-row--pending' : ''}`}>
        <button className="project-select" type="button" onClick={() => onSelect(p.id)} disabled={busy || (locked && !p.selected)} aria-label={`Select ${p.name} for Timer`} title={locked && !p.selected ? 'End the current session before changing projects' : p.selected ? 'Selected for Timer' : 'Select for Timer'} aria-pressed={p.selected} aria-busy={pendingProjectId === p.id}>
          {pendingProjectId === p.id ? <Spinner /> : p.selected ? <Icon name="check" /> : <span className="project-selection-circle" aria-hidden="true" />}
        </button>
        <button className="project-detail-link" type="button" onClick={() => onDetail(p)} aria-label={`View details for ${p.name}`}>
          <Thumbnail icon={p.icon} /><span className="project-copy"><strong>{p.name}</strong><span className="project-progress"><span className="progress-value">{formatProgress(p.progress)}</span><span className="stage-badge">{p.progressStatus ?? 'Status unavailable'}</span></span><span className="project-time">{p.timeSpent ?? '—'}</span>{pendingProjectId === p.id ? <span className="selection-feedback">Selecting…</span> : null}</span>
        </button>
      </div>)}
    </div>
    {!filtered.length ? <div className="list-empty" role="status"><p>{hasFilters ? 'No projects match these conditions.' : search.trim() ? 'No projects match your search.' : 'No projects in Schedule. Update the view in Notion, then refresh.'}</p>{hasFilters ? <button className="text-button" onClick={() => onFiltersChange({ ...EMPTY_FILTERS })}>Clear filters</button> : null}</div> : null}
  </section>;
}
