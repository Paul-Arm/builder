import { createError } from 'h3'
import type {
  DeploymentActionPlan,
  DeploymentActionRequest,
  DeploymentActionResult,
  ProviderRuntimeSnapshot
} from '~~/types/providers'
import { dockerCliProvider } from './docker-cli'
import type { ProviderCollectResult, ProviderPlugin } from './types'

const providers: ProviderPlugin[] = [
  dockerCliProvider
]

export function providerManifests() {
  return providers.map((provider) => provider.manifest)
}

export async function collectProviderRuntime(): Promise<ProviderRuntimeSnapshot> {
  const generatedAt = new Date().toISOString()
  const results = await Promise.all(providers.map((provider) => provider.collectRuntime()))

  return {
    generatedAt,
    providers: providerManifests(),
    targets: results.map((result) => result.target),
    collectors: results.map((result) => result.collector),
    deployments: results.flatMap((result) => result.deployments),
    observations: results.flatMap((result) => result.observations),
    actionPlans: defaultActionPlans(results)
  }
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
