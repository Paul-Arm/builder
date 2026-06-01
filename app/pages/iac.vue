<script setup lang="ts">
import {
  AlertTriangleIcon,
  BracesIcon,
  BoxesIcon,
  DatabaseIcon,
  FileCode2Icon,
  GitBranchIcon,
  LayersIcon,
  ServerIcon
} from '@lucide/vue'
import type { Component } from 'vue'
import type { InventoryDataset } from '~~/types/inventory'
import type {
  IacBackboneSnapshot,
  IacBackboneSource,
  IacPlanChange,
  IacResourceRef
} from '~~/types/iac'

const { data: inventory, refresh: refreshInventory } = useFetch<InventoryDataset>('/api/inventory', {
  lazy: true,
  server: false
})
const {
  data: backbone,
  pending,
  error,
  refresh: refreshBackbone
} = useFetch<IacBackboneSnapshot>('/api/iac/backbone', {
  lazy: true,
  server: false
})

const query = ref('')
const selectedSourceId = ref<string>('')
const selectedKind = ref('all')

const sources = computed(() => backbone.value?.sources || [])
const resources = computed(() => backbone.value?.resources || [])
const changes = computed(() => backbone.value?.changes || [])
const entities = computed(() => backbone.value?.entities || [])
const insights = computed(() => backbone.value?.insights || [])
const loading = computed(() => pending.value || (!backbone.value && !error.value))

const activeSourceId = computed(() => selectedSourceId.value || sources.value[0]?.id || '')
const selectedSource = computed(() => sourceFor(activeSourceId.value))
const sourceResources = computed(() => {
  return resources.value.filter((resource) => !activeSourceId.value || resource.sourceId === activeSourceId.value)
})
const sourceChanges = computed(() => {
  return changes.value.filter((change) => !activeSourceId.value || change.sourceId === activeSourceId.value)
})
const sourceEntities = computed(() => {
  const nodeIds = new Set(sourceResources.value.map((resource) => resource.nodeId).filter(Boolean))
  return entities.value.filter((entity) => nodeIds.has(entity.id))
})
const filteredResources = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()

  return sourceResources.value.filter((resource) => {
    const kind = entityFor(resource)?.kind || ''
    const matchesKind = selectedKind.value === 'all' || kind === selectedKind.value
    const matchesQuery = !normalizedQuery || [
      resource.address,
      resource.type,
      resource.provider,
      resource.name,
      kind,
      entityFor(resource)?.name,
      entityFor(resource)?.environment
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)

    return matchesKind && matchesQuery
  })
})
const kindOptions = computed(() => {
  const kinds = new Set(sourceEntities.value.map((entity) => entity.kind))
  return [
    { label: 'All kinds', value: 'all' },
    ...[...kinds].sort().map((kind) => ({
      label: kind.replace('_', ' '),
      value: kind
    }))
  ]
})
const stats = computed(() => [
  {
    label: 'Sources',
    value: sources.value.length,
    detail: `${connectedSourceCount.value} connected`
  },
  {
    label: 'Resources',
    value: resources.value.length,
    detail: `${sourceResources.value.length} selected`
  },
  {
    label: 'Graph nodes',
    value: entities.value.length,
    detail: `${sourceEntities.value.length} selected`
  },
  {
    label: 'Plan changes',
    value: changes.value.length,
    detail: `${sourceChanges.value.length} selected`
  }
])
const connectedSourceCount = computed(() => sources.value.filter((source) => source.status === 'connected').length)
const collectorCount = computed(() => inventory.value?.collectors.length || 0)

watch(sources, (nextSources) => {
  if (!nextSources.length) {
    selectedSourceId.value = ''
    return
  }

  if (!selectedSourceId.value || !nextSources.some((source) => source.id === selectedSourceId.value)) {
    selectedSourceId.value = nextSources[0]?.id || ''
  }
}, { immediate: true })

watch(activeSourceId, () => {
  selectedKind.value = 'all'
})

async function refreshAll() {
  await Promise.all([refreshInventory(), refreshBackbone()])
}

function selectSource(source: IacBackboneSource) {
  selectedSourceId.value = source.id
}

function sourceFor(id: string) {
  return sources.value.find((source) => source.id === id)
}

function entityFor(resource: IacResourceRef) {
  return entities.value.find((entity) => entity.id === resource.nodeId)
}

function sourceForChange(change: IacPlanChange) {
  return sourceFor(change.sourceId)
}

function iconForResource(resource: IacResourceRef): Component {
  const kind = entityFor(resource)?.kind
  if (kind === 'repo') {
    return GitBranchIcon
  }

  if (['database', 'database_server', 'storage', 'queue', 'secret_store'].includes(kind || '')) {
    return DatabaseIcon
  }

  if (['host', 'runtime', 'container', 'cluster', 'namespace', 'function'].includes(kind || '')) {
    return ServerIcon
  }

  return BoxesIcon
}

function iconForSource(source: IacBackboneSource): Component {
  if (source.kind === 'plan-json') {
    return LayersIcon
  }

  if (source.status === 'degraded') {
    return AlertTriangleIcon
  }

  return FileCode2Icon
}

