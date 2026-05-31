<script setup lang="ts">
import {
  BoxIcon,
  BoxesIcon,
  CloudIcon,
  DatabaseIcon,
  GitBranchIcon,
  GlobeIcon,
  HardDriveIcon,
  LockIcon,
  NetworkIcon,
  ServerIcon,
  WaypointsIcon
} from '@lucide/vue'
import type { Component, ComponentPublicInstance } from 'vue'
import type {
  DeploymentEvent,
  EntityKind,
  InventoryDataset,
  InventoryEntity,
  InventoryRelation
} from '~~/types/inventory'

type GraphKind = EntityKind | 'ci'
type GraphStage = 'source' | 'ci' | 'compute' | 'state' | 'edge'

interface GraphEntity extends Omit<InventoryEntity, 'kind'> {
  kind: GraphKind
  virtual?: boolean
}

interface GraphRelation extends Omit<InventoryRelation, 'type'> {
  type: InventoryRelation['type']
}

interface Lane {
  project: GraphEntity
  active: boolean
  stages: Record<GraphStage, GraphEntity[]>
}

interface DeploymentVariant {
  id: string
  environment: string
  status: DeploymentEvent['status']
  version: string
  branch?: string
  target: string
}

interface NodeChip {
  label: string
  tone: 'env' | 'shared' | 'branch'
}

type ConnectionTone = 'compute' | 'state' | 'event' | 'edge'

interface LaneConnectionSpec {
  key: string
  label: string
  fromKey: string
  toKey: string
  fromId: string
  toId: string
  type: GraphRelation['type']
  tone: ConnectionTone
}

interface RenderedConnection extends LaneConnectionSpec {
  path: string
  selected: boolean
  dimmed: boolean
}

interface LaneMetrics {
  width: number
  height: number
}

interface DependencyCard {
  key: string
  id: string
  kind: GraphKind
  name: string
  platform: string
  entity?: GraphEntity
  virtual?: boolean
  chips: NodeChip[]
  variants: DeploymentVariant[]
}

interface StageColumn {
  id: string
  label: string
  cards: DependencyCard[]
}

const props = defineProps<{
  inventory: InventoryDataset
  selectedId?: string
  selectedProjectId?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  selectProject: [id: string]
}>()

const stages: Array<{ id: GraphStage, label: string, sublabel: string }> = [
  { id: 'source', label: 'Source', sublabel: 'Repo / folder' },
  { id: 'ci', label: 'CI/CD', sublabel: 'Deploy actors' },
  { id: 'compute', label: 'Compute', sublabel: 'Services & targets' },
  { id: 'state', label: 'DB / State', sublabel: 'Data & secrets' },
  { id: 'edge', label: 'Ingress / Egress', sublabel: 'DNS & events' }
]

const kindIcons: Partial<Record<GraphKind, Component>> = {
  project: BoxesIcon,
  service: WaypointsIcon,
  host: ServerIcon,
  runtime: BoxIcon,
  container: BoxIcon,
  database: DatabaseIcon,
  storage: HardDriveIcon,
  queue: NetworkIcon,
  repo: GitBranchIcon,
  domain: GlobeIcon,
  cluster: CloudIcon,
  secret_store: LockIcon,
  ci: NetworkIcon
}

const stateKinds = new Set<GraphKind>(['database', 'storage', 'secret_store'])
const edgeKinds = new Set<GraphKind>(['domain', 'queue'])
const computeKinds = new Set<GraphKind>(['service', 'container', 'runtime', 'cluster', 'host'])
const connectionTones: ConnectionTone[] = ['compute', 'state', 'event', 'edge']
const laneEnvironments = ref<Record<string, string>>({})
const laneMetrics = ref<Record<string, LaneMetrics>>({})
const renderedConnections = ref<Record<string, RenderedConnection[]>>({})
const laneElements = new Map<string, HTMLElement>()
let resizeObserver: ResizeObserver | undefined
let layoutFrame = 0

const graphData = computed(() => createGraphData(props.inventory.entities, props.inventory.relations))
const entityById = computed(() => new Map(graphData.value.entities.map((entity) => [entity.id, entity])))

const lanes = computed(() => {
  const projects = graphData.value.entities
    .filter((entity) => entity.kind === 'project')
    .sort((a, b) => a.name.localeCompare(b.name))

  return projects
    .map((project) => createLane(project))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.project.name.localeCompare(b.project.name))
})

watch(
  () => [lanes.value, laneEnvironments.value, props.selectedId],
  () => {
    void nextTick().then(scheduleConnectionLayout)
  },
  { deep: true }
)

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleConnectionLayout())
    for (const element of laneElements.values()) {
      resizeObserver.observe(element)
    }
  }

  window.addEventListener('resize', scheduleConnectionLayout)
  scheduleConnectionLayout()
})

onBeforeUnmount(() => {
  if (layoutFrame) {
    window.cancelAnimationFrame(layoutFrame)
  }

  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleConnectionLayout)
})

function createLane(project: GraphEntity): Lane {
  const stageIds: Record<GraphStage, Set<string>> = {
    source: new Set(),
    ci: new Set(),
    compute: new Set(),
    state: new Set(),
    edge: new Set()
  }

  const serviceIds = relatedIds(project.id, 'owns', 'out')
  for (const serviceId of serviceIds) {
    addByKind(stageIds, serviceId)
    collectSourceForService(stageIds, serviceId)
    collectCiForService(stageIds, serviceId)
    collectServiceDependencies(stageIds, serviceId)
  }

  for (const deployment of props.inventory.deployments) {
    if (deployment.projectId !== project.id) {
      continue
    }

    addByKind(stageIds, deployment.serviceId)
    addByKind(stageIds, deployment.targetId)
    collectComputeInfrastructure(stageIds, deployment.targetId)
  }

  const stagesForLane = Object.fromEntries(
    stages.map((stage) => [
      stage.id,
      [...stageIds[stage.id]]
        .map((id) => entityById.value.get(id))
        .filter((entity): entity is GraphEntity => Boolean(entity))
        .sort(compareEntities)
    ])
  ) as Record<GraphStage, GraphEntity[]>

  return {
    project,
    active: project.id === props.selectedProjectId,
    stages: stagesForLane
  }
}

