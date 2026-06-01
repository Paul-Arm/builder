<script setup lang="ts">
import GitHubMarkIcon from '~/components/icons/GitHubMarkIcon.vue'
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

const selectedRepository = ref('')
const selectedBranch = ref('')
const selectedWorkflow = ref('')
const folder = ref('')
const pagesUrl = ref('')
const workflowPath = ref('')
const nodeName = ref('')
const environment = ref('')
const description = ref('')

const repositories = computed(() => {
  return props.observations
    .filter((observation) => observation.kind === 'repository')
    .sort((a, b) => repositoryName(a).localeCompare(repositoryName(b)))
})

const pageRepositories = computed(() => {
  const withPages = repositories.value.filter((repository) => booleanPayload(repository, 'hasPages'))
  return withPages.length ? withPages : repositories.value
})

const workflows = computed(() => {
  return props.observations
    .filter((observation) => observation.kind === 'workflow')
    .sort((a, b) => workflowName(a).localeCompare(workflowName(b)))
})

const repositoryItems = computed(() => {
  const source = isPagesOption.value ? pageRepositories.value : repositories.value
  return source.map((repository) => ({
    label: repositoryName(repository),
    value: repositoryName(repository)
  }))
})

const branchItems = computed(() => {
  const branches = props.observations
    .filter((observation) => {
      return observation.kind === 'branch'
        && stringPayload(observation, 'repository') === selectedRepository.value
    })
    .map((observation) => stringPayload(observation, 'branch'))
    .filter(Boolean)

  if (!branches.length) {
    const defaultBranch = selectedRepositoryObservation.value
      ? stringPayload(selectedRepositoryObservation.value, 'defaultBranch')
      : ''
    return defaultBranch ? [{ label: defaultBranch, value: defaultBranch }] : []
  }

  return Array.from(new Set(branches)).sort().map((branch) => ({
    label: branch,
    value: branch
  }))
})

const workflowItems = computed(() => {
  return workflows.value
    .filter((observation) => stringPayload(observation, 'repository') === selectedRepository.value)
    .map((observation) => ({
      label: workflowLabel(observation),
      value: observation.externalId
    }))
})

const selectedRepositoryObservation = computed(() => {
  return repositories.value.find((repository) => repositoryName(repository) === selectedRepository.value)
})

const selectedWorkflowObservation = computed(() => {
  return workflows.value.find((workflow) => workflow.externalId === selectedWorkflow.value)
})

const isPagesOption = computed(() => props.option.id.includes('pages'))
const isWorkflowOption = computed(() => props.option.id.includes('workflow'))
const canCreate = computed(() => {
  return Boolean(
    selectedRepository.value
    && environment.value
    && resolvedName.value
    && (!isWorkflowOption.value || resolvedWorkflowPath.value)
  )
})
const resolvedName = computed(() => {
  if (nodeName.value.trim()) {
    return nodeName.value.trim()
  }

  if (!selectedRepository.value) {
    return ''
  }

  if (isPagesOption.value) {
    return pagesUrl.value.trim() || inferredPagesUrl.value || `${selectedRepository.value} pages`
  }

  if (isWorkflowOption.value) {
    return selectedWorkflowObservation.value
      ? workflowName(selectedWorkflowObservation.value)
      : workflowPath.value.trim() || `${selectedRepository.value} workflow`
  }

  return folder.value.trim()
    ? `${selectedRepository.value}:${folder.value.trim()}`
    : selectedRepository.value
})
const resolvedWorkflowPath = computed(() => {
  return selectedWorkflowObservation.value
    ? stringPayload(selectedWorkflowObservation.value, 'path')
    : workflowPath.value.trim()
})
const inferredPagesUrl = computed(() => {
  if (!selectedRepository.value) {
    return ''
  }

  const [owner, repo] = selectedRepository.value.split('/')
  if (!owner || !repo) {
    return ''
  }

  return `https://${owner}.github.io/${repo}`
})

