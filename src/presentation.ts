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
