import { describe, expect, it } from 'vitest';
import { formatProgress, totalTime } from '../src/presentation';

describe('Notion values presented in the UI', () => {
  it('formats ratios as percentages and preserves existing formatted or missing values', () => {
    expect(['0.66', '0.83', '0.5', '0', '1', '66%', null, '', '—'].map(formatProgress))
      .toEqual(['66%', '83%', '50%', '0%', '100%', '66%', '—', '—', '—']);
  });
  it('shows only the total on Timer for multiline and single-line formula text', () => {
    expect(totalTime('8 hr 56 mins\n(2 days, 4 hr 28 mins/day)')).toBe('8 hr 56 mins');
    expect(totalTime('31 hr 33 mins (12 days, 2 hr 37 mins/day)')).toBe('31 hr 33 mins');
    expect(totalTime('6h 10m')).toBe('6h 10m');
    expect(totalTime(null)).toBe('—');
  });
});
