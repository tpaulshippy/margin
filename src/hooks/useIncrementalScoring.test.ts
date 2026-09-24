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

function mockScoreApi(
  annotationsForCall: (call: number, indices: number[]) => SentenceAnnotation[],
): number[][] {
  const requestedTargets: number[][] = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === '/api/config') {
      return new Response(JSON.stringify({ provider: 'jev' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const request = JSON.parse(String(init?.body)) as ScoringRequest
    const indices = request.sentences.map(({ index }) => index)
    const annotations = annotationsForCall(requestedTargets.length, indices)
    requestedTargets.push(indices)
    return new Response(JSON.stringify({ provider: 'jev', annotations }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return requestedTargets
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

  it('retries sentences omitted from a partial response', async () => {
    const requestedTargets = mockScoreApi((call, indices) => call === 0
      ? [annotation(indices[0])]
      : indices.map((index) => annotation(index)))

    const { result } = renderHook(() => useIncrementalScoring('One. Two.', 300))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(requestedTargets).toEqual([[0, 1], [1]])
    expect(result.current.annotations.map(({ index }) => index)).toEqual([0, 1])
    expect(result.current.pendingIndices).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('reports a persistent omission after bounded retries', async () => {
    const requestedTargets = mockScoreApi(() => [annotation(0)])

    const { result } = renderHook(() => useIncrementalScoring('One. Two.', 300))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(requestedTargets).toEqual([[0, 1], [1], [1]])
    expect(result.current.annotations.map(({ index }) => index)).toEqual([0])
    expect(result.current.pendingIndices).toEqual([])
    expect(result.current.error).toBe('1 sentence result was dropped because no valid score was returned.')
  })

  it('reports the server retry delay when scoring is rate limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/api/config') {
        return new Response(JSON.stringify({ provider: 'jev' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: 'Too many scoring requests.' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '12' },
      })
    }))

    const { result } = renderHook(() => useIncrementalScoring('One. Two.', 300))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301)
    })

    expect(result.current.error).toBe('Scoring is temporarily rate limited. Try again in 12 seconds.')
  })
})
