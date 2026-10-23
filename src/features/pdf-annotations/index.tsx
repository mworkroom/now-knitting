import { useEffect } from 'react';
import type { Project } from '../../../shared/model';
import PatternViewer from './PatternViewer';
import { startPatternSync } from './patternStore';
import './styles.css';

// Optional module: the main app does not import or mount this entry point.
export default function PdfAnnotations({ project, onBack }: { project: Project; onBack: () => void }) {
  useEffect(() => startPatternSync(), []);
  return <PatternViewer project={project} onBack={onBack} />;
}
