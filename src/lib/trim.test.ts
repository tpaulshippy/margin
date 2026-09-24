import { describe, expect, it } from 'vitest'
import type { SentenceAnnotation } from '../core/schema'
import { buildTrimPlan } from './trim'

const annotation = (index: number, confidence: number): SentenceAnnotation => ({
  index,
  role: { value: 'claim', confidence: 0.9 },
  cut_safety: { value: 'cuttable', confidence },
  redundancy: { value: 'none', confidence: 0.8, earlier_sentence_index: null },
  support: { value: 'n/a', confidence: 0.8 },
  clarity: { value: 'ok', confidence: 0.8 },
})

describe('buildTrimPlan', () => {
  it('ranks cuttable sentences by ascending confidence-weighted importance', () => {
    const plan = buildTrimPlan({
      sentences: ['Keep this claim.', 'Low confidence cut.', 'High confidence cut.'],
      annotations: [
        { ...annotation(0, 0.9), cut_safety: { value: 'essential', confidence: 0.9 } },
        annotation(1, 0.42),
        annotation(2, 0.86),
      ],
      targetWords: 2,
      decisions: {},
    })

    expect(plan.requiredCutWords).toBe(7)
    expect(plan.selectedIndices).toEqual([1, 2])
    expect(plan.candidates.map(({ index }) => index)).toEqual([1, 2])
  })

  it('keeps accepted decisions and excludes rejected cuts', () => {
    const plan = buildTrimPlan({
      sentences: ['One two three four.', 'Five six seven eight.'],
      annotations: [annotation(0, 0.4), annotation(1, 0.6)],
      targetWords: 4,
      decisions: { 0: 'rejected' },
    })

    expect(plan.selectedIndices).toEqual([1])
    expect(plan.projectedWords).toBe(4)
    expect(plan.reachesTarget).toBe(true)
  })
})