function collectSourceForService(stageIds: Record<GraphStage, Set<string>>, serviceId: string) {
  for (const relation of graphData.value.relations) {
    if (relation.type === 'contains' && relation.to === serviceId) {
      stageIds.source.add(relation.from)
    }
  }
}

function collectCiForService(stageIds: Record<GraphStage, Set<string>>, serviceId: string) {
  for (const relation of graphData.value.relations) {
    if (relation.type === 'deployed_as' && relation.to === serviceId) {
      stageIds.ci.add(relation.from)
    }
  }
}

function collectServiceDependencies(stageIds: Record<GraphStage, Set<string>>, serviceId: string) {
  for (const relation of graphData.value.relations) {
    if (relation.from === serviceId && [
      'runs_on',
      'deployed_as',
      'uses',
      'publishes',
      'subscribes',
      'secured_by'
    ].includes(relation.type)) {
      addByKind(stageIds, relation.to)
      collectComputeInfrastructure(stageIds, relation.to)
    }

    if (relation.to === serviceId && relation.type === 'exposed_by') {
      addByKind(stageIds, relation.from)
    }
  }
}

function collectComputeInfrastructure(stageIds: Record<GraphStage, Set<string>>, entityId: string) {
  const entity = entityById.value.get(entityId)
  if (!entity || !computeKinds.has(entity.kind)) {
    return
  }

  for (const relation of graphData.value.relations) {
    if (relation.from === entityId && ['runs_on', 'managed_by'].includes(relation.type)) {
      addByKind(stageIds, relation.to)
    }

    if (relation.to === entityId) {
      const upstream = entityById.value.get(relation.from)
      if (upstream?.kind === 'host' && relation.type === 'runs_on') {
        addByKind(stageIds, relation.from)
      }
    }
  }
}

function addByKind(stageIds: Record<GraphStage, Set<string>>, entityId: string) {
  const entity = entityById.value.get(entityId)
  if (!entity) {
    return
  }

  if (entity.kind === 'repo') {
    stageIds.source.add(entity.id)
    return
  }

  if (entity.kind === 'ci') {
    stageIds.ci.add(entity.id)
    return
  }

  if (computeKinds.has(entity.kind)) {
    stageIds.compute.add(entity.id)
    return
  }

  if (stateKinds.has(entity.kind)) {
    stageIds.state.add(entity.id)
    return
  }

  if (edgeKinds.has(entity.kind)) {
    stageIds.edge.add(entity.id)
  }
}

function relatedIds(id: string, type: InventoryRelation['type'], direction: 'in' | 'out') {
  return graphData.value.relations
    .filter((relation) => {
      return relation.type === type && (direction === 'out' ? relation.from === id : relation.to === id)
    })
    .map((relation) => direction === 'out' ? relation.to : relation.from)
}

function iconFor(kind: GraphKind) {
  return kindIcons[kind] || BoxesIcon
}

