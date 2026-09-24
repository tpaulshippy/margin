import { describe, expect, it } from 'vitest'
import { JevProvider } from './jev.js'

const probabilities = (labels: string[], selected: string) => Object.fromEntries(
  labels.map((label) => [label, label === selected ? 1 : 0]),
)

const choice = (selected: string, labels: string[], confidence: number) => ({
  type: 'choice',
  choice: selected,
  confidence,
  probabilities: probabilities(labels, selected),
})

describe('JevProvider', () => {
  it('maps typed Jev Choice answers into the shared annotation schema', async () => {
    let requestBody: Record<string, unknown> | undefined
    const provider = new JevProvider({
      apiKey: 'test-key',
      model: 'jev-latest',
      fetch: async (_input: string, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({
          model: 'jev-test',
          answers: {
            s1_role: choice('claim', ['claim', 'evidence', 'transition', 'filler'], 0.91),
            s1_cut_safety: choice('supporting', ['essential', 'supporting', 'cuttable'], 0.82),
            s1_redundancy: choice('none', ['none', 'repeat_0'], 0.88),
            s1_support: choice('n/a', ['n/a', 'unsupported_claim'], 0.79),
            s1_clarity: choice('ok', ['ok', 'unclear'], 0.93),
          },
          usage: { input_tokens: 10, output_tokens: 5 },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })

    const result = await provider.score(
      [{ index: 1, text: 'The second sentence makes a claim.' }],
      { document: ['The first sentence introduces evidence.', 'The second sentence makes a claim.'] },
    )

    expect(result).toEqual([{
      index: 1,
      role: { value: 'claim', confidence: 0.91 },
      cut_safety: { value: 'supporting', confidence: 0.82 },
      redundancy: { value: 'none', confidence: 0.88, earlier_sentence_index: null },
      support: { value: 'n/a', confidence: 0.79 },
      clarity: { value: 'ok', confidence: 0.93 },
    }])
    expect(requestBody?.model).toBe('jev-latest')
    expect(Object.keys(requestBody?.questions as object)).toHaveLength(5)
    expect(requestBody?.state).toEqual({
      sentences: ['The first sentence introduces evidence.', 'The second sentence makes a claim.'],
    })
  })
})
