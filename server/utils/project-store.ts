import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createError } from 'h3'
import type { InventoryDataset, InventoryEntity, InventoryRelation } from '~~/types/inventory'
import type {
  CreateProjectEnvironmentRequest,
  CreateProjectNodeRequest,
  CreateProjectRequest,
  ProjectWorkspace,
  UpdateProjectRequest
} from '~~/types/projects'

interface ProjectStoreFile {
  version: 1
  entities: InventoryEntity[]
  relations: InventoryRelation[]
}

const storePath = process.env.BUILDER_PROJECT_STORE_PATH
  || join(process.cwd(), '.data', 'projects.json')

export async function readProjectWorkspace(base: InventoryDataset): Promise<ProjectWorkspace> {
  const inventory = await applyProjectOverlay(base)
  const projects = inventory.entities
    .filter((entity) => entity.kind === 'project')
    .sort((a, b) => a.name.localeCompare(b.name))
  const nodesByProject = Object.fromEntries(projects.map((project) => {
    return [
      project.id,
      inventory.relations
        .filter((relation) => relation.from === project.id && relation.type === 'owns')
        .map((relation) => inventory.entities.find((entity) => entity.id === relation.to))
        .filter((entity): entity is InventoryEntity => Boolean(entity))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    ]
  }))
  const environmentsByProject = Object.fromEntries(projects.map((project) => {
    return [
      project.id,
      collectProjectEnvironments(project, inventory)
    ]
  }))

  return {
    generatedAt: inventory.generatedAt,
    projects,
    relations: inventory.relations,
    nodesByProject,
    environmentsByProject
  }
}

export async function applyProjectOverlay(base: InventoryDataset): Promise<InventoryDataset> {
  const store = await readStore()
  const entityMap = new Map(base.entities.map((entity) => [entity.id, entity]))
  const relationMap = new Map(base.relations.map((relation) => [relation.id, relation]))

  for (const entity of store.entities) {
    const normalizedEntity = withDefaultEditableProjectEnvironments(entity)
    entityMap.set(normalizedEntity.id, normalizedEntity)

    const projectId = typeof normalizedEntity.metadata?.projectId === 'string'
      ? normalizedEntity.metadata.projectId
      : undefined
    if (projectId && normalizedEntity.kind !== 'project') {
      const relation = relationFor(projectId, normalizedEntity.id)
      relationMap.set(relation.id, relation)
    }
  }

  for (const relation of store.relations) {
    relationMap.set(relation.id, relation)
  }

  return {
    ...base,
    generatedAt: new Date().toISOString(),
    entities: Array.from(entityMap.values()),
    relations: Array.from(relationMap.values())
  }
}

function withDefaultEditableProjectEnvironments(entity: InventoryEntity): InventoryEntity {
  if (
    entity.kind !== 'project'
    || entity.metadata?.editable !== true
    || typeof entity.metadata.environments === 'string'
  ) {
    return entity
  }

  return {
    ...entity,
    metadata: {
      ...entity.metadata,
      environments: serializeEnvironments(['dev', 'prod'])
    }
  }
}

export async function createProject(request: CreateProjectRequest, base: InventoryDataset): Promise<ProjectWorkspace> {
  const name = request.name.trim()
  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Project name is required'
    })
  }

  const store = await readStore()
  const now = new Date().toISOString()
  const id = uniqueEntityId('project', name, [...base.entities, ...store.entities])

  store.entities.push({
    id,
    kind: 'project',
    name,
    provider: 'manual',
    platform: request.platform?.trim() || 'project',
    owner: request.owner?.trim() || undefined,
    health: 'healthy',
    description: optionalString(request.description),
    tags: normalizeTags(request.tags),
    confidence: 1,
    lastSeen: now,
    metadata: {
      editable: true,
      environments: serializeEnvironments(request.environments || ['dev', 'prod'])
    }
  })

  await writeStore(store)
  return readProjectWorkspace(base)
}

export async function updateProject(
  projectId: string,
  request: UpdateProjectRequest,
  base: InventoryDataset
): Promise<ProjectWorkspace> {
  const store = await readStore()
  const current = store.entities.find((entity) => entity.id === projectId)
    || base.entities.find((entity) => entity.id === projectId && entity.kind === 'project')

  if (!current) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project not found'
    })
  }

  const updated: InventoryEntity = {
    ...current,
    name: optionalString(request.name) || current.name,
    owner: request.owner !== undefined ? optionalString(request.owner) : current.owner,
    platform: optionalString(request.platform) || current.platform,
    description: request.description !== undefined ? optionalString(request.description) : current.description,
    health: request.health || current.health,
    tags: request.tags ? normalizeTags(request.tags) : current.tags,
    provider: current.provider === 'manual' ? current.provider : 'manual',
    confidence: 1,
    lastSeen: new Date().toISOString(),
    metadata: {
      ...current.metadata,
      editable: true
    }
  }

  upsertEntity(store, updated)
  await writeStore(store)
  return readProjectWorkspace(base)
}

