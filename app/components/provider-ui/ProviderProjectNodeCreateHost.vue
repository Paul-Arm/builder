<script setup lang="ts">
import GenericProviderNodeCreate from './GenericProviderNodeCreate.vue'
import GitHubProjectNodeCreate from '../../../providers/github/ProjectNodeCreate.vue'
import {
  registerProviderNodeCreateComponent,
  resolveProviderNodeCreateComponent
} from '~/utils/provider-node-create-registry'
import type { InventoryEntity } from '~~/types/inventory'
import type { CreateProjectNodeRequest } from '~~/types/projects'
import type {
  ProviderManifest,
  ProviderNodeCreateOption,
  ProviderObservation
} from '~~/types/providers'

const props = defineProps<{
  provider?: ProviderManifest
  option?: ProviderNodeCreateOption
  observations: ProviderObservation[]
  project?: InventoryEntity
  environments: string[]
  creating?: boolean
}>()

defineEmits<{
  create: [request: CreateProjectNodeRequest]
}>()

registerProviderNodeCreateComponent('github-project-node-create', GitHubProjectNodeCreate)

const createComponent = computed(() => {
  return resolveProviderNodeCreateComponent(props.option?.ui?.component) || GenericProviderNodeCreate
})
</script>

<template>
  <component
    :is="createComponent"
    v-if="provider && option"
    :provider="provider"
    :option="option"
    :observations="observations"
    :project="project"
    :environments="environments"
    :creating="creating"
    @create="$emit('create', $event)"
  />

  <p v-else class="muted">
    Kein Provider-Node-Creator ausgewaehlt.
  </p>
</template>
