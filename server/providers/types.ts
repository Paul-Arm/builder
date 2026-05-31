import type {
  DeploymentActionPlan,
  DeploymentActionRequest,
  DeploymentActionResult,
  ProviderCollectorInstance,
  ProviderDeploymentRef,
  ProviderManifest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'

export interface ProviderCollectResult {
  target: ProviderTargetScope
  collector: ProviderCollectorInstance
  deployments: ProviderDeploymentRef[]
  observations: ProviderObservation[]
}

export interface ProviderPlugin {
  manifest: ProviderManifest
  collectRuntime: () => Promise<ProviderCollectResult>
  planAction: (request: DeploymentActionRequest, deployments: ProviderDeploymentRef[]) => Promise<DeploymentActionPlan>
  executeAction: (request: DeploymentActionRequest, deployments: ProviderDeploymentRef[]) => Promise<DeploymentActionResult>
}
