<script setup lang="ts">
import ELK, { type ElkEdgeSection, type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js'
import type {
  EntityKind,
  InventoryDataset,
  InventoryEntity,
  InventoryRelation
} from '~~/types/inventory'

type GraphScope = 'project' | 'all'

interface GraphModel {
  nodes: InventoryEntity[]
  relations: InventoryRelation[]
}

interface RenderedNode {
  id: string
  entity: InventoryEntity
  x: number
  y: number
  width: number
  height: number
}

interface RenderedEdge {
  id: string
  relation: InventoryRelation
  path: string
  marker: boolean
  selected: boolean
  dimmed: boolean
}

interface RenderedLayout {
  width: number
  height: number
  nodes: RenderedNode[]
  edges: RenderedEdge[]
}

const props = withDefaults(defineProps<{
  inventory: InventoryDataset
  selectedId?: string
  selectedProjectId?: string
  query?: string
  scope?: GraphScope
}>(), {
  query: '',
  scope: 'project'
})

const emit = defineEmits<{
  select: [id: string]
  selectProject: [id: string]
}>()

const nodeWidth = 204
const nodeHeight = 78
const graphPadding = 36
const relationTypes: InventoryRelation['type'][] = [
  'owns',
  'contains',
  'deployed_from',
  'deployed_as',
  'runs_on',
  'exposed_by',
  'uses',
  'publishes',
  'subscribes',
  'managed_by',
  'secured_by'
]
const elk = new ELK({
  defaultLayoutOptions: {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': '44',
    'elk.layered.spacing.nodeNodeBetweenLayers': '86',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP'
  }
})

const clientReady = ref(false)
const layoutPending = ref(false)
const layoutError = ref('')
const renderedLayout = ref<RenderedLayout>({
  width: 900,
  height: 520,
  nodes: [],
  edges: []
})
let layoutRun = 0

const graphModel = computed(() => buildGraphModel())
const activeSelectedId = computed(() => {
  return graphModel.value.nodes.some((node) => node.id === props.selectedId) ? props.selectedId : ''
})
const selectedConnections = computed(() => {
  if (!activeSelectedId.value) {
    return new Set<string>()
  }

  const ids = new Set<string>()
  for (const relation of graphModel.value.relations) {
    if (relation.from === activeSelectedId.value) {
      ids.add(relation.to)
    }

    if (relation.to === activeSelectedId.value) {
      ids.add(relation.from)
    }
  }

  return ids
})

watch(
  () => graphModel.value,
  () => {
    if (clientReady.value) {
      void runLayout()
    }
  },
  { deep: true }
)

watch(
  () => props.selectedId,
  () => {
    renderedLayout.value = {
      ...renderedLayout.value,
      edges: renderedLayout.value.edges.map((edge) => {
        return edgeSelection(edge.relation, edge.path, edge.id, edge.marker)
      })
    }
  }
)

onMounted(() => {
  clientReady.value = true
  void runLayout()
})

onBeforeUnmount(() => {
  try {
    elk.terminateWorker()
  } catch {
    // The bundled browser build can run without a terminable worker during HMR.
  }
})

async function runLayout() {
  const runId = ++layoutRun
  layoutPending.value = true
  layoutError.value = ''

  if (!graphModel.value.nodes.length) {
    renderedLayout.value = {
      width: 900,
      height: 520,
      nodes: [],
      edges: []
    }
    layoutPending.value = false
    return
  }

  const edgeRefs = new Map<string, InventoryRelation>()

  try {
    const elkGraph = createElkGraph(graphModel.value, edgeRefs)
    const laidOut = await elk.layout(elkGraph)

    if (runId !== layoutRun) {
      return
    }

    renderedLayout.value = createRenderedLayout(laidOut, graphModel.value, edgeRefs)
  } catch (error) {
    if (runId !== layoutRun) {
      return
    }

    layoutError.value = error instanceof Error ? error.message : 'Auto layout failed'
  } finally {
    if (runId === layoutRun) {
      layoutPending.value = false
    }
  }
}

function buildGraphModel(): GraphModel {
  const entityById = new Map(props.inventory.entities.map((entity) => [entity.id, entity]))
  let visibleIds = props.scope === 'project' && props.selectedProjectId
    ? projectVisibleIds(props.selectedProjectId)
    : new Set(props.inventory.entities.map((entity) => entity.id))

  const normalizedQuery = props.query.trim().toLowerCase()
  if (normalizedQuery) {
    const matchedIds = new Set<string>()

    for (const id of visibleIds) {
      const entity = entityById.get(id)
      if (entity && entityMatches(entity, normalizedQuery)) {
        matchedIds.add(id)
      }
    }

    const expandedIds = new Set(matchedIds)
    for (const relation of props.inventory.relations) {
      if (!visibleIds.has(relation.from) || !visibleIds.has(relation.to)) {
        continue
      }

      if (matchedIds.has(relation.from) || matchedIds.has(relation.to)) {
        expandedIds.add(relation.from)
        expandedIds.add(relation.to)
      }
    }

    visibleIds = expandedIds
  }

  const nodes = props.inventory.entities
    .filter((entity) => visibleIds.has(entity.id))
    .filter((entity) => props.scope !== 'project' || entity.id !== props.selectedProjectId)
    .sort(compareEntities)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const relations = dedupeRelations(props.inventory.relations
    .filter((relation) => nodeIds.has(relation.from) && nodeIds.has(relation.to))
    .filter((relation) => props.scope !== 'project' || relation.type !== 'owns'))
    .sort(compareRelations)

  return {
    nodes,
    relations
  }
}

function projectVisibleIds(projectId: string) {
  const visibleIds = new Set<string>([projectId])
  const projectNodeIds = new Set<string>()

  for (const relation of props.inventory.relations) {
    if (relation.from === projectId && relation.type === 'owns') {
      visibleIds.add(relation.to)
      projectNodeIds.add(relation.to)
    }
  }

  for (const deployment of props.inventory.deployments) {
    if (deployment.projectId === projectId) {
      visibleIds.add(deployment.serviceId)
      visibleIds.add(deployment.targetId)
      projectNodeIds.add(deployment.serviceId)
      projectNodeIds.add(deployment.targetId)
    }
  }

  const seedIds = new Set(projectNodeIds)
  for (const relation of props.inventory.relations) {
    if (seedIds.has(relation.from) && [
      'runs_on',
      'deployed_as',
      'deployed_from',
      'uses',
      'publishes',
      'subscribes',
      'secured_by',
      'managed_by'
    ].includes(relation.type)) {
      visibleIds.add(relation.to)
    }

    if (seedIds.has(relation.to) && [
      'contains',
      'deployed_as',
      'deployed_from',
      'exposed_by',
      'runs_on',
      'managed_by'
    ].includes(relation.type)) {
      visibleIds.add(relation.from)
    }
  }

  const infrastructureIds = new Set(visibleIds)
  for (const relation of props.inventory.relations) {
    if (infrastructureIds.has(relation.from) && ['contains', 'runs_on', 'managed_by'].includes(relation.type)) {
      visibleIds.add(relation.to)
    }

    if (infrastructureIds.has(relation.to) && ['contains', 'runs_on', 'managed_by'].includes(relation.type)) {
      visibleIds.add(relation.from)
    }
  }

  return visibleIds
}

function createElkGraph(model: GraphModel, edgeRefs: Map<string, InventoryRelation>): ElkNode {
  return {
    id: 'inventory',
    layoutOptions: {
      'elk.padding': `[top=${graphPadding},left=${graphPadding},bottom=${graphPadding},right=${graphPadding}]`
    },
    children: model.nodes.map((node) => ({
      id: node.id,
      width: nodeWidthFor(node),
      height: nodeHeight
    })),
    edges: model.relations.map((relation, index) => {
      const id = `edge:${index}:${relation.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      edgeRefs.set(id, relation)
      return {
        id,
        sources: [relation.from],
        targets: [relation.to]
      }
    })
  }
}

function createRenderedLayout(
  laidOut: ElkNode,
  model: GraphModel,
  edgeRefs: Map<string, InventoryRelation>
): RenderedLayout {
  const entityById = new Map(model.nodes.map((entity) => [entity.id, entity]))
  const renderedNodes = (laidOut.children || [])
    .map((node) => {
      const entity = entityById.get(node.id)
      if (!entity) {
        return undefined
      }

      return {
        id: node.id,
        entity,
        x: Math.round(node.x || 0),
        y: Math.round(node.y || 0),
        width: Math.round(node.width || nodeWidthFor(entity)),
        height: Math.round(node.height || nodeHeight)
      }
    })
    .filter((node): node is RenderedNode => Boolean(node))

  const nodeById = new Map(renderedNodes.map((node) => [node.id, node]))
  const renderedEdges = (laidOut.edges || [])
    .flatMap((edge) => {
      const relation = edgeRefs.get(edge.id)
      if (!relation) {
        return []
      }

      return edgePaths(edge, relation, nodeById).map((sectionPath) => {
        return edgeSelection(
          relation,
          sectionPath.path,
          `${edge.id}:${sectionPath.id}`,
          sectionPath.marker
        )
      })
    })

  const maxX = Math.max(...renderedNodes.map((node) => node.x + node.width), 820)
  const maxY = Math.max(...renderedNodes.map((node) => node.y + node.height), 420)

  return {
    width: Math.max(Math.round(laidOut.width || maxX + graphPadding), maxX + graphPadding),
    height: Math.max(Math.round(laidOut.height || maxY + graphPadding), maxY + graphPadding),
    nodes: renderedNodes,
    edges: renderedEdges
  }
}

function edgeSelection(
  relation: InventoryRelation,
  path: string,
  id: string,
  marker: boolean
): RenderedEdge {
  const selected = Boolean(activeSelectedId.value && [relation.from, relation.to].includes(activeSelectedId.value))

  return {
    id,
    relation,
    path,
    marker,
    selected,
    dimmed: Boolean(activeSelectedId.value && !selected)
  }
}

function edgePaths(
  edge: ElkExtendedEdge,
  relation: InventoryRelation,
  nodeById: Map<string, RenderedNode>
) {
  if (edge.sections?.length) {
    const terminalSectionIds = terminalIdsFor(edge.sections)
    return edge.sections
      .map((section, index) => {
        const marker = terminalSectionIds.has(section.id)
        return {
          id: section.id || `section-${index}`,
          path: sectionPath(section, marker),
          marker
        }
      })
      .filter((section) => section.path)
  }

  const source = nodeById.get(relation.from)
  const target = nodeById.get(relation.to)
  if (!source || !target) {
    return []
  }

  const startPoint = {
    x: source.x + source.width,
    y: source.y + source.height / 2
  }
  const endPoint = shortenTerminalPoint([
    startPoint,
    {
      x: target.x,
      y: target.y + target.height / 2
    }
  ])

  return [{
    id: 'fallback',
    path: `M ${formatPathNumber(startPoint.x)} ${formatPathNumber(startPoint.y)} L ${formatPathNumber(endPoint.x)} ${formatPathNumber(endPoint.y)}`,
    marker: true
  }]
}

function terminalIdsFor(sections: ElkEdgeSection[]) {
  const terminalIds = new Set(
    sections
      .filter((section) => !section.outgoingSections?.length)
      .map((section) => section.id)
  )

  if (!terminalIds.size) {
    const lastSection = sections.at(-1)
    if (lastSection) {
      terminalIds.add(lastSection.id)
    }
  }

  return terminalIds
}

function sectionPath(section: ElkEdgeSection, shortenEnd = false) {
  const points = [
    section.startPoint,
    ...(section.bendPoints || []),
    section.endPoint
  ]
  const renderedPoints = shortenEnd ? replaceLastPoint(points, shortenTerminalPoint(points)) : points

  return renderedPoints.map((point, index) => {
    const command = index === 0 ? 'M' : 'L'
    return `${command} ${formatPathNumber(point.x)} ${formatPathNumber(point.y)}`
  }).join(' ')
}

function replaceLastPoint(points: Array<{ x: number, y: number }>, point: { x: number, y: number }) {
  return points.map((item, index) => index === points.length - 1 ? point : item)
}

function shortenTerminalPoint(points: Array<{ x: number, y: number }>) {
  const end = points.at(-1)
  const previous = points.at(-2)
  if (!end || !previous) {
    return end || { x: 0, y: 0 }
  }

  const deltaX = end.x - previous.x
  const deltaY = end.y - previous.y
  const length = Math.hypot(deltaX, deltaY)
  if (length < 1) {
    return end
  }

  const offset = Math.min(8, length / 2)
  return {
    x: end.x - (deltaX / length) * offset,
    y: end.y - (deltaY / length) * offset
  }
}

function nodeWidthFor(entity: InventoryEntity) {
  if (entity.kind === 'project') {
    return 222
  }

  if (['database_server', 'external_service', 'secret_store'].includes(entity.kind)) {
    return 216
  }

  return nodeWidth
}

function selectNode(entity: InventoryEntity) {
  emit('select', entity.id)

  if (entity.kind === 'project') {
    emit('selectProject', entity.id)
  }
}

function nodeStyle(node: RenderedNode) {
  return {
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.width}px`,
    height: `${node.height}px`
  }
}

function isNodeSelected(node: RenderedNode) {
  return activeSelectedId.value === node.id
}

function isNodeConnected(node: RenderedNode) {
  return selectedConnections.value.has(node.id)
}

function isNodeDimmed(node: RenderedNode) {
  return Boolean(activeSelectedId.value && !isNodeSelected(node) && !isNodeConnected(node))
}

function entityMatches(entity: InventoryEntity, query: string) {
  return [
    entity.name,
    entity.kind,
    entity.provider,
    entity.platform,
    entity.environment,
    entity.region,
    entity.account,
    entity.owner,
    entity.description,
    ...entity.tags
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query)
}

function dedupeRelations(relations: InventoryRelation[]) {
  const seen = new Set<string>()
  const unique: InventoryRelation[] = []

  for (const relation of relations) {
    const key = `${relation.from}:${relation.type}:${relation.to}:${relation.source}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(relation)
  }

  return unique
}

function compareEntities(a: InventoryEntity, b: InventoryEntity) {
  return kindRank(a.kind) - kindRank(b.kind)
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id)
}

function compareRelations(a: InventoryRelation, b: InventoryRelation) {
  return relationRank(a.type) - relationRank(b.type)
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
}

function kindRank(kind: EntityKind) {
  const ranks: Partial<Record<EntityKind, number>> = {
    project: 0,
    repo: 1,
    pipeline: 2,
    service: 3,
    function: 3,
    container: 4,
    runtime: 4,
    cluster: 5,
    namespace: 5,
    host: 6,
    domain: 7,
    queue: 8,
    database_server: 9,
    database: 10,
    storage: 11,
    secret_store: 12,
    external_service: 13
  }

  return ranks[kind] ?? 20
}

function relationRank(type: InventoryRelation['type']) {
  const ranks: Partial<Record<InventoryRelation['type'], number>> = {
    owns: 0,
    contains: 1,
    deployed_from: 2,
    deployed_as: 3,
    runs_on: 4,
    exposed_by: 5,
    uses: 6,
    publishes: 7,
    subscribes: 8,
    managed_by: 9,
    secured_by: 10
  }

  return ranks[type] ?? 20
}

function relationLabel(type: InventoryRelation['type']) {
  return type.replace('_', ' ')
}

function iconForKind(kind: EntityKind) {
  const icons: Record<EntityKind, string> = {
    project: 'i-lucide-folder-kanban',
    service: 'i-lucide-waypoints',
    host: 'i-lucide-server',
    runtime: 'i-lucide-cpu',
    container: 'i-lucide-box',
    pipeline: 'i-lucide-network',
    function: 'i-lucide-cloud',
    database: 'i-lucide-database',
    database_server: 'i-lucide-database-zap',
    storage: 'i-lucide-hard-drive',
    queue: 'i-lucide-radio-tower',
    repo: 'i-lucide-git-branch',
    domain: 'i-lucide-globe',
    cluster: 'i-lucide-cloud',
    namespace: 'i-lucide-boxes',
    secret_store: 'i-lucide-lock',
    external_service: 'i-lucide-cloud'
  }

  return icons[kind]
}

function nodeMeta(entity: InventoryEntity) {
  return [
    entity.kind.replace('_', ' '),
    entity.environment || entity.provider,
    entity.platform
  ].filter(Boolean).join(' / ')
}

function markerIdFor(type: InventoryRelation['type']) {
  return `auto-layout-arrow-${type.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function formatPathNumber(value: number) {
  return String(Math.round(value * 10) / 10)
}
</script>

<template>
  <section class="auto-graph-panel" aria-label="Auto layout inventory graph">
    <div class="auto-graph-toolbar">
      <div>
        <strong>ELK auto layout</strong>
        <span>{{ graphModel.nodes.length }} nodes / {{ graphModel.relations.length }} edges</span>
      </div>

      <div class="auto-graph-toolbar-actions">
        <StatusPill :status="layoutError ? 'degraded' : layoutPending ? 'rolling' : 'healthy'" />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="sm"
          title="Auto layout neu berechnen"
          :loading="layoutPending"
          @click="runLayout"
        />
      </div>
    </div>

    <div v-if="layoutError" class="empty-state danger">{{ layoutError }}</div>
    <div v-else-if="layoutPending && !renderedLayout.nodes.length" class="empty-state">Auto layout wird berechnet</div>
    <div v-else-if="!renderedLayout.nodes.length" class="empty-state">Keine Nodes fuer diese Auswahl</div>

    <div v-else class="auto-graph-viewport">
      <div
        class="auto-graph-canvas"
        :style="{ width: `${renderedLayout.width}px`, height: `${renderedLayout.height}px` }"
      >
        <svg
          class="auto-graph-lines"
          :width="renderedLayout.width"
          :height="renderedLayout.height"
          :viewBox="`0 0 ${renderedLayout.width} ${renderedLayout.height}`"
          aria-hidden="true"
        >
          <defs>
            <marker
              v-for="type in relationTypes"
              :id="markerIdFor(type)"
              :key="type"
              markerWidth="9"
              markerHeight="9"
              viewBox="0 0 9 9"
              refX="8"
              refY="4.5"
              orient="auto"
              markerUnits="strokeWidth"
              :data-type="type"
            >
              <path d="M 0 0 L 9 4.5 L 0 9 z" />
            </marker>
          </defs>

          <path
            v-for="edge in renderedLayout.edges"
            :key="edge.id"
            :d="edge.path"
            :class="{ selected: edge.selected, dimmed: edge.dimmed }"
            :data-type="edge.relation.type"
            :marker-end="edge.marker ? `url(#${markerIdFor(edge.relation.type)})` : undefined"
          >
            <title>{{ relationLabel(edge.relation.type) }}</title>
          </path>
        </svg>

        <button
          v-for="node in renderedLayout.nodes"
          :key="node.id"
          type="button"
          class="auto-graph-node"
          :class="{
            selected: isNodeSelected(node),
            connected: isNodeConnected(node),
            dimmed: isNodeDimmed(node)
          }"
          :data-kind="node.entity.kind"
          :style="nodeStyle(node)"
          @click="selectNode(node.entity)"
        >
          <span class="auto-graph-node-icon">
            <UIcon :name="iconForKind(node.entity.kind)" />
          </span>
          <span class="auto-graph-node-copy">
            <strong :title="node.entity.name">{{ node.entity.name }}</strong>
            <small :title="nodeMeta(node.entity)">{{ nodeMeta(node.entity) }}</small>
            <span class="auto-graph-node-footer">
              <StatusPill :status="node.entity.health" />
              <span v-if="node.entity.owner">{{ node.entity.owner }}</span>
            </span>
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
