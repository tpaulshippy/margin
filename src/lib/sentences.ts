import type { SentenceAnnotation } from '../core/schema'

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

export function splitSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  return Array.from(segmenter.segment(trimmed), ({ segment }) => segment.trim()).filter(Boolean)
}

type AlignedPair = readonly [previousIndex: number, currentIndex: number]

function alignSentences(previous: readonly string[], current: readonly string[]): AlignedPair[] {
  const table = Array.from(
    { length: previous.length + 1 },
    () => Array<number>(current.length + 1).fill(0),
  )

  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let currentIndex = current.length - 1; currentIndex >= 0; currentIndex -= 1) {
      table[previousIndex][currentIndex] = previous[previousIndex] === current[currentIndex]
        ? table[previousIndex + 1][currentIndex + 1] + 1
        : Math.max(table[previousIndex + 1][currentIndex], table[previousIndex][currentIndex + 1])
    }
  }

  const pairs: AlignedPair[] = []
  let previousIndex = 0
  let currentIndex = 0

  while (previousIndex < previous.length && currentIndex < current.length) {
    if (previous[previousIndex] === current[currentIndex]) {
      pairs.push([previousIndex, currentIndex])
      previousIndex += 1
      currentIndex += 1
    } else if (table[previousIndex + 1][currentIndex] >= table[previousIndex][currentIndex + 1]) {
      previousIndex += 1
    } else {
      currentIndex += 1
    }
  }

  return pairs
}

export function reconcileSentenceAnnotations(
  previousSentences: readonly string[],
  previousAnnotations: readonly SentenceAnnotation[],
  currentSentences: readonly string[],
): { annotations: SentenceAnnotation[]; changedIndices: number[] } {
  const pairs = alignSentences(previousSentences, currentSentences)
  const previousByIndex = new Map(previousAnnotations.map((annotation) => [annotation.index, annotation]))
  const currentToPrevious = new Map(pairs.map(([previousIndex, currentIndex]) => [currentIndex, previousIndex]))
  const previousToCurrent = new Map(pairs.map(([previousIndex, currentIndex]) => [previousIndex, currentIndex]))
  const annotations: SentenceAnnotation[] = []
  const changed = new Set<number>()

  for (let index = 0; index < currentSentences.length; index += 1) {
    if (!currentToPrevious.has(index)) {
      changed.add(index)
    }
  }

  for (let index = 0; index < previousSentences.length; index += 1) {
    if (!previousToCurrent.has(index) && currentSentences.length > 0) {
      changed.add(Math.min(index, currentSentences.length - 1))
    }
  }

  for (const [previousIndex, currentIndex] of pairs) {
    const annotation = previousByIndex.get(previousIndex)
    if (!annotation) {
      continue
    }

    if (annotation.redundancy.value === 'repeats') {
      const mappedEarlierIndex = previousToCurrent.get(annotation.redundancy.earlier_sentence_index)
      if (mappedEarlierIndex === undefined) {
        changed.add(currentIndex)
        continue
      }
      annotations.push({
        ...annotation,
        index: currentIndex,
        redundancy: {
          ...annotation.redundancy,
          earlier_sentence_index: mappedEarlierIndex,
        },
      })
      continue
    }

    annotations.push({ ...annotation, index: currentIndex })
  }

  return {
    annotations,
    changedIndices: Array.from(changed).sort((left, right) => left - right),
  }
}

export function expandWithNeighbors(indices: readonly number[], sentenceCount: number): number[] {
  const expanded = new Set<number>()

  for (const index of indices) {
    for (const candidate of [index - 1, index, index + 1]) {
      if (candidate >= 0 && candidate < sentenceCount) {
        expanded.add(candidate)
      }
    }
  }

  return Array.from(expanded).sort((left, right) => left - right)
}
