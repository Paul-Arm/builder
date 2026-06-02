<script setup lang="ts">
import LocalFolderProviderPanel from '../../../providers/local-folder/ProviderPanel.vue'
import GitHubProviderPanel from '../../../providers/github/ProviderPanel.vue'
import DockerProviderPanel from '../../../providers/docker-cli/ProviderPanel.vue'
import {
  registerProviderUiComponent,
  resolveProviderUiComponent
} from '~/utils/provider-ui-registry'
import type {
  ProviderAddOption,
  ProviderCollectorInstance,
  ProviderManifest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'

const props = defineProps<{
  provider?: ProviderManifest
  collectors: ProviderCollectorInstance[]
  observations: ProviderObservation[]
  targets: ProviderTargetScope[]
}>()

defineEmits<{
  refresh: []
}>()

registerProviderUiComponent('local-folder-panel', LocalFolderProviderPanel)
registerProviderUiComponent('github-panel', GitHubProviderPanel)
registerProviderUiComponent('docker-cli-panel', DockerProviderPanel)

const selectedAddOptionId = ref('')

const selectedAddOptions = computed(() => props.provider?.addOptions || [])
const selectedAddOption = computed(() => {
  return selectedAddOptions.value.find((option) => option.id === selectedAddOptionId.value)
    || selectedAddOptions.value[0]
})

const extensionComponent = computed(() => {
  return resolveProviderUiComponent(props.provider?.ui?.component)
})

watch(() => props.provider?.id, () => {
  selectedAddOptionId.value = props.provider?.addOptions[0]?.id || ''
}, { immediate: true })

function selectAddOption(option: ProviderAddOption) {
  selectedAddOptionId.value = option.id
}

function capabilityLabel(value: string) {
  return value.replace('.', ' / ')
}

function schemaFieldLabel(value: unknown) {
  if (!value || typeof value !== 'object') {
    return 'value'
  }

  const field = value as Record<string, unknown>
  return [
    field.type,
    field.description || field.title || field.placeholder
  ].filter(Boolean).join(' / ') || 'value'
}
</script>

<template>
  <component
    :is="extensionComponent"
    v-if="provider && extensionComponent"
    :provider="provider"
    :collectors="collectors"
    :observations="observations"
    :targets="targets"
    @refresh="$emit('refresh')"
  />

  <section
    v-else
    class="collector-page-panel"
  >
    <div class="panel-heading">
      <h2>Add from {{ provider?.displayName || 'provider' }}</h2>
      <span>{{ selectedAddOptions.length }}</span>
    </div>

    <div
      v-if="selectedAddOptions.length"
      class="provider-add-list"
    >
      <button
        v-for="option in selectedAddOptions"
        :key="option.id"
        type="button"
        class="provider-add-option"
        :class="{ selected: selectedAddOption?.id === option.id }"
        :aria-pressed="selectedAddOption?.id === option.id"
        @click="selectAddOption(option)"
      >
        <strong>{{ option.label }}</strong>
        <span>{{ option.description }}</span>
        <div class="provider-chip-list">
          <span data-category="type">{{ option.type }}</span>
          <span>{{ capabilityLabel(option.capability) }}</span>
        </div>
      </button>
    </div>

    <div
      v-if="selectedAddOption"
      class="provider-add-preview"
    >
      <div class="deployment-card-title">
        <strong>{{ selectedAddOption.label }}</strong>
        <StatusPill status="planned" />
      </div>

      <div
        v-if="selectedAddOption.configSchema"
        class="provider-schema-list"
      >
        <div
          v-for="(field, key) in selectedAddOption.configSchema"
          :key="String(key)"
        >
          <span>{{ key }}</span>
          <small>{{ schemaFieldLabel(field) }}</small>
        </div>
      </div>
    </div>

    <p
      v-if="!selectedAddOptions.length"
      class="muted"
    >
      Keine Add-Optionen fuer {{ provider?.displayName || 'diesen Provider' }}.
    </p>
  </section>
</template>
