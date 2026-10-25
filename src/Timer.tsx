import { useEffect, useState } from 'react';
import type { AppState, Session } from '../shared/model';
import { ElapsedTimer, Icon, Thumbnail } from './components';
import { formatProgress, timerMetricParts, totalTime } from './presentation';
import { FileText, ChevronRight } from 'lucide-react';
import { PREVIEW_SHORTCUT_URL } from './links';

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function MetricValue({ value }: { value: string }) {
  return <>{timerMetricParts(value).map(part => part.unit ? <span className="metric-part" key={part.unit}>{part.number}<span className="metric-unit">{part.unit}</span></span> : part.number)}</>;
}

export function Timer({ state, lastEndedSession, busy, disabled, onChoose, onToggle, onDetail }: {
  state: AppState; lastEndedSession: Session | null; busy: boolean; disabled: boolean; onChoose: () => void; onToggle: (startAt?: string) => Promise<boolean>; onDetail: (project: NonNullable<AppState['selectedProject']>) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState('');
  const [inputError, setInputError] = useState('');
  const project = state.session ? state.sessionProject ?? state.selectedProject : state.selectedProject;
  const linkedSession = state.session ?? (lastEndedSession?.projectId === project?.id ? lastEndedSession : null);
  const validStart = state.session?.startAt && Number.isFinite(Date.parse(state.session.startAt));
  useEffect(() => { if (state.session) { setCustom(false); setStart(''); } }, [state.session?.id]);
  async function toggle() {
    let startAt: string | undefined;
    setInputError('');
    if (!state.session && custom) {
      const date = new Date(start);
      if (!start || !Number.isFinite(date.getTime())) { setInputError('Enter a valid start date and time.'); return; }
      if (date.getTime() > Date.now()) { setInputError('The start time cannot be in the future.'); return; }
      startAt = date.toISOString();
    }
    if (await onToggle(startAt)) { setCustom(false); setStart(''); }
  }
  if (!project && !state.session) return <section className="empty-state" aria-label="Timer">
    <div className="empty-copy"><Icon name="yarn" size={90} /><h2>Choose what to knit</h2><p>Select a project to start your next session.</p></div>
    <button className="primary-button" onClick={onChoose} disabled={busy}>Choose Project</button>
  </section>;
  return <section className="timer" aria-label="Timer">
    <div className="project-identity">
      <Thumbnail icon={project?.icon ?? null} large />
      <h2><a href={project?.notionUrl ?? state.session?.notionUrl} target="_blank" rel="noreferrer">{project?.name ?? 'Open knitting session'} <Icon name="external" size={22} /></a></h2>
      <p>{project?.progressStatus ?? 'Status unavailable'}</p>
    </div>
    <dl className="metrics"><div><dt>Progress</dt><dd><MetricValue value={formatProgress(project?.progress)} /></dd></div><div><dt>Total time</dt><dd aria-label={totalTime(project?.timeSpent)}><MetricValue value={totalTime(project?.timeSpent)} /></dd></div></dl>
    {project ? <div className="timer-tools"><a href={PREVIEW_SHORTCUT_URL} title="Open Preview"><FileText size={20} />Pattern</a><button onClick={() => onDetail(project)}>Project details<ChevronRight size={20} /></button></div> : null}
    <div className="timer-readout"><ElapsedTimer state={state} /><p>{state.session ? validStart ? `Started ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.session.startAt!))}` : 'Correct the start time in Notion.' : 'Ready when you are'}</p></div>
    <button className="primary-button" disabled={busy || disabled} onClick={event => { if (event.detail <= 1) void toggle(); }} onKeyDown={event => { if (event.repeat) event.preventDefault(); }}>{busy ? 'Saving…' : state.session ? 'END' : 'START'}</button>
    {linkedSession ? <a className="session-link" href={linkedSession.notionUrl} target="_blank" rel="noreferrer"><Icon name="external" size={20} />{state.session ? 'Open session in Notion' : 'Open last session in Notion'}</a> : null}
    {!state.session ? <div className="start-time">
      <button className="disclosure" aria-expanded={custom} aria-controls="start-time-fields" onClick={() => { setCustom(!custom); if (!start) setStart(localDateTime()); setInputError(''); }} disabled={busy}><span className={custom ? 'chevron--open' : ''}><Icon name="chevron" size={20} /></span>Set start time</button>
      {custom ? <div id="start-time-fields" className="start-time-fields"><label htmlFor="start-at">Start date &amp; time</label><input id="start-at" type="datetime-local" value={start} max={localDateTime()} onChange={e => { setStart(e.target.value); setInputError(''); }} disabled={busy} aria-describedby="start-time-help" /><p id="start-time-help">Your local time. Saved when you press START.</p><button className="text-button" onClick={() => { setCustom(false); setInputError(''); }}>Use current time instead</button></div> : null}
    </div> : null}
    {inputError ? <p className="input-error" role="alert">{inputError}</p> : null}
    <p className="footer-note">Your sessions are saved in Notion.</p>
  </section>;
}
