import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { ScoringProviderName } from '../src/core/provider.js'
import { createScoringProvider } from '../server/providers/index.js'

const evalFileSchema = z.object({
  essays: z.array(z.object({
    id: z.string(),
    title: z.string(),
    sentences: z.array(z.object({
      text: z.string().min(1),
      label: z.enum(['cut', 'keep']),
    })).min(1),
  })).length(5),
}).strict()

type EvalFile = z.infer<typeof evalFileSchema>

type EssayResult = {
  essay: string
  agreement: number
  correct: number
  total: number
  dropped: number
}

const providers = (process.argv[2] ?? 'jev,llm')
  .split(',')
  .map((provider) => provider.trim())
  .filter((provider): provider is ScoringProviderName => provider === 'jev' || provider === 'llm')

if (providers.length === 0) {
  throw new Error('Choose providers with --providers jev,llm or npm run eval -- jev,llm.')
}

const evalUrl = new URL('../evals/samples.json', import.meta.url)
const evalFile = evalFileSchema.parse(JSON.parse(await readFile(evalUrl, 'utf8')) as unknown)

async function evaluateProvider(name: ScoringProviderName, data: EvalFile) {
  const provider = createScoringProvider({ ...process.env, SCORING_PROVIDER: name })
  const essays: EssayResult[] = []

  for (const essay of data.essays) {
    const annotations = await provider.score(
      essay.sentences.map((sentence, index) => ({ index, text: sentence.text })),
      { document: essay.sentences.map(({ text }) => text), signal: AbortSignal.timeout(120_000) },
    )
    const byIndex = new Map(annotations.map((annotation) => [annotation.index, annotation]))
    let correct = 0
    let dropped = 0

    essay.sentences.forEach((sentence, index) => {
      const annotation = byIndex.get(index)
      if (!annotation) {
        dropped += 1
        return
      }
      const predicted = annotation.cut_safety.value === 'cuttable' ? 'cut' : 'keep'
      if (predicted === sentence.label) {
        correct += 1
      }
    })

    essays.push({
      essay: essay.title,
      agreement: correct / essay.sentences.length,
      correct,
      total: essay.sentences.length,
      dropped,
    })
  }

  const correct = essays.reduce((total, essay) => total + essay.correct, 0)
  const total = essays.reduce((sum, essay) => sum + essay.total, 0)
  const dropped = essays.reduce((sum, essay) => sum + essay.dropped, 0)
  console.log(`\n${name.toUpperCase()}`)
  console.table(essays)
  console.log(`Agreement: ${(correct / total * 100).toFixed(1)}% (${correct}/${total}); dropped: ${dropped}`)
}

for (const provider of providers) {
  await evaluateProvider(provider, evalFile)
}
