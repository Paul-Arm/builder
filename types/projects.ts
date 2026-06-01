import type { EntityKind, HealthStatus, InventoryEntity, InventoryRelation } from './inventory'

export interface ProjectWorkspace {
  generatedAt: string
  projects: InventoryEntity[]
  relations: InventoryRelation[]
  nodesByProject: Record<string, InventoryEntity[]>
  environmentsByProject: Record<string, string[]>
}

export interface CreateProjectRequest {
  name: string
  owner?: string
  platform?: string
  description?: string
  tags?: string[]
  environments?: string[]
}

export interface UpdateProjectRequest {
  name?: string
  owner?: string
  platform?: string
  description?: string
  health?: HealthStatus
  tags?: string[]
}

export interface CreateProjectNodeRequest {
  kind: Exclude<EntityKind, 'project'>
  name: string
  provider?: string
  platform?: string
  environment?: string
  owner?: string
  description?: string
  tags?: string[]
  externalId?: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface CreateProjectRelationRequest {
  from: string
  to: string
  type: InventoryRelation['type']
  evidence?: string
}

export interface CreateProjectEnvironmentRequest {
  name: string
}
