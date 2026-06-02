<script setup lang="ts">
import type {
  ProviderCollectorInstance,
  ProviderDeploymentMetrics,
  ProviderManifest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'
import type { DockerManagerArea, DockerManagerState } from './types'

const props = defineProps<{
  provider: ProviderManifest
  collectors: ProviderCollectorInstance[]
  observations: ProviderObservation[]
  targets: ProviderTargetScope[]
}>()

const emit = defineEmits<{
  refresh: []
}>()

const {
  data: manager,
  pending: managerPending,
  refresh: refreshManager
} = useFetch<DockerManagerState>('/api/providers/docker-cli/manager', {
  lazy: true,
  server: false
})

const collector = computed(() => props.collectors[0])
const target = computed(() => {
  return props.targets.find((item) => item.id === collector.value?.targetId)
})
const containerObservations = computed(() => observationsByKind('container'))
const volumeObservations = computed(() => observationsByKind('docker-volume'))
const networkObservations = computed(() => observationsByKind('docker-network'))
const systemObservations = computed(() => observationsByKind('docker-system'))
const metricRows = computed(() => {
  return observationsByKind('container-metrics')
    .map((observation) => metricRowFromObservation(observation))
    .filter((row): row is DockerMetricRow => Boolean(row))
    .sort((left, right) => {
      return (right.metrics.cpuPercent || 0) - (left.metrics.cpuPercent || 0)
        || (right.metrics.memoryUsageBytes || 0) - (left.metrics.memoryUsageBytes || 0)
    })
    .slice(0, 5)
})

const managerStatus = computed(() => manager.value?.status || 'disabled')
const managerAreas = computed(() => manager.value?.areas || [])
const resourceStats = computed(() => [
  {
    label: 'Containers',
    value: containerObservations.value.length,
    icon: 'i-lucide-box'
  },
  {
    label: 'Volumes',
    value: volumeObservations.value.length,
    icon: 'i-lucide-database'
  },
  {
    label: 'Networks',
    value: networkObservations.value.length,
    icon: 'i-lucide-network'
  },
  {
    label: 'System rows',
    value: systemObservations.value.length,
    icon: 'i-lucide-hard-drive'
  }
])

interface DockerMetricRow {
  name: string
  image?: string
  service?: string
  project?: string
  environment?: string
  metrics: ProviderDeploymentMetrics
}

async function refreshPanel() {
  await refreshManager()
  emit('refresh')
}

function observationsByKind(kind: string) {
  return props.observations.filter((observation) => observation.kind === kind)
}

function metricRowFromObservation(observation: ProviderObservation): DockerMetricRow | undefined {
  const payload = observation.payload as {
    name?: unknown
    image?: unknown
    service?: unknown
    project?: unknown
    environment?: unknown
    metrics?: unknown
  }

  if (!payload.metrics || typeof payload.metrics !== 'object') {
    return undefined
  }

  return {
    name: typeof payload.name === 'string' ? payload.name : observation.externalId,
    image: typeof payload.image === 'string' ? payload.image : undefined,
    service: typeof payload.service === 'string' ? payload.service : undefined,
    project: typeof payload.project === 'string' ? payload.project : undefined,
    environment: typeof payload.environment === 'string' ? payload.environment : undefined,
    metrics: payload.metrics as ProviderDeploymentMetrics
  }
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

function formatPercent(value?: number) {
  return value === undefined ? 'n/a' : `${value.toFixed(value >= 10 ? 1 : 2)}%`
}

function formatBytes(value?: number) {
  if (value === undefined) {
    return 'n/a'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }

  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function managerAreaIcon(area: DockerManagerArea) {
  if (area.id === 'containers') {
    return 'i-lucide-box'
  }

  if (area.id === 'volumes') {
    return 'i-lucide-database'
  }

  if (area.id === 'networks') {
    return 'i-lucide-network'
  }

  if (area.id === 'images') {
    return 'i-lucide-layers'
  }

  if (area.id === 'stacks') {
    return 'i-lucide-panels-top-left'
  }

  return 'i-lucide-gauge'
}
</script>

<template>
  <section class="collector-page-panel provider-extension-panel docker-provider-panel">
    <div class="panel-heading">
      <h2>Docker Manager</h2>
      <StatusPill :status="managerStatus" />
    </div>

    <div class="docker-manager-card">
      <div class="github-connection-main">
        <div class="collector-card-icon">
          <UIcon name="i-lucide-ship-wheel" class="size-5" />
        </div>
        <div>
          <strong>Portainer CE</strong>
          <small>{{ manager?.baseUrl || 'http://localhost:9000' }}</small>
          <small v-if="manager?.error" class="danger-text">{{ manager.error }}</small>
        </div>
      </div>

      <div class="docker-manager-controls">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="sm"
          title="Refresh Docker manager"
          :loading="managerPending"
          @click="refreshPanel"
        />
        <UButton
          v-if="manager?.baseUrl"
          icon="i-lucide-external-link"
          color="primary"
          size="sm"
          :to="manager.baseUrl"
          target="_blank"
        >
          Open Portainer
        </UButton>
      </div>
    </div>

    <div v-if="managerAreas.length" class="docker-manager-areas">
      <UButton
        v-for="area in managerAreas"
        :key="area.id"
        :icon="managerAreaIcon(area)"
        color="neutral"
        variant="outline"
        size="sm"
        :to="area.url"
        target="_blank"
      >
        {{ area.label }}
      </UButton>
    </div>

    <div class="docker-resource-grid">
      <div
        v-for="stat in resourceStats"
        :key="stat.label"
        class="docker-resource-stat"
      >
        <UIcon :name="stat.icon" />
        <span>{{ stat.label }}</span>
        <strong>{{ stat.value }}</strong>
      </div>
    </div>

    <div v-if="collector" class="docker-collector-row">
      <div class="collector-card-icon">
        <UIcon name="i-lucide-terminal" class="size-5" />
      </div>
      <div class="collector-card-main">
        <strong>{{ target?.name || collector.targetId }}</strong>
        <span>{{ collector.summary }}</span>
        <small>{{ collector.config.dockerContext || 'current' }} / {{ formatDate(collector.lastRun) }}</small>
      </div>
      <div class="collector-card-meta">
        <StatusPill :status="collector.status" />
        <StatusPill :status="collector.mode" />
      </div>
    </div>

    <section class="docker-metrics-panel">
      <div class="panel-heading">
        <h2>Top Metrics</h2>
        <span>{{ metricRows.length }}</span>
      </div>

      <div v-if="metricRows.length" class="docker-metric-list">
        <article
          v-for="row in metricRows"
          :key="row.name"
          class="docker-metric-row"
        >
          <div>
            <strong>{{ row.name }}</strong>
            <small>{{ row.project || 'unmapped project' }} / {{ row.service || 'unmapped service' }}</small>
          </div>
          <div class="docker-metric-values">
            <span>{{ formatPercent(row.metrics.cpuPercent) }} CPU</span>
            <span>{{ formatBytes(row.metrics.memoryUsageBytes) }} RAM</span>
            <span>{{ formatBytes(row.metrics.networkRxBytes) }} in</span>
            <span>{{ formatBytes(row.metrics.networkTxBytes) }} out</span>
          </div>
        </article>
      </div>

      <p v-else class="muted">No Docker stats returned yet.</p>
    </section>
  </section>
</template>
