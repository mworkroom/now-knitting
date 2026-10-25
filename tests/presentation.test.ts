import { describe, expect, it } from 'vitest';
import { formatProgress, timerMetricParts, totalTime } from '../src/presentation';

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
  it('keeps metric numbers intact while compacting only recognized units', () => {
    expect(timerMetricParts(formatProgress('0.5'))).toEqual([{ number: '50', unit: '%' }]);
    for (const value of ['27 hr 10 mins\n(2 days)', '27h 10m', '27 hours 10 minutes']) {
      expect(timerMetricParts(totalTime(value))).toEqual([{ number: '27', unit: 'h' }, { number: '10', unit: 'm' }]);
    }
    expect(timerMetricParts('99 hr 59 mins')).toEqual([{ number: '99', unit: 'h' }, { number: '59', unit: 'm' }]);
    expect(timerMetricParts('0 hr 0 mins')).toEqual([{ number: '0', unit: 'h' }, { number: '0', unit: 'm' }]);
    expect(timerMetricParts('10 hr')).toEqual([{ number: '10', unit: 'h' }]);
    expect(timerMetricParts('5 mins')).toEqual([{ number: '5', unit: 'm' }]);
    for (const value of ['—', 'About 27 hours', '1 day 3 hr', '27:10']) {
      expect(timerMetricParts(value)).toEqual([{ number: value, unit: '' }]);
    }
  });
});
