import type { SentenceAnnotation } from '../core/schema'

export type TrimDecision = 'pending' | 'accepted' | 'rejected'

export interface TrimPlanInput {
  sentences: readonly string[]
  annotations: readonly SentenceAnnotation[]
  targetWords: number
  decisions: Readonly<Record<number, TrimDecision>>
}

export interface TrimCandidate {
  index: number
  text: string
  words: number
  importance: number
  status: TrimDecision
  selected: boolean
}

export interface TrimPlan {
  currentWords: number
  targetWords: number
  requiredCutWords: number
  projectedWords: number
  availableCutWords: number
  selectedIndices: number[]
  candidates: TrimCandidate[]
  reachesTarget: boolean
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0
}

export function buildTrimPlan({
  sentences,
  annotations,
  targetWords,
  decisions,
}: TrimPlanInput): TrimPlan {
  const currentWords = sentences.reduce((total, sentence) => total + countWords(sentence), 0)
  const safeTargetWords = Math.max(0, Math.trunc(targetWords))
  const requiredCutWords = Math.max(0, currentWords - safeTargetWords)
  const annotationByIndex = new Map(annotations.map((annotation) => [annotation.index, annotation]))
  const candidates = sentences.flatMap((text, index) => {
    const annotation = annotationByIndex.get(index)
    if (annotation?.cut_safety.value !== 'cuttable' || decisions[index] === 'rejected') {
      return []
    }
    return [{
      index,
      text,
      words: countWords(text),
      importance: annotation.cut_safety.confidence,
      status: decisions[index] ?? 'pending',
      selected: false,
    }]
  }).sort((left, right) => left.importance - right.importance || left.index - right.index)

  const selectedIndices: number[] = []
  let selectedWords = 0
  const select = (candidate: TrimCandidate) => {
    if (!selectedIndices.includes(candidate.index)) {
      selectedIndices.push(candidate.index)
      selectedWords += candidate.words
      candidate.selected = true
    }
  }

  if (requiredCutWords > 0) {
    for (const candidate of candidates) {
      if (candidate.status === 'accepted') {
        select(candidate)
      }
    }
    for (const candidate of candidates) {
      if (selectedWords >= requiredCutWords) {
        break
      }
      if (candidate.status === 'pending') {
        select(candidate)
      }
    }
  }

  const projectedWords = currentWords - selectedWords
  return {
    currentWords,
    targetWords: safeTargetWords,
    requiredCutWords,
    projectedWords,
    availableCutWords: candidates
      .filter((candidate) => candidate.status !== 'accepted')
      .reduce((total, candidate) => total + candidate.words, 0),
    selectedIndices: selectedIndices.sort((left, right) => left - right),
    candidates,
    reachesTarget: projectedWords <= safeTargetWords,
  }
}
