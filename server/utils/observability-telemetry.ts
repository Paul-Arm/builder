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
const dockerContainerCpuPercent = meter.createObservableGauge('builder_docker_container_cpu_percent', {
  description: 'Latest Docker container CPU percentage reported by the Docker provider',
  unit: '%'
})
const dockerContainerMemoryUsageBytes = meter.createObservableGauge('builder_docker_container_memory_usage_bytes', {
  description: 'Latest Docker container memory usage reported by the Docker provider',
  unit: 'By'
})
const dockerContainerMemoryLimitBytes = meter.createObservableGauge('builder_docker_container_memory_limit_bytes', {
  description: 'Latest Docker container memory limit reported by the Docker provider',
  unit: 'By'
})
const dockerContainerNetworkRxBytes = meter.createObservableGauge('builder_docker_container_network_rx_bytes', {
  description: 'Latest Docker container network receive bytes reported by the Docker provider',
  unit: 'By'
})
const dockerContainerNetworkTxBytes = meter.createObservableGauge('builder_docker_container_network_tx_bytes', {
  description: 'Latest Docker container network transmit bytes reported by the Docker provider',
  unit: 'By'
})
const dockerContainerBlockReadBytes = meter.createObservableGauge('builder_docker_container_block_read_bytes', {
  description: 'Latest Docker container block read bytes reported by the Docker provider',
  unit: 'By'
})
const dockerContainerBlockWriteBytes = meter.createObservableGauge('builder_docker_container_block_write_bytes', {
  description: 'Latest Docker container block write bytes reported by the Docker provider',
  unit: 'By'
})

const logPath = process.env.BUILDER_LOG_PATH || join(process.cwd(), '.data', 'logs', 'builder.ndjson')
let dockerMetricSnapshots: DockerContainerMetricSnapshot[] = []

interface DockerContainerMetricSnapshot {
  provider: string
  targetId: string
  dockerContext: string
  containerId: string
  containerName: string
  project?: string
  service?: string
  environment?: string
  image?: string
  cpuPercent?: number
  memoryUsageBytes?: number
  memoryLimitBytes?: number
  networkRxBytes?: number
  networkTxBytes?: number
  blockReadBytes?: number
  blockWriteBytes?: number
}

for (const gauge of [
  {
    gauge: dockerContainerCpuPercent,
    value: (snapshot: DockerContainerMetricSnapshot) => snapshot.cpuPercent
  },
  {
    gauge: dockerContainerMemoryUsageBytes,
    value: (snapshot: DockerContainerMetricSnapshot) => snapshot.memoryUsageBytes
  },
  {
    gauge: dockerContainerMemoryLimitBytes,
    value: (snapshot: DockerContainerMetricSnapshot) => snapshot.memoryLimitBytes
  },
  {
    gauge: dockerContainerNetworkRxBytes,
    value: (snapshot: DockerContainerMetricSnapshot) => snapshot.networkRxBytes
  },
  {
    gauge: dockerContainerNetworkTxBytes,
    value: (snapshot: DockerContainerMetricSnapshot) => snapshot.networkTxBytes
  },
  {
    gauge: dockerContainerBlockReadBytes,
    value: (snapshot: DockerContainerMetricSnapshot) => snapshot.blockReadBytes
  },
  {
    gauge: dockerContainerBlockWriteBytes,
    value: (snapshot: DockerContainerMetricSnapshot) => snapshot.blockWriteBytes
  }
]) {
  gauge.gauge.addCallback((result) => {
    for (const snapshot of dockerMetricSnapshots) {
      const value = gauge.value(snapshot)
      if (value !== undefined) {
        result.observe(value, dockerMetricAttributes(snapshot))
      }
    }
  })
}

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

export function recordDockerContainerMetrics(input: {
  provider: string
  targetId: string
  dockerContext: string
  containers: Array<Omit<DockerContainerMetricSnapshot, 'provider' | 'targetId' | 'dockerContext'>>
}) {
  dockerMetricSnapshots = [
    ...dockerMetricSnapshots.filter((snapshot) => {
      return snapshot.provider !== input.provider || snapshot.targetId !== input.targetId
    }),
    ...input.containers.map((container) => ({
      ...container,
      provider: input.provider,
      targetId: input.targetId,
      dockerContext: input.dockerContext
    }))
  ]
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

function dockerMetricAttributes(snapshot: DockerContainerMetricSnapshot) {
  return cleanAttributes({
    provider: snapshot.provider,
    target: snapshot.targetId,
    dockerContext: snapshot.dockerContext,
    container: snapshot.containerName,
    containerId: snapshot.containerId,
    project: snapshot.project,
    service: snapshot.service,
    environment: snapshot.environment,
    image: snapshot.image
  })
}
