import { describe, expect, it } from 'vitest'
import type { SentenceAnnotation } from '../../src/core/schema.js'
import { LLMProvider } from './llm.js'

const valid: SentenceAnnotation = {
  index: 1,
  role: { value: 'evidence', confidence: 0.86 },
  cut_safety: { value: 'cuttable', confidence: 0.61 },
  redundancy: { value: 'none', confidence: 0.9, earlier_sentence_index: null },
  support: { value: 'n/a', confidence: 0.84 },
  clarity: { value: 'ok', confidence: 0.77 },
}

describe('LLMProvider', () => {
  it('requests strict JSON and drops malformed result objects', async () => {
    let requestBody: Record<string, unknown> | undefined
    const provider = new LLMProvider({
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'https://example.test/v1',
      fetch: async (_input: string, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                results: [
                  valid,
                  { ...valid, index: 2, cut_safety: { value: 'cuttable', confidence: 4 } },
                ],
              }),
            },
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })

    const result = await provider.score(
      [{ index: 1, text: 'Measured latency fell by twelve percent.' }],
      { document: ['Measured latency fell by twelve percent.'] },
    )

    expect(result).toEqual([valid])
    const body = requestBody?.messages as Array<{ role: string; content: string }> | undefined
    expect(body?.[0].content).toContain('Never generate')
    expect(requestBody).toBeDefined()
    expect(requestBody?.response_format).toMatchObject({ type: 'json_schema' })
  })
})
