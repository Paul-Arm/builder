<script setup lang="ts">
import type {
  EntityKind,
  InventoryDataset,
  InventoryEntity,
  InventoryRelation
} from '~~/types/inventory'

type GraphScope = 'project' | 'all'

const { data: inventory, pending, error, refresh } = await useFetch<InventoryDataset>('/api/inventory')

const query = ref('')
const scope = ref<GraphScope>('project')
const selectedProjectId = useState<string>('builder:selected-project-id', () => '')
const selectedEntityId = ref('')

const entities = computed(() => inventory.value?.entities || [])
const relations = computed(() => inventory.value?.relations || [])
const collectors = computed(() => inventory.value?.collectors || [])

const projects = computed(() => {
  return entities.value
    .filter((entity) => entity.kind === 'project')
    .sort((a, b) => a.name.localeCompare(b.name))
})

const selectedProject = computed(() => {
  return projects.value.find((project) => project.id === selectedProjectId.value) || projects.value[0]
})

const selectedEntity = computed(() => {
  return entities.value.find((entity) => entity.id === selectedEntityId.value)
    || selectedProject.value
    || entities.value[0]
})

const projectOptions = computed(() => projects.value.map((project) => ({
  label: project.name,
  value: project.id
})))

const scopeItems = computed(() => [
  { label: 'Project', value: 'project' },
  { label: 'All inventory', value: 'all' }
])

const selectedRelations = computed(() => {
  if (!selectedEntity.value) {
    return []
  }

  return relations.value.filter((relation) => {
    return relation.from === selectedEntity.value?.id || relation.to === selectedEntity.value?.id
  })
})

const selectedNeighbors = computed(() => {
  if (!selectedEntity.value) {
    return []
  }

  const byId = new Map(entities.value.map((entity) => [entity.id, entity]))

  return selectedRelations.value
    .map((relation) => {
      const outgoing = relation.from === selectedEntity.value?.id
      const neighbor = byId.get(outgoing ? relation.to : relation.from)
      return {
        relation,
        entity: neighbor,
        direction: outgoing ? 'out' : 'in'
      }
    })
    .filter((item): item is {
      relation: InventoryRelation
      entity: InventoryEntity
      direction: 'in' | 'out'
    } => Boolean(item.entity))
    .sort((a, b) => {
      return relationLabel(a.relation).localeCompare(relationLabel(b.relation))
        || a.entity.name.localeCompare(b.entity.name)
    })
})

const stats = computed(() => {
  const degraded = entities.value.filter((entity) => ['degraded', 'offline'].includes(entity.health)).length

  return [
    { label: 'Projects', value: projects.value.length },
    { label: 'Nodes', value: entities.value.length },
    { label: 'Edges', value: relations.value.length },
    { label: 'Needs attention', value: degraded }
  ]
})

watch(projects, (nextProjects) => {
  if (!nextProjects.length) {
    selectedProjectId.value = ''
    selectedEntityId.value = ''
    return
  }

  if (!selectedProjectId.value || !nextProjects.some((project) => project.id === selectedProjectId.value)) {
    selectedProjectId.value = nextProjects.some((project) => project.id === 'project:builder')
      ? 'project:builder'
      : nextProjects[0]?.id || ''
  }

  if (!selectedEntityId.value) {
    selectedEntityId.value = selectedProjectId.value
  }
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

function selectProjectFromDropdown(projectId: string) {
  selectedProjectId.value = projectId
  selectedEntityId.value = projectId
}

function inspectEntity(id: string) {
  selectedEntityId.value = id
}

function selectProject(projectId: string) {
  selectedProjectId.value = projectId
  selectedEntityId.value = projectId
}

function selectNeighbor(entity: InventoryEntity) {
  if (entity.kind === 'project') {
    selectProject(entity.id)
    return
  }

  inspectEntity(entity.id)
}

function relationLabel(relation: InventoryRelation) {
  return relation.type.replace('_', ' ')
}

function relationDirectionLabel(item: { relation: InventoryRelation, direction: 'in' | 'out' }) {
  if (item.direction === 'out') {
    return relationLabel(item.relation)
  }

  return `in: ${relationLabel(item.relation)}`
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

function iconForKind(kind: EntityKind) {
  const icons: Record<EntityKind, string> = {
    project: 'i-lucide-folder-kanban',
    service: 'i-lucide-waypoints',
    host: 'i-lucide-server',
    runtime: 'i-lucide-cpu',
    container: 'i-lucide-box',
    pipeline: 'i-lucide-network',
    function: 'i-lucide-cloud',
    database: 'i-lucide-database',
    database_server: 'i-lucide-database-zap',
    storage: 'i-lucide-hard-drive',
    queue: 'i-lucide-radio-tower',
    repo: 'i-lucide-git-branch',
    domain: 'i-lucide-globe',
    cluster: 'i-lucide-cloud',
    namespace: 'i-lucide-boxes',
    secret_store: 'i-lucide-lock',
    external_service: 'i-lucide-cloud'
  }

  return icons[kind]
}
</script>

<template>
  <main class="app-frame">
    <AppRail :mode="inventory?.mode" :collector-count="collectors.length" />

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Inventory graph</p>
          <h1>Dashboard 2</h1>
        </div>

        <div class="topbar-actions">
          <div class="project-switcher">
            <span class="project-switcher-label">
              <UIcon name="i-lucide-folder-kanban" />
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
            <small>{{ selectedProject?.owner || 'No owner' }} / {{ selectedProject?.platform || 'inventory' }}</small>
          </div>

          <USelect
            v-model="scope"
            :items="scopeItems"
            value-key="value"
            label-key="label"
            size="md"
            color="neutral"
            class="dashboard2-scope-select"
            aria-label="Graph scope"
          />

          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Node, Provider, Env"
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
        </div>
      </header>

      <div v-if="pending" class="empty-state">Inventory wird geladen</div>
      <div v-else-if="error" class="empty-state danger">Inventory API nicht erreichbar</div>

      <section v-else-if="inventory" class="dashboard2-console">
        <section class="dashboard2-summary-row" aria-label="Inventory summary">
          <article
            v-for="stat in stats"
            :key="stat.label"
            class="dashboard2-stat"
          >
            <span>{{ stat.label }}</span>
            <strong>{{ stat.value }}</strong>
          </article>
        </section>

        <AutoLayoutGraph
          class="dashboard2-graph"
          :inventory="inventory"
          :selected-id="selectedEntity?.id"
          :selected-project-id="selectedProject?.id"
          :query="query"
          :scope="scope"
          @select="inspectEntity"
          @select-project="selectProject"
        />

        <aside class="dashboard2-detail-panel detail-panel">
          <template v-if="selectedEntity">
            <div class="detail-header">
              <UIcon :name="iconForKind(selectedEntity.kind)" class="size-6" />
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

            <section class="detail-section">
              <h3>Connections</h3>
              <button
                v-for="item in selectedNeighbors"
                :key="`${item.relation.id}:${item.entity.id}`"
                type="button"
                class="connection-row"
                @click="selectNeighbor(item.entity)"
              >
                <span>{{ relationDirectionLabel(item) }}</span>
                <strong>{{ item.entity.name }}</strong>
                <small>{{ item.entity.kind }} / {{ item.relation.source }} / {{ Math.round(item.relation.confidence * 100) }}%</small>
              </button>
              <p v-if="!selectedNeighbors.length" class="muted">Keine Verbindungen</p>
            </section>
          </template>
        </aside>
      </section>
    </section>
  </main>
</template>
