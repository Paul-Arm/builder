import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  CollectorRun,
  EntityKind,
  HealthStatus,
  InventoryDataset,
  InventoryEntity,
  InventoryInsight,
  InventoryRelation
} from '~~/types/inventory'
import type {
  IacBackboneSnapshot,
  IacBackboneSource,
  IacEngine,
  IacPlanChange,
  IacPlanRisk,
  IacResourceRef,
  IacSourceKind
} from '~~/types/iac'

const execFileAsync = promisify(execFile)

interface LoadedIacDocument {
  source: IacBackboneSource
  document?: TofuShowJson
}

interface NormalizedIacParts {
  resources: IacResourceRef[]
  changes: IacPlanChange[]
  entities: InventoryEntity[]
  relations: InventoryRelation[]
  insights: InventoryInsight[]
}

interface TofuShowJson {
  format_version?: string
  terraform_version?: string
  values?: TofuValuesRepresentation
  planned_values?: TofuValuesRepresentation
  resource_changes?: TofuResourceChange[]
}

interface TofuValuesRepresentation {
  root_module?: TofuModule
}

interface TofuModule {
  resources?: TofuResource[]
  child_modules?: TofuModule[]
}

interface TofuResource {
  address: string
  mode?: string
  type: string
  name?: string
  provider_name?: string
  values?: Record<string, unknown>
  depends_on?: string[]
}

interface TofuResourceChange {
  address: string
  mode?: string
  type: string
  name?: string
  provider_name?: string
  change?: {
    actions?: string[]
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  }
}

interface ResourceMapping {
  kind: EntityKind
  provider: string
  platform: string
  name: string
  health: HealthStatus
  environment?: string
  owner?: string
  region?: string
  account?: string
  externalId?: string
  tags: string[]
  metadata: Record<string, string | number | boolean | null>
}

const backboneCollectorId = 'collector:opentofu:backbone'

export async function applyIacBackbone(base: InventoryDataset): Promise<InventoryDataset> {
  const snapshot = await readIacBackbone(base)
  if (!snapshot.enabled || !hasConfiguredBackboneSource(snapshot)) {
    return base
  }

  return {
    ...base,
    generatedAt: new Date().toISOString(),
    collectors: mergeById(base.collectors, snapshot.collectors),
    entities: mergeById(base.entities, snapshot.entities),
    relations: mergeRelations(base.relations, snapshot.relations),
    insights: mergeById(base.insights, snapshot.insights)
  }
}

function hasConfiguredBackboneSource(snapshot: IacBackboneSnapshot) {
  return snapshot.sources.some((source) => source.id !== 'iac:opentofu:unconfigured')
}

export async function readIacBackbone(base?: InventoryDataset): Promise<IacBackboneSnapshot> {
  const generatedAt = new Date().toISOString()
  const enabled = booleanFromEnv('BUILDER_OPENTOFU_BACKBONE_ENABLED', true)
  if (!enabled) {
    return {
      generatedAt,
      enabled,
      sources: [],
      resources: [],
      changes: [],
      entities: [],
      relations: [],
      collectors: [],
      insights: []
    }
  }

  const documents = await loadConfiguredDocuments(generatedAt)
  const normalized = normalizeIacDocuments(documents, base, generatedAt)
  const collectors = collectorsFor(documents, generatedAt)

  return {
    generatedAt,
    enabled,
    sources: documents.map((item) => item.source),
    resources: normalized.resources,
    changes: normalized.changes,
    entities: normalized.entities,
    relations: normalized.relations,
    collectors,
    insights: normalized.insights
  }
}

async function loadConfiguredDocuments(generatedAt: string): Promise<LoadedIacDocument[]> {
  const documents: LoadedIacDocument[] = []

  for (const filePath of configuredPaths('BUILDER_OPENTOFU_STATE_JSON_PATHS', 'BUILDER_OPENTOFU_STATE_JSON')) {
    documents.push(await loadJsonDocument('state-json', filePath, generatedAt))
  }

  for (const filePath of configuredPaths('BUILDER_OPENTOFU_PLAN_JSON_PATHS', 'BUILDER_OPENTOFU_PLAN_JSON')) {
    documents.push(await loadJsonDocument('plan-json', filePath, generatedAt))
  }

  const cliEnabled = booleanFromEnv('BUILDER_OPENTOFU_CLI_ENABLED', false)
  for (const workspacePath of configuredPaths('BUILDER_OPENTOFU_WORKSPACES', 'BUILDER_IAC_WORKSPACES')) {
    documents.push(await loadWorkspaceDocument(workspacePath, cliEnabled, generatedAt))
  }

  if (!documents.length) {
    documents.push({
      source: {
        id: 'iac:opentofu:unconfigured',
        name: 'OpenTofu Backbone',
        kind: 'workspace-cli',
        engine: 'opentofu',
        status: 'disabled',
        mode: 'read_only',
        summary: 'No OpenTofu state, plan, or workspace sources configured',
        lastRun: generatedAt
      }
    })
  }

  return documents
}

