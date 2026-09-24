import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SentenceAnnotation, ScoringRequest } from '../core/schema'
import { useIncrementalScoring } from './useIncrementalScoring'

function annotation(index: number): SentenceAnnotation {
  return {
    index,
    role: { value: 'claim', confidence: 0.9 },
    cut_safety: { value: 'supporting', confidence: 0.8 },
    redundancy: { value: 'none', confidence: 0.9, earlier_sentence_index: null },
    support: { value: 'n/a', confidence: 0.8 },
    clarity: { value: 'ok', confidence: 0.8 },
  }
}

describe('useIncrementalScoring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/config') {
        return new Response(JSON.stringify({ provider: 'jev' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const request = JSON.parse(String(init?.body)) as ScoringRequest
      return new Response(JSON.stringify({
        provider: 'jev',
        annotations: request.sentences.map(({ index }) => annotation(index)),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('preserves fetched scores when a sentence is appended', async () => {
    const { result } = renderHook(() => useIncrementalScoring('One. Two.', 300))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301)
    })
    expect(result.current.annotations.map(({ index }) => index)).toEqual([0, 1])

    act(() => result.current.updateText('One. Two. Three.'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301)
    })

    expect(result.current.annotations.map(({ index }) => index)).toEqual([0, 1, 2])
  })
})
