import { z } from 'zod'
import type { Fetch } from '@typesafe-ai/sdk'
import type { ScoringProvider } from '../../src/core/provider.js'
import { sanitizeAnnotations, type SentenceAnnotation, type SentenceTarget } from '../../src/core/schema.js'

const annotationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    index: { type: 'integer', minimum: 0 },
    role: {
      type: 'object',
      additionalProperties: false,
      properties: {
        value: { type: 'string', enum: ['claim', 'evidence', 'transition', 'filler'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['value', 'confidence'],
    },
    cut_safety: {
      type: 'object',
      additionalProperties: false,
      properties: {
        value: { type: 'string', enum: ['essential', 'supporting', 'cuttable'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['value', 'confidence'],
    },
    redundancy: {
      type: 'object',
      additionalProperties: false,
      properties: {
        value: { type: 'string', enum: ['none', 'repeats'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        earlier_sentence_index: { type: ['integer', 'null'], minimum: 0 },
      },
      required: ['value', 'confidence', 'earlier_sentence_index'],
    },
    support: {
      type: 'object',
      additionalProperties: false,
      properties: {
        value: { type: 'string', enum: ['n/a', 'unsupported_claim'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['value', 'confidence'],
    },
    clarity: {
      type: 'object',
      additionalProperties: false,
      properties: {
        value: { type: 'string', enum: ['ok', 'unclear'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['value', 'confidence'],
    },
  },
  required: ['index', 'role', 'cut_safety', 'redundancy', 'support', 'clarity'],
} as const

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    results: { type: 'array', items: annotationJsonSchema },
  },
  required: ['results'],
} as const

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable(),
    }),
  })).min(1),
})

const modelOutputSchema = z.object({
  results: z.array(z.unknown()),
})

const systemPrompt = `You are a writing annotator. Classify only the existing sentences supplied by the user. Never generate, rewrite, paraphrase, quote alternatives, or suggest replacement text. Return one result for every target index and no other prose. Every verdict must include a confidence from 0 to 1. A repeated sentence must reference an earlier sentence index. Treat support as n/a for evidence, transitions, filler, and non-factual material.`

export interface LLMProviderOptions {
  apiKey: string
  model: string
  baseUrl?: string
  fetch?: Fetch
}

export class LLMProvider implements ScoringProvider {
  readonly name = 'llm' as const
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly fetch: Fetch

  constructor({ apiKey, model, baseUrl = 'https://api.openai.com/v1', fetch }: LLMProviderOptions) {
    this.apiKey = apiKey
    this.model = model
    this.baseUrl = baseUrl.replace(/\/$/u, '')
    this.fetch = fetch ?? globalThis.fetch
  }

  async score(
    sentences: readonly SentenceTarget[],
    context: { document: readonly string[]; signal?: AbortSignal },
  ): Promise<SentenceAnnotation[]> {
    if (sentences.length === 0) {
      return []
    }

    const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              sentences: context.document.map((text, index) => ({ index, text })),
              target_indices: sentences.map(({ index }) => index),
            }),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'margin_sentence_annotations',
            strict: true,
            schema: responseJsonSchema,
          },
        },
      }),
      signal: context.signal,
    })

    if (!response.ok) {
      throw new Error(`LLM scoring request failed with status ${response.status}.`)
    }

    const completion = completionSchema.safeParse(await response.json())
    if (!completion.success || !completion.data.choices[0].message.content) {
      return []
    }

    try {
      const output = modelOutputSchema.parse(JSON.parse(completion.data.choices[0].message.content))
      return sanitizeAnnotations(output.results, sentences.map(({ index }) => index))
    } catch {
      return []
    }
  }
}
