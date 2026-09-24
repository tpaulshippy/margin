import { describe, expect, it } from 'vitest'
import type { SentenceAnnotation } from '../core/schema'
import {
  expandWithNeighbors,
  reconcileSentenceAnnotations,
  splitSentences,
} from './sentences'

const annotation = (index: number, earlierSentenceIndex: number | null = null): SentenceAnnotation => ({
  index,
  role: { value: 'claim', confidence: 0.9 },
  cut_safety: { value: 'supporting', confidence: 0.8 },
  redundancy: earlierSentenceIndex === null
    ? { value: 'none', confidence: 0.7, earlier_sentence_index: null }
    : { value: 'repeats', confidence: 0.7, earlier_sentence_index: earlierSentenceIndex },
  support: { value: 'n/a', confidence: 0.8 },
  clarity: { value: 'ok', confidence: 0.8 },
})

describe('splitSentences', () => {
  it('uses Intl.Segmenter for sentence boundaries', () => {
    expect(splitSentences('The first sentence ends! Does the second? Yes.')).toEqual([
      'The first sentence ends!',
      'Does the second?',
      'Yes.',
    ])
  })
})

describe('reconcileSentenceAnnotations', () => {
  it('transfers unchanged scores across an insertion and only marks the insertion changed', () => {
    const previous = ['First.', 'Second.', 'Third.']
    const next = ['First.', 'Inserted.', 'Second.', 'Third.']
    const previousAnnotations = [annotation(0), annotation(1, 0), annotation(2, 0)]

    const result = reconcileSentenceAnnotations(previous, previousAnnotations, next)

    expect(result.changedIndices).toEqual([1])
    expect(result.annotations.map(({ index, redundancy }) => ({ index, earlier: redundancy.earlier_sentence_index }))).toEqual([
      { index: 0, earlier: null },
      { index: 2, earlier: 0 },
      { index: 3, earlier: 0 },
    ])
  })

  it('drops a score for an edited sentence', () => {
    const result = reconcileSentenceAnnotations(
      ['First.', 'Second.'],
      [annotation(0), annotation(1, 0)],
      ['First.', 'Changed.'],
    )

    expect(result.annotations.map(({ index }) => index)).toEqual([0])
    expect(result.changedIndices).toEqual([1])
  })

  it('marks the surviving neighbor when a sentence is deleted', () => {
    const result = reconcileSentenceAnnotations(
      ['First.', 'Second.'],
      [annotation(0), annotation(1, 0)],
      ['First.'],
    )

    expect(result.changedIndices).toEqual([0])
  })
})

describe('expandWithNeighbors', () => {
  it('adds only valid immediate neighbors', () => {
    expect(expandWithNeighbors([2], 5)).toEqual([1, 2, 3])
    expect(expandWithNeighbors([4], 5)).toEqual([3, 4])
  })
})
