export type ProviderRole = string
export type ProviderCapability = string
export type ProviderMode = 'read_only' | 'write_capable'
export type ProviderConnectionStatus = 'connected' | 'degraded' | 'disabled'
export type DeploymentRuntimeStatus = 'running' | 'stopped' | 'unknown'
export type DeploymentActionKind = 'start' | 'stop' | 'restart' | 'create'
export type DeploymentActionRisk = 'low' | 'medium' | 'high'

export interface ProviderManifest {
  id: string
  displayName: string
  version: string
  description: string
  roles: ProviderRole[]
  capabilities: ProviderCapability[]
  configSchema?: Record<string, unknown>
  secretSchema?: Record<string, unknown>
}

export interface ProviderTargetScope {
  id: string
  name: string
  kind: string
  description?: string
  transport: {
    type: string
    label: string
  }
  labels: Record<string, string>
}

export interface ProviderCollectorInstance {
  id: string
  providerId: string
  targetId: string
  mode: ProviderMode
  status: ProviderConnectionStatus
  config: Record<string, string | number | boolean | null>
  lastRun?: string
  summary: string
}

export interface ProviderObservation {
  id: string
  providerId: string
  collectorId: string
  targetId: string
  externalId: string
  kind: string
  fingerprint: string
  observedAt: string
  payload: Record<string, unknown>
}

export interface ProviderDeploymentRef {
  id: string
  providerId: string
  collectorId: string
  targetId: string
  externalId: string
  name: string
  service?: string
  project?: string
  environment?: string
  image?: string
  status: DeploymentRuntimeStatus
  ports: string[]
  labels: Record<string, string>
  actions: DeploymentActionKind[]
  observedAt: string
}

export interface DeploymentActionRequest {
  providerId: string
  collectorId: string
  deploymentId: string
  action: DeploymentActionKind
}

export interface DeploymentActionPlan {
  id: string
  providerId: string
  collectorId: string
  deploymentId: string
  action: DeploymentActionKind
  targetLabel: string
  command: string[]
  mode: ProviderMode
  risk: DeploymentActionRisk
  requiresConfirmation: boolean
  summary: string
  createdAt: string
  executable: boolean
}

export interface DeploymentActionResult {
  id: string
  providerId: string
  collectorId: string
  deploymentId: string
  action: DeploymentActionKind
  targetLabel: string
  command: string[]
  status: 'completed' | 'failed'
  stdout: string
  stderr: string
  executedAt: string
}

export interface ProviderRuntimeSnapshot {
  generatedAt: string
  providers: ProviderManifest[]
  targets: ProviderTargetScope[]
  collectors: ProviderCollectorInstance[]
  deployments: ProviderDeploymentRef[]
  observations: ProviderObservation[]
  actionPlans: DeploymentActionPlan[]
}