export async function createProjectNode(
  projectId: string,
  request: CreateProjectNodeRequest,
  base: InventoryDataset
): Promise<ProjectWorkspace> {
  const name = request.name.trim()
  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Node name is required'
    })
  }

  const store = await readStore()
  const project = [...base.entities, ...store.entities].find((entity) => entity.id === projectId && entity.kind === 'project')
  if (!project) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project not found'
    })
  }

  const now = new Date().toISOString()
  const node: InventoryEntity = {
    id: uniqueEntityId(request.kind, `${project.name}-${name}`, [...base.entities, ...store.entities]),
    kind: request.kind,
    name,
    provider: request.provider?.trim() || 'manual',
    platform: request.platform?.trim() || request.kind,
    environment: optionalString(request.environment),
    owner: optionalString(request.owner) || project.owner,
    health: 'unknown',
    description: optionalString(request.description),
    tags: normalizeTags(request.tags),
    confidence: 1,
    lastSeen: now,
    metadata: {
      editable: true,
      projectId
    }
  }
  const relation = relationFor(project.id, node.id)

  store.entities.push(node)
  store.relations.push(relation)
  await writeStore(store)
  return readProjectWorkspace(base)
}

export async function createProjectEnvironment(
  projectId: string,
  request: CreateProjectEnvironmentRequest,
  base: InventoryDataset
): Promise<ProjectWorkspace> {
  const name = normalizeEnvironmentName(request.name)
  if (!name) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Environment name is required'
    })
  }

  const store = await readStore()
  const current = store.entities.find((entity) => entity.id === projectId)
    || base.entities.find((entity) => entity.id === projectId && entity.kind === 'project')

  if (!current) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project not found'
    })
  }

  const existing = collectProjectEnvironments(current, await applyProjectOverlay(base))
  const updated: InventoryEntity = {
    ...current,
    provider: current.provider === 'manual' ? current.provider : 'manual',
    confidence: 1,
    lastSeen: new Date().toISOString(),
    metadata: {
      ...current.metadata,
      editable: true,
      environments: serializeEnvironments([...existing, name])
    }
  }

  upsertEntity(store, updated)
  await writeStore(store)
  return readProjectWorkspace(base)
}

async function readStore(): Promise<ProjectStoreFile> {
  try {
    const raw = await readFile(storePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProjectStoreFile>
    return {
      version: 1,
      entities: parsed.entities || [],
      relations: parsed.relations || []
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        version: 1,
        entities: [],
        relations: []
      }
    }

    throw error
  }
}

async function writeStore(store: ProjectStoreFile) {
  await mkdir(dirname(storePath), { recursive: true })
  const tmpPath = `${storePath}.${process.pid}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(tmpPath, storePath)
}

function upsertEntity(store: ProjectStoreFile, entity: InventoryEntity) {
  const index = store.entities.findIndex((item) => item.id === entity.id)
  if (index >= 0) {
    store.entities[index] = entity
    return
  }

  store.entities.push(entity)
}

function relationFor(projectId: string, nodeId: string): InventoryRelation {
  return {
    id: `relation:${projectId}:owns:${nodeId}`,
    from: projectId,
    to: nodeId,
    type: 'owns',
    source: 'manual',
    confidence: 1,
    evidence: 'Created from Projects page'
  }
}

function uniqueEntityId(kind: string, name: string, entities: InventoryEntity[]) {
  const base = `${kind}:${slugify(name)}`
  const ids = new Set(entities.map((entity) => entity.id))
  if (!ids.has(base)) {
    return base
  }

  let suffix = 2
  while (ids.has(`${base}-${suffix}`)) {
    suffix += 1
  }

  return `${base}-${suffix}`
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
}

function optionalString(value?: string) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function normalizeTags(tags?: string[]) {
  return Array.from(new Set((tags || [])
    .map((tag) => tag.trim())
    .filter(Boolean)))
}

function collectProjectEnvironments(project: InventoryEntity, inventory: InventoryDataset) {
  const environmentNames = new Set<string>()
  for (const environment of parseEnvironments(project.metadata?.environments)) {
    environmentNames.add(environment)
  }

  for (const deployment of inventory.deployments) {
    if (deployment.projectId === project.id) {
      environmentNames.add(deployment.environment)
    }
  }

  const ownedIds = new Set(inventory.relations
    .filter((relation) => relation.from === project.id && relation.type === 'owns')
    .map((relation) => relation.to))

  for (const entity of inventory.entities) {
    if (ownedIds.has(entity.id) && entity.environment) {
      environmentNames.add(entity.environment)
    }
  }

  return sortEnvironmentNames([...environmentNames])
}

function serializeEnvironments(environments: string[]) {
  return sortEnvironmentNames(environments.map(normalizeEnvironmentName).filter(Boolean)).join(',')
}

function parseEnvironments(value: unknown) {
  if (typeof value !== 'string') {
    return []
  }

  return value.split(',').map(normalizeEnvironmentName).filter(Boolean)
}

function normalizeEnvironmentName(value?: string) {
  return value?.trim().replace(/\s+/g, '-').toLowerCase() || ''
}

function sortEnvironmentNames(environments: string[]) {
  const rank: Record<string, number> = {
    local: 0,
    dev: 1,
    development: 2,
    preview: 3,
    staging: 4,
    stage: 5,
    prod: 6,
    production: 7
  }

  return Array.from(new Set(environments)).sort((a, b) => {
    return (rank[a] ?? 50) - (rank[b] ?? 50) || a.localeCompare(b)
  })
}