function nodeName(entity: GraphEntity) {
  if (entity.kind === 'repo') {
    if (entity.provider === 'local-folder') {
      const parts = entity.name.split(/[\\/]/).filter(Boolean)
      return `local: ${parts.at(-1) || entity.name}`
    }

    return entity.name.replace(/^github\.com\//, '')
  }

  return entity.name
}

function stageColumnsFor(lane: Lane, stageId: GraphStage): StageColumn[] {
  const environment = selectedEnvironmentFor(lane.project.id)

  if (stageId === 'source') {
    return [
      {
        id: 'source',
        label: 'Repo / Folder',
        cards: sourceComponentCardsFor(lane, environment)
      }
    ]
  }

  if (stageId === 'compute') {
    return [
      {
        id: 'service',
        label: 'Service',
        cards: serviceEntitiesFor(lane, environment)
          .map((entity) => entityCard(entity, lane.project.id, {}, environment))
      },
      {
        id: 'target',
        label: 'Target',
        cards: computeTargetEntitiesFor(lane, environment)
          .map((entity) => entityCard(entity, lane.project.id, {}, environment))
      }
    ]
  }

  if (stageId === 'state') {
    return [
      {
        id: 'server',
        label: 'Server',
        cards: stateBackendCardsFor(lane, environment)
      },
      {
        id: 'resource',
        label: 'Resource',
        cards: stateResourceEntitiesFor(lane, environment)
          .map((entity) => entityCard(entity, lane.project.id, {}, environment))
      }
    ]
  }

  if (stageId === 'edge') {
    return [
      {
        id: 'edge',
        label: 'Ingress / Events',
        cards: edgeEntitiesFor(lane, environment)
          .map((entity) => entityCard(entity, lane.project.id, {}, environment))
      }
    ]
  }

  return [
    {
      id: stageId,
      label: 'Pipeline',
      cards: lane.stages[stageId]
        .filter((entity) => pipelineEntityVisibleFor(entity, lane.project.id, environment))
        .map((entity) => entityCard(entity, lane.project.id, {}, environment))
    }
  ]
}

function entityCard(
  entity: GraphEntity,
  projectId: string,
  overrides: Partial<Omit<DependencyCard, 'entity'>> = {},
  environment = selectedEnvironmentFor(projectId)
): DependencyCard {
  return {
    key: overrides.key || `${projectId}:${entity.id}`,
    id: overrides.id || entity.id,
    kind: overrides.kind || entity.kind,
    name: overrides.name || nodeName(entity),
    platform: overrides.platform || entity.platform,
    entity,
    virtual: overrides.virtual ?? entity.virtual,
    chips: overrides.chips ?? nodeChipsFor(entity, projectId, environment),
    variants: overrides.variants ?? deploymentVariantsFor(entity, projectId, environment)
  }
}

function sourceComponentCardsFor(lane: Lane, environment: string): DependencyCard[] {
  const repoIds = new Set(sourceRepoEntitiesFor(lane, environment).map((entity) => entity.id))
  const serviceIds = serviceIdsFor(lane, environment)
  const cards = new Map<string, DependencyCard>()

  for (const card of graphData.value.relations
    .filter((relation) => relation.type === 'contains' && repoIds.has(relation.from) && serviceIds.has(relation.to))
    .map((relation) => {
      const service = entityById.value.get(relation.to)
      const repo = entityById.value.get(relation.from)
      if (!service || !repo) {
        return undefined
      }

      return entityCard(service, lane.project.id, {
        key: `${lane.project.id}:source-component:${relation.from}:${service.id}`,
        id: `source-component:${relation.from}:${service.id}`,
        name: nodeName(repo),
        platform: `${sourcePathFor(service)} / ${service.name}`,
        chips: environmentChipsFor(service, environment),
        variants: []
      }, environment)
    })
    .filter((card): card is DependencyCard => Boolean(card))) {
    cards.set(card.key, card)
  }

  for (const entity of sourceRepoEntitiesFor(lane, environment)) {
    const hasComponent = graphData.value.relations.some((relation) => {
      return relation.type === 'contains' && relation.from === entity.id && serviceIds.has(relation.to)
    })
    if (!hasComponent) {
      const card = entityCard(entity, lane.project.id, {}, environment)
      cards.set(card.key, card)
    }
  }

  return [...cards.values()].sort(compareCards)
}

function stateBackendCardsFor(lane: Lane, environment: string): DependencyCard[] {
  const cards = new Map<string, DependencyCard>()

  for (const resource of stateResourceEntitiesFor(lane, environment)) {
    const card = stateBackendCardFor(resource, lane.project.id, environment)
    if (!cards.has(card.id)) {
      cards.set(card.id, card)
    }
  }

  return [...cards.values()].sort(compareCards)
}

function stateBackendCardFor(resource: GraphEntity, projectId: string, environment: string): DependencyCard {
  const managerRelation = graphData.value.relations.find((relation) => {
    return relation.to === resource.id && relation.type === 'managed_by'
  })
  const manager = managerRelation ? entityById.value.get(managerRelation.from) : undefined

  if (manager) {
    return entityCard(manager, projectId, {
      key: `${projectId}:state-backend:${manager.id}`,
      variants: []
    }, environment)
  }

  const backendId = [
    'state-backend',
    resource.kind,
    resource.provider,
    resource.platform,
    resource.account || resource.region || resource.environment || resource.id
  ].join(':')

  return {
    key: `${projectId}:${backendId}`,
    id: backendId,
    kind: resource.kind,
    name: stateBackendName(resource),
    platform: stateBackendPlatform(resource),
    virtual: true,
    chips: environmentChipsFor(resource, environment),
    variants: []
  }
}

function sourcePathFor(entity: GraphEntity) {
  const sourcePath = entity.metadata?.sourcePath
  return typeof sourcePath === 'string' ? sourcePath : entity.platform
}

function stateBackendName(entity: GraphEntity) {
  if (entity.kind === 'database') {
    return `${providerName(entity.provider)} ${databaseServerName(entity.platform)}`
  }

  if (entity.kind === 'storage') {
    return `${providerName(entity.provider)} ${entity.platform.toUpperCase()}`
  }

  if (entity.kind === 'secret_store') {
    return `${providerName(entity.provider)} ${titleCase(entity.platform)}`
  }

  return `${providerName(entity.provider)} ${entity.platform}`
}

function stateBackendPlatform(entity: GraphEntity) {
  return [
    entity.account,
    entity.region,
    entity.environment
  ].filter(Boolean).join(' / ') || entity.provider
}

function databaseServerName(platform: string) {
  return platform
    .split(/[-_]/)
    .map((part) => part.toUpperCase() === 'RDS' ? 'RDS' : titleCase(part))
    .join(' ')
}

function providerName(provider: string) {
  return provider.toUpperCase() === 'AWS' ? 'AWS' : titleCase(provider)
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function environmentChipsFor(entity: GraphEntity, environment = 'all'): NodeChip[] {
  return sortEnvironmentNames(environmentsFor(entity))
    .filter((item) => environment === 'all' || item === environment || localEnvironmentMatches(item, environment))
    .map((environment) => ({ label: environment, tone: 'env' }))
}

function selectedEnvironmentFor(projectId: string) {
  return laneEnvironments.value[projectId] || 'all'
}

function setLaneEnvironment(projectId: string, environment: string) {
  laneEnvironments.value = {
    ...laneEnvironments.value,
    [projectId]: environment
  }
}

function environmentOptionsFor(projectId: string) {
  const project = entityById.value.get(projectId)
  const environments = new Set<string>()

  if (project) {
    for (const environment of metadataEnvironmentNames(project)) {
      environments.add(environment)
    }
  }

  for (const deployment of props.inventory.deployments) {
    if (deployment.projectId === projectId) {
      environments.add(deployment.environment)
    }
  }

  for (const entityId of projectOwnedEntityIds(projectId)) {
    const entity = entityById.value.get(entityId)
    if (entity?.environment) {
      environments.add(entity.environment)
    }
  }

  return [
    { label: 'All', value: 'all' },
    ...sortEnvironmentNames([...environments]).map((environment) => ({
      label: environment,
      value: environment
    }))
  ]
}

function projectDeploymentsFor(projectId: string, environment: string) {
  return props.inventory.deployments.filter((deployment) => {
    return deployment.projectId === projectId
      && (environment === 'all' || deployment.environment === environment)
  })
}

function serviceIdsFor(lane: Lane, environment: string) {
  const serviceIds = new Set<string>()
  for (const entity of lane.stages.compute) {
    if (entity.kind === 'service' && (environment === 'all' || entityMatchesEnvironment(entity, environment))) {
      serviceIds.add(entity.id)
    }
  }

  for (const deployment of projectDeploymentsFor(lane.project.id, environment)) {
    serviceIds.add(deployment.serviceId)
  }

  return serviceIds
}

function serviceEntitiesFor(lane: Lane, environment: string) {
  const serviceIds = serviceIdsFor(lane, environment)
  return lane.stages.compute
    .filter((entity) => entity.kind === 'service' && serviceIds.has(entity.id))
}

function sourceRepoEntitiesFor(lane: Lane, environment: string) {
  if (environment === 'all') {
    return lane.stages.source
  }

  const serviceIds = serviceIdsFor(lane, environment)
  const repoIds = new Set(graphData.value.relations
    .filter((relation) => relation.type === 'contains' && serviceIds.has(relation.to))
    .map((relation) => relation.from))

  return lane.stages.source.filter((entity) => {
    return repoIds.has(entity.id) || entityMatchesEnvironment(entity, environment)
  })
}

function computeTargetEntitiesFor(lane: Lane, environment: string) {
  if (environment === 'all') {
    return lane.stages.compute.filter((entity) => entity.kind !== 'service')
  }

  const targetIds = new Set<string>()
  for (const deployment of projectDeploymentsFor(lane.project.id, environment)) {
    targetIds.add(deployment.targetId)
    collectInfrastructureIds(deployment.targetId, targetIds)
  }

  return lane.stages.compute.filter((entity) => {
    return entity.kind !== 'service' && (targetIds.has(entity.id) || entityMatchesEnvironment(entity, environment))
  })
}

function collectInfrastructureIds(entityId: string, ids: Set<string>, depth = 0) {
  if (depth > 4) {
    return
  }

  for (const relation of graphData.value.relations) {
    if (relation.from === entityId && ['runs_on', 'managed_by'].includes(relation.type)) {
      ids.add(relation.to)
      collectInfrastructureIds(relation.to, ids, depth + 1)
    }

    if (relation.to === entityId && relation.type === 'runs_on') {
      const upstream = entityById.value.get(relation.from)
      if (upstream?.kind === 'host') {
        ids.add(relation.from)
      }
    }
  }
}

function stateResourceEntitiesFor(lane: Lane, environment: string) {
  if (environment === 'all') {
    return lane.stages.state
  }

  const serviceIds = serviceIdsFor(lane, environment)
  const resourceIds = new Set(graphData.value.relations
    .filter((relation) => serviceIds.has(relation.from) && ['uses', 'secured_by'].includes(relation.type))
    .map((relation) => relation.to))

  return lane.stages.state.filter((entity) => {
    return (resourceIds.has(entity.id) || entityMatchesEnvironment(entity, environment))
      && entityMatchesEnvironment(entity, environment)
  })
}

function edgeEntitiesFor(lane: Lane, environment: string) {
  if (environment === 'all') {
    return lane.stages.edge
  }

  const serviceIds = serviceIdsFor(lane, environment)
  const edgeIds = new Set<string>()

  for (const relation of graphData.value.relations) {
    if (serviceIds.has(relation.from) && ['publishes', 'subscribes'].includes(relation.type)) {
      edgeIds.add(relation.to)
    }

    if (serviceIds.has(relation.to) && relation.type === 'exposed_by') {
      edgeIds.add(relation.from)
    }
  }

  return lane.stages.edge.filter((entity) => {
    return (edgeIds.has(entity.id) || entityMatchesEnvironment(entity, environment))
      && entityMatchesEnvironment(entity, environment)
  })
}

function pipelineEntityVisibleFor(entity: GraphEntity, projectId: string, environment: string) {
  if (environment === 'all') {
    return true
  }

  if (entity.kind === 'ci') {
    return projectDeploymentsFor(projectId, environment).some((deployment) => {
      return deployment.actor === entity.name && deployment.source === entity.provider
    })
  }

  return entityMatchesEnvironment(entity, environment)
}

function entityMatchesEnvironment(entity: GraphEntity, environment: string) {
  if (environment === 'all') {
    return true
  }

  if (entity.environment === environment) {
    return true
  }

  return localEnvironmentMatches(entity.environment, environment)
}

function localEnvironmentMatches(entityEnvironment: string | undefined, selectedEnvironment: string) {
  const normalized = selectedEnvironment.toLowerCase()
  return entityEnvironment === 'local'
    && (['dev', 'development', 'local'].includes(normalized) || normalized.startsWith('feature-'))
}

function relationVisibleForProject(relation: GraphRelation, projectId: string, environment: string) {
  const serviceId = serviceIdForRelation(relation)
  if (!serviceId || !serviceIdsForProject(projectId, environment).has(serviceId)) {
    return false
  }

  if (environment === 'all') {
    return true
  }

  const relatedEntityId = relation.from === serviceId ? relation.to : relation.from
  const relatedEntity = entityById.value.get(relatedEntityId)
  return !relatedEntity || relatedEntity.kind === 'service' || entityMatchesEnvironment(relatedEntity, environment)
}

function serviceIdsForProject(projectId: string, environment: string) {
  const ids = new Set<string>()

  if (environment !== 'all') {
    for (const deployment of projectDeploymentsFor(projectId, environment)) {
      ids.add(deployment.serviceId)
    }

    for (const entityId of projectOwnedEntityIds(projectId)) {
      const entity = entityById.value.get(entityId)
      if (entity?.kind === 'service' && entityMatchesEnvironment(entity, environment)) {
        ids.add(entity.id)
      }
    }

    return ids
  }

  for (const entityId of projectOwnedEntityIds(projectId)) {
    ids.add(entityId)
  }

  return ids
}

function projectOwnedEntityIds(projectId: string) {
  return graphData.value.relations
    .filter((relation) => relation.from === projectId && relation.type === 'owns')
    .map((relation) => relation.to)
}

function metadataEnvironmentNames(entity: GraphEntity) {
  const environments = entity.metadata?.environments
  if (typeof environments !== 'string') {
    return []
  }

  return environments
    .split(',')
    .map((environment) => environment.trim())
    .filter(Boolean)
}

function serviceIdForRelation(relation: GraphRelation) {
  const from = entityById.value.get(relation.from)
  const to = entityById.value.get(relation.to)

  if (from?.kind === 'service') {
    return relation.from
  }

  if (to?.kind === 'service') {
    return relation.to
  }

  return undefined
}

function connectionVerb(type: GraphRelation['type']) {
  const labels: Partial<Record<GraphRelation['type'], string>> = {
    uses: 'uses',
    publishes: 'publishes',
    subscribes: 'subscribes',
    secured_by: 'secured by',
    exposed_by: 'exposed by',
    managed_by: 'manages',
    runs_on: 'runs on',
    deployed_as: 'deployed as'
  }

  return labels[type] || type.replace('_', ' ')
}

function connectionToneFor(kind: GraphKind, type: GraphRelation['type']): ConnectionTone {
  if (type === 'publishes' || type === 'subscribes' || kind === 'queue') {
    return 'event'
  }

  if (type === 'exposed_by' || kind === 'domain') {
    return 'edge'
  }

  if (stateKinds.has(kind)) {
    return 'state'
  }

  return 'compute'
}

function laneConnectionSpecsFor(lane: Lane) {
  const projectId = lane.project.id
  const environment = selectedEnvironmentFor(projectId)
  const visibleCards = visibleCardsForLane(lane)
  const specs = new Map<string, LaneConnectionSpec>()

  for (const relation of graphData.value.relations) {
    const from = entityById.value.get(relation.from)
    const to = entityById.value.get(relation.to)
    if (!from || !to) {
      continue
    }

    if (relation.type === 'contains') {
      continue
    }

    if (!relationVisibleForProject(relation, projectId, environment)) {
      continue
    }

    if (relation.type === 'deployed_as') {
      addConnectionSpec(specs, visibleCards, {
        key: `${relation.id}:deploy`,
        label: `${nodeName(from)} ${connectionVerb(relation.type)} ${nodeName(to)}`,
        fromKey: `${projectId}:${from.id}`,
        toKey: `${projectId}:${to.id}`,
        fromId: from.id,
        toId: to.id,
        type: relation.type,
        tone: 'compute'
      })
      continue
    }

    if (relation.type === 'runs_on' && from.kind === 'service' && computeKinds.has(to.kind)) {
      addConnectionSpec(specs, visibleCards, {
        key: `${relation.id}:runtime`,
        label: `${nodeName(from)} runs on ${nodeName(to)}`,
        fromKey: `${projectId}:${from.id}`,
        toKey: `${projectId}:${to.id}`,
        fromId: from.id,
        toId: to.id,
        type: relation.type,
        tone: 'compute'
      })
      continue
    }

    if (['uses', 'publishes', 'subscribes', 'secured_by'].includes(relation.type) && from.kind === 'service') {
      addConnectionSpec(specs, visibleCards, {
        key: `${relation.id}:dependency`,
        label: `${nodeName(from)} ${connectionVerb(relation.type)} ${nodeName(to)}`,
        fromKey: `${projectId}:${from.id}`,
        toKey: `${projectId}:${to.id}`,
        fromId: from.id,
        toId: to.id,
        type: relation.type,
        tone: connectionToneFor(to.kind, relation.type)
      })
      continue
    }

    if (relation.type === 'exposed_by' && from.kind === 'domain' && to.kind === 'service') {
      addConnectionSpec(specs, visibleCards, {
        key: `${relation.id}:ingress`,
        label: `${nodeName(to)} exposed by ${nodeName(from)}`,
        fromKey: `${projectId}:${to.id}`,
        toKey: `${projectId}:${from.id}`,
        fromId: to.id,
        toId: from.id,
        type: relation.type,
        tone: 'edge'
      })
    }
  }

  for (const resource of stateResourceEntitiesFor(lane, environment)) {
    const backendCard = stateBackendCardFor(resource, projectId, environment)
    addConnectionSpec(specs, visibleCards, {
      key: `${projectId}:state-backend:${resource.id}`,
      label: `${backendCard.name} hosts ${nodeName(resource)}`,
      fromKey: backendCard.key,
      toKey: `${projectId}:${resource.id}`,
      fromId: backendCard.entity?.id || backendCard.id,
      toId: resource.id,
      type: 'managed_by',
      tone: 'state'
    })
  }

  return [...specs.values()].sort(compareLaneConnections)
}

function visibleCardsForLane(lane: Lane) {
  const cards = new Map<string, DependencyCard>()
  for (const stage of stages) {
    for (const column of stageColumnsFor(lane, stage.id)) {
      for (const card of column.cards) {
        cards.set(card.key, card)
      }
    }
  }

  return cards
}

function addConnectionSpec(
  specs: Map<string, LaneConnectionSpec>,
  visibleCards: Map<string, DependencyCard>,
  spec: LaneConnectionSpec
) {
  if (spec.fromKey === spec.toKey || !visibleCards.has(spec.fromKey) || !visibleCards.has(spec.toKey)) {
    return
  }

  specs.set(spec.key, spec)
}

function compareLaneConnections(a: LaneConnectionSpec, b: LaneConnectionSpec) {
  return connectionPriority(a.tone) - connectionPriority(b.tone)
    || a.fromKey.localeCompare(b.fromKey)
    || a.toKey.localeCompare(b.toKey)
}

function connectionPriority(tone: ConnectionTone) {
  const priorities: Record<ConnectionTone, number> = {
    state: 0,
    event: 1,
    edge: 2,
    compute: 3
  }

  return priorities[tone]
}

const serviceProjects = computed(() => {
  const map = new Map<string, Set<string>>()
  for (const relation of props.inventory.relations) {
    const from = props.inventory.entities.find((entity) => entity.id === relation.from)
    if (relation.type === 'owns' && from?.kind === 'project') {
      const projects = map.get(relation.to) || new Set<string>()
      projects.add(relation.from)
      map.set(relation.to, projects)
    }
  }
  return map
})

function environmentsFor(entity: GraphEntity) {
  const environments = new Set<string>()
  if (entity.environment) {
    environments.add(entity.environment)
  }

  for (const deployment of props.inventory.deployments) {
    if (deployment.projectId === entity.id || deployment.serviceId === entity.id || deployment.targetId === entity.id) {
      environments.add(deployment.environment)
    }
  }

  return [...environments]
}

function deploymentVariantsFor(entity: GraphEntity, projectId: string, environment = 'all'): DeploymentVariant[] {
  if (!['service', 'cluster', 'runtime', 'container', 'ci'].includes(entity.kind)) {
    return []
  }

  return props.inventory.deployments
    .filter((deployment) => {
      return deployment.projectId === projectId
        && (environment === 'all' || deployment.environment === environment)
    })
    .filter((deployment) => {
      if (entity.kind === 'service') {
        return deployment.serviceId === entity.id
      }

      if (entity.kind === 'ci') {
        return deployment.actor === entity.name && deployment.source === entity.provider
      }

      return deployment.targetId === entity.id
    })
    .map((deployment) => ({
      id: deployment.id,
      environment: deployment.environment,
      status: deployment.status,
      version: deployment.version,
      branch: deployment.branch,
      target: shortTargetName(deployment.targetId)
    }))
    .sort(compareDeploymentVariants)
}

function nodeChipsFor(entity: GraphEntity, projectId: string, environment = 'all'): NodeChip[] {
  const chips: NodeChip[] = []
  const hasDeploymentVariants = deploymentVariantsFor(entity, projectId, environment).length > 0

  if (!hasDeploymentVariants) {
    for (const envName of environmentsFor(entity)) {
      if (environment === 'all' || envName === environment || localEnvironmentMatches(envName, environment)) {
        chips.push({ label: envName, tone: 'env' })
      }
    }
  }

  if (projectCountFor(entity) > 1) {
    chips.push({ label: `shared x${projectCountFor(entity)}`, tone: 'shared' })
  }

  for (const branch of repoBranches(entity)) {
    chips.push({ label: branch, tone: 'branch' })
  }

  return chips
}

function projectCountFor(entity: GraphEntity) {
  if (!isInventoryKind(entity.kind) || !stateKinds.has(entity.kind) && entity.kind !== 'queue') {
    return 0
  }

  const projects = new Set<string>()
  for (const relation of props.inventory.relations) {
    if (relation.to !== entity.id) {
      continue
    }

    for (const projectId of serviceProjects.value.get(relation.from) || []) {
      projects.add(projectId)
    }
  }

  return projects.size
}

function repoBranches(entity: GraphEntity) {
  if (entity.kind !== 'repo') {
    return []
  }

  const branches = entity.metadata?.branches
  if (typeof branches !== 'string') {
    return []
  }

  const parts = branches.split(',').map((branch) => branch.trim()).filter(Boolean)
  const first = parts[0]
  return parts.length > 2 && first ? [first, `+${parts.length - 1}`] : parts
}

function shortTargetName(targetId: string) {
  const target = entityById.value.get(targetId)
  if (!target) {
    return targetId
  }

  return target.name
}

function variantSummary(variant: DeploymentVariant) {
  return [
    variant.version,
    variant.branch,
    variant.target
  ].filter(Boolean).join(' / ')
}

function compareDeploymentVariants(a: DeploymentVariant, b: DeploymentVariant) {
  return environmentRank(a.environment) - environmentRank(b.environment)
    || a.environment.localeCompare(b.environment)
    || a.version.localeCompare(b.version)
}

function environmentRank(environment: string) {
  const normalized = environment.toLowerCase()
  const order: Record<string, number> = {
    prod: 0,
    production: 0,
    staging: 10,
    stage: 10,
    dev: 20,
    development: 20,
    local: 30
  }

  if (normalized.startsWith('feature-')) {
    return 40
  }

  return order[normalized] ?? 50
}

function sortEnvironmentNames(values: string[]) {
  return [...values].sort((a, b) => environmentRank(a) - environmentRank(b) || a.localeCompare(b))
}

function createGraphData(entities: InventoryEntity[], relations: InventoryRelation[]) {
  const graphEntities: GraphEntity[] = entities.map((entity) => ({ ...entity }))
  const graphRelations: GraphRelation[] = relations.map((relation) => ({ ...relation }))
  const ids = new Set(graphEntities.map((entity) => entity.id))
  const containsByService = new Map<string, string[]>()

  for (const relation of props.inventory.relations) {
    if (relation.type !== 'contains') {
      continue
    }

    const repos = containsByService.get(relation.to) || []
    repos.push(relation.from)
    containsByService.set(relation.to, repos)
  }

  for (const deployment of props.inventory.deployments) {
    if (!ids.has(deployment.serviceId) && !ids.has(deployment.projectId)) {
      continue
    }

    const ciId = `ci:${deployment.source}:${deployment.actor}`
    if (!ids.has(ciId)) {
      graphEntities.push({
        id: ciId,
        kind: 'ci',
        name: deployment.actor,
        provider: deployment.source,
        platform: deployment.source,
        environment: deployment.environment,
        owner: 'Automation',
        health: deployment.status === 'failed' ? 'degraded' : 'healthy',
        tags: ['ci', deployment.source],
        confidence: 0.9,
        lastSeen: deployment.deployedAt,
        virtual: true
      })
      ids.add(ciId)
    }

    for (const repoId of containsByService.get(deployment.serviceId) || []) {
      if (ids.has(repoId)) {
        graphRelations.push({
          id: `virtual:${repoId}:deployed_from:${ciId}:${deployment.id}`,
          from: repoId,
          to: ciId,
          type: 'deployed_from',
          source: deployment.source,
          confidence: 0.9,
          evidence: deployment.commit
        })
      }
    }

    if (ids.has(deployment.serviceId)) {
      graphRelations.push({
        id: `virtual:${ciId}:deployed_as:${deployment.serviceId}:${deployment.id}`,
        from: ciId,
        to: deployment.serviceId,
        type: 'deployed_as',
        source: deployment.source,
        confidence: 0.9,
        evidence: deployment.commit
      })
    }
  }

  return {
    entities: graphEntities,
    relations: dedupeRelations(graphRelations)
  }
}

function dedupeRelations(relations: GraphRelation[]) {
  const seen = new Set<string>()
  const unique: GraphRelation[] = []

  for (const relation of relations) {
    const key = `${relation.from}:${relation.type}:${relation.to}:${relation.source}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(relation)
  }

  return unique
}

function isInventoryKind(kind: GraphKind): kind is EntityKind {
  return kind !== 'ci'
}

function compareEntities(a: GraphEntity, b: GraphEntity) {
  return kindPriority(a.kind) - kindPriority(b.kind) || a.name.localeCompare(b.name)
}

function compareCards(a: DependencyCard, b: DependencyCard) {
  return kindPriority(a.kind) - kindPriority(b.kind) || a.name.localeCompare(b.name)
}

function kindPriority(kind: GraphKind) {
  const priorities: Partial<Record<GraphKind, number>> = {
    repo: 0,
    ci: 0,
    service: 0,
    container: 1,
    runtime: 2,
    cluster: 3,
    host: 4,
    database: 0,
    storage: 1,
    secret_store: 2,
    domain: 0,
    queue: 1
  }

  return priorities[kind] ?? 10
}

function selectCard(card: DependencyCard) {
  if (card.entity && !card.virtual) {
    emit('select', card.entity.id)
  }
}

function isCardSelected(card: DependencyCard) {
  return Boolean(card.entity && props.selectedId === card.entity.id)
}

function selectProject(project: GraphEntity) {
  emit('selectProject', project.id)
}

function setLaneElement(projectId: string, element: ComponentPublicInstance | Element | null) {
  const previous = laneElements.get(projectId)

  if (!element) {
    if (previous) {
      resizeObserver?.unobserve(previous)
      laneElements.delete(projectId)
      scheduleConnectionLayout()
    }
    return
  }

  if (!(element instanceof HTMLElement) || previous === element) {
    return
  }

  if (previous) {
    resizeObserver?.unobserve(previous)
  }

  laneElements.set(projectId, element)
  resizeObserver?.observe(element)
  scheduleConnectionLayout()
}

function scheduleConnectionLayout() {
  if (typeof window === 'undefined') {
    return
  }

  if (layoutFrame) {
    window.cancelAnimationFrame(layoutFrame)
  }

  layoutFrame = window.requestAnimationFrame(() => {
    layoutFrame = 0
    updateConnectionLayout()
  })
}

function updateConnectionLayout() {
  const nextMetrics: Record<string, LaneMetrics> = {}
  const nextConnections: Record<string, RenderedConnection[]> = {}

  for (const lane of lanes.value) {
    const laneElement = laneElements.get(lane.project.id)
    if (!laneElement) {
      continue
    }

    const laneRect = laneElement.getBoundingClientRect()
    const cardElements = cardElementsFor(laneElement)

    nextMetrics[lane.project.id] = {
      width: laneRect.width,
      height: laneRect.height
    }

    nextConnections[lane.project.id] = laneConnectionSpecsFor(lane)
      .map((connection) => renderConnection(connection, laneRect, cardElements))
      .filter((connection): connection is RenderedConnection => Boolean(connection))
      .sort((a, b) => Number(a.selected) - Number(b.selected))
  }

  laneMetrics.value = nextMetrics
  renderedConnections.value = nextConnections
}

function cardElementsFor(laneElement: HTMLElement) {
  const elements = new Map<string, HTMLElement>()
  for (const element of laneElement.querySelectorAll<HTMLElement>('[data-card-key]')) {
    const key = element.dataset.cardKey
    if (key) {
      elements.set(key, element)
    }
  }

  return elements
}

function renderConnection(
  connection: LaneConnectionSpec,
  laneRect: DOMRect,
  cardElements: Map<string, HTMLElement>
): RenderedConnection | undefined {
  const fromElement = cardElements.get(connection.fromKey)
  const toElement = cardElements.get(connection.toKey)
  if (!fromElement || !toElement) {
    return undefined
  }

  const selected = Boolean(props.selectedId && [connection.fromId, connection.toId].includes(props.selectedId))

  return {
    ...connection,
    path: connectionPath(laneRect, fromElement.getBoundingClientRect(), toElement.getBoundingClientRect()),
    selected,
    dimmed: Boolean(props.selectedId && !selected)
  }
}

function connectionPath(laneRect: DOMRect, fromRect: DOMRect, toRect: DOMRect) {
  const fromCenterX = fromRect.left + fromRect.width / 2
  const toCenterX = toRect.left + toRect.width / 2
  const flowsRight = fromCenterX <= toCenterX
  const startX = flowsRight ? fromRect.right - laneRect.left - 1 : fromRect.left - laneRect.left + 1
  const endX = flowsRight ? toRect.left - laneRect.left + 1 : toRect.right - laneRect.left - 1
  const startY = fromRect.top - laneRect.top + fromRect.height / 2
  const endY = toRect.top - laneRect.top + toRect.height / 2
  const distance = Math.abs(endX - startX)
  const curve = Math.max(36, Math.min(160, distance * 0.42))
  const controlOffset = flowsRight ? curve : -curve

  return [
    'M',
    formatPathNumber(startX),
    formatPathNumber(startY),
    'C',
    formatPathNumber(startX + controlOffset),
    formatPathNumber(startY),
    formatPathNumber(endX - controlOffset),
    formatPathNumber(endY),
    formatPathNumber(endX),
    formatPathNumber(endY)
  ].join(' ')
}

function formatPathNumber(value: number) {
  return String(Math.round(value * 10) / 10)
}

function markerIdFor(projectId: string, tone: ConnectionTone) {
  return `dependency-arrow-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${tone}`
}
</script>

<template>
  <section class="topology-panel dependency-map" aria-label="Project dependency map">
    <div class="dependency-board">
      <div class="dependency-header">
        <div
          v-for="stage in stages"
          :key="stage.id"
          class="dependency-header-stage"
        >
          <strong>{{ stage.label }}</strong>
          <span>{{ stage.sublabel }}</span>
        </div>
      </div>

      <article
        v-for="lane in lanes"
        :key="lane.project.id"
        :ref="(element) => setLaneElement(lane.project.id, element)"
        class="dependency-lane"
        :class="{ active: lane.active }"
      >
        <svg
          v-if="laneMetrics[lane.project.id]"
          class="dependency-lines"
          :width="laneMetrics[lane.project.id]?.width || 0"
          :height="laneMetrics[lane.project.id]?.height || 0"
          :viewBox="`0 0 ${laneMetrics[lane.project.id]?.width || 0} ${laneMetrics[lane.project.id]?.height || 0}`"
          aria-hidden="true"
        >
          <defs>
            <marker
              v-for="tone in connectionTones"
              :id="markerIdFor(lane.project.id, tone)"
              :key="`${lane.project.id}:marker:${tone}`"
              :data-tone="tone"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>

          <path
            v-for="connection in renderedConnections[lane.project.id] || []"
            :key="connection.key"
            :d="connection.path"
            :class="{ selected: connection.selected, dimmed: connection.dimmed }"
            :data-tone="connection.tone"
            :data-type="connection.type"
            :marker-end="`url(#${markerIdFor(lane.project.id, connection.tone)})`"
          >
            <title>{{ connection.label }}</title>
          </path>
        </svg>

        <div class="dependency-lane-controls">
          <button
            type="button"
            class="dependency-lane-project"
            :class="{ selected: selectedProjectId === lane.project.id }"
            @click="selectProject(lane.project)"
          >
            <component :is="iconFor(lane.project.kind)" :size="13" stroke-width="2.2" />
            <strong>{{ lane.project.name }}</strong>
            <small>{{ lane.project.owner }}</small>
          </button>

          <USelect
            :model-value="selectedEnvironmentFor(lane.project.id)"
            :items="environmentOptionsFor(lane.project.id)"
            value-key="value"
            label-key="label"
            size="xs"
            variant="soft"
            color="neutral"
            class="dependency-lane-env"
            aria-label="Environment"
            @click.stop
            @update:model-value="setLaneEnvironment(lane.project.id, String($event))"
          />
        </div>

        <div
          v-for="stage in stages"
          :key="`${lane.project.id}:${stage.id}`"
          class="dependency-stage"
          :data-stage="stage.id"
          :data-column-count="stageColumnsFor(lane, stage.id).length"
        >
          <div class="dependency-stage-columns">
            <div
              v-for="column in stageColumnsFor(lane, stage.id)"
              :key="`${lane.project.id}:${stage.id}:${column.id}`"
              class="dependency-substage"
            >
              <span class="dependency-substage-label">{{ column.label }}</span>

              <button
                v-for="card in column.cards"
                :key="`${lane.project.id}:${stage.id}:${column.id}:${card.key}`"
                type="button"
                class="dependency-card"
                :class="{ selected: isCardSelected(card), virtual: card.virtual }"
                :data-card-key="card.key"
                :aria-disabled="card.virtual ? 'true' : undefined"
                @click="selectCard(card)"
              >
                <component :is="iconFor(card.kind)" :size="17" stroke-width="2" />
                <span>
                  <strong>{{ card.name }}</strong>
                  <small>{{ card.platform }}</small>
                  <span v-if="card.chips.length" class="node-meta">
                    <span
                      v-for="chip in card.chips"
                      :key="`${card.key}:chip:${chip.label}`"
                      :class="{
                        'node-env': chip.tone === 'env',
                        'node-shared': chip.tone === 'shared',
                        'node-branch': chip.tone === 'branch'
                      }"
                    >
                      {{ chip.label }}
                    </span>
                  </span>
                  <span
                    v-if="card.variants.length"
                    class="node-variants"
                  >
                    <span
                      v-for="variant in card.variants"
                      :key="`${card.key}:variant:${variant.id}`"
                      class="node-variant"
                      :data-status="variant.status"
                    >
                      <span class="node-variant-env">{{ variant.environment }}</span>
                      <span class="node-variant-copy">{{ variantSummary(variant) }}</span>
                    </span>
                  </span>
                </span>
              </button>

              <span v-if="!column.cards.length" class="dependency-empty">-</span>
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