watch(() => props.option.id, () => {
  selectedRepository.value = repositoryItems.value[0]?.value || ''
  selectedBranch.value = ''
  selectedWorkflow.value = ''
  folder.value = ''
  pagesUrl.value = ''
  workflowPath.value = ''
  nodeName.value = ''
  environment.value = props.environments[0] || ''
  description.value = props.option.description
}, { immediate: true })

watch(repositoryItems, (items) => {
  if (!items.some((item) => item.value === selectedRepository.value)) {
    selectedRepository.value = items[0]?.value || ''
  }
}, { immediate: true })

watch(branchItems, (items) => {
  if (!items.some((item) => item.value === selectedBranch.value)) {
    selectedBranch.value = items[0]?.value || ''
  }
}, { immediate: true })

watch(workflowItems, (items) => {
  if (!items.some((item) => item.value === selectedWorkflow.value)) {
    selectedWorkflow.value = items[0]?.value || ''
  }
}, { immediate: true })

watch(() => props.environments, (environments) => {
  if (!environment.value || !environments.includes(environment.value)) {
    environment.value = environments[0] || ''
  }
}, { immediate: true })

function createNode() {
  if (isPagesOption.value) {
    emit('create', {
      kind: props.option.nodeKind,
      name: resolvedName.value,
      provider: props.option.defaultProvider || props.provider.id,
      platform: props.option.defaultPlatform || 'github-pages',
      environment: environment.value,
      owner: props.project?.owner,
      description: description.value,
      tags: ['hosting', 'github-pages'],
      externalId: `github-pages:${selectedRepository.value}`,
      metadata: {
        providerNodeOptionId: props.option.id,
        repository: selectedRepository.value,
        pagesUrl: pagesUrl.value.trim() || inferredPagesUrl.value,
        htmlUrl: stringPayload(selectedRepositoryObservation.value, 'url'),
        hasPages: true
      }
    })
    return
  }

  if (isWorkflowOption.value) {
    emit('create', {
      kind: props.option.nodeKind,
      name: resolvedName.value,
      provider: props.option.defaultProvider || props.provider.id,
      platform: props.option.defaultPlatform || 'github-actions',
      environment: environment.value,
      owner: props.project?.owner,
      description: description.value,
      tags: ['ci', 'cd', 'github-actions'],
      externalId: selectedWorkflowObservation.value?.externalId
        || `github:${selectedRepository.value}:workflow:${resolvedWorkflowPath.value}`,
      metadata: {
        providerNodeOptionId: props.option.id,
        repository: selectedRepository.value,
        workflowId: numberPayload(selectedWorkflowObservation.value, 'workflowId'),
        workflowName: selectedWorkflowObservation.value ? workflowName(selectedWorkflowObservation.value) : resolvedName.value,
        workflowPath: resolvedWorkflowPath.value,
        state: stringPayload(selectedWorkflowObservation.value, 'state'),
        htmlUrl: stringPayload(selectedWorkflowObservation.value, 'url'),
        badgeUrl: stringPayload(selectedWorkflowObservation.value, 'badgeUrl')
      }
    })
    return
  }

  const normalizedFolder = folder.value.trim().replace(/^\/+|\/+$/g, '')
  emit('create', {
    kind: props.option.nodeKind,
    name: resolvedName.value,
    provider: props.option.defaultProvider || props.provider.id,
    platform: props.option.defaultPlatform || 'repository-folder',
    environment: environment.value,
    owner: props.project?.owner,
    description: description.value,
    tags: ['source', 'github', 'repo-folder'],
    externalId: `github:${selectedRepository.value}${normalizedFolder ? `:${normalizedFolder}` : ''}`,
    metadata: {
      providerNodeOptionId: props.option.id,
      repository: selectedRepository.value,
      sourcePath: normalizedFolder || '.',
      branch: selectedBranch.value,
      defaultBranch: stringPayload(selectedRepositoryObservation.value, 'defaultBranch'),
      htmlUrl: stringPayload(selectedRepositoryObservation.value, 'url')
    }
  })
}

function repositoryName(observation: ProviderObservation) {
  return stringPayload(observation, 'repository') || observation.externalId.replace(/^github:/, '')
}