async function loadJsonDocument(kind: IacSourceKind, filePath: string, generatedAt: string): Promise<LoadedIacDocument> {
  const absolutePath = resolve(filePath)
  const source = sourceFor(kind, absolutePath, generatedAt)

  try {
    const raw = await readFile(absolutePath, 'utf8')
    const parsed = JSON.parse(raw) as TofuShowJson
    const resourceCount = collectResources(parsed).length
    const changeCount = parsed.resource_changes?.length || 0

    return {
      source: {
        ...source,
        status: 'connected',
        summary: summaryFor(kind, resourceCount, changeCount)
      },
      document: parsed
    }
  } catch (error) {
    return {
      source: {
        ...source,
        status: 'degraded',
        summary: `${source.name} could not be read`,
        error: errorMessage(error)
      }
    }
  }
}

async function loadWorkspaceDocument(
  workspacePath: string,
  cliEnabled: boolean,
  generatedAt: string
): Promise<LoadedIacDocument> {
  const absolutePath = resolve(workspacePath)
  const source = sourceFor('workspace-cli', absolutePath, generatedAt)

  if (!cliEnabled) {
    return {
      source: {
        ...source,
        status: 'disabled',
        workspacePath: absolutePath,
        summary: 'Workspace configured, but OpenTofu CLI execution is disabled'
      }
    }
  }

  try {
    const workspaceStat = await stat(absolutePath)
    if (!workspaceStat.isDirectory()) {
      throw new Error('Workspace path is not a directory')
    }

    const binary = stringFromEnv('BUILDER_OPENTOFU_BINARY', 'tofu')
    const { stdout } = await execFileAsync(binary, [`-chdir=${absolutePath}`, 'show', '-json'], {
      timeout: numberFromEnv('BUILDER_OPENTOFU_CLI_TIMEOUT_MS', 15_000),
      windowsHide: true,
      maxBuffer: numberFromEnv('BUILDER_OPENTOFU_CLI_MAX_BUFFER_MB', 20) * 1024 * 1024
    })
    const parsed = JSON.parse(stdout) as TofuShowJson
    const resourceCount = collectResources(parsed).length

    return {
      source: {
        ...source,
        status: 'connected',
        workspacePath: absolutePath,
        summary: `Workspace state read through ${binary}: ${resourceCount} resources`
      },
      document: parsed
    }
  } catch (error) {
    return {
      source: {
        ...source,
        status: 'degraded',
        workspacePath: absolutePath,
        summary: `${basename(absolutePath)} workspace could not be read`,
        error: errorMessage(error)
      }
    }
  }
}

