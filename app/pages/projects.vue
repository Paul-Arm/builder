<script setup lang="ts">
import {
  BoxesIcon,
  DatabaseIcon,
  FolderKanbanIcon,
  NetworkIcon,
  ServerIcon,
  WaypointsIcon
} from '@lucide/vue'
import type { Component } from 'vue'
import GitHubMarkIcon from '~/components/icons/GitHubMarkIcon.vue'
import ProviderProjectNodeCreateHost from '~/components/provider-ui/ProviderProjectNodeCreateHost.vue'
import type { EntityKind, InventoryEntity, InventoryRelation } from '~~/types/inventory'
import type {
  CreateProjectEnvironmentRequest,
  CreateProjectNodeRequest,
  CreateProjectRelationRequest,
  CreateProjectRequest,
  ProjectWorkspace,
  UpdateProjectRequest
} from '~~/types/projects'
import type {
  ProviderNodeCreateOption,
  ProviderRuntimeSnapshot
} from '~~/types/providers'

type RelationType = InventoryRelation['type']

const {
  data: workspace,
  pending,
  error,
  refresh
} = useFetch<ProjectWorkspace>('/api/projects', {
  lazy: true,
  server: false
})
const {
  data: providerRuntime,
  pending: providersPending,
  refresh: refreshProviderRuntime
} = useFetch<ProviderRuntimeSnapshot>('/api/providers/runtime', {
  lazy: true,
  server: false
})

const selectedProjectId = useState<string>('builder:selected-project-id', () => '')
const savingProject = ref(false)
const creatingProject = ref(false)
const creatingEnvironment = ref(false)
const creatingNode = ref(false)
const creatingProviderNode = ref(false)
const creatingRelation = ref(false)
const deletingRelationId = ref('')
const message = ref('')
const selectedProviderId = ref('')
const selectedProviderNodeOptionId = ref('')

const projectDraft = reactive({
  name: '',
  owner: '',
  platform: '',
  health: 'healthy',
  description: '',
  tags: ''
})

const newProject = reactive({
  name: '',
  owner: '',
  platform: 'product',
  description: '',
  tags: '',
  environments: 'dev, prod'
})

const newEnvironment = reactive({
  name: ''
})

const newNode = reactive({
  kind: 'service' as CreateProjectNodeRequest['kind'],
  name: '',
  provider: 'manual',
  platform: 'node',
  environment: '',
  owner: '',
  description: '',
  tags: ''
})

const relationDraft = reactive({
  from: '',
  to: '',
  type: 'uses' as RelationType,
  evidence: ''
})

const relationOptions: Array<{
  value: RelationType
  label: string
  description: string
}> = [
  {
    value: 'contains',
    label: 'contains',
    description: 'Repo, namespace, server, or group contains another node'
  },
  {
    value: 'runs_on',
    label: 'runs on',
    description: 'Service, container, or runtime runs on compute'
  },
  {
    value: 'deployed_as',
    label: 'deployed as',
    description: 'Service is deployed as a runtime artifact'
  },
  {
    value: 'deployed_from',
    label: 'deployed from',
    description: 'Service is deployed from source'
  },
  {
    value: 'uses',
    label: 'uses',
    description: 'Service depends on a resource or external service'
  },
  {
    value: 'publishes',
    label: 'publishes',
    description: 'Service publishes events to a queue or topic'
  },
  {
    value: 'subscribes',
    label: 'subscribes',
    description: 'Service consumes events from a queue or topic'
  },
  {
    value: 'exposed_by',
    label: 'exposed by',
    description: 'Domain or ingress exposes a service'
  },
  {
    value: 'managed_by',
    label: 'managed by',
    description: 'Runtime or controller manages a resource'
  },
  {
    value: 'secured_by',
    label: 'secured by',
    description: 'Service is secured by a secret store'
  }
]

