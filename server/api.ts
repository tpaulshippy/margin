import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { scoringRequestSchema } from '../src/core/schema.js'
import { configuredProviderName, createScoringProvider } from './providers/index.js'

const maximumBodyBytes = 1_000_000

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximumBodyBytes) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function handleScore(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST')
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  let input: unknown
  try {
    input = await readJson(request)
  } catch {
    sendJson(response, 400, { error: 'Invalid JSON body.' })
    return
  }

  const parsed = scoringRequestSchema.safeParse(input)
  if (!parsed.success) {
    sendJson(response, 400, { error: 'Invalid scoring request.' })
    return
  }

  const abortController = new AbortController()
  request.once('aborted', () => abortController.abort())

  try {
    const provider = createScoringProvider()
    const annotations = await provider.score(parsed.data.sentences, {
      document: parsed.data.document,
      signal: abortController.signal,
    })
    sendJson(response, 200, { provider: provider.name, annotations })
  } catch (error) {
    if (abortController.signal.aborted) {
      return
    }
    const message = error instanceof Error && error.message.startsWith('SCORING_CONFIGURATION:')
      ? error.message
      : 'Scoring provider unavailable.'
    const status = message.startsWith('SCORING_CONFIGURATION:') ? 503 : 502
    sendJson(response, status, { error: message })
  }
}

function handleConfig(_request: IncomingMessage, response: ServerResponse): void {
  try {
    sendJson(response, 200, { provider: configuredProviderName() })
  } catch {
    sendJson(response, 503, { error: 'SCORING_CONFIGURATION:SCORING_PROVIDER must be jev or llm.' })
  }
}

export function scoringApiPlugin(): Plugin {
  const scoreMiddleware = (request: IncomingMessage, response: ServerResponse) => {
    void handleScore(request, response)
  }
  const configMiddleware = (request: IncomingMessage, response: ServerResponse) => {
    void handleConfig(request, response)
  }

  return {
    name: 'margin-scoring-api',
    configureServer(server) {
      server.middlewares.use('/api/score', scoreMiddleware)
      server.middlewares.use('/api/config', configMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/score', scoreMiddleware)
      server.middlewares.use('/api/config', configMiddleware)
    },
  }
}
