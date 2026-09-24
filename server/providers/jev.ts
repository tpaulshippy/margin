import {
  TypeSafeClient,
  choice,
  type Fetch,
  type Questions,
} from '@typesafe-ai/sdk'
import { z } from 'zod'
import type { ScoringProvider } from '../../src/core/provider.js'
import {
  clarityValues,
  cutSafetyValues,
  roleValues,
  sanitizeAnnotations,
  supportValues,
  type SentenceAnnotation,
  type SentenceTarget,
} from '../../src/core/schema.js'

const confidenceSchema = z.number().finite().min(0).max(1)
const roleAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.enum(roleValues),
  confidence: confidenceSchema,
})
const cutSafetyAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.enum(cutSafetyValues),
  confidence: confidenceSchema,
})
const redundancyAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string().regex(/^(?:none|repeat_\d+)$/),
  confidence: confidenceSchema,
})
const supportAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.enum(supportValues),
  confidence: confidenceSchema,
})
const clarityAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.enum(clarityValues),
  confidence: confidenceSchema,
})

const roleCriteria = {
  claim: 'States or advances an assertion, thesis, conclusion, or interpretation.',
  evidence: 'Provides data, an example, quotation, citation, or observable support for a claim.',
  transition: 'Connects ideas or signals a change in the argument without adding substantive support.',
  filler: 'Adds little argumentative value, such as throat-clearing, generic emphasis, or empty commentary.',
} as const

const cutSafetyCriteria = {
  essential: 'Removing the sentence would break a central claim, its necessary evidence, or the argument’s logic.',
  supporting: 'Removing the sentence loses useful context or reinforcement, but the central argument remains understandable.',
  cuttable: 'Removing the sentence would not materially weaken the central argument or reader understanding.',
} as const

const supportCriteria = {
  'n/a': 'The sentence is not a factual or causal claim needing support, or it is itself evidence.',
  unsupported_claim: 'The sentence advances a factual or causal claim without support elsewhere in the document.',
} as const

const clarityCriteria = {
  ok: 'The sentence has a clear subject, meaning, and relationship to the surrounding writing.',
  unclear: 'The sentence is materially ambiguous or leaves a key referent, claim, or relationship unclear.',
} as const

export interface JevProviderOptions {
  apiKey: string
  model?: string
  fetch?: Fetch
}

export class JevProvider implements ScoringProvider {
  readonly name = 'jev' as const
  private readonly client: TypeSafeClient
  private readonly model: string

  constructor({ apiKey, model = 'jev-latest', fetch }: JevProviderOptions) {
    this.model = model
    this.client = new TypeSafeClient({
      apiKey,
      defaultModel: model,
      logLevel: 'off',
      timeout: 60_000,
      ...(fetch ? { fetch } : {}),
    })
  }

  async score(
    sentences: readonly SentenceTarget[],
    context: { document: readonly string[]; signal?: AbortSignal },
  ): Promise<SentenceAnnotation[]> {
    if (sentences.length === 0) {
      return []
    }

    const questions: Questions = {}

    for (const target of sentences) {
      const instructions = {
        target_sentence_index: target.index,
        question: 'Evaluate only the target sentence. Use the full `sentences` array only as context.',
      }
      questions[`s${target.index}_role`] = choice(instructions, roleCriteria)
      questions[`s${target.index}_cut_safety`] = choice(instructions, cutSafetyCriteria)
      questions[`s${target.index}_support`] = choice(instructions, supportCriteria)
      questions[`s${target.index}_clarity`] = choice(instructions, clarityCriteria)

      if (target.index === 0) {
        continue
      }

      const redundancyCriteria: Record<string, string> = {
        none: 'The target sentence does not repeat the meaning of an earlier sentence.',
      }
      const earlierIndices = context.document
        .map((_, index) => index)
        .filter((index) => index < target.index)
        .slice(-254)
      for (const earlierIndex of earlierIndices) {
        redundancyCriteria[`repeat_${earlierIndex}`] = `The target repeats the meaning of earlier sentence ${earlierIndex}: ${context.document[earlierIndex]}`
      }
      questions[`s${target.index}_redundancy`] = choice({
        ...instructions,
        question: 'Does the target sentence repeat an earlier sentence? Select the closest earlier sentence only when the meaning is substantially repeated.',
      }, redundancyCriteria)
    }

    const response = await this.client.systemOne({
      state: { sentences: Array.from(context.document) },
      questions,
      model: this.model,
    }, { signal: context.signal })

    const rawAnnotations: SentenceAnnotation[] = []
    for (const target of sentences) {
      const role = roleAnswerSchema.safeParse(response.answers[`s${target.index}_role`])
      const cutSafety = cutSafetyAnswerSchema.safeParse(response.answers[`s${target.index}_cut_safety`])
      const support = supportAnswerSchema.safeParse(response.answers[`s${target.index}_support`])
      const clarity = clarityAnswerSchema.safeParse(response.answers[`s${target.index}_clarity`])
      if (!role.success || !cutSafety.success || !support.success || !clarity.success) {
        continue
      }

      let redundancy: SentenceAnnotation['redundancy']
      if (target.index === 0) {
        redundancy = { value: 'none', confidence: 1, earlier_sentence_index: null }
      } else {
        const parsedRedundancy = redundancyAnswerSchema.safeParse(response.answers[`s${target.index}_redundancy`])
        if (!parsedRedundancy.success) {
          continue
        }
        redundancy = parsedRedundancy.data.choice === 'none'
          ? { value: 'none', confidence: parsedRedundancy.data.confidence, earlier_sentence_index: null }
          : {
              value: 'repeats',
              confidence: parsedRedundancy.data.confidence,
              earlier_sentence_index: Number(parsedRedundancy.data.choice.slice('repeat_'.length)),
            }
      }

      rawAnnotations.push({
        index: target.index,
        role: { value: role.data.choice, confidence: role.data.confidence },
        cut_safety: { value: cutSafety.data.choice, confidence: cutSafety.data.confidence },
        redundancy,
        support: { value: support.data.choice, confidence: support.data.confidence },
        clarity: { value: clarity.data.choice, confidence: clarity.data.confidence },
      })
    }

    return sanitizeAnnotations(rawAnnotations, sentences.map(({ index }) => index))
  }
}
