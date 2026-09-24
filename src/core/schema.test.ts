import { describe, expect, it } from 'vitest'
import {
  sanitizeAnnotations,
  scoringRequestSchema,
  type SentenceAnnotation,
} from './schema'

const validAnnotation: SentenceAnnotation = {
  index: 0,
  role: { value: 'claim', confidence: 0.91 },
  cut_safety: { value: 'essential', confidence: 0.88 },
  redundancy: { value: 'none', confidence: 0.95, earlier_sentence_index: null },
  support: { value: 'n/a', confidence: 0.84 },
  clarity: { value: 'ok', confidence: 0.79 },
}

describe('sanitizeAnnotations', () => {
  it('keeps valid requested results and drops malformed or duplicate results', () => {
    const result = sanitizeAnnotations(
      [
        validAnnotation,
        { ...validAnnotation, cut_safety: { value: 'essential', confidence: 1.2 } },
        validAnnotation,
        { ...validAnnotation, index: 1, unknown: true },
      ],
      [0, 1],
    )

    expect(result).toEqual([validAnnotation])
  })

  it('rejects a repeat without a valid earlier sentence index', () => {
    const result = sanitizeAnnotations(
      [
        {
          ...validAnnotation,
          index: 2,
          redundancy: { value: 'repeats', confidence: 0.7, earlier_sentence_index: 2 },
        },
      ],
      [2],
    )

    expect(result).toEqual([])
  })
})

describe('scoringRequestSchema', () => {
  it('rejects target indices outside the document', () => {
    const parsed = scoringRequestSchema.safeParse({
      sentences: [{ index: 2, text: 'Outside' }],
      document: ['Only one sentence.'],
    })

    expect(parsed.success).toBe(false)
  })
})
