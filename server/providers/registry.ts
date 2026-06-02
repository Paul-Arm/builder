import { performance } from 'node:perf_hooks'
import { createError } from 'h3'
import type {
  DeploymentActionPlan,
  DeploymentActionRequest,
  DeploymentActionResult,
  ProviderRuntimeSnapshot
} from '~~/types/providers'
import { dockerCliProvider } from '../../providers/docker-cli/server'
import { grafanaStackProvider } from '../../providers/grafana-stack/server'
import { githubProvider } from '../../providers/github/server'
import { localFolderProvider } from '../../providers/local-folder/server'
import {
  recordProviderCollection
} from '../utils/observability-telemetry'
import type { ProviderCollectResult, ProviderPlugin } from './types'

const providers: ProviderPlugin[] = [
  githubProvider,
  localFolderProvider,
  dockerCliProvider,
  grafanaStackProvider
]

let runtimeCache:
  | {
    expiresAt: number
    snapshot: ProviderRuntimeSnapshot
  }
  | undefined

export function providerManifests() {
  return providers.map((provider) => provider.manifest)
}

export async function collectProviderRuntime(): Promise<ProviderRuntimeSnapshot> {
  if (runtimeCache && runtimeCache.expiresAt > Date.now()) {
    return runtimeCache.snapshot
  }

  const generatedAt = new Date().toISOString()
  const results = await Promise.all(providers.map(async (provider) => {
    const startedAt = performance.now()
    try {
      const result = await provider.collectRuntime()
      recordProviderCollection({
        provider: provider.manifest.id,
        status: result.collector.status,
        durationMs: performance.now() - startedAt,
        observations: result.observations.length
      })
      return result
    } catch (error) {
      recordProviderCollection({
        provider: provider.manifest.id,
        status: 'failed',
        durationMs: performance.now() - startedAt,
        observations: 0
      })
      throw error
    }
  }))

  const snapshot = {
    generatedAt,
    providers: providerManifests(),
    targets: results.map((result) => result.target),
    collectors: results.map((result) => result.collector),
    deployments: results.flatMap((result) => result.deployments),
    observations: results.flatMap((result) => result.observations),
    actionPlans: defaultActionPlans(results)
  }

  runtimeCache = {
    expiresAt: Date.now() + 2_000,
    snapshot
  }

  return snapshot
}

export async function planProviderAction(request: DeploymentActionRequest): Promise<DeploymentActionPlan> {
  const provider = providers.find((item) => item.manifest.id === request.providerId)
  if (!provider) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider not found'
    })
  }

  const runtime = await provider.collectRuntime()
  return provider.planAction(request, runtime.deployments)
}

export async function executeProviderAction(request: DeploymentActionRequest): Promise<DeploymentActionResult> {
  const provider = providers.find((item) => item.manifest.id === request.providerId)
  if (!provider) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Provider not found'
    })
  }

  const runtime = await provider.collectRuntime()
  return provider.executeAction(request, runtime.deployments)
}

function defaultActionPlans(results: ProviderCollectResult[]): DeploymentActionPlan[] {
  return results.flatMap((result) => {
    return result.deployments.map((deployment) => ({
      id: `action-plan:preview:${deployment.id}`,
      providerId: deployment.providerId,
      collectorId: deployment.collectorId,
      deploymentId: deployment.id,
      action: deployment.actions[0] || 'restart',
      targetLabel: deployment.name,
      command: [],
      mode: result.collector.mode,
      risk: deployment.status === 'running' ? 'medium' as const : 'low' as const,
      requiresConfirmation: true,
      summary: deployment.actions.length
        ? `${deployment.actions.join(' / ')} available`
        : 'No lifecycle action available',
      createdAt: result.collector.lastRun || new Date().toISOString(),
      executable: deployment.actions.length > 0
    }))
  })
}