const projects = computed(() => workspace.value?.projects || [])
const selectedProject = computed(() => {
  return projects.value.find((project) => project.id === selectedProjectId.value) || projects.value[0]
})
const projectNodes = computed(() => {
  return selectedProject.value ? workspace.value?.nodesByProject[selectedProject.value.id] || [] : []
})
const projectNodeIds = computed(() => new Set(projectNodes.value.map((node) => node.id)))
const projectNodeById = computed(() => new Map(projectNodes.value.map((node) => [node.id, node])))
const projectNodeItems = computed(() => {
  return projectNodes.value.map((node) => ({
    label: `${node.name} (${node.kind})`,
    value: node.id
  }))
})
const projectConnectionRelations = computed(() => {
  const nodeIds = projectNodeIds.value
  return (workspace.value?.relations || [])
    .filter((relation) => {
      return relation.type !== 'owns'
        && nodeIds.has(relation.from)
        && nodeIds.has(relation.to)
    })
    .sort((a, b) => {
      return relationNodeName(a.from).localeCompare(relationNodeName(b.from))
        || relationLabel(a.type).localeCompare(relationLabel(b.type))
        || relationNodeName(a.to).localeCompare(relationNodeName(b.to))
    })
})
const selectedRelationFrom = computed(() => projectNodeById.value.get(relationDraft.from))
const selectedRelationTo = computed(() => projectNodeById.value.get(relationDraft.to))
const recommendedRelationType = computed(() => recommendRelationType(selectedRelationFrom.value, selectedRelationTo.value))
const relationTypeItems = computed(() => {
  return relationOptions.map((option) => ({
    label: option.value === recommendedRelationType.value ? `${option.label} (suggested)` : option.label,
    value: option.value
  }))
})
const relationAlreadyExists = computed(() => {
  return Boolean(relationDraft.from && relationDraft.to && relationDraft.type && (workspace.value?.relations || []).some((relation) => {
    return relation.from === relationDraft.from
      && relation.to === relationDraft.to
      && relation.type === relationDraft.type
  }))
})
const canCreateRelation = computed(() => {
  return Boolean(
    selectedProject.value
    && relationDraft.from
    && relationDraft.to
    && relationDraft.from !== relationDraft.to
    && relationDraft.type
    && !relationAlreadyExists.value
  )
})
const projectEnvironments = computed(() => {
  return selectedProject.value ? workspace.value?.environmentsByProject[selectedProject.value.id] || [] : []
})
const environmentOptions = computed(() => {
  return projectEnvironments.value.map((environment) => ({
    label: environment,
    value: environment
  }))
})
const loading = computed(() => pending.value || (!workspace.value && !error.value))
const providers = computed(() => providerRuntime.value?.providers || [])
const providerObservations = computed(() => providerRuntime.value?.observations || [])
const providersWithNodeOptions = computed(() => {
  return providers.value.filter((provider) => provider.nodeOptions?.length)
})
const selectedProvider = computed(() => {
  return providersWithNodeOptions.value.find((provider) => provider.id === selectedProviderId.value)
    || providersWithNodeOptions.value[0]
})
const selectedProviderNodeOptions = computed(() => selectedProvider.value?.nodeOptions || [])
const selectedProviderNodeOption = computed(() => {
  return selectedProviderNodeOptions.value.find((option) => option.id === selectedProviderNodeOptionId.value)
    || selectedProviderNodeOptions.value[0]
})
const providerOptionItems = computed(() => {
  return selectedProviderNodeOptions.value.map((option) => ({
    label: option.label,
    value: option.id
  }))
})
const providerItems = computed(() => {
  return providersWithNodeOptions.value.map((provider) => ({
    label: provider.displayName,
    value: provider.id
  }))
})
const selectedProviderObservations = computed(() => {
  return selectedProvider.value
    ? providerObservations.value.filter((observation) => observation.providerId === selectedProvider.value?.id)
    : []
})
const nodeKindOptions = computed(() => [
  { label: 'Service', value: 'service' },
  { label: 'Function', value: 'function' },
  { label: 'External Service', value: 'external_service' },
  { label: 'Database Server', value: 'database_server' },
  { label: 'Database', value: 'database' },
  { label: 'Storage', value: 'storage' },
  { label: 'Queue', value: 'queue' },
  { label: 'Repo', value: 'repo' },
  { label: 'Domain', value: 'domain' },
  { label: 'Container', value: 'container' },
  { label: 'Runtime', value: 'runtime' },
  { label: 'Pipeline', value: 'pipeline' },
  { label: 'Host', value: 'host' },
  { label: 'Cluster', value: 'cluster' },
  { label: 'Namespace', value: 'namespace' },
  { label: 'Secret Store', value: 'secret_store' }
])
const healthOptions = computed(() => [
  { label: 'Healthy', value: 'healthy' },
  { label: 'Degraded', value: 'degraded' },
  { label: 'Unknown', value: 'unknown' },
  { label: 'Offline', value: 'offline' }
])