function changeTone(change: IacPlanChange) {
  if (change.risk === 'high') {
    return 'critical'
  }

  if (change.risk === 'medium') {
    return 'warning'
  }

  return 'info'
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
</script>

<template>
  <main class="app-frame">
    <AppRail :mode="inventory?.mode" :collector-count="collectorCount" />

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">IaC backbone</p>
          <h1>OpenTofu</h1>
        </div>

        <div class="topbar-actions">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Resource, provider, address"
            class="w-full sm:w-72"
            size="md"
          />

          <USelect
            v-model="selectedKind"
            :items="kindOptions"
            value-key="value"
            label-key="label"
            class="w-full sm:w-48"
            size="md"
            color="neutral"
          />

          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            title="Refresh OpenTofu"
            @click="refreshAll()"
          />
        </div>
      </header>

      <div v-if="loading" class="empty-state">OpenTofu wird geladen</div>
      <div v-else-if="error" class="empty-state danger">OpenTofu Backbone nicht erreichbar</div>

      <section v-else-if="backbone" class="iac-console">
        <section class="iac-summary-row">
          <article
            v-for="item in stats"
            :key="item.label"
            class="iac-stat"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <small>{{ item.detail }}</small>
          </article>
        </section>

        <aside class="collector-page-panel iac-source-panel">
          <div class="panel-heading">
            <h2>Sources</h2>
            <span>{{ connectedSourceCount }} connected</span>
          </div>

          <button
            v-for="source in sources"
            :key="source.id"
            type="button"
            class="target-row"
            :class="{ selected: activeSourceId === source.id }"
            @click="selectSource(source)"
          >
            <span class="collector-card-icon">
              <component :is="iconForSource(source)" :size="18" />
            </span>
            <span class="provider-card-main">
              <strong>{{ source.name }}</strong>
              <span>{{ source.engine }} / {{ source.kind }}</span>
              <small>{{ source.summary }}</small>
              <span class="iac-row-status">
                <StatusPill :status="source.status" />
                <StatusPill :status="source.mode" />
              </span>
            </span>
          </button>
        </aside>

        <section class="deployment-panel iac-resource-panel">
          <div class="panel-heading">
            <h2>Normalized resources</h2>
            <span>{{ filteredResources.length }}</span>
          </div>

          <article
            v-for="resource in filteredResources"
            :key="resource.id"
            class="iac-resource-row"
          >
            <div class="collector-card-icon">
              <component :is="iconForResource(resource)" :size="18" />
            </div>
            <div class="provider-card-main">
              <strong>{{ entityFor(resource)?.name || resource.name }}</strong>
              <span>{{ resource.type }} / {{ resource.provider }}</span>
              <small>{{ resource.address }}</small>
              <div class="provider-chip-list">
                <span v-if="entityFor(resource)">{{ entityFor(resource)?.kind }}</span>
                <span v-if="entityFor(resource)?.environment">{{ entityFor(resource)?.environment }}</span>
                <span>{{ sourceFor(resource.sourceId)?.engine || 'iac' }}</span>
              </div>
            </div>
          </article>

          <p v-if="!filteredResources.length" class="muted">Keine Ressourcen im aktuellen Filter.</p>
        </section>

        <aside class="iac-side-column">
          <section class="collector-page-panel">
            <div class="panel-heading">
              <h2>Selected source</h2>
              <span>{{ selectedSource?.status || 'n/a' }}</span>
            </div>

            <template v-if="selectedSource">
              <div class="iac-source-detail">
                <div class="collector-card-icon">
                  <BracesIcon :size="18" />
                </div>
                <div>
                  <strong>{{ selectedSource.name }}</strong>
                  <span>{{ selectedSource.path || selectedSource.workspacePath || selectedSource.id }}</span>
                  <small>{{ formatDate(selectedSource.lastRun) }}</small>
                </div>
              </div>
              <p v-if="selectedSource.error" class="danger-text">{{ selectedSource.error }}</p>
            </template>
          </section>

          <section class="collector-page-panel">
            <div class="panel-heading">
              <h2>Plan changes</h2>
              <span>{{ sourceChanges.length }}</span>
            </div>

            <article
              v-for="change in sourceChanges"
              :key="change.id"
              class="iac-change-row"
              :data-risk="change.risk"
            >
              <div class="deployment-card-title">
                <strong>{{ change.actions.join(' / ') }}</strong>
                <StatusPill :status="changeTone(change)" />
              </div>
              <span>{{ change.type }} / {{ change.provider }}</span>
              <small>{{ change.address }}</small>
              <small>{{ sourceForChange(change)?.name || change.sourceId }}</small>
            </article>

            <p v-if="!sourceChanges.length" class="muted">Keine Plan-Changes fuer diese Quelle.</p>
          </section>

          <section class="collector-page-panel">
            <div class="panel-heading">
              <h2>Insights</h2>
              <span>{{ insights.length }}</span>
            </div>

            <article
              v-for="insight in insights"
              :key="insight.id"
              class="iac-insight-row"
            >
              <div class="deployment-card-title">
                <strong>{{ insight.title }}</strong>
                <StatusPill :status="insight.severity" />
              </div>
              <small>{{ insight.description }}</small>
            </article>

            <p v-if="!insights.length" class="muted">Keine Insights.</p>
          </section>
        </aside>
      </section>
    </section>
  </main>
</template>
