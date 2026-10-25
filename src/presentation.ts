const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

// Notion's numeric formula is a ratio. Already formatted text stays readable.
export function formatProgress(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  const text = value.trim();
  const ratio = Number(text);
  return Number.isFinite(ratio) ? percent.format(ratio) : text;
}

export function totalTime(value: string | null | undefined): string {
  return value?.split(/\r?\n|\s*\(/, 1)[0].trim() || '—';
}

// Only recognized metric formats are compacted; unknown Notion text stays intact.
export function timerMetricParts(value: string): { number: string; unit: string }[] {
  const percentage = value.match(/^(\d+(?:[.,]\d+)?)%$/);
  if (percentage) return [{ number: percentage[1], unit: '%' }];
  const duration = value.match(/^(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h))?\s*(?:(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m))?$/i);
  if (duration && (duration[1] || duration[2])) {
    return [
      ...(duration[1] ? [{ number: duration[1], unit: 'h' }] : []),
      ...(duration[2] ? [{ number: duration[2], unit: 'm' }] : []),
    ];
  }
  return [{ number: value, unit: '' }];
}
