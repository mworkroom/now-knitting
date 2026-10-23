import { describe, expect, it } from 'vitest';
import { CONDITIONS, EMPTY_FILTERS, conditionAvailability, matchesProject } from '../shared/conditions';
import type { Project } from '../shared/model';
import { projectFromPage } from '../worker/notion';

const project: Project = { id: 'p1', name: 'Into the Wild Sweater', notionUrl: 'https://www.notion.so/', icon: null, progress: '50%', progressStatus: 'Body 50%', timeSpent: null, selected: false };

describe('knitting conditions and combined search', () => {
  it('reads the exact Korean names, boolean formulas and explicit Yes/No formula strings', () => {
    for (const [value, expected] of [[' Yes ', true], ['No', false], ['maybe', null], ['', null]] as const) {
      expect(projectFromPage({ id: 'p1', properties: { '카뜨가능': { formula: { type: 'string', string: value } }, '역행용': { checkbox: true }, '여름불가': { checkbox: false } } }).conditions)
        .toEqual({ cafe: expected, mindless: true, summerBlocked: false });
    }
    expect(projectFromPage({ id: 'p1', properties: { '카뜨가능': { formula: { type: 'boolean', boolean: false } } } }).conditions?.cafe).toBe(false);
  });

  it('uses saved property IDs after renaming, and never adopts a new property with the old name', () => {
    expect(projectFromPage({ id: 'p1', properties: {
      'Renamed Cafe': { id: 'c%3Af', checkbox: false }, '카뜨가능': { id: 'different-id', checkbox: true },
      'Renamed Mindless': { id: 'm1', checkbox: true }, 'Renamed Summer': { id: 's1', checkbox: true },
    } }, { cafe: 'c:f', mindless: 'm1', summerBlocked: 's1' }).conditions).toEqual({ cafe: false, mindless: true, summerBlocked: true });
    expect(projectFromPage({ id: 'p1', properties: { '카뜨가능': { id: 'new-id', checkbox: true } } }, { cafe: 'deleted-id' }).conditions?.cafe).toBeNull();
  });

  it('inverts summerBlocked without treating unknown values as summer availability', () => {
    expect([false, true, null].map(summerBlocked => conditionAvailability({ ...project, conditions: { cafe: null, mindless: null, summerBlocked } }, 'summer'))).toEqual([true, false, null]);
    for (const { key } of CONDITIONS) {
      expect(conditionAvailability(project, key)).toBeNull();
      expect(matchesProject(project, '', { ...EMPTY_FILTERS, [key]: true })).toBe(false);
    }
    expect(matchesProject(project, '', EMPTY_FILTERS)).toBe(true);
  });

  it('combines all eight filter selections with all eight project states using AND', () => {
    for (let active = 0; active < 8; active++) for (let flags = 0; flags < 8; flags++) {
      const filters = { cafe: !!(active & 1), mindless: !!(active & 2), summer: !!(active & 4) };
      const candidate = { ...project, conditions: { cafe: !!(flags & 1), mindless: !!(flags & 2), summerBlocked: !(flags & 4) } };
      expect(matchesProject(candidate, ' WILD ', filters)).toBe((flags & active) === active);
      expect(matchesProject(candidate, 'cardigan', filters)).toBe(false);
    }
  });
});
