import { z } from 'zod'

export const roleValues = ['claim', 'evidence', 'transition', 'filler'] as const
export const cutSafetyValues = ['essential', 'supporting', 'cuttable'] as const
export const supportValues = ['n/a', 'unsupported_claim'] as const
export const clarityValues = ['ok', 'unclear'] as const

const confidenceSchema = z.number().finite().min(0).max(1)
const sentenceIndexSchema = z.number().int().nonnegative()

const scoredRoleSchema = z.object({
  value: z.enum(roleValues),
  confidence: confidenceSchema,
}).strict()

const scoredCutSafetySchema = z.object({
  value: z.enum(cutSafetyValues),
  confidence: confidenceSchema,
}).strict()

const redundancySchema = z.discriminatedUnion('value', [
  z.object({
    value: z.literal('none'),
    confidence: confidenceSchema,
    earlier_sentence_index: z.null(),
  }).strict(),
  z.object({
    value: z.literal('repeats'),
    confidence: confidenceSchema,
    earlier_sentence_index: sentenceIndexSchema,
  }).strict(),
])

const scoredSupportSchema = z.object({
  value: z.enum(supportValues),
  confidence: confidenceSchema,
}).strict()

const scoredClaritySchema = z.object({
  value: z.enum(clarityValues),
  confidence: confidenceSchema,
}).strict()

export const sentenceAnnotationSchema = z.object({
  index: sentenceIndexSchema,
  role: scoredRoleSchema,
  cut_safety: scoredCutSafetySchema,
  redundancy: redundancySchema,
  support: scoredSupportSchema,
  clarity: scoredClaritySchema,
}).strict().superRefine((annotation, context) => {
  if (
    annotation.redundancy.value === 'repeats'
    && annotation.redundancy.earlier_sentence_index >= annotation.index
  ) {
    context.addIssue({
      code: 'custom',
      path: ['redundancy', 'earlier_sentence_index'],
      message: 'A repeated sentence must reference an earlier sentence.',
    })
  }
})

export const sentenceTargetSchema = z.object({
  index: sentenceIndexSchema,
  text: z.string().min(1),
}).strict()

export const scoringRequestSchema = z.object({
  sentences: z.array(sentenceTargetSchema).min(1),
  document: z.array(z.string()),
}).strict().superRefine((request, context) => {
  const seen = new Set<number>()
  for (const sentence of request.sentences) {
    if (sentence.index >= request.document.length || sentence.text !== request.document[sentence.index]) {
      context.addIssue({
        code: 'custom',
        path: ['sentences'],
        message: 'Each target must match its document sentence.',
      })
    }
    if (seen.has(sentence.index)) {
      context.addIssue({
        code: 'custom',
        path: ['sentences'],
        message: 'Target indices must be unique.',
      })
    }
    seen.add(sentence.index)
  }
})

export type SentenceAnnotation = z.infer<typeof sentenceAnnotationSchema>
export type SentenceTarget = z.infer<typeof sentenceTargetSchema>
export type ScoringRequest = z.infer<typeof scoringRequestSchema>
export type Role = (typeof roleValues)[number]
export type CutSafety = (typeof cutSafetyValues)[number]
export type Support = (typeof supportValues)[number]
export type Clarity = (typeof clarityValues)[number]

export function sanitizeAnnotations(
  input: unknown,
  requestedIndices: readonly number[],
): SentenceAnnotation[] {
  if (!Array.isArray(input)) {
    return []
  }

  const requested = new Set(requestedIndices)
  const seen = new Set<number>()
  const annotations: SentenceAnnotation[] = []

  for (const candidate of input) {
    const parsed = sentenceAnnotationSchema.safeParse(candidate)
    if (!parsed.success || !requested.has(parsed.data.index) || seen.has(parsed.data.index)) {
      continue
    }
    seen.add(parsed.data.index)
    annotations.push(parsed.data)
  }

  return annotations
}
