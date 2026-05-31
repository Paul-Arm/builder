<script setup lang="ts">
import {
  CloudIcon,
  DatabaseIcon,
  HardDriveIcon,
  ServerIcon,
  TerminalIcon
} from '@lucide/vue'
import type { Component } from 'vue'
import type { InventoryDataset } from '~~/types/inventory'
import type {
  ProviderCollectorInstance,
  ProviderDeploymentRef,
  ProviderObservation,
  ProviderRuntimeSnapshot,
  ProviderTargetScope
} from '~~/types/providers'

const { data: inventory, refresh: refreshInventory } = useFetch<InventoryDataset>('/api/inventory', {
  lazy: true,
  server: false
})
const {
  data: runtime,
  pending,
  error,
  refresh: refreshRuntime
} = useFetch<ProviderRuntimeSnapshot>('/api/providers/runtime', {
  lazy: true,
  server: false
})

const query = ref('')
const selectedTargetId = ref<string>()

const targets = computed(() => runtime.value?.targets || [])
const collectors = computed(() => runtime.value?.collectors || [])
const deployments = computed(() => runtime.value?.deployments || [])
const observations = computed(() => runtime.value?.observations || [])
const runtimeLoading = computed(() => pending.value || (!runtime.value && !error.value))

const filteredTargets = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()

  return targets.value.filter((target) => {
    return !normalizedQuery || [
      target.name,
      target.kind,
      target.description,
      target.transport.label,
      ...Object.values(target.labels)
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
  })
})

const selectedTarget = computed(() => {
  return targets.value.find((target) => target.id === selectedTargetId.value) || filteredTargets.value[0] || targets.value[0]
})

const targetCollectors = computed(() => {
  return selectedTarget.value
    ? collectors.value.filter((collector) => collector.targetId === selectedTarget.value?.id)
    : []
})

const targetDeployments = computed(() => {
  return selectedTarget.value
    ? deployments.value.filter((deployment) => deployment.targetId === selectedTarget.value?.id)
    : []
})

const targetObservations = computed(() => {
  return selectedTarget.value
    ? observations.value.filter((observation) => observation.targetId === selectedTarget.value?.id)
    : []
})

const collectorCount = computed(() => collectors.value.length || inventory.value?.collectors.length || 0)
const inventoryMode = computed(() => {
  if (collectors.value.some((collector) => collector.mode === 'write_capable')) {
    return 'mixed'
  }

  return inventory.value?.mode
})

watch(filteredTargets, (nextTargets) => {
  if (!nextTargets.length) {
    selectedTargetId.value = undefined
    return
  }

  if (!selectedTargetId.value || !nextTargets.some((target) => target.id === selectedTargetId.value)) {
    selectedTargetId.value = nextTargets[0]?.id
  }
}, { immediate: true })

async function refreshAll() {
  await Promise.all([refreshInventory(), refreshRuntime()])
}

function selectTarget(target: ProviderTargetScope) {
  selectedTargetId.value = target.id
}

function iconForTarget(target: ProviderTargetScope): Component {
  if (target.kind.includes('cloud') || target.kind.includes('cluster')) {
    return CloudIcon
  }

  if (target.kind.includes('docker') || target.kind.includes('device')) {
    return ServerIcon
  }

  return HardDriveIcon
}

function iconForCollector(collector: ProviderCollectorInstance): Component {
  if (collector.providerId.includes('docker')) {
    return ServerIcon
  }

  return TerminalIcon
}

function deploymentLine(deployment: ProviderDeploymentRef) {
  return [
    deployment.project || 'unmapped project',
    deployment.service || 'unmapped service',
    deployment.environment || 'unknown env'
  ].join(' / ')
}