function workflowName(observation: ProviderObservation) {
  return stringPayload(observation, 'name') || stringPayload(observation, 'path') || observation.externalId
}

function workflowLabel(observation: ProviderObservation) {
  const path = stringPayload(observation, 'path')
  return path ? `${workflowName(observation)} (${path})` : workflowName(observation)
}

function stringPayload(observation: ProviderObservation | undefined, key: string) {
  const value = observation?.payload[key]
  return typeof value === 'string' ? value : ''
}

function numberPayload(observation: ProviderObservation | undefined, key: string) {
  const value = observation?.payload[key]
  return typeof value === 'number' ? value : null
}

function booleanPayload(observation: ProviderObservation, key: string) {
  return observation.payload[key] === true
}
</script>

<template>
  <form class="provider-node-create-form github-node-create-form" @submit.prevent="createNode">
    <div class="provider-node-create-head">
      <div class="collector-card-icon">
        <GitHubMarkIcon class="github-brand-icon" :size="20" />
      </div>
      <div>
        <strong>{{ option.label }}</strong>
        <small>{{ option.description }}</small>
      </div>
      <EntityBadge :kind="option.nodeKind" />
    </div>

    <p v-if="!repositories.length" class="muted">
      Keine GitHub-Repositories geladen. Verbinde GitHub auf der Provider-Seite oder nutze das manuelle Formular.
    </p>
    <p v-else-if="isWorkflowOption && !workflowItems.length" class="muted">
      Keine Workflows fuer dieses Repository geladen. Du kannst die Workflow-Datei manuell eintragen.
    </p>

    <div class="project-form-row">
      <USelect
        v-model="selectedRepository"
        :items="repositoryItems"
        value-key="value"
        label-key="label"
        placeholder="Repository"
        size="sm"
        :disabled="!repositoryItems.length"
      />
      <USelect
        v-model="environment"
        :items="environments.map((item) => ({ label: item, value: item }))"
        value-key="value"
        label-key="label"
        placeholder="Environment"
        size="sm"
        :disabled="!environments.length"
      />
    </div>

    <template v-if="isPagesOption">
      <UInput
        v-model="pagesUrl"
        icon="i-lucide-globe"
        :placeholder="inferredPagesUrl || 'https://owner.github.io/repo'"
        size="sm"
      />
    </template>

    <template v-else-if="isWorkflowOption">
      <div class="project-form-row">
        <USelect
          v-model="selectedWorkflow"
          :items="workflowItems"
          value-key="value"
          label-key="label"
          placeholder="Workflow"
          size="sm"
          :disabled="!workflowItems.length"
        />
        <UInput
          v-model="workflowPath"
          icon="i-lucide-route"
          placeholder=".github/workflows/deploy.yml"
          size="sm"
        />
      </div>
    </template>

    <template v-else>
      <div class="project-form-row">
        <UInput
          v-model="folder"
          icon="i-lucide-folder"
          placeholder="Folder in repo, e.g. apps/api"
          size="sm"
        />
        <USelect
          v-model="selectedBranch"
          :items="branchItems"
          value-key="value"
          label-key="label"
          placeholder="Branch"
          size="sm"
          :disabled="!branchItems.length"
        />
      </div>
    </template>

    <UInput v-model="nodeName" placeholder="Node name, optional" size="sm" />
    <UTextarea v-model="description" placeholder="Description" :rows="2" />

    <div class="provider-node-create-preview">
      <span>{{ selectedRepository || 'No repository' }}</span>
      <strong>{{ resolvedName || 'Node name' }}</strong>
      <small v-if="isPagesOption">{{ pagesUrl || inferredPagesUrl || 'GitHub Pages URL' }}</small>
      <small v-else-if="isWorkflowOption">{{ resolvedWorkflowPath || 'Workflow file' }}</small>
      <small v-else>{{ folder || '.' }} / {{ selectedBranch || 'default branch' }}</small>
    </div>

    <UButton
      type="submit"
      icon="i-lucide-plus"
      color="primary"
      size="sm"
      :loading="creating"
      :disabled="!canCreate"
    >
      Create node
    </UButton>
  </form>
</template>
