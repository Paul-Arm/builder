<script setup lang="ts">
import {
  ActivityIcon,
  CloudIcon,
  DatabaseIcon,
  LayersIcon,
  ServerIcon,
  TerminalIcon
} from '@lucide/vue'
import type { Component } from 'vue'
import type { InventoryDataset } from '~~/types/inventory'
import type {
  DeploymentActionKind,
  DeploymentActionPlan,
  DeploymentActionResult,
  ProviderCollectorInstance,
  ProviderDeploymentRef,
  ProviderManifest,
  ProviderRuntimeSnapshot,
  ProviderTargetScope
} from '~~/types/providers'

const { data: inventory, refresh: refreshInventory } = await useFetch<InventoryDataset>('/api/inventory')
const {
  data: runtime,
  pending,
  error,
  refresh: refreshRuntime
} = await useFetch<ProviderRuntimeSnapshot>('/api/providers/runtime')

const query = ref('')
const selectedProviderId = ref<string>('all')
const selectedPlan = ref<DeploymentActionPlan>()
const selectedResult = ref<DeploymentActionResult>()
const planningKey = ref('')
const executing = ref(false)

const providers = computed(() => runtime.value?.providers || [])
const targets = computed(() => runtime.value?.targets || [])
const collectors = computed(() => runtime.value?.collectors || [])
const deployments = computed(() => runtime.value?.deployments || [])
const observations = computed(() => runtime.value?.observations || [])

const providerOptions = computed(() => [
  { label: 'All providers', value: 'all' },
  ...providers.value.map((provider) => ({
    label: provider.displayName,
    value: provider.id
  }))
])

const filteredDeployments = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()

  return deployments.value.filter((deployment) => {
    const matchesProvider = selectedProviderId.value === 'all' || deployment.providerId === selectedProviderId.value
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

function collectorFor(id: string) {
  return collectors.value.find((collector) => collector.id === id)
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

function iconForTarget(target: ProviderTargetScope): Component {
  if (target.kind.includes('cloud') || target.kind.includes('cluster')) {
    return CloudIcon
  }

  if (target.kind.includes('docker') || target.kind.includes('device')) {
    return ServerIcon
  }

  return DatabaseIcon
}

async function refreshAll() {
  selectedPlan.value = undefined
  selectedResult.value = undefined
  await Promise.all([refreshInventory(), refreshRuntime()])
}

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
          <h1>Collectors, Provider, Deployments</h1>
        </div>

        <div class="topbar-actions">
          <USelect
            v-model="selectedProviderId"
            :items="providerOptions"
            value-key="value"
            label-key="label"
            size="md"
            color="neutral"
            class="w-full sm:w-52"
            aria-label="Provider"
          />

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

            <article
              v-for="provider in providers"
              :key="provider.id"
              class="provider-card"
            >
              <div class="collector-card-icon">
                <component :is="iconForProvider(provider)" :size="18" />
              </div>
              <div class="provider-card-main">
                <strong>{{ provider.displayName }}</strong>
                <span>{{ provider.id }} / v{{ provider.version }}</span>
                <small>{{ provider.description }}</small>
                <div class="provider-chip-list">
                  <span v-for="role in provider.roles" :key="`${provider.id}:${role}`">{{ role }}</span>
                </div>
              </div>
            </article>
          </section>

          <section class="collector-page-panel">
            <div class="panel-heading">
              <h2>Targets</h2>
              <span>{{ targets.length }}</span>
            </div>

            <article
              v-for="target in targets"
              :key="target.id"
              class="provider-card compact"
            >
              <div class="collector-card-icon">
                <component :is="iconForTarget(target)" :size="18" />
              </div>
              <div class="provider-card-main">
                <strong>{{ target.name }}</strong>
                <span>{{ target.kind }} / {{ target.transport.label }}</span>
                <small>{{ target.description || target.transport.type }}</small>
              </div>
            </article>
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

          <p v-if="!filteredDeployments.length" class="muted">Keine Deployments im aktuellen Provider-Filter.</p>
        </section>

        <aside class="provider-column">
          <section class="collector-page-panel">
            <div class="panel-heading">
              <h2>Collectors</h2>
              <span>{{ collectors.length }}</span>
            </div>

            <article
              v-for="collector in collectors"
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
              <span>{{ observations.length }}</span>
            </div>
            <div class="provider-chip-list">
              <span
                v-for="capability in providers.flatMap((provider) => provider.capabilities).slice(0, 12)"
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
