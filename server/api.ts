import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { scoringRequestSchema } from '../src/core/schema.js'
import { configuredProviderName, createScoringProvider } from './providers/index.js'

const maximumBodyBytes = 1_000_000
const scoreRequestLimit = 30
const scoreRequestWindowMs = 60_000

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

const scoreRateLimits = new Map<string, RateLimitEntry>()

function requestClientKey(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for']
  const forwardedAddress = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return forwardedAddress?.trim() || request.socket.remoteAddress || 'unknown'
}

function consumeScoreRequest(request: IncomingMessage, now = Date.now()): RateLimitResult {
  if (scoreRateLimits.size > 10_000) {
    for (const [key, entry] of scoreRateLimits) {
      if (entry.resetAt <= now) {
        scoreRateLimits.delete(key)
      }
    }
  }

  const key = requestClientKey(request)
  const current = scoreRateLimits.get(key)
  if (!current || current.resetAt <= now) {
    const resetAt = now + scoreRequestWindowMs
    scoreRateLimits.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: scoreRequestLimit - 1, resetAt, retryAfterSeconds: 0 }
  }
  if (current.count >= scoreRequestLimit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    }
  }

  current.count += 1
  return {
    allowed: true,
    remaining: scoreRequestLimit - current.count,
    resetAt: current.resetAt,
    retryAfterSeconds: 0,
  }
}

function setRateLimitHeaders(response: ServerResponse, result: RateLimitResult): void {
  response.setHeader('x-ratelimit-limit', String(scoreRequestLimit))
  response.setHeader('x-ratelimit-remaining', String(result.remaining))
  response.setHeader('x-ratelimit-reset', String(Math.ceil(result.resetAt / 1000)))
}

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

  const rateLimit = consumeScoreRequest(request)
  setRateLimitHeaders(response, rateLimit)
  if (!rateLimit.allowed) {
    response.setHeader('retry-after', String(rateLimit.retryAfterSeconds))
    sendJson(response, 429, { error: 'Too many scoring requests. Please try again later.' })
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
