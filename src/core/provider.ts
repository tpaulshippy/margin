import type { SentenceAnnotation, SentenceTarget } from './schema.js'

export type ScoringProviderName = 'jev' | 'llm'

export interface ScoringContext {
  document: readonly string[]
  signal?: AbortSignal
}

export interface ScoringProvider {
  readonly name: ScoringProviderName
  score(
    sentences: readonly SentenceTarget[],
    context: ScoringContext,
  ): Promise<SentenceAnnotation[]>
}