function normalizeIacDocuments(
  documents: LoadedIacDocument[],
  base: InventoryDataset | undefined,
  observedAt: string
): NormalizedIacParts {
  const resources: IacResourceRef[] = []
  const changes: IacPlanChange[] = []
  const entities: InventoryEntity[] = []
  const relations: InventoryRelation[] = []
  const insights: InventoryInsight[] = []
  const nodeByAddress = new Map<string, InventoryEntity>()
  const projectAndServiceIndex = buildProjectAndServiceIndex(base)

  for (const { source, document } of documents) {
    if (!document) {
      if (source.status === 'degraded') {
        insights.push({
          id: `insight:${source.id}:degraded`,
          severity: 'warning',
          title: `${source.name} is degraded`,
          description: source.error || source.summary
        })
      }
      continue
    }

    for (const resource of collectResources(document)) {
      if (resource.mode && resource.mode !== 'managed') {
        continue
      }

      const mapping = mapResource(resource, source)
      const nodeId = entityIdFor(mapping.kind, source.id, resource.address, mapping.name)
      const entity: InventoryEntity = {
        id: nodeId,
        kind: mapping.kind,
        name: mapping.name,
        provider: mapping.provider,
        platform: mapping.platform,
        environment: mapping.environment,
        region: mapping.region,
        account: mapping.account,
        owner: mapping.owner,
        health: mapping.health,
        description: `${resource.type} managed by ${source.engine}`,
        tags: mapping.tags,
        externalId: mapping.externalId,
        confidence: 0.94,
        lastSeen: observedAt,
        metadata: mapping.metadata
      }

      entities.push(entity)
      nodeByAddress.set(resource.address, entity)
      resources.push({
        id: `iac-resource:${shortHash(`${source.id}:${resource.address}`)}`,
        sourceId: source.id,
        address: resource.address,
        type: resource.type,
        name: resource.name || mapping.name,
        provider: mapping.provider,
        nodeId
      })

      relations.push(...relationsFromBuilderTags(entity, resource.values || {}, projectAndServiceIndex, source.engine))
    }

    for (const change of document.resource_changes || []) {
      const actions = change.change?.actions || []
      if (!actions.length || actions.includes('no-op')) {
        continue
      }

      const existingNode = nodeByAddress.get(change.address)
      const risk = riskForActions(actions)
      const planChange: IacPlanChange = {
        id: `iac-change:${shortHash(`${source.id}:${change.address}:${actions.join('.')}`)}`,
        sourceId: source.id,
        address: change.address,
        type: change.type,
        provider: providerForResource(change),
        actions,
        risk,
        nodeId: existingNode?.id
      }
      changes.push(planChange)

      insights.push({
        id: `insight:${planChange.id}`,
        severity: risk === 'high' ? 'critical' : risk === 'medium' ? 'warning' : 'info',
        title: `${source.engine} plan: ${actions.join('/')} ${change.type}`,
        entityId: existingNode?.id,
        description: `${change.address} has pending ${actions.join(', ')} action(s) in ${source.name}.`
      })
    }
  }

  for (const { document, source } of documents) {
    if (!document) {
      continue
    }

    for (const resource of collectResources(document)) {
      const entity = nodeByAddress.get(resource.address)
      if (!entity) {
        continue
      }

      for (const dependencyAddress of resource.depends_on || []) {
        const dependency = nodeByAddress.get(dependencyAddress)
        if (!dependency) {
          continue
        }

        relations.push(...dependencyRelations(dependency, entity, source.engine))
      }
    }
  }

  return {
    resources,
    changes,
    entities: dedupeById(entities),
    relations: mergeRelations([], relations),
    insights: dedupeById(insights)
  }
}

function collectResources(document: TofuShowJson): TofuResource[] {
  const root = document.values?.root_module || document.planned_values?.root_module
  return collectModuleResources(root)
}

function collectModuleResources(module?: TofuModule): TofuResource[] {
  if (!module) {
    return []
  }

  return [
    ...(module.resources || []),
    ...(module.child_modules || []).flatMap(collectModuleResources)
  ]
}

function mapResource(resource: TofuResource, source: IacBackboneSource): ResourceMapping {
  const values = resource.values || {}
  const provider = providerForResource(resource)
  const tags = tagMapFromValues(values)
  const kind = kindForResourceType(resource.type)
  const name = nameForResource(resource, values)
  const environment = environmentFrom(tags, values) || environmentFromName(name)
  const owner = stringFromTags(tags, ['builder.owner', 'owner', 'team'])
  const region = stringFromValues(values, ['region', 'location'])
  const account = stringFromValues(values, [
    'account_id',
    'subscription_id',
    'tenant_id',
    'project',
    'resource_group_name'
  ])
  const metadata = metadataForResource(resource, source, values)

  return {
    kind,
    provider,
    platform: resource.type,
    name,
    health: healthForResource(values),
    environment,
    owner,
    region,
    account,
    externalId: stringFromValues(values, ['id', 'arn', 'resource_id']),
    tags: Array.from(new Set([
      'iac',
      source.engine,
      provider,
      resource.type,
      ...Object.entries(tags).map(([key, value]) => `${key}:${value}`)
    ])).slice(0, 24),
    metadata
  }
}