watch(projects, (nextProjects) => {
  if (!nextProjects.length) {
    selectedProjectId.value = ''
    return
  }

  if (!selectedProjectId.value || !nextProjects.some((project) => project.id === selectedProjectId.value)) {
    selectedProjectId.value = nextProjects[0]?.id || ''
  }
}, { immediate: true })

watch(providersWithNodeOptions, (nextProviders) => {
  if (!nextProviders.length) {
    selectedProviderId.value = ''
    selectedProviderNodeOptionId.value = ''
    return
  }

  if (!selectedProviderId.value || !nextProviders.some((provider) => provider.id === selectedProviderId.value)) {
    selectedProviderId.value = nextProviders[0]?.id || ''
  }
}, { immediate: true })

watch(selectedProvider, (provider) => {
  const options = provider?.nodeOptions || []
  if (!options.length) {
    selectedProviderNodeOptionId.value = ''
    return
  }

  if (!selectedProviderNodeOptionId.value || !options.some((option) => option.id === selectedProviderNodeOptionId.value)) {
    selectedProviderNodeOptionId.value = options[0]?.id || ''
  }
}, { immediate: true })

onMounted(() => {
  const storedProjectId = window.localStorage.getItem('builder:selected-project-id')
  if (storedProjectId) {
    selectedProjectId.value = storedProjectId
  }
})

watch(selectedProjectId, (projectId) => {
  if (projectId && import.meta.client) {
    window.localStorage.setItem('builder:selected-project-id', projectId)
  }
})

watch(selectedProject, (project) => {
  if (!project) {
    return
  }

  projectDraft.name = project.name
  projectDraft.owner = project.owner || ''
  projectDraft.platform = project.platform
  projectDraft.health = project.health
  projectDraft.description = project.description || ''
  projectDraft.tags = project.tags.join(', ')
  newNode.owner = project.owner || ''
  newNode.environment = projectEnvironments.value[0] || ''
}, { immediate: true })

watch(projectEnvironments, (environments) => {
  if (!environments.length) {
    newNode.environment = ''
    return
  }

  if (!newNode.environment || !environments.includes(newNode.environment)) {
    newNode.environment = environments[0] || ''
  }
}, { immediate: true })

watch(projectNodes, (nodes) => {
  if (!nodes.length) {
    relationDraft.from = ''
    relationDraft.to = ''
    return
  }

  if (!relationDraft.from || !nodes.some((node) => node.id === relationDraft.from)) {
    relationDraft.from = preferredRelationSource(nodes)?.id || nodes[0]?.id || ''
  }

  if (!relationDraft.to || relationDraft.to === relationDraft.from || !nodes.some((node) => node.id === relationDraft.to)) {
    relationDraft.to = preferredRelationTarget(nodes, relationDraft.from)?.id || ''
  }

  relationDraft.type = recommendedRelationType.value
}, { immediate: true })

watch(() => [relationDraft.from, relationDraft.to] as const, () => {
  if (relationDraft.from && relationDraft.to && relationDraft.from === relationDraft.to) {
    relationDraft.to = preferredRelationTarget(projectNodes.value, relationDraft.from)?.id || ''
  }

  relationDraft.type = recommendedRelationType.value
})

function selectProject(project: InventoryEntity) {
  selectedProjectId.value = project.id
}

