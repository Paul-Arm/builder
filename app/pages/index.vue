<script setup lang="ts">
import {
  ActivityIcon,
  BoxesIcon,
  CloudIcon,
  CpuIcon,
  DatabaseIcon,
  GitBranchIcon,
  LockIcon,
  NetworkIcon,
  ServerIcon
} from '@lucide/vue'
import type { Component } from 'vue'
import type { EntityKind, InventoryDataset, InventoryEntity } from '~~/types/inventory'

const { data: inventory, pending, error, refresh } = await useFetch<InventoryDataset>('/api/inventory')

const query = ref('')
const selectedProjectId = useState<string>('builder:selected-project-id', () => '')
const selectedEntityId = ref('project:checkout')

const entities = computed(() => inventory.value?.entities || [])
const relations = computed(() => inventory.value?.relations || [])
const deployments = computed(() => inventory.value?.deployments || [])
const collectors = computed(() => inventory.value?.collectors || [])

const allProjects = computed(() => {
  return entities.value
    .filter((entity) => entity.kind === 'project')
    .sort((a, b) => a.name.localeCompare(b.name))
})

const projects = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()
  return allProjects.value
    .filter((entity) => {
      if (!normalizedQuery) {
        return true
      }
      return [
        entity.name,
        entity.owner,
        entity.description,
        entity.platform,
        ...entity.tags
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    })
})

watch(allProjects, (nextProjects) => {
  if (!nextProjects.length) {
    selectedProjectId.value = ''
    return
  }

  if (selectedProjectId.value && nextProjects.some((project) => project.id === selectedProjectId.value)) {
    return
  }

  selectedProjectId.value = nextProjects.some((project) => project.id === 'project:checkout')
    ? 'project:checkout'
    : nextProjects[0]?.id || ''
}, { immediate: true })

onMounted(() => {
  const storedProjectId = window.localStorage.getItem('builder:selected-project-id')
  if (storedProjectId) {
    selectedProjectId.value = storedProjectId
    selectedEntityId.value = storedProjectId
  }
})

watch(selectedProjectId, (projectId) => {
  if (projectId && import.meta.client) {
    window.localStorage.setItem('builder:selected-project-id', projectId)
  }
})

const selectedEntity = computed(() => {
  return entities.value.find((entity) => entity.id === selectedEntityId.value) || allProjects.value[0]
})

const selectedProject = computed(() => {
  return entities.value.find((entity) => entity.id === selectedProjectId.value && entity.kind === 'project') || allProjects.value[0]
})

const selectedProjectSummary = computed(() => {
  if (!selectedProject.value) {
    return 'Kein Project'
  }

  return [
    selectedProject.value.owner,
    `${serviceCountForProject(selectedProject.value.id)} services`,
    environmentsForProject(selectedProject.value.id).join(', ')
  ].filter(Boolean).join(' / ')
})

const projectOptions = computed(() => {
  const options = projects.value.map((project) => ({
    label: project.name,
    value: project.id
  }))

  if (selectedProject.value && !options.some((option) => option.value === selectedProject.value?.id)) {
    options.unshift({
      label: selectedProject.value.name,
      value: selectedProject.value.id
    })
  }

  return options
})

const selectedDeployments = computed(() => {
  if (!selectedEntity.value) {
    return []
  }

  return deployments.value.filter((deployment) => {
    return projectIdFor(deployment) === selectedEntity.value?.id
      || deployment.serviceId === selectedEntity.value?.id
      || deployment.targetId === selectedEntity.value?.id
  })
})

const selectedRelations = computed(() => {
  if (!selectedEntity.value) {
    return []
  }

  return relations.value.filter((relation) => {
    return relation.from === selectedEntity.value?.id || relation.to === selectedEntity.value?.id
  })
})

const selectedNeighbors = computed(() => {
  const byId = new Map(entities.value.map((entity) => [entity.id, entity]))
  return selectedRelations.value.map((relation) => {
    const neighborId = relation.from === selectedEntity.value?.id ? relation.to : relation.from
    return {
      relation,
      entity: byId.get(neighborId)
    }
  }).filter((item): item is { relation: typeof selectedRelations.value[number], entity: InventoryEntity } => Boolean(item.entity))
})

const kindIcons: Partial<Record<EntityKind, Component>> = {
  project: BoxesIcon,
  service: ActivityIcon,
  host: ServerIcon,
  runtime: CpuIcon,
  container: CpuIcon,
  pipeline: NetworkIcon,
  function: CloudIcon,
  database: DatabaseIcon,
  database_server: DatabaseIcon,
  storage: CloudIcon,
  queue: ActivityIcon,
  secret_store: LockIcon,
  repo: GitBranchIcon,
  namespace: CloudIcon,
  external_service: CloudIcon
}

