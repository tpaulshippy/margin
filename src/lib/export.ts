import type { ScoringProviderName } from '../core/provider'
import type { SentenceAnnotation } from '../core/schema'

function formatField(value: string, confidence: number): string {
  return `- **${value}** — confidence \`${confidence.toFixed(2)}\``
}

export function buildMarkdownExport(
  sentences: readonly string[],
  annotations: readonly SentenceAnnotation[],
  provider: ScoringProviderName | 'unconfigured',
): string {
  const byIndex = new Map(annotations.map((annotation) => [annotation.index, annotation]))
  const sections = sentences.map((sentence, index) => {
    const annotation = byIndex.get(index)
    if (!annotation) {
      return `## Sentence ${index + 1}\n\n> ${sentence}\n\nNo valid score returned.`
    }
    const lines = [
      `## Sentence ${index + 1}`,
      '',
      `> ${sentence}`,
      '',
      `- **Role:** \`${annotation.role.value}\` — confidence \`${annotation.role.confidence.toFixed(2)}\``,
      `- **Cut safety:** \`${annotation.cut_safety.value}\` — confidence \`${annotation.cut_safety.confidence.toFixed(2)}\``,
      `- **Redundancy:** \`${annotation.redundancy.value}\` — confidence \`${annotation.redundancy.confidence.toFixed(2)}\``,
    ]
    if (annotation.redundancy.value === 'repeats') {
      lines.push(`- **Earlier sentence:** ${(annotation.redundancy.earlier_sentence_index ?? 0) + 1}`)
    }
    lines.push(
      `- **Support:** \`${annotation.support.value}\` — confidence \`${annotation.support.confidence.toFixed(2)}\``,
    )
    if (annotation.clarity.confidence > 0.8) {
      lines.push(formatField(`Clarity: ${annotation.clarity.value}`, annotation.clarity.confidence))
    }
    return lines.join('\n')
  })

  return [
    '# Margin annotations',
    '',
    `- Provider: \`${provider}\``,
    `- Sentence count: \`${sentences.length}\``,
    '',
    ...sections.flatMap((section) => [section, '']),
  ].join('\n')
}

export function buildJsonExport(
  sentences: readonly string[],
  annotations: readonly SentenceAnnotation[],
  provider: ScoringProviderName | 'unconfigured',
): string {
  const byIndex = new Map(annotations.map((annotation) => [annotation.index, annotation]))
  return JSON.stringify({
    version: 1,
    provider,
    exported_at: new Date().toISOString(),
    scores: sentences.map((text, index) => ({
      index,
      text,
      annotation: byIndex.get(index) ?? null,
    })),
  }, null, 2)
}
