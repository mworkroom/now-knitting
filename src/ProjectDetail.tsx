import { ArrowLeft, Check, ChevronRight, ExternalLink, FileText, Plus, Spool } from 'lucide-react';
import type { Project } from '../shared/model';
import { Thumbnail } from './components';
import { formatProgress, totalTime } from './presentation';
import { PREVIEW_SHORTCUT_URL } from './links';
import { ConditionBadges } from './ConditionBadges';

export function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const numericProgress = Number(project.progress?.replace('%', ''));
  const progress = project.progress === null || !Number.isFinite(numericProgress) ? null : Math.max(0, Math.min(100, project.progress.includes('%') ? numericProgress : numericProgress <= 1 ? numericProgress * 100 : numericProgress));
  return <section className="project-detail" aria-label="Project details">
    <div className="detail-topbar"><button className="text-button" onClick={onBack}><ArrowLeft size={20} />Back</button></div>
    <h2 className="detail-title">{project.name}{' '}<a className="detail-notion-link" href={project.notionUrl} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} in Notion`} title="Open in Notion"><ExternalLink size={24} /></a></h2>
    <div className="detail-summary">
      <div className="detail-identity"><Thumbnail icon={project.icon} large /><div className="detail-copy"><span className="stage-badge">{project.progressStatus ?? 'Status unavailable'}</span><div className="detail-progress"><strong>{formatProgress(project.progress)}</strong>{progress !== null ? <div className="progress-track" role="progressbar" aria-label="Project progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div> : null}</div><p className="detail-time"><span>Total</span><strong>{totalTime(project.timeSpent)}</strong></p></div></div>
    </div>
    <ConditionBadges project={project} />
    <section className="detail-section" aria-labelledby="quick-tools-title"><h3 id="quick-tools-title">Quick Tools</h3><div className="quick-tools"><a className="quick-tool" href={PREVIEW_SHORTCUT_URL} title="Open Preview"><span className="quick-tool-icon"><FileText size={25} /></span><span>Pattern</span><ChevronRight size={20} /></a><button className="quick-tool quick-tool--later" disabled><span className="quick-tool-icon"><Check size={25} /></span><span>Row Checklist<small>Coming later</small></span><ChevronRight size={20} /></button></div></section>
    <section className="detail-section" aria-labelledby="yarn-usage-title"><h3 id="yarn-usage-title">Yarn Usage</h3><div className="yarn-usage-card"><div className="yarn-overview"><Spool size={38} strokeWidth={1.5} /><div><strong>Weight tracking</strong><p>Coming later</p></div><button className="weight-button" disabled><Plus size={20} />Add weight</button></div><div className="yarn-step"><span className="step-dot" /><span>Start</span><span>— g</span></div><p className="yarn-placeholder">No weights recorded.</p></div></section>
  </section>;
}