async function createProjectFromForm() {
  message.value = ''
  creatingProject.value = true

  try {
    workspace.value = await $fetch<ProjectWorkspace>('/api/projects', {
      method: 'POST',
      body: {
        name: newProject.name,
        owner: newProject.owner,
        platform: newProject.platform,
        description: newProject.description,
        tags: splitTags(newProject.tags),
        environments: splitTags(newProject.environments)
      } satisfies CreateProjectRequest
    })
    selectedProjectId.value = workspace.value.projects.find((project) => project.name === newProject.name)?.id
      || selectedProjectId.value
    newProject.name = ''
    newProject.owner = ''
    newProject.description = ''
    newProject.tags = ''
    message.value = 'Project created'
  } finally {
    creatingProject.value = false
  }
}

async function createEnvironmentFromForm() {
  if (!selectedProject.value) {
    return
  }

  message.value = ''
  creatingEnvironment.value = true

  try {
    workspace.value = await $fetch<ProjectWorkspace>(`/api/projects/${encodeURIComponent(selectedProject.value.id)}/environments`, {
      method: 'POST',
      body: {
        name: newEnvironment.name
      } satisfies CreateProjectEnvironmentRequest
    })
    newNode.environment = normalizeEnvironmentInput(newEnvironment.name)
    newEnvironment.name = ''
    message.value = 'Environment created'
  } finally {
    creatingEnvironment.value = false
  }
}

async function saveSelectedProject() {
  if (!selectedProject.value) {
    return
  }

  message.value = ''
  savingProject.value = true

  try {
    workspace.value = await $fetch<ProjectWorkspace>(`/api/projects/${encodeURIComponent(selectedProject.value.id)}`, {
      method: 'PATCH',
      body: {
        name: projectDraft.name,
        owner: projectDraft.owner,
        platform: projectDraft.platform,
        description: projectDraft.description,
        health: projectDraft.health as UpdateProjectRequest['health'],
        tags: splitTags(projectDraft.tags)
      } satisfies UpdateProjectRequest
    })
    message.value = 'Project saved'
  } finally {
    savingProject.value = false
  }
}

async function createNodeFromForm() {
  if (!selectedProject.value) {
    return
  }

  message.value = ''
  creatingNode.value = true

  try {
    workspace.value = await $fetch<ProjectWorkspace>(`/api/projects/${encodeURIComponent(selectedProject.value.id)}/nodes`, {
      method: 'POST',
      body: {
        kind: newNode.kind,
        name: newNode.name,
        provider: newNode.provider,
        platform: newNode.platform,
        environment: newNode.environment,
        owner: newNode.owner,
        description: newNode.description,
        tags: splitTags(newNode.tags)
      } satisfies CreateProjectNodeRequest
    })
    newNode.name = ''
    newNode.description = ''
    newNode.tags = ''
    message.value = 'Node created'
  } finally {
    creatingNode.value = false
  }
}

async function createProviderNodeFromPayload(request: CreateProjectNodeRequest) {
  if (!selectedProject.value) {
    return
  }

  message.value = ''
  creatingProviderNode.value = true

  try {
    workspace.value = await $fetch<ProjectWorkspace>(`/api/projects/${encodeURIComponent(selectedProject.value.id)}/nodes`, {
      method: 'POST',
      body: request
    })
    message.value = `${request.name} created`
    await refreshProviderRuntime()
  } finally {
    creatingProviderNode.value = false
  }
}

async function createRelationFromForm() {
  if (!selectedProject.value) {
    return
  }

  message.value = ''
  creatingRelation.value = true

  try {
    workspace.value = await $fetch<ProjectWorkspace>(`/api/projects/${encodeURIComponent(selectedProject.value.id)}/relations`, {
      method: 'POST',
      body: {
        from: relationDraft.from,
        to: relationDraft.to,
        type: relationDraft.type,
        evidence: relationDraft.evidence
      } satisfies CreateProjectRelationRequest
    })
    relationDraft.evidence = ''
    message.value = 'Connection created'
  } finally {
    creatingRelation.value = false
  }
}