function observationLine(observation: ProviderObservation) {
  return [
    observation.kind,
    observation.externalId,
    observation.fingerprint.slice(0, 8)
  ].join(' / ')
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
    <AppRail :mode="inventoryMode" :collector-count="collectorCount" />

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Runtime scopes</p>
          <h1>Targets</h1>
        </div>

        <div class="topbar-actions">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Target, Transport, Label"
            class="w-full sm:w-72"
            size="md"
          />

          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            title="Refresh targets"
            @click="refreshAll()"
          />
        </div>
      </header>

      <div v-if="runtimeLoading" class="empty-state">Targets werden geladen</div>
      <div v-else-if="error" class="empty-state danger">Provider runtime nicht erreichbar</div>

      <section v-else class="target-console">
        <aside class="collector-page-panel target-list-panel">
          <div class="panel-heading">
            <h2>Targets</h2>
            <span>{{ filteredTargets.length }}</span>
          </div>

          <button
            v-for="target in filteredTargets"
            :key="target.id"
            type="button"
            class="target-row"
            :class="{ selected: selectedTarget?.id === target.id }"
            @click="selectTarget(target)"
          >
            <span class="collector-card-icon">
              <component :is="iconForTarget(target)" :size="18" />
            </span>
            <span class="provider-card-main">
              <strong>{{ target.name }}</strong>
              <span>{{ target.kind }} / {{ target.transport.label }}</span>
              <small>{{ target.description || target.transport.type }}</small>
            </span>
          </button>

          <p v-if="!filteredTargets.length" class="muted">Keine Targets im aktuellen Filter.</p>
        </aside>

        <section class="target-detail-panel">
          <template v-if="selectedTarget">
            <div class="target-hero">
              <div class="collector-card-icon">
                <component :is="iconForTarget(selectedTarget)" :size="20" />
              </div>
              <div>
                <EntityBadge kind="host" />
                <h2>{{ selectedTarget.name }}</h2>
                <p>{{ selectedTarget.kind }} / {{ selectedTarget.transport.label }}</p>
              </div>
            </div>

            <section class="target-section">
              <div class="panel-heading">
                <h2>Collectors</h2>
                <span>{{ targetCollectors.length }}</span>
              </div>

              <article
                v-for="collector in targetCollectors"
                :key="collector.id"
                class="collector-card compact"
              >
                <div class="collector-card-icon">
                  <component :is="iconForCollector(collector)" :size="18" />
                </div>
                <div class="collector-card-main">
                  <strong>{{ collector.providerId }}</strong>
                  <span>{{ collector.summary }}</span>
                  <small>{{ formatDate(collector.lastRun) }}</small>
                </div>
                <div class="collector-card-meta">
                  <StatusPill :status="collector.status" />
                  <StatusPill :status="collector.mode" />
                </div>
              </article>

              <p v-if="!targetCollectors.length" class="muted">Keine Collectors fuer dieses Target.</p>
            </section>

            <section class="target-section">
              <div class="panel-heading">
                <h2>Deployments on target</h2>
                <span>{{ targetDeployments.length }}</span>
              </div>

              <article
                v-for="deployment in targetDeployments"
                :key="deployment.id"
                class="deployment-card"
              >
                <div class="deployment-card-main">
                  <div class="deployment-card-title">
                    <strong>{{ deployment.name }}</strong>
                    <StatusPill :status="deployment.status" />
                  </div>
                  <span>{{ deployment.image || 'unknown image' }}</span>
                  <small>{{ deploymentLine(deployment) }}</small>
                </div>
              </article>

              <p v-if="!targetDeployments.length" class="muted">Keine Deployments auf diesem Target.</p>
            </section>

            <section class="target-section">
              <div class="panel-heading">
                <h2>Observations</h2>
                <span>{{ targetObservations.length }}</span>
              </div>

              <article
                v-for="observation in targetObservations"
                :key="observation.id"
                class="provider-card compact"
              >
                <div class="collector-card-icon">
                  <DatabaseIcon :size="18" />
                </div>
                <div class="provider-card-main">
                  <strong>{{ observation.externalId }}</strong>
                  <span>{{ observationLine(observation) }}</span>
                  <small>{{ formatDate(observation.observedAt) }}</small>
                </div>
              </article>
            </section>
          </template>
        </section>
      </section>
    </section>
  </main>
</template>
