import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions'

const enabled = process.env.BUILDER_OTEL_ENABLED !== 'false'

if (enabled && !globalThis.__builderOpenTelemetryStarted) {
  globalThis.__builderOpenTelemetryStarted = true

  const otlpEndpoint = stripTrailingSlash(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318'
  )

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'builder',
      [ATTR_SERVICE_NAMESPACE]: 'builder',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.1.0'
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${otlpEndpoint}/v1/metrics`
      }),
      exportIntervalMillis: numberFromEnv('BUILDER_OTEL_METRIC_EXPORT_INTERVAL_MS', 10_000)
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false
        }
      })
    ]
  })

  sdk.start()

  const shutdown = () => {
    sdk.shutdown()
      .catch((error) => {
        console.warn('[observability] OpenTelemetry shutdown failed:', error)
      })
      .finally(() => {
        process.exit(0)
      })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function numberFromEnv(key, fallback) {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}
