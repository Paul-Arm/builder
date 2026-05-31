export type EntityKind =
  | 'project'
  | 'service'
  | 'host'
  | 'runtime'
  | 'container'
  | 'database'
  | 'storage'
  | 'queue'
  | 'repo'
  | 'domain'
  | 'cluster'
  | 'secret_store'

export type HealthStatus = 'healthy' | 'degraded' | 'unknown' | 'offline'
export type DeploymentStatus = 'active' | 'rolling' | 'failed' | 'paused'
export type CollectorStatus = 'connected' | 'degraded' | 'disabled'
export type CollectorMode = 'read_only' | 'write_capable'
export type InventoryMode = 'read_only' | 'mixed'

export interface InventoryEntity {
  id: string
  kind: EntityKind
  name: string
  provider: string
  platform: string
  environment?: string
  region?: string
  account?: string
  owner?: string
  health: HealthStatus
  description?: string
  tags: string[]
  externalId?: string
  confidence: number
  lastSeen?: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface InventoryRelation {
  id: string
  from: string
  to: string
  type:
    | 'owns'
    | 'runs_on'
    | 'deployed_as'
    | 'deployed_from'
    | 'uses'
    | 'publishes'
    | 'subscribes'
    | 'exposed_by'
    | 'managed_by'
    | 'contains'
    | 'secured_by'
  source: string
  confidence: number
  evidence?: string
}

export interface DeploymentEvent {
  id: string
  projectId: string
  serviceId: string
  environment: string
  targetId: string
  version: string
  status: DeploymentStatus
  branch?: string
  sourcePath?: string
  commit?: string
  actor: string
  deployedAt: string
  source: string
}

export interface CollectorRun {
  id: string
  name: string
  kind: 'docker' | 'orbstack' | 'bash' | 'terraform' | 'kubernetes' | 'git' | 'cloud'
  target: string
  status: CollectorStatus
  mode: CollectorMode
  lastRun?: string
  summary: string
}

export interface InventoryInsight {
  id: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  entityId?: string
  description: string
}

export interface InventoryDataset {
  generatedAt: string
  mode: InventoryMode
  source: 'seed' | 'surrealdb'
  entities: InventoryEntity[]
  relations: InventoryRelation[]
  deployments: DeploymentEvent[]
  collectors: CollectorRun[]
  insights: InventoryInsight[]
}
