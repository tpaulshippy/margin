import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScoringProviderName } from '../core/provider'
import { sanitizeAnnotations, type SentenceAnnotation } from '../core/schema'
import { expandWithNeighbors, reconcileSentenceAnnotations, splitSentences } from '../lib/sentences'

interface ScoringResponse {
  provider?: unknown
  annotations?: unknown
}

export interface IncrementalScoringState {
  text: string
  updateText: (text: string) => void
  sentences: string[]
  annotations: SentenceAnnotation[]
  pendingIndices: number[]
  provider: ScoringProviderName | null
  error: string | null
}

export function useIncrementalScoring(initialText: string, debounceMs = 300): IncrementalScoringState {
  const [initialSnapshot] = useState(() => {
    const initialSentences = splitSentences(initialText)
    return {
      sentences: initialSentences,
      targets: expandWithNeighbors(
        initialSentences.map((_, index) => index),
        initialSentences.length,
      ),
    }
  })
  const initialSentences = initialSnapshot.sentences
  const initialTargets = initialSnapshot.targets
  const [text, setText] = useState(initialText)
  const [sentences, setSentences] = useState(initialSentences)
  const [annotations, setAnnotations] = useState<SentenceAnnotation[]>([])
  const [pendingIndices, setPendingIndices] = useState(initialTargets)
  const [provider, setProvider] = useState<ScoringProviderName | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previousSentences = useRef<string[]>([])
  const previousAnnotations = useRef<SentenceAnnotation[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const requestVersion = useRef(0)

  const startRequest = useCallback((currentSentences: readonly string[], targetIndices: readonly number[]) => {
    if (timer.current) {
      clearTimeout(timer.current)
    }
    activeRequest.current?.abort()
    requestVersion.current += 1

    if (targetIndices.length === 0 || currentSentences.length === 0) {
      return
    }

    const targetSet = new Set(targetIndices)
    const version = requestVersion.current
    timer.current = setTimeout(() => {
      const controller = new AbortController()
      activeRequest.current = controller
      const targets = targetIndices.map((index) => ({ index, text: currentSentences[index] }))

      void fetch('/api/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sentences: targets,
          document: currentSentences,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error('Scoring request failed.')
          }
          return response.json() as Promise<ScoringResponse>
        })
        .then((body) => {
          if (version !== requestVersion.current) {
            return
          }
          if (body.provider === 'jev' || body.provider === 'llm') {
            setProvider(body.provider)
          }
          const valid = sanitizeAnnotations(body.annotations, targetIndices)
          setAnnotations((current) => {
            const next = [
              ...current.filter(({ index }) => !targetSet.has(index)),
              ...valid,
            ].sort((left, right) => left.index - right.index)
            previousAnnotations.current = next
            return next
          })
          setPendingIndices([])
          const dropped = targetIndices.length - valid.length
          setError(dropped > 0
            ? `${dropped} sentence result${dropped === 1 ? ' was' : 's were'} dropped because no valid score was returned.`
            : null)
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || version !== requestVersion.current) {
            return
          }
          setPendingIndices([])
          setError(reason instanceof Error ? reason.message : 'Scoring request failed.')
        })
    }, debounceMs)
  }, [debounceMs])

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/config', { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<ScoringResponse> : null)
      .then((body) => {
        if (body?.provider === 'jev' || body?.provider === 'llm') {
          setProvider(body.provider)
        }
      })
      .catch(() => undefined)
    startRequest(initialSentences, initialTargets)
    return () => {
      controller.abort()
      if (timer.current) {
        clearTimeout(timer.current)
      }
      activeRequest.current?.abort()
    }
  }, [initialSentences, initialTargets, startRequest])

  const updateText = useCallback((nextText: string) => {
    const currentSentences = splitSentences(nextText)
    const reconciliation = reconcileSentenceAnnotations(
      previousSentences.current,
      previousAnnotations.current,
      currentSentences,
    )
    const targetIndices = expandWithNeighbors(reconciliation.changedIndices, currentSentences.length)
    const targetSet = new Set(targetIndices)
    const retainedAnnotations = reconciliation.annotations.filter(({ index }) => !targetSet.has(index))

    previousSentences.current = currentSentences
    previousAnnotations.current = retainedAnnotations
    setText(nextText)
    setSentences(currentSentences)
    setAnnotations(retainedAnnotations)
    setPendingIndices(targetIndices)
    setError(null)
    startRequest(currentSentences, targetIndices)
  }, [startRequest])

  return { text, updateText, sentences, annotations, pendingIndices, provider, error }
}
