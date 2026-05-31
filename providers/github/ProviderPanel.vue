<script setup lang="ts">
import type {
  ProviderAddOption,
  ProviderCollectorInstance,
  ProviderManifest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'
import type {
  GitHubConnectionStatus,
  GitHubSaveTokenRequest
} from './types'

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
  data: connection,
  pending: connectionPending,
  refresh: refreshConnection
} = useFetch<GitHubConnectionStatus>('/api/providers/github/connection', {
  lazy: true,
  server: false
})

const selectedAddOptionId = ref('')
const token = ref('')
const saving = ref(false)
const deleting = ref(false)
const connectionError = ref('')

const selectedAddOptions = computed(() => props.provider.addOptions)
const selectedAddOption = computed(() => {
  return selectedAddOptions.value.find((option) => option.id === selectedAddOptionId.value)
    || selectedAddOptions.value[0]
})

const repositories = computed(() => {
  return props.observations.filter((observation) => observation.kind === 'repository')
})

const branches = computed(() => {
  return props.observations.filter((observation) => observation.kind === 'branch')
})

const workflows = computed(() => {
  return props.observations.filter((observation) => observation.kind === 'workflow')
})

const warnings = computed(() => {
  return props.observations.filter((observation) => observation.kind === 'provider-warning')
})

watch(() => props.provider.id, () => {
  selectedAddOptionId.value = props.provider.addOptions[0]?.id || ''
}, { immediate: true })

function selectAddOption(option: ProviderAddOption) {
  selectedAddOptionId.value = option.id
}

async function saveToken() {
  connectionError.value = ''
  saving.value = true

  try {
    connection.value = await $fetch<GitHubConnectionStatus>('/api/providers/github/connection', {
      method: 'POST',
      body: {
        token: token.value
      } satisfies GitHubSaveTokenRequest
    })
    token.value = ''
    await refreshConnection()
    emit('refresh')
  } catch (error) {
    connectionError.value = errorMessage(error)
  } finally {
    saving.value = false
  }
}

async function deleteToken() {
  connectionError.value = ''
  deleting.value = true

  try {
    connection.value = await $fetch<GitHubConnectionStatus>('/api/providers/github/connection', {
      method: 'DELETE'
    })
    await refreshConnection()
    emit('refresh')
  } catch (error) {
    connectionError.value = errorMessage(error)
  } finally {
    deleting.value = false
  }
}

function repositoryName(observation: ProviderObservation) {
  return stringPayload(observation, 'repository') || observation.externalId
}

function repositoryMeta(observation: ProviderObservation) {
  return [
    stringPayload(observation, 'visibility'),
    stringPayload(observation, 'defaultBranch'),
    stringPayload(observation, 'language')
  ].filter(Boolean).join(' / ') || 'repository'
}

function stringPayload(observation: ProviderObservation, key: string) {
  const value = observation.payload[key]
  return typeof value === 'string' ? value : ''
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

function errorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    if ('statusMessage' in error && typeof error.statusMessage === 'string') {
      return error.statusMessage
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }
  }

  return 'GitHub connection failed'
}
</script>

<template>
  <section class="collector-page-panel provider-extension-panel github-provider-panel">
    <div class="panel-heading">
      <h2>GitHub</h2>
      <span>{{ repositories.length }} repos</span>
    </div>

    <div class="github-connection-card">
      <div class="github-connection-main">
        <div class="collector-card-icon">
          <UIcon
            name="i-lucide-github"
            class="size-5"
          />
        </div>
        <div>
          <strong>{{ connection?.user?.login || 'Not connected' }}</strong>
          <small>{{ connection?.source || 'missing' }} / {{ connection?.fingerprint || 'no token' }}</small>
        </div>
      </div>

      <StatusPill
        :status="connection?.error ? 'degraded' : connection?.configured ? 'connected' : 'disabled'"
      />
    </div>

    <form
      class="github-token-form"
      @submit.prevent="saveToken"
    >
      <UInput
        v-model="token"
        type="password"
        icon="i-lucide-key-round"
        placeholder="Fine-grained PAT"
        autocomplete="off"
        size="sm"
      />
      <UButton
        type="submit"
        icon="i-lucide-lock-keyhole"
        color="primary"
        size="sm"
        :loading="saving"
        :disabled="!token || connectionPending"
      >
        Save
      </UButton>
      <UButton
        icon="i-lucide-trash-2"
        color="neutral"
        variant="ghost"
        size="sm"
        :loading="deleting"
        :disabled="connection?.source !== 'secret-store'"
        @click="deleteToken"
      />
    </form>

    <p
      v-if="connectionError || connection?.error"
      class="muted danger-text"
    >
      {{ connectionError || connection?.error }}
    </p>

    <div class="provider-chip-list">
      <span
        v-for="permission in connection?.requiredPermissions || []"
        :key="permission"
        data-category="type"
      >
        {{ permission }}
      </span>
    </div>

    <div class="provider-extension-actions">
      <button
        v-for="option in selectedAddOptions"
        :key="option.id"
        type="button"
        class="provider-extension-action"
        :class="{ selected: selectedAddOption?.id === option.id }"
        @click="selectAddOption(option)"
      >
        <strong>{{ option.label }}</strong>
        <span>{{ option.type }}</span>
      </button>
    </div>

    <div class="github-provider-stats">
      <span>{{ branches.length }} branches</span>
      <span>{{ workflows.length }} workflows</span>
      <span v-if="warnings.length">{{ warnings.length }} warnings</span>
      <span v-if="connection?.rateLimit?.remaining !== undefined">
        {{ connection.rateLimit.remaining }} api left
      </span>
    </div>

    <div
      v-if="repositories.length"
      class="github-repo-list"
    >
      <article
        v-for="repository in repositories.slice(0, 8)"
        :key="repository.id"
        class="github-repo-row"
      >
        <UIcon
          name="i-lucide-git-branch"
          class="size-4"
        />
        <div>
          <strong>{{ repositoryName(repository) }}</strong>
          <small>{{ repositoryMeta(repository) }}</small>
        </div>
        <small>{{ formatDate(stringPayload(repository, 'updatedAt')) }}</small>
      </article>
    </div>

    <p
      v-else
      class="muted"
    >
      Keine GitHub-Repositories geladen.
    </p>
  </section>
</template>
