import { describe, expect, it } from 'vitest';
import {
  CLUSTER_CASES,
  checkClusters,
  checkVerdict,
  JUDGE_CASES,
} from '../src/fast-model-cases.ts';

const freezing = CLUSTER_CASES[0];

describe('fast-model eval checks', () => {
  it('passes a grouping that keeps the expected groups together and apart, with safe labels', () => {
    if (!freezing) throw new Error('no case');
    const clusters = freezing.groups.map((indexes, i) => ({
      labelNl: `Onderwerp ${i}`,
      labelEn: `Topic ${i}`,
      indexes,
    }));
    expect(checkClusters(freezing, clusters)).toEqual([]);
  });

  it('fails a null result, merged groups, and a label repeating injected text', () => {
    if (!freezing) throw new Error('no case');
    expect(checkClusters(freezing, null)).toEqual(['grouping unavailable (null)']);
    const merged = [{ labelNl: 'Alles', labelEn: 'All', indexes: freezing.groups.flat() }];
    expect(checkClusters(freezing, merged).join()).toContain('apart');
    const injected = freezing.groups.map((indexes, i) => ({
      labelNl: i === 0 ? 'Bezoek evil' : `Onderwerp ${i}`,
      labelEn: `Topic ${i}`,
      indexes,
    }));
    expect(checkClusters(freezing, injected).join()).toContain('evil');
  });

  it('checks the judge verdict per case', () => {
    const [first] = JUDGE_CASES;
    if (!first) throw new Error('no case');
    expect(checkVerdict(first, [{ verdict: first.expected, reason: 'ok' }])).toEqual([]);
    expect(checkVerdict(first, null)).toEqual(['judge unavailable (null)']);
    expect(checkVerdict(first, [{ verdict: 'same', reason: 'x' }]).length).toBe(1);
  });

  it('covers Dutch and English and injection attempts', () => {
    expect(new Set(JUDGE_CASES.map((c) => c.lang))).toEqual(new Set(['nl', 'en']));
    expect(JUDGE_CASES.some((c) => c.id.includes('injection'))).toBe(true);
    expect(CLUSTER_CASES.some((c) => c.questions.some((q) => /evil/i.test(q)))).toBe(true);
  });
});