const serviceProjects = computed(() => {
  const map = new Map<string, InventoryEntity[]>()
  const byId = new Map(entities.value.map((entity) => [entity.id, entity]))

  for (const relation of relations.value) {
    const project = byId.get(relation.from)
    if (relation.type === 'owns' && project?.kind === 'project') {
      const list = map.get(relation.to) || []
      list.push(project)
      map.set(relation.to, list)
    }
  }

  return map
})

const selectedProjectUsage = computed(() => {
  if (!selectedEntity.value || !['database_server', 'database', 'storage', 'queue', 'secret_store', 'external_service'].includes(selectedEntity.value.kind)) {
    return []
  }

  const projectsById = new Map<string, InventoryEntity>()
  for (const relation of relations.value) {
    if (relation.to !== selectedEntity.value.id) {
      continue
    }

    for (const project of serviceProjects.value.get(relation.from) || []) {
      projectsById.set(project.id, project)
    }
  }

  return [...projectsById.values()]
})

const selectedRepoBranches = computed(() => {
  if (selectedEntity.value?.kind !== 'repo') {
    return []
  }

  return splitMetadataList(selectedEntity.value, 'branches')
})

const selectedRepoServices = computed(() => {
  if (selectedEntity.value?.kind !== 'repo') {
    return []
  }

  const byId = new Map(entities.value.map((entity) => [entity.id, entity]))

  return relations.value
    .filter((relation) => relation.from === selectedEntity.value?.id && relation.type === 'contains')
    .map((relation) => byId.get(relation.to))
    .filter((entity): entity is InventoryEntity => Boolean(entity))
})

function projectIdFor(deployment: { projectId: string }) {
  return deployment.projectId
}

function iconFor(kind: EntityKind) {
  return kindIcons[kind] || ActivityIcon
}

function environmentsForProject(projectId: string) {
  const environmentNames = new Set<string>()
  const project = entities.value.find((entity) => entity.id === projectId)

  if (project) {
    for (const environment of splitMetadataList(project, 'environments')) {
      environmentNames.add(environment)
    }
  }

  for (const deployment of deployments.value) {
    if (projectIdFor(deployment) === projectId) {
      environmentNames.add(deployment.environment)
    }
  }

  const ownedIds = new Set(relations.value
    .filter((relation) => relation.from === projectId && relation.type === 'owns')
    .map((relation) => relation.to))

  for (const entity of entities.value) {
    if (ownedIds.has(entity.id) && entity.environment) {
      environmentNames.add(entity.environment)
    }
  }

  return sortEnvironmentNames([...environmentNames])
}

function serviceCountForProject(projectId: string) {
  return relations.value.filter((relation) => relation.type === 'owns' && relation.from === projectId).length
}

function sourcePathFor(entity: InventoryEntity) {
  const sourcePath = entity.metadata?.sourcePath
  return typeof sourcePath === 'string' ? sourcePath : entity.platform
}

function environmentsForService(serviceId: string) {
  return sortEnvironmentNames([...new Set(
    deployments.value
      .filter((deployment) => deployment.serviceId === serviceId)
      .map((deployment) => deployment.environment)
  )])
}

function deploymentSourceLine(deployment: { branch?: string, sourcePath?: string, actor: string, deployedAt: string }) {
  return [
    deployment.branch,
    deployment.sourcePath,
    deployment.actor,
    formatDate(deployment.deployedAt)
  ].filter(Boolean).join(' / ')
}

function relationLabel(relation: { from: string, type: string }) {
  if (relation.type === 'contains' && relation.from !== selectedEntity.value?.id) {
    return 'defined in'
  }

  return relation.type.replace('_', ' ')
}

