import type { ScoringProvider, ScoringProviderName } from '../../src/core/provider.js'
import { JevProvider } from './jev.js'
import { LLMProvider } from './llm.js'

type Environment = Record<string, string | undefined>

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) {
    throw new Error(`SCORING_CONFIGURATION:${name} is required for the selected scoring provider.`)
  }
  return value
}

export function configuredProviderName(environment: Environment = process.env): ScoringProviderName {
  const name = environment.SCORING_PROVIDER?.trim() || 'jev'
  if (name !== 'jev' && name !== 'llm') {
    throw new Error('SCORING_CONFIGURATION:SCORING_PROVIDER must be jev or llm.')
  }
  return name
}

export function createScoringProvider(environment: Environment = process.env): ScoringProvider {
  const name = configuredProviderName(environment)
  if (name === 'jev') {
    return new JevProvider({
      apiKey: required(environment, 'TYPESAFE_API_KEY'),
      model: environment.TYPESAFE_DEFAULT_MODEL?.trim() || 'jev-latest',
    })
  }

  const llmApiKey = environment.LLM_API_KEY?.trim() || environment.OPENAI_API_KEY?.trim()
  if (!llmApiKey) {
    throw new Error('SCORING_CONFIGURATION:LLM_API_KEY or OPENAI_API_KEY is required for the LLM provider.')
  }

  return new LLMProvider({
    apiKey: llmApiKey,
    model: required(environment, 'LLM_MODEL'),
    baseUrl: environment.LLM_BASE_URL?.trim()
      || environment.OPENAI_BASE_URL?.trim()
      || 'https://api.openai.com/v1',
  })
}