function kindForResourceType(type: string): EntityKind {
  if ([
    'azurerm_postgresql_flexible_server',
    'azurerm_postgresql_server',
    'azurerm_mssql_server',
    'azurerm_mysql_flexible_server',
    'aws_db_instance',
    'aws_rds_cluster',
    'google_sql_database_instance',
    'neon_project'
  ].includes(type)) {
    return 'database_server'
  }

  if ([
    'azurerm_postgresql_flexible_server_database',
    'azurerm_postgresql_database',
    'azurerm_mssql_database',
    'azurerm_mysql_flexible_database',
    'aws_rds_cluster_instance',
    'google_sql_database',
    'postgresql_database',
    'neon_database',
    'planetscale_database',
    'planetscale_branch'
  ].includes(type)) {
    return 'database'
  }

  if ([
    'azurerm_linux_function_app',
    'azurerm_windows_function_app',
    'azurerm_function_app',
    'aws_lambda_function',
    'google_cloudfunctions_function',
    'google_cloudfunctions2_function'
  ].includes(type)) {
    return 'function'
  }

  if ([
    'azurerm_kubernetes_cluster',
    'aws_eks_cluster',
    'google_container_cluster',
    'kubernetes_cluster'
  ].includes(type)) {
    return 'cluster'
  }

  if (type === 'kubernetes_namespace') {
    return 'namespace'
  }

  if ([
    'docker_container',
    'kubernetes_pod'
  ].includes(type)) {
    return 'container'
  }

  if ([
    'azurerm_linux_virtual_machine',
    'azurerm_windows_virtual_machine',
    'aws_instance',
    'google_compute_instance',
    'digitalocean_droplet'
  ].includes(type)) {
    return 'host'
  }

  if ([
    'aws_s3_bucket',
    'azurerm_storage_account',
    'azurerm_storage_container',
    'google_storage_bucket'
  ].includes(type)) {
    return 'storage'
  }

  if ([
    'aws_sqs_queue',
    'azurerm_servicebus_queue',
    'google_pubsub_topic',
    'rabbitmq_queue'
  ].includes(type)) {
    return 'queue'
  }

  if ([
    'github_repository',
    'gitlab_project'
  ].includes(type)) {
    return 'repo'
  }

  if (
    type.includes('dns')
    || type.includes('route53_record')
    || type.includes('cloudflare_record')
    || type.endsWith('_domain')
  ) {
    return 'domain'
  }

  if ([
    'azurerm_key_vault',
    'aws_secretsmanager_secret',
    'google_secret_manager_secret',
    'vault_mount',
    'vault_kv_secret_v2'
  ].includes(type)) {
    return 'secret_store'
  }

  if (type.includes('app_service') || type.includes('web_app') || type.includes('container_app')) {
    return 'service'
  }

  return 'external_service'
}

function dependencyRelations(
  dependency: InventoryEntity,
  entity: InventoryEntity,
  source: IacEngine
): InventoryRelation[] {
  if (dependency.kind === 'database_server' && entity.kind === 'database') {
    return [
      relation(dependency.id, entity.id, 'managed_by', source, 'OpenTofu dependency'),
      relation(dependency.id, entity.id, 'contains', source, 'OpenTofu dependency')
    ]
  }

  if (dependency.kind === 'cluster' && entity.kind === 'namespace') {
    return [relation(dependency.id, entity.id, 'contains', source, 'OpenTofu dependency')]
  }

  if (['host', 'runtime', 'cluster'].includes(dependency.kind) && ['service', 'function', 'container'].includes(entity.kind)) {
    return [relation(entity.id, dependency.id, 'runs_on', source, 'OpenTofu dependency')]
  }

  return [relation(entity.id, dependency.id, 'uses', source, 'OpenTofu dependency')]
}

function relationsFromBuilderTags(
  entity: InventoryEntity,
  values: Record<string, unknown>,
  index: ReturnType<typeof buildProjectAndServiceIndex>,
  source: IacEngine
): InventoryRelation[] {
  const tags = tagMapFromValues(values)
  const relations: InventoryRelation[] = []
  const projectName = stringFromTags(tags, ['builder.project', 'project'])
  const serviceName = stringFromTags(tags, ['builder.service', 'service', 'app'])
  const project = projectName ? index.projects.get(slugify(projectName)) : undefined
  const service = serviceName ? index.services.get(slugify(serviceName)) : undefined

  if (project) {
    relations.push(relation(project.id, entity.id, 'owns', source, `OpenTofu tag project=${projectName}`))
  }

  if (service) {
    if (['database', 'storage', 'queue', 'secret_store', 'external_service'].includes(entity.kind)) {
      relations.push(relation(service.id, entity.id, 'uses', source, `OpenTofu tag service=${serviceName}`))
    } else if (['container', 'function'].includes(entity.kind)) {
      relations.push(relation(service.id, entity.id, 'deployed_as', source, `OpenTofu tag service=${serviceName}`))
    } else if (['cluster', 'runtime', 'host', 'namespace'].includes(entity.kind)) {
      relations.push(relation(service.id, entity.id, 'runs_on', source, `OpenTofu tag service=${serviceName}`))
    }
  }

  return relations
}

