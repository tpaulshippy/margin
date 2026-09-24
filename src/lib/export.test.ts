import { describe, expect, it } from 'vitest'
import type { SentenceAnnotation } from '../core/schema'
import { buildJsonExport, buildMarkdownExport } from './export'

const annotation: SentenceAnnotation = {
  index: 0,
  role: { value: 'claim', confidence: 0.91 },
  cut_safety: { value: 'essential', confidence: 0.88 },
  redundancy: { value: 'none', confidence: 0.95, earlier_sentence_index: null },
  support: { value: 'n/a', confidence: 0.84 },
  clarity: { value: 'unclear', confidence: 0.81 },
}

describe('exports', () => {
  it('shows clarity only above the confidence threshold in markdown', () => {
    const markdown = buildMarkdownExport(['A sentence.'], [annotation], 'jev')
    expect(markdown).toContain('Clarity: unclear')
    expect(buildMarkdownExport(['A sentence.'], [{ ...annotation, clarity: { ...annotation.clarity, confidence: 0.8 } }], 'jev'))
      .not.toContain('Clarity:')
  })

  it('exports all scores and sentence text as JSON', () => {
    const output = JSON.parse(buildJsonExport(['A sentence.'], [annotation], 'jev')) as {
      provider: string
      scores: Array<{ text: string; annotation: SentenceAnnotation | null }>
    }
    expect(output.provider).toBe('jev')
    expect(output.scores[0].text).toBe('A sentence.')
    expect(output.scores[0].annotation).toEqual(annotation)
  })
})