async function deleteRelation(relation: InventoryRelation) {
  if (!selectedProject.value) {
    return
  }

  message.value = ''
  deletingRelationId.value = relation.id

  try {
    workspace.value = await $fetch<ProjectWorkspace>(
      `/api/projects/${encodeURIComponent(selectedProject.value.id)}/relations/${encodeURIComponent(relation.id)}`,
      { method: 'DELETE' }
    )
    message.value = 'Connection removed'
  } finally {
    deletingRelationId.value = ''
  }
}

function swapRelationNodes() {
  const from = relationDraft.from
  relationDraft.from = relationDraft.to
  relationDraft.to = from
}

function optionDescription(option?: ProviderNodeCreateOption) {
  return option ? `${option.type} / ${option.nodeKind}` : 'Provider node'
}

async function refreshAll() {
  await Promise.all([refresh(), refreshProviderRuntime()])
}

function splitTags(value: string) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}

function normalizeEnvironmentInput(value: string) {
  return value.trim().replace(/\s+/g, '-').toLowerCase()
}

function preferredRelationSource(nodes: InventoryEntity[]) {
  return nodes.find((node) => ['service', 'function', 'repo', 'domain'].includes(node.kind)) || nodes[0]
}

function preferredRelationTarget(nodes: InventoryEntity[], fromId: string) {
  return nodes.find((node) => node.id !== fromId && ['database', 'storage', 'queue', 'container', 'runtime'].includes(node.kind))
    || nodes.find((node) => node.id !== fromId)
}

function recommendRelationType(from?: InventoryEntity, to?: InventoryEntity): RelationType {
  if (!from || !to) {
    return 'uses'
  }

  const serviceKinds: EntityKind[] = ['service', 'function', 'external_service']
  const computeKinds: EntityKind[] = ['host', 'runtime', 'container', 'cluster', 'namespace']
  const resourceKinds: EntityKind[] = ['database', 'database_server', 'storage', 'external_service']

  if (from.kind === 'repo' && ['service', 'function', 'pipeline'].includes(to.kind)) {
    return 'contains'
  }

  if (serviceKinds.includes(from.kind) && ['repo', 'pipeline'].includes(to.kind)) {
    return 'deployed_from'
  }

  if (from.kind === 'pipeline' && serviceKinds.includes(to.kind)) {
    return 'deployed_as'
  }

  if (serviceKinds.includes(from.kind) && ['container', 'function', 'runtime'].includes(to.kind)) {
    return 'deployed_as'
  }

  if (['service', 'function', 'container', 'runtime'].includes(from.kind) && computeKinds.includes(to.kind)) {
    return 'runs_on'
  }

  if (from.kind === 'domain' && serviceKinds.includes(to.kind)) {
    return 'exposed_by'
  }

  if (from.kind === 'database_server' && to.kind === 'database') {
    return 'contains'
  }

  if (['container', 'runtime', 'database_server'].includes(from.kind) && ['database', 'storage', 'queue'].includes(to.kind)) {
    return 'managed_by'
  }

  if (serviceKinds.includes(from.kind) && to.kind === 'secret_store') {
    return 'secured_by'
  }

  if (serviceKinds.includes(from.kind) && to.kind === 'queue') {
    return 'publishes'
  }

  if (serviceKinds.includes(from.kind) && resourceKinds.includes(to.kind)) {
    return 'uses'
  }

  return 'uses'
}

function relationLabel(type: RelationType) {
  return relationOptions.find((option) => option.value === type)?.label || type.replace('_', ' ')
}

function relationDescription(type: RelationType) {
  return relationOptions.find((option) => option.value === type)?.description || ''
}

function relationNode(id: string) {
  return projectNodeById.value.get(id)
}

function relationNodeName(id: string) {
  return relationNode(id)?.name || id
}

function relationNodeMeta(id: string) {
  const node = relationNode(id)
  return node ? `${node.kind} / ${node.platform}` : 'Unknown node'
}