function collectorsFor(documents: LoadedIacDocument[], generatedAt: string): CollectorRun[] {
  if (!documents.length) {
    return []
  }

  return documents.map((item) => ({
    id: item.source.id === 'iac:opentofu:unconfigured' ? backboneCollectorId : `collector:${item.source.id}`,
    name: item.source.name,
    kind: 'opentofu',
    target: item.source.workspacePath || item.source.path || item.source.id,
    status: item.source.status === 'connected'
      ? 'connected'
      : item.source.status === 'disabled'
        ? 'disabled'
        : 'degraded',
    mode: 'read_only',
    lastRun: item.source.lastRun || generatedAt,
    summary: item.source.summary
  }))
}

function sourceFor(kind: IacSourceKind, absolutePath: string, generatedAt: string): IacBackboneSource {
  const engine = kind === 'workspace-cli' ? engineFromEnv() : engineFromPath(absolutePath)
  return {
    id: `iac:${engine}:${kind}:${shortHash(absolutePath)}`,
    name: `${engine === 'opentofu' ? 'OpenTofu' : 'Terraform'} ${sourceKindLabel(kind)} ${basename(absolutePath)}`,
    kind,
    engine,
    status: 'disabled',
    mode: 'read_only',
    path: kind === 'workspace-cli' ? undefined : absolutePath,
    workspacePath: kind === 'workspace-cli' ? absolutePath : undefined,
    summary: 'Not read yet',
    lastRun: generatedAt
  }
}

function providerForResource(resource: Pick<TofuResource, 'type' | 'provider_name'>) {
  const fromProviderName = resource.provider_name?.split('/').filter(Boolean).at(-1)
  const raw = fromProviderName || resource.type.split('_')[0] || 'iac'
  const aliases: Record<string, string> = {
    azurerm: 'azure',
    azuread: 'azure',
    google: 'gcp',
    kubernetes: 'kubernetes',
    postgresql: 'postgres',
    planetscale: 'planetscale',
    neon: 'neon'
  }

  return aliases[raw] || raw
}

function nameForResource(resource: TofuResource, values: Record<string, unknown>) {
  const explicitName = stringFromValues(values, [
    'name',
    'display_name',
    'server_name',
    'database_name',
    'bucket',
    'domain',
    'hostname',
    'repository',
    'full_name',
    'app_name',
    'account_name'
  ])

  return explicitName || resource.name || resource.address.split('.').at(-1) || resource.address
}

function metadataForResource(
  resource: TofuResource,
  source: IacBackboneSource,
  values: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  const metadata: Record<string, string | number | boolean | null> = {
    iacEngine: source.engine,
    iacSourceId: source.id,
    iacSourceKind: source.kind,
    iacAddress: resource.address,
    iacResourceType: resource.type,
    iacProvider: providerForResource(resource)
  }

  for (const key of [
    'id',
    'arn',
    'resource_id',
    'name',
    'location',
    'region',
    'resource_group_name',
    'server_name',
    'database_name',
    'namespace',
    'endpoint',
    'fqdn',
    'url',
    'repository',
    'full_name',
    'project',
    'subscription_id',
    'account_id'
  ]) {
    const value = values[key]
    if (isMetadataValue(value)) {
      metadata[key] = typeof value === 'string' ? value.slice(0, 240) : value
    }
  }

  return metadata
}

function tagMapFromValues(values: Record<string, unknown>) {
  const tags: Record<string, string> = {}
  for (const key of ['tags', 'labels', 'metadata']) {
    const value = values[key]
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }

    for (const [tagKey, tagValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof tagValue === 'string' || typeof tagValue === 'number' || typeof tagValue === 'boolean') {
        tags[tagKey] = String(tagValue)
      }
    }
  }

  return tags
}

function buildProjectAndServiceIndex(base?: InventoryDataset) {
  const projects = new Map<string, InventoryEntity>()
  const services = new Map<string, InventoryEntity>()

  for (const entity of base?.entities || []) {
    if (entity.kind === 'project') {
      projects.set(slugify(entity.name), entity)
      projects.set(slugify(entity.id.replace(/^project:/, '')), entity)
    }

    if (entity.kind === 'service') {
      services.set(slugify(entity.name), entity)
      services.set(slugify(entity.id.replace(/^service:/, '')), entity)
    }
  }

  return { projects, services }
}

