<script setup lang="ts">
import type { InventoryEntity } from '~~/types/inventory'
import type { CreateProjectNodeRequest } from '~~/types/projects'
import type {
  ProviderManifest,
  ProviderNodeCreateOption,
  ProviderObservation
} from '~~/types/providers'

const props = defineProps<{
  provider: ProviderManifest
  option: ProviderNodeCreateOption
  observations: ProviderObservation[]
  project?: InventoryEntity
  environments: string[]
  creating?: boolean
}>()

const emit = defineEmits<{
  create: [request: CreateProjectNodeRequest]
}>()

const draft = reactive({
  name: '',
  environment: '',
  platform: '',
  owner: '',
  description: '',
  tags: ''
})

watch(() => props.option.id, () => {
  draft.name = ''
  draft.environment = props.environments[0] || ''
  draft.platform = props.option.defaultPlatform || props.option.nodeKind
  draft.owner = props.project?.owner || ''
  draft.description = props.option.description
  draft.tags = (props.option.tags || []).join(', ')
}, { immediate: true })

watch(() => props.environments, (environments) => {
  if (!draft.environment || !environments.includes(draft.environment)) {
    draft.environment = environments[0] || ''
  }
}, { immediate: true })

function createNode() {
  emit('create', {
    kind: props.option.nodeKind,
    name: draft.name,
    provider: props.option.defaultProvider || props.provider.id,
    platform: draft.platform || props.option.defaultPlatform || props.option.nodeKind,
    environment: draft.environment,
    owner: draft.owner,
    description: draft.description,
    tags: splitTags(draft.tags),
    metadata: {
      providerNodeOptionId: props.option.id,
      providerNodeType: props.option.type
    }
  })
}

function splitTags(value: string) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}
</script>

<template>
  <form class="provider-node-create-form" @submit.prevent="createNode">
    <div class="provider-node-create-head">
      <div class="collector-card-icon">
        <UIcon name="i-lucide-plus" class="size-5" />
      </div>
      <div>
        <strong>{{ option.label }}</strong>
        <small>{{ option.description }}</small>
      </div>
      <EntityBadge :kind="option.nodeKind" />
    </div>

    <div class="project-form-row">
      <UInput v-model="draft.name" placeholder="Node name" size="sm" />
      <USelect
        v-model="draft.environment"
        :items="environments.map((environment) => ({ label: environment, value: environment }))"
        value-key="value"
        label-key="label"
        placeholder="Environment"
        size="sm"
        :disabled="!environments.length"
      />
    </div>

    <div class="project-form-row">
      <UInput v-model="draft.platform" placeholder="Platform" size="sm" />
      <UInput v-model="draft.owner" placeholder="Owner" size="sm" />
    </div>

    <UTextarea v-model="draft.description" placeholder="Description" :rows="2" />
    <UInput v-model="draft.tags" placeholder="tags, comma separated" size="sm" />

    <UButton
      type="submit"
      icon="i-lucide-plus"
      color="primary"
      size="sm"
      :loading="creating"
      :disabled="!draft.name || !draft.environment"
    >
      Create node
    </UButton>
  </form>
</template>
