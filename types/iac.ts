import type {
  CollectorRun,
  InventoryEntity,
  InventoryInsight,
  InventoryRelation
} from './inventory'

export type IacEngine = 'opentofu' | 'terraform'
export type IacSourceKind = 'state-json' | 'plan-json' | 'workspace-cli'
export type IacSourceStatus = 'connected' | 'degraded' | 'disabled'
export type IacPlanRisk = 'low' | 'medium' | 'high'

export interface IacBackboneSource {
  id: string
  name: string
  kind: IacSourceKind
  engine: IacEngine
  status: IacSourceStatus
  mode: 'read_only' | 'write_capable'
  path?: string
  workspacePath?: string
  summary: string
  lastRun?: string
  error?: string
}

export interface IacResourceRef {
  id: string
  sourceId: string
  address: string
  type: string
  name: string
  provider: string
  nodeId?: string
}

export interface IacPlanChange {
  id: string
  sourceId: string
  address: string
  type: string
  provider: string
  actions: string[]
  risk: IacPlanRisk
  nodeId?: string
}

export interface IacBackboneSnapshot {
  generatedAt: string
  enabled: boolean
  sources: IacBackboneSource[]
  resources: IacResourceRef[]
  changes: IacPlanChange[]
  entities: InventoryEntity[]
  relations: InventoryRelation[]
  collectors: CollectorRun[]
  insights: InventoryInsight[]
}
