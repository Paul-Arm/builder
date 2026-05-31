<script setup lang="ts">
import {
  ActivityIcon,
  LayersIcon,
  ServerIcon,
  TerminalIcon
} from '@lucide/vue'
import ProviderExtensionHost from '~/components/provider-ui/ProviderExtensionHost.vue'
import type { Component } from 'vue'
import type { InventoryDataset } from '~~/types/inventory'
import type {
  DeploymentActionKind,
  DeploymentActionPlan,
  DeploymentActionResult,
  ProviderDeploymentRef,
  ProviderManifest,
  ProviderRuntimeSnapshot
} from '~~/types/providers'

const { data: inventory, refresh: refreshInventory } = useFetch<InventoryDataset>('/api/inventory', {
  lazy: true
})
const {
  data: runtime,
  pending,
  error,
  refresh: refreshRuntime
} = useFetch<ProviderRuntimeSnapshot>('/api/providers/runtime', {
  lazy: true
})

const query = ref('')
const selectedProviderId = ref<string>('')
const selectedPlan = ref<DeploymentActionPlan>()
const selectedResult = ref<DeploymentActionResult>()
const planningKey = ref('')
const executing = ref(false)

const providers = computed(() => runtime.value?.providers || [])
const targets = computed(() => runtime.value?.targets || [])
const collectors = computed(() => runtime.value?.collectors || [])
const deployments = computed(() => runtime.value?.deployments || [])
const observations = computed(() => runtime.value?.observations || [])

const activeProviderId = computed(() => selectedProviderId.value || providers.value[0]?.id || '')

const selectedProvider = computed(() => providerFor(activeProviderId.value))

const filteredCollectors = computed(() => {
  return collectors.value.filter((collector) => {
    return collector.providerId === activeProviderId.value
  })
})

const filteredDeployments = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()

  return deployments.value.filter((deployment) => {
    const matchesProvider = deployment.providerId === activeProviderId.value
    const matchesQuery = !normalizedQuery || [
      deployment.name,
      deployment.service,
      deployment.project,
      deployment.environment,
      deployment.image,
      deployment.status,
      deployment.ports.join(' ')
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)

    return matchesProvider && matchesQuery
  })
})

const filteredObservations = computed(() => {
  return observations.value.filter((observation) => {
    return observation.providerId === activeProviderId.value
  })
})

const visibleCapabilities = computed(() => {
  return selectedProvider.value?.capabilities.slice(0, 12) || []
})

const collectorCount = computed(() => collectors.value.length || inventory.value?.collectors.length || 0)
const inventoryMode = computed(() => {
  if (collectors.value.some((collector) => collector.mode === 'write_capable')) {
    return 'mixed'
  }

  return inventory.value?.mode
})

function providerFor(id: string) {
  return providers.value.find((provider) => provider.id === id)
}

function targetFor(id: string) {
  return targets.value.find((target) => target.id === id)
}

function selectProvider(provider: ProviderManifest) {
  selectedProviderId.value = provider.id
}

function providerCollectorCount(providerId: string) {
  return collectors.value.filter((collector) => collector.providerId === providerId).length
}

function providerDeploymentCount(providerId: string) {
  return deployments.value.filter((deployment) => deployment.providerId === providerId).length
}

function iconForProvider(provider: ProviderManifest): Component {
  if (provider.roles.includes('observability.provider')) {
    return ActivityIcon
  }

  if (provider.roles.includes('deployment.provider')) {
    return LayersIcon
  }

  if (provider.roles.includes('inventory.provider')) {
    return ServerIcon
  }

  return TerminalIcon
}

async function refreshAll() {
  selectedPlan.value = undefined
  selectedResult.value = undefined
  await Promise.all([refreshInventory(), refreshRuntime()])
}

watch(providers, (nextProviders) => {
  if (!nextProviders.length) {
    selectedProviderId.value = ''
    return
  }

  if (!selectedProviderId.value || !nextProviders.some((provider) => provider.id === selectedProviderId.value)) {
    selectedProviderId.value = nextProviders[0]?.id || ''
  }
}, { immediate: true })

watch(selectedProvider, (provider) => {
  selectedPlan.value = undefined
  selectedResult.value = undefined
}, { immediate: true })