function splitMetadataList(entity: InventoryEntity, key: string) {
  const value = entity.metadata?.[key]
  if (typeof value !== 'string') {
    return []
  }

  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function formatDate(value?: string) {
  if (!value) {
    return 'n/a'
  }

  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}

function sortEnvironmentNames(values: string[]) {
  return values.sort((a, b) => environmentRank(a) - environmentRank(b) || a.localeCompare(b))
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

function inspectEntity(id: string) {
  selectedEntityId.value = id
}

function selectProject(id: string) {
  selectedProjectId.value = id
  selectedEntityId.value = id
}

function selectProjectFromDropdown(id: string) {
  selectProject(id)
}

function selectRelatedEntity(id: string) {
  const entity = entities.value.find((item) => item.id === id)
  if (entity?.kind === 'project') {
    selectProject(id)
    return
  }

  inspectEntity(id)
}
</script>

<template>
  <main class="app-frame">
    <AppRail :mode="inventory?.mode" :collector-count="collectors.length" />

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Live inventory</p>
          <h1>Projects, Environments, Ressourcen</h1>
        </div>

        <div class="topbar-actions">
          <div class="project-switcher">
            <span class="project-switcher-label">
              <UIcon name="i-lucide-boxes" />
              Project
            </span>
            <USelect
              :model-value="selectedProject?.id"
              :items="projectOptions"
              value-key="value"
              label-key="label"
              size="md"
              color="neutral"
              class="project-switcher-select"
              aria-label="Project"
              @update:model-value="selectProjectFromDropdown(String($event))"
            />
            <small>{{ selectedProjectSummary }}</small>
          </div>

          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Projekt, Team, Plattform"
            class="w-full sm:w-72"
            size="md"
          />

          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            title="Refresh inventory"
            @click="refresh()"
          />

          <UButton
            icon="i-lucide-plus"
            color="neutral"
            disabled
            title="Write actions are disabled"
          >
            New env
          </UButton>
        </div>
      </header>

      <div v-if="pending" class="empty-state">Inventory wird geladen</div>
      <div v-else-if="error" class="empty-state danger">Inventory API nicht erreichbar</div>

      <section v-else-if="inventory" class="content-grid">
        <TopologyGraph
          class="graph-area"
          :inventory="inventory"
          :selected-id="selectedEntity?.id"
          :selected-project-id="selectedProject?.id"
          @select="inspectEntity"
          @select-project="selectProject"
        />

        <aside class="detail-panel">
          <template v-if="selectedEntity">
            <div class="detail-header">
              <component :is="iconFor(selectedEntity.kind)" :size="22" />
              <div>
                <EntityBadge :kind="selectedEntity.kind" />
                <h2>{{ selectedEntity.name }}</h2>
              </div>
              <StatusPill :status="selectedEntity.health" />
            </div>

            <p class="detail-description">{{ selectedEntity.description || selectedEntity.platform }}</p>

            <dl class="metadata-grid">
              <div>
                <dt>Owner</dt>
                <dd>{{ selectedEntity.owner || 'n/a' }}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{{ selectedEntity.provider }}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>{{ selectedEntity.platform }}</dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>{{ formatDate(selectedEntity.lastSeen) }}</dd>
              </div>
            </dl>

            <section v-if="selectedRepoBranches.length" class="detail-section">
              <h3>Branches</h3>
              <div class="branch-list">
                <span
                  v-for="branch in selectedRepoBranches"
                  :key="`${selectedEntity.id}:${branch}`"
                >
                  {{ branch }}
                </span>
              </div>
            </section>

            <section v-if="selectedRepoServices.length" class="detail-section">
              <h3>Services in repo</h3>
              <button
                v-for="service in selectedRepoServices"
                :key="service.id"
                class="connection-row"
                type="button"
                @click="inspectEntity(service.id)"
              >
                <span>service</span>
                <strong>{{ service.name }}</strong>
                <small>{{ sourcePathFor(service) }} / {{ environmentsForService(service.id).join(', ') }}</small>
              </button>
            </section>

            <section v-if="selectedProjectUsage.length" class="detail-section">
              <h3>Shared across projects</h3>
              <button
                v-for="project in selectedProjectUsage"
                :key="project.id"
                class="connection-row"
                type="button"
                @click="selectProject(project.id)"
              >
                <span>project</span>
                <strong>{{ project.name }}</strong>
                <small>{{ project.owner }} / {{ serviceCountForProject(project.id) }} services</small>
              </button>
            </section>

            <section class="detail-section">
              <h3>Deployments</h3>
              <article v-for="deployment in selectedDeployments" :key="deployment.id" class="deployment-row">
                <div>
                  <strong>{{ deployment.environment }} / {{ deployment.version }}</strong>
                  <span>{{ deploymentSourceLine(deployment) }}</span>
                </div>
                <StatusPill :status="deployment.status" />
              </article>
              <p v-if="!selectedDeployments.length" class="muted">Keine Deployments</p>
            </section>

            <section class="detail-section">
              <h3>Connections</h3>
              <button
                v-for="{ relation, entity } in selectedNeighbors"
                :key="relation.id"
                class="connection-row"
                type="button"
                @click="selectRelatedEntity(entity.id)"
              >
                <span>{{ relationLabel(relation) }}</span>
                <strong>{{ entity.name }}</strong>
                <small>{{ relation.source }} / {{ Math.round(relation.confidence * 100) }}%</small>
              </button>
              <p v-if="!selectedNeighbors.length" class="muted">Keine Verbindungen</p>
            </section>
          </template>
        </aside>
      </section>
    </section>
  </main>
</template>