function iconForRelationNode(id: string): Component {
  const node = relationNode(id)
  return node ? iconForNode(node) : BoxesIcon
}

function iconForNode(node: InventoryEntity): Component {
  return isGitHubNode(node) ? GitHubMarkIcon : iconForKind(node.kind)
}

function isGitHubNode(node: InventoryEntity) {
  return node.provider === 'github'
    || node.platform.includes('github')
    || Boolean(node.externalId?.startsWith('github:'))
}

function iconForKind(kind: EntityKind): Component {
  if (kind === 'project') {
    return FolderKanbanIcon
  }

  if (['database_server', 'database', 'storage', 'queue', 'secret_store'].includes(kind)) {
    return DatabaseIcon
  }

  if (kind === 'pipeline') {
    return NetworkIcon
  }

  if (['host', 'runtime', 'container', 'cluster', 'namespace', 'function', 'external_service'].includes(kind)) {
    return ServerIcon
  }

  if (['repo', 'domain'].includes(kind)) {
    return WaypointsIcon
  }

  return BoxesIcon
}
</script>

<template>
  <main class="app-frame">
    <AppRail mode="mixed" />

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Project catalog</p>
          <h1>Projects</h1>
        </div>

        <div class="topbar-actions">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            title="Refresh projects"
            @click="refreshAll()"
          />
        </div>
      </header>

      <div v-if="loading" class="empty-state">Projects werden geladen</div>
      <div v-else-if="error" class="empty-state danger">Projects nicht erreichbar</div>

      <section v-else class="projects-console">
        <aside class="collector-page-panel project-list-panel">
          <div class="panel-heading">
            <h2>Projects</h2>
            <span>{{ projects.length }}</span>
          </div>

          <button
            v-for="project in projects"
            :key="project.id"
            type="button"
            class="target-row"
            :class="{ selected: selectedProject?.id === project.id }"
            @click="selectProject(project)"
          >
            <span class="collector-card-icon">
              <component :is="iconForKind(project.kind)" :size="18" />
            </span>
            <span class="provider-card-main">
              <strong>{{ project.name }}</strong>
              <span>{{ project.owner || 'No owner' }} / {{ project.platform }}</span>
              <small>{{ project.description || project.tags.join(', ') || project.id }}</small>
            </span>
          </button>

          <form class="project-create-form" @submit.prevent="createProjectFromForm">
            <div class="panel-heading">
              <h2>New project</h2>
            </div>
            <UInput v-model="newProject.name" placeholder="Project name" size="sm" />
            <div class="project-form-row">
              <UInput v-model="newProject.owner" placeholder="Owner" size="sm" />
              <UInput v-model="newProject.platform" placeholder="Platform" size="sm" />
            </div>
            <UInput v-model="newProject.environments" placeholder="envs, comma separated" size="sm" />
            <UInput v-model="newProject.tags" placeholder="tags, comma separated" size="sm" />
            <UButton
              type="submit"
              icon="i-lucide-plus"
              color="primary"
              size="sm"
              :loading="creatingProject"
              :disabled="!newProject.name"
            >
              Create project
            </UButton>
          </form>
        </aside>

        <section v-if="selectedProject" class="project-detail-panel">
          <section class="project-editor-panel">
            <div class="panel-heading">
              <h2>Edit project</h2>
              <StatusPill :status="selectedProject.health" />
            </div>

            <form class="project-editor-form" @submit.prevent="saveSelectedProject">
              <div class="project-form-row">
                <UInput v-model="projectDraft.name" placeholder="Name" size="sm" />
                <UInput v-model="projectDraft.owner" placeholder="Owner" size="sm" />
              </div>
              <div class="project-form-row">
                <UInput v-model="projectDraft.platform" placeholder="Platform" size="sm" />
                <USelect
                  v-model="projectDraft.health"
                  :items="healthOptions"
                  value-key="value"
                  label-key="label"
                  size="sm"
                />
              </div>
              <UTextarea v-model="projectDraft.description" placeholder="Description" :rows="3" />
              <UInput v-model="projectDraft.tags" placeholder="tags, comma separated" size="sm" />
              <UButton
                type="submit"
                icon="i-lucide-save"
                color="primary"
                size="sm"
                :loading="savingProject"
              >
                Save project
              </UButton>
            </form>
          </section>

          <section class="project-editor-panel">
            <div class="panel-heading">
              <h2>Environments</h2>
              <span>{{ projectEnvironments.length }}</span>
            </div>

            <div v-if="projectEnvironments.length" class="project-env-list">
              <span
                v-for="environment in projectEnvironments"
                :key="environment"
              >
                {{ environment }}
              </span>
            </div>
            <p v-else class="muted">Lege zuerst ein Env an, danach koennen Nodes diesem Env zugeordnet werden.</p>

            <form class="project-env-form" @submit.prevent="createEnvironmentFromForm">
              <UInput v-model="newEnvironment.name" placeholder="dev, prod, feature-abc" size="sm" />
              <UButton
                type="submit"
                icon="i-lucide-plus"
                color="primary"
                size="sm"
                :loading="creatingEnvironment"
                :disabled="!newEnvironment.name"
              >
                Add env
              </UButton>
            </form>
          </section>

          <section class="project-editor-panel">
            <div class="panel-heading">
              <h2>Nodes</h2>
              <span>{{ projectNodes.length }}</span>
            </div>

            <div class="project-node-grid">
              <article
                v-for="node in projectNodes"
                :key="node.id"
                class="project-node-card"
                :class="{ 'github-node-card': isGitHubNode(node) }"
              >
                <component :is="iconForNode(node)" :size="18" />
                <div>
                  <strong>{{ node.name }}</strong>
                  <span>{{ node.kind }} / {{ node.platform }}</span>
                  <small>{{ node.environment || node.provider }} / {{ node.owner || selectedProject.owner || 'No owner' }}</small>
                </div>
              </article>
            </div>

            <section class="project-connection-panel">
              <div class="panel-heading">
                <h2>Connections</h2>
                <span>{{ projectConnectionRelations.length }}</span>
              </div>

              <form class="project-connection-form" @submit.prevent="createRelationFromForm">
                <div class="project-connection-builder">
                  <USelect
                    v-model="relationDraft.from"
                    :items="projectNodeItems"
                    value-key="value"
                    label-key="label"
                    placeholder="From node"
                    size="sm"
                    :disabled="projectNodes.length < 2"
                  />
                  <UButton
                    type="button"
                    icon="i-lucide-arrow-left-right"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    title="Swap direction"
                    :disabled="projectNodes.length < 2"
                    @click="swapRelationNodes"
                  />
                  <USelect
                    v-model="relationDraft.to"
                    :items="projectNodeItems"
                    value-key="value"
                    label-key="label"
                    placeholder="To node"
                    size="sm"
                    :disabled="projectNodes.length < 2"
                  />
                </div>

                <div class="project-form-row">
                  <USelect
                    v-model="relationDraft.type"
                    :items="relationTypeItems"
                    value-key="value"
                    label-key="label"
                    placeholder="Relation"
                    size="sm"
                    :disabled="projectNodes.length < 2"
                  />
                  <UInput
                    v-model="relationDraft.evidence"
                    placeholder="Evidence / note"
                    size="sm"
                    :disabled="projectNodes.length < 2"
                  />
                </div>

                <div v-if="selectedRelationFrom && selectedRelationTo" class="project-relation-preview">
                  <span>{{ selectedRelationFrom.name }}</span>
                  <strong>{{ relationLabel(relationDraft.type) }}</strong>
                  <span>{{ selectedRelationTo.name }}</span>
                  <small>{{ relationDescription(relationDraft.type) }}</small>
                </div>

                <UButton
                  type="submit"
                  icon="i-lucide-link"
                  color="primary"
                  size="sm"
                  :loading="creatingRelation"
                  :disabled="!canCreateRelation"
                >
                  Create connection
                </UButton>
              </form>

              <div v-if="projectConnectionRelations.length" class="project-relation-list">
                <article
                  v-for="relation in projectConnectionRelations"
                  :key="relation.id"
                  class="project-relation-row"
                >
                  <span class="collector-card-icon">
                    <component :is="iconForRelationNode(relation.from)" :size="18" />
                  </span>
                  <div class="project-relation-node">
                    <strong>{{ relationNodeName(relation.from) }}</strong>
                    <small>{{ relationNodeMeta(relation.from) }}</small>
                  </div>
                  <div class="project-relation-type">
                    <strong>{{ relationLabel(relation.type) }}</strong>
                    <small>{{ relation.source }}</small>
                  </div>
                  <div class="project-relation-node">
                    <strong>{{ relationNodeName(relation.to) }}</strong>
                    <small>{{ relationNodeMeta(relation.to) }}</small>
                  </div>
                  <UButton
                    v-if="relation.source === 'manual'"
                    type="button"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    title="Remove connection"
                    :loading="deletingRelationId === relation.id"
                    @click="deleteRelation(relation)"
                  />
                </article>
              </div>
              <p v-else class="muted">No node connections yet.</p>
            </section>

            <section class="provider-node-create-panel">
              <div class="panel-heading">
                <h2>Add from plugin</h2>
                <span>{{ providersWithNodeOptions.length }}</span>
              </div>

              <div v-if="providersWithNodeOptions.length" class="provider-node-create-picker">
                <USelect
                  v-model="selectedProviderId"
                  :items="providerItems"
                  value-key="value"
                  label-key="label"
                  size="sm"
                  :loading="providersPending"
                />
                <USelect
                  v-model="selectedProviderNodeOptionId"
                  :items="providerOptionItems"
                  value-key="value"
                  label-key="label"
                  size="sm"
                  :disabled="!selectedProviderNodeOptions.length"
                />
              </div>

              <div v-if="selectedProviderNodeOption" class="provider-node-create-option-line">
                <span>{{ selectedProvider?.displayName }}</span>
                <small>{{ optionDescription(selectedProviderNodeOption) }}</small>
              </div>

              <ProviderProjectNodeCreateHost
                v-if="selectedProvider && selectedProviderNodeOption"
                :provider="selectedProvider"
                :option="selectedProviderNodeOption"
                :observations="selectedProviderObservations"
                :project="selectedProject"
                :environments="projectEnvironments"
                :creating="creatingProviderNode"
                @create="createProviderNodeFromPayload"
              />

              <p v-else class="muted">
                Keine Provider-Node-Optionen geladen.
              </p>
            </section>

            <form class="project-node-form" @submit.prevent="createNodeFromForm">
              <div class="panel-heading">
                <h2>Manual node</h2>
              </div>
              <div class="project-form-row">
                <USelect
                  v-model="newNode.kind"
                  :items="nodeKindOptions"
                  value-key="value"
                  label-key="label"
                  size="sm"
                />
                <UInput v-model="newNode.name" placeholder="Node name" size="sm" />
              </div>
              <div class="project-form-row">
                <UInput v-model="newNode.provider" placeholder="Provider" size="sm" />
                <UInput v-model="newNode.platform" placeholder="Platform" size="sm" />
              </div>
              <div class="project-form-row">
                <USelect
                  v-model="newNode.environment"
                  :items="environmentOptions"
                  value-key="value"
                  label-key="label"
                  placeholder="Environment"
                  size="sm"
                  :disabled="!projectEnvironments.length"
                />
                <UInput v-model="newNode.owner" placeholder="Owner" size="sm" />
              </div>
              <UTextarea v-model="newNode.description" placeholder="Description" :rows="2" />
              <UInput v-model="newNode.tags" placeholder="tags, comma separated" size="sm" />
              <UButton
                type="submit"
                icon="i-lucide-plus"
                color="primary"
                size="sm"
                :loading="creatingNode"
                :disabled="!newNode.name || !newNode.environment"
              >
                Create node
              </UButton>
            </form>
          </section>

          <p v-if="message" class="muted">{{ message }}</p>
        </section>
      </section>
    </section>
  </main>
</template>
