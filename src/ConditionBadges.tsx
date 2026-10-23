import { CONDITIONS, conditionAvailability, type ProjectFilters } from '../shared/conditions';
import type { Project } from '../shared/model';

export function ConditionBadges({ project }: { project: Project }) {
  return <div className="condition-tags" role="group" aria-label="Knitting conditions">
    {CONDITIONS.map(({ key, label }) => {
      const available = conditionAvailability(project, key);
      const state = available === null ? 'Unknown' : available ? 'Available' : 'Unavailable';
      return <span key={key} className={`condition-tag${available === true ? ' condition-tag--active' : ''}`} aria-label={`${label}: ${state}`} title={`${label}: ${state}`}>
        {label}{available === null ? ' —' : ''}
      </span>;
    })}
  </div>;
}

export function ConditionFilters({ filters, onChange }: { filters: ProjectFilters; onChange: (filters: ProjectFilters) => void }) {
  return <div className="condition-tags condition-filters" role="group" aria-label="Filter knitting conditions">
    {CONDITIONS.map(({ key, label }) => <button key={key} className={`condition-tag${filters[key] ? ' condition-tag--active' : ''}`} aria-pressed={filters[key]} onClick={() => onChange({ ...filters, [key]: !filters[key] })}>{label}</button>)}
  </div>;
}