async function planDeploymentAction(deployment: ProviderDeploymentRef, action: DeploymentActionKind) {
  planningKey.value = `${deployment.id}:${action}`
  selectedResult.value = undefined
  try {
    selectedPlan.value = await $fetch<DeploymentActionPlan>('/api/providers/action-plan', {
      method: 'POST',
      body: {
        providerId: deployment.providerId,
        collectorId: deployment.collectorId,
        deploymentId: deployment.id,
        action
      }
    })
  } finally {
    planningKey.value = ''
  }
}

async function executeSelectedPlan() {
  if (!selectedPlan.value) {
    return
  }

  executing.value = true
  selectedResult.value = undefined

  try {
    selectedResult.value = await $fetch<DeploymentActionResult>('/api/providers/execute-action', {
      method: 'POST',
      body: {
        providerId: selectedPlan.value.providerId,
        collectorId: selectedPlan.value.collectorId,
        deploymentId: selectedPlan.value.deploymentId,
        action: selectedPlan.value.action
      }
    })
    await refreshRuntime()
  } finally {
    executing.value = false
  }
}

function commandText(plan: DeploymentActionPlan) {
  return plan.command.join(' ')
}

function capabilityLabel(value: string) {
  return value.replace('.', ' / ')
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

function actionIcon(action: DeploymentActionKind) {
  if (action === 'stop') {
    return 'i-lucide-square'
  }

  if (action === 'restart') {
    return 'i-lucide-rotate-cw'
  }

  if (action === 'create') {
    return 'i-lucide-plus'
  }

  return 'i-lucide-play'
}

function actionColor(action: DeploymentActionKind) {
  return action === 'stop' ? 'warning' : 'neutral'
}
</script>

<template>
  <main class="app-frame">
    <AppRail :mode="inventoryMode" :collector-count="collectorCount" />

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Provider runtime</p>
          <h1>Providers, Collectors, Deployments</h1>
        </div>

        <div class="topbar-actions">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Deployment, Image, Port"
            class="w-full sm:w-72"
            size="md"
          />

          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            title="Refresh providers"
            @click="refreshAll()"
          />
        </div>
      </header>

      <div v-if="pending" class="empty-state">Provider runtime wird geladen</div>
      <div v-else-if="error" class="empty-state danger">Provider runtime nicht erreichbar</div>

      <section v-else class="provider-console">
        <aside class="provider-column">
          <section class="collector-page-panel">
            <div class="panel-heading">
              <h2>Providers</h2>
              <span>{{ providers.length }}</span>
            </div>

            <button
              v-for="provider in providers"
              :key="provider.id"
              type="button"
              class="provider-card provider-select-card"
              :class="{ selected: activeProviderId === provider.id }"
              :aria-pressed="activeProviderId === provider.id"
              @click="selectProvider(provider)"
            >
              <div class="collector-card-icon">
                <component :is="iconForProvider(provider)" :size="18" />
              </div>
              <div class="provider-card-main">
                <strong>{{ provider.displayName }}</strong>
                <span>{{ provider.id }} / v{{ provider.version }}</span>
                <small>{{ provider.description }}</small>
                <div class="provider-chip-list">
                  <span
                    v-for="type in provider.types"
                    :key="`${provider.id}:type:${type}`"
                    data-category="type"
                  >
                    {{ type }}
                  </span>
                  <span v-for="role in provider.roles" :key="`${provider.id}:${role}`">{{ role }}</span>
                </div>
                <div class="provider-card-stats">
                  <span>{{ providerCollectorCount(provider.id) }} collectors</span>
                  <span>{{ providerDeploymentCount(provider.id) }} deployments</span>
                </div>
              </div>
            </button>
          </section>

        </aside>

        <section class="deployment-panel">
          <div class="panel-heading">
            <h2>Deployments</h2>
            <span>{{ filteredDeployments.length }}</span>
          </div>

          <article
            v-for="deployment in filteredDeployments"
            :key="deployment.id"
            class="deployment-card"
            :data-status="deployment.status"
          >
            <div class="deployment-card-main">
              <div class="deployment-card-title">
                <strong>{{ deployment.name }}</strong>
                <StatusPill :status="deployment.status" />
              </div>
              <span>{{ deployment.image || 'unknown image' }}</span>
              <small>
                {{ deployment.project || 'unmapped project' }} /
                {{ deployment.service || 'unmapped service' }} /
                {{ deployment.environment || 'unknown env' }}
              </small>
              <div class="provider-chip-list">
                <span>{{ providerFor(deployment.providerId)?.displayName || deployment.providerId }}</span>
                <span>{{ targetFor(deployment.targetId)?.name || deployment.targetId }}</span>
                <span v-if="deployment.ports.length">{{ deployment.ports.join(', ') }}</span>
              </div>
            </div>

            <div class="deployment-card-actions">
              <UButton
                v-for="action in deployment.actions"
                :key="`${deployment.id}:${action}`"
                :icon="actionIcon(action)"
                :color="actionColor(action)"
                variant="outline"
                size="sm"
                :loading="planningKey === `${deployment.id}:${action}`"
                @click="planDeploymentAction(deployment, action)"
              >
                {{ action }}
              </UButton>
            </div>
          </article>

          <p v-if="!filteredDeployments.length" class="muted">
            Keine Deployments fuer {{ selectedProvider?.displayName || 'diesen Provider' }}.
          </p>
        </section>

        <aside class="provider-column">
          <ProviderExtensionHost
            :provider="selectedProvider"
            :collectors="filteredCollectors"
            :observations="filteredObservations"
            :targets="targets"
            @refresh="refreshAll"
          />

          <section class="collector-page-panel">
            <div class="panel-heading">
              <h2>Collectors</h2>
              <span>{{ filteredCollectors.length }}</span>
            </div>

            <article
              v-for="collector in filteredCollectors"
              :key="collector.id"
              class="collector-card compact"
            >
              <div class="collector-card-icon">
                <TerminalIcon :size="18" />
              </div>
              <div class="collector-card-main">
                <strong>{{ providerFor(collector.providerId)?.displayName || collector.providerId }}</strong>
                <span>{{ targetFor(collector.targetId)?.name || collector.targetId }}</span>
                <small>{{ collector.summary }}</small>
              </div>
              <div class="collector-card-meta">
                <StatusPill :status="collector.status" />
                <StatusPill :status="collector.mode" />
                <small>{{ formatDate(collector.lastRun) }}</small>
              </div>
            </article>

            <p v-if="!filteredCollectors.length" class="muted">
              Keine Collectors fuer {{ selectedProvider?.displayName || 'diesen Provider' }}.
            </p>
          </section>

          <section class="collector-page-panel action-plan-panel">
            <div class="panel-heading">
              <h2>Action plan</h2>
              <span>{{ selectedPlan ? selectedPlan.action : 'preview' }}</span>
            </div>

            <template v-if="selectedPlan">
              <div class="action-plan-summary">
                <strong>{{ selectedPlan.summary }}</strong>
                <small>{{ selectedPlan.targetLabel }} / {{ selectedPlan.risk }} risk</small>
              </div>

              <pre>{{ commandText(selectedPlan) }}</pre>

              <UButton
                icon="i-lucide-zap"
                color="primary"
                variant="solid"
                size="sm"
                :disabled="!selectedPlan.executable"
                :loading="executing"
                @click="executeSelectedPlan"
              >
                Execute action
              </UButton>

              <div v-if="selectedResult" class="action-result">
                <div class="deployment-card-title">
                  <strong>Result</strong>
                  <StatusPill :status="selectedResult.status" />
                </div>
                <small>{{ formatDate(selectedResult.executedAt) }}</small>
                <pre v-if="selectedResult.stdout || selectedResult.stderr">{{ selectedResult.stdout || selectedResult.stderr }}</pre>
              </div>
            </template>

            <p v-else class="muted">Waehle start, stop oder restart, pruefe den Plan und fuehre ihn dann aus.</p>
          </section>

          <section class="collector-page-panel">
            <div class="panel-heading">
              <h2>Observations</h2>
              <span>{{ filteredObservations.length }}</span>
            </div>
            <div class="provider-chip-list">
              <span
                v-for="capability in visibleCapabilities"
                :key="capability"
              >
                {{ capabilityLabel(capability) }}
              </span>
            </div>
          </section>
        </aside>
      </section>
    </section>
  </main>
</template>