function healthForResource(values: Record<string, unknown>): HealthStatus {
  const enabled = values.enabled
  if (enabled === false) {
    return 'offline'
  }

  const status = stringFromValues(values, ['status', 'state', 'provisioning_state'])?.toLowerCase()
  if (!status) {
    return 'unknown'
  }

  if (['running', 'available', 'active', 'succeeded', 'ready'].some((value) => status.includes(value))) {
    return 'healthy'
  }

  if (['failed', 'error', 'degraded'].some((value) => status.includes(value))) {
    return 'degraded'
  }

  if (['stopped', 'disabled', 'deleted'].some((value) => status.includes(value))) {
    return 'offline'
  }

  return 'unknown'
}

function riskForActions(actions: string[]): IacPlanRisk {
  if (actions.includes('delete')) {
    return 'high'
  }

  if (actions.includes('update')) {
    return 'medium'
  }

  return 'low'
}

function relation(
  from: string,
  to: string,
  type: InventoryRelation['type'],
  source: string,
  evidence?: string
): InventoryRelation {
  return {
    id: `relation:${from}:${type}:${to}:${source}`,
    from,
    to,
    type,
    source,
    confidence: 0.9,
    evidence
  }
}

function mergeById<T extends { id: string }>(base: T[], additions: T[]): T[] {
  const map = new Map(base.map((item) => [item.id, item]))
  for (const item of additions) {
    map.set(item.id, item)
  }

  return [...map.values()]
}

function mergeRelations(base: InventoryRelation[], additions: InventoryRelation[]) {
  const map = new Map<string, InventoryRelation>()
  for (const relation of [...base, ...additions]) {
    const key = `${relation.from}:${relation.type}:${relation.to}:${relation.source}`
    if (!map.has(key)) {
      map.set(key, relation)
    }
  }

  return [...map.values()]
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function configuredPaths(primaryKey: string, fallbackKey: string) {
  const value = stringFromEnv(primaryKey, '') || stringFromEnv(fallbackKey, '')
  return value
    .split(/[;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function summaryFor(kind: IacSourceKind, resourceCount: number, changeCount: number) {
  if (kind === 'plan-json') {
    return `${resourceCount} planned resources, ${changeCount} plan changes`
  }

  return `${resourceCount} state resources`
}

function sourceKindLabel(kind: IacSourceKind) {
  if (kind === 'state-json') {
    return 'state'
  }

  if (kind === 'plan-json') {
    return 'plan'
  }

  return 'workspace'
}

function environmentFrom(tags: Record<string, string>, values: Record<string, unknown>) {
  return stringFromTags(tags, ['builder.environment', 'environment', 'env', 'stage', 'workspace'])
    || stringFromValues(values, ['environment', 'env', 'stage', 'workspace'])
}

function environmentFromName(name: string) {
  const normalized = name.toLowerCase()
  for (const candidate of ['prod', 'production', 'staging', 'stage', 'dev', 'development', 'local']) {
    if (normalized === candidate || normalized.endsWith(`-${candidate}`) || normalized.includes(`-${candidate}-`)) {
      return candidate
    }
  }

  return undefined
}

function stringFromTags(tags: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = tags[key]
    if (value) {
      return value
    }
  }

  return undefined
}

function stringFromValues(values: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = values[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
  }

  return undefined
}

function isMetadataValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function entityIdFor(kind: EntityKind, sourceId: string, address: string, name: string) {
  return `${kind}:${slugify(name)}-${shortHash(`${sourceId}:${address}`)}`
}

function shortHash(value: string) {
  return createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
}

function engineFromEnv(): IacEngine {
  return stringFromEnv('BUILDER_OPENTOFU_ENGINE', 'opentofu') === 'terraform' ? 'terraform' : 'opentofu'
}

function engineFromPath(path: string): IacEngine {
  const normalized = path.toLowerCase()
  return normalized.includes('terraform') && !normalized.includes('opentofu') ? 'terraform' : 'opentofu'
}

function booleanFromEnv(key: string, fallback: boolean) {
  const value = process.env[key]
  if (value === undefined) {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function stringFromEnv(key: string, fallback: string) {
  return typeof process.env[key] === 'string' ? process.env[key] as string : fallback
}

function numberFromEnv(key: string, fallback: number) {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }

    if ('statusMessage' in error && typeof error.statusMessage === 'string') {
      return error.statusMessage
    }
  }

  return String(error)
}
