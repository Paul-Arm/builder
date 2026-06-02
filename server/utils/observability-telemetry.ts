import { mkdir, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { metrics } from '@opentelemetry/api'

type AttributeValue = string | number | boolean
type LogLevel = 'info' | 'warning' | 'error'

const meter = metrics.getMeter('builder')
const apiRequests = meter.createCounter('builder_api_requests', {
  description: 'Builder server requests'
})
const apiRequestDuration = meter.createHistogram('builder_api_request_duration_ms', {
  description: 'Builder server request duration',
  unit: 'ms'
})
const dbFallbacks = meter.createCounter('builder_db_fallbacks', {
  description: 'Builder database fallback count'
})
const providerCollections = meter.createCounter('builder_provider_collections', {
  description: 'Provider collection runs'
})
const providerCollectDuration = meter.createHistogram('builder_provider_collect_duration_ms', {
  description: 'Provider collection duration',
  unit: 'ms'
})
const providerObservations = meter.createCounter('builder_provider_observations', {
  description: 'Provider observations returned'
})

const logPath = process.env.BUILDER_LOG_PATH || join(process.cwd(), '.data', 'logs', 'builder.ndjson')

export function recordApiRequest(input: {
  method: string
  route: string
  status: number
  durationMs: number
}) {
  const attributes = cleanAttributes({
    method: input.method,
    route: input.route,
    status: String(input.status)
  })

  apiRequests.add(1, attributes)
  apiRequestDuration.record(input.durationMs, attributes)
}

export function recordDbFallback(store: string) {
  dbFallbacks.add(1, cleanAttributes({ store }))
}

export function recordProviderCollection(input: {
  provider: string
  status: string
  durationMs: number
  observations: number
}) {
  const attributes = cleanAttributes({
    provider: input.provider,
    status: input.status
  })

  providerCollections.add(1, attributes)
  providerCollectDuration.record(input.durationMs, attributes)

  if (input.observations > 0) {
    providerObservations.add(input.observations, cleanAttributes({
      provider: input.provider
    }))
  }
}

export function logInfo(message: string, attributes?: Record<string, unknown>) {
  return writeStructuredLog('info', message, attributes)
}

export function logWarning(message: string, attributes?: Record<string, unknown>) {
  return writeStructuredLog('warning', message, attributes)
}

export function logError(message: string, attributes?: Record<string, unknown>) {
  return writeStructuredLog('error', message, attributes)
}

async function writeStructuredLog(
  level: LogLevel,
  message: string,
  attributes?: Record<string, unknown>
) {
  const line = `${JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service_name: 'builder',
    message,
    ...safeLogAttributes(attributes)
  })}\n`

  try {
    await mkdir(dirname(logPath), { recursive: true })
    await appendFile(logPath, line, 'utf8')
  } catch (error) {
    console.warn('[observability] Unable to write structured log:', error)
  }
}

function cleanAttributes(attributes: Record<string, AttributeValue | undefined>) {
  const cleaned: Record<string, AttributeValue> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== '') {
      cleaned[key] = value
    }
  }

  return cleaned
}

function safeLogAttributes(attributes?: Record<string, unknown>) {
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      safe[key] = value as string | number | boolean | null
    }
  }

  return safe
}
