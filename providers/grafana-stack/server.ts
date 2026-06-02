import { createError } from 'h3'
import {
  getGrafanaConnectionStatus,
  readGrafanaSettings
} from '../../server/utils/observability-store'
import type {
  DeploymentActionRequest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'
import type { ProviderCollectResult, ProviderPlugin } from '../../server/providers/types'

const providerId = 'grafana-stack'
const collectorId = 'collector:grafana-stack:local'
const targetId = 'target:grafana-stack:local'

export const grafanaStackProvider: ProviderPlugin = {
  manifest: {
    id: providerId,
    displayName: 'Grafana Stack',
    version: '0.1.0',
    description: 'Local observability provider for Grafana, Loki, Tempo, Prometheus, and Alloy.',
    types: ['observability.logs', 'observability.traces', 'observability.metrics', 'observability.dashboards'],
    roles: ['observability.provider'],
    capabilities: [
      'logs.query',
      'logs.tail',
      'traces.query',
      'metrics.query',
      'dashboards.link'
    ],
    addOptions: [
      {
        id: 'grafana-dashboard',
        label: 'Grafana dashboard',
        description: 'Link a Grafana dashboard into the Builder sidebar.',
        type: 'observability.dashboard',
        capability: 'dashboards.link'
      }
    ],
    configSchema: {
      baseUrl: {
        type: 'string',
        title: 'Grafana URL',
        default: 'http://localhost:3300'
      }
    },
    secretSchema: {
      apiToken: {
        type: 'string',
        title: 'Grafana API token'
      }
    }
  },

  async collectRuntime() {
    return collectGrafanaRuntime()
  },

  async planAction(request) {
    throw unsupportedAction(request)
  },

  async executeAction(request) {
    throw unsupportedAction(request)
  }
}

async function collectGrafanaRuntime(): Promise<ProviderCollectResult> {
  const settings = await readGrafanaSettings()
  const status = await getGrafanaConnectionStatus(settings)
  const target: ProviderTargetScope = {
    id: targetId,
    name: settings.mode === 'local' ? 'Local Grafana stack' : 'External Grafana',
    kind: 'observability-stack',
    description: 'Grafana dashboards, logs, traces, and metrics',
    transport: {
      type: 'http-api',
      label: settings.baseUrl
    },
    labels: {
      provider: providerId,
      mode: settings.mode
    }
  }
  const connected = status.services.filter((service) => service.status === 'connected').length
  const degraded = status.services.filter((service) => service.status === 'degraded').length
  const observations: ProviderObservation[] = [
    ...status.services.map((service) => ({
      id: `observation:${providerId}:service:${service.id}`,
      providerId,
      collectorId,
      targetId,
      externalId: service.id,
      kind: 'observability-service',
      fingerprint: `${service.id}:${service.status}:${service.error || ''}`,
      observedAt: status.checkedAt,
      payload: { ...service }
    })),
    ...settings.slots.map((slot) => ({
      id: `observation:${providerId}:slot:${slot.id}`,
      providerId,
      collectorId,
      targetId,
      externalId: slot.id,
      kind: 'dashboard-slot',
      fingerprint: `${slot.id}:${slot.dashboardUid || 'empty'}:${slot.enabled}`,
      observedAt: status.checkedAt,
      payload: { ...slot }
    }))
  ]

  return {
    target,
    collector: {
      id: collectorId,
      providerId,
      targetId,
      mode: 'read_only',
      status: degraded ? 'degraded' : connected ? 'connected' : 'disabled',
      config: {
        mode: settings.mode,
        baseUrl: settings.baseUrl,
        dashboards: settings.slots.filter((slot) => slot.dashboardUid).length
      },
      lastRun: status.checkedAt,
      summary: `${connected} services connected, ${degraded} degraded`
    },
    deployments: [],
    observations
  }
}

function unsupportedAction(request: DeploymentActionRequest): never {
  throw createError({
    statusCode: 400,
    statusMessage: `Provider ${providerId} does not support deployment action ${request.action}`
  })
}
