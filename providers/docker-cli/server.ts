import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { createError } from 'h3'
import type {
  DeploymentActionKind,
  DeploymentActionPlan,
  DeploymentActionRequest,
  DeploymentActionResult,
  DeploymentRuntimeStatus,
  ProviderDeploymentMetrics,
  ProviderDeploymentRef,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'
import type { ProviderCollectResult, ProviderPlugin } from '../../server/providers/types'
import { recordDockerContainerMetrics } from '../../server/utils/observability-telemetry'
import type { DockerManagerArea, DockerManagerState } from './types'

const execFileAsync = promisify(execFile)

interface DockerPsRow {
  ID?: string
  Image?: string
  Names?: string
  Ports?: string
  Labels?: string
  State?: string
  Status?: string
}

interface DockerStatsRow {
  ID?: string
  Container?: string
  Name?: string
  CPUPerc?: string
  MemUsage?: string
  MemPerc?: string
  NetIO?: string
  BlockIO?: string
}

interface DockerVolumeRow {
  Driver?: string
  Labels?: string
  Links?: string
  Mountpoint?: string
  Name?: string
  Scope?: string
  Size?: string
}

interface DockerNetworkRow {
  ID?: string
  Name?: string
  Driver?: string
  Scope?: string
  IPv6?: string
  Internal?: string
  Labels?: string
}

interface DockerSystemDfRow {
  Type?: string
  TotalCount?: string
  Active?: string
  Size?: string
  Reclaimable?: string
}

interface DockerMetricSource {
  identifiers: string[]
  metrics: ProviderDeploymentMetrics
}

const providerId = 'docker-cli'
const collectorId = 'collector:docker-cli:local'
const targetId = 'target:docker:local'

export const dockerCliProvider: ProviderPlugin = {
  manifest: {
    id: providerId,
    displayName: 'Docker CLI',
    version: '0.1.0',
    description: 'Docker-compatible local runtime provider for Docker Desktop, OrbStack, Colima, and remote contexts.',
    types: ['runtime.container', 'runtime.volume', 'runtime.network', 'deployment.lifecycle'],
    roles: ['inventory.provider', 'deployment.provider'],
    capabilities: [
      'inventory.discover',
      'inventory.observe',
      'runtime.metrics.observe',
      'runtime.volumes.list',
      'runtime.networks.list',
      'manager.portainer.health',
      'manager.portainer.open',
      'deployments.list',
      'deployments.start',
      'deployments.stop',
      'deployments.restart',
      'deployments.create.preview'
    ],
    addOptions: [
      {
        id: 'docker-context',
        label: 'Docker context',
        description: 'Add a Docker-compatible runtime target such as OrbStack, Docker Desktop, Colima, or SSH context.',
        type: 'runtime.container',
        capability: 'runtime.contexts.add',
        configSchema: {
          context: {
            type: 'string',
            title: 'Docker context',
            placeholder: 'orbstack'
          }
        }
      },
      {
        id: 'compose-app',
        label: 'Compose app',
        description: 'Add a compose application as a manageable deployment group.',
        type: 'deployment.lifecycle',
        capability: 'deployments.compose.add',
        configSchema: {
          composeFile: {
            type: 'string',
            title: 'Compose file',
            placeholder: 'compose.yml'
          }
        }
      }
    ],
    nodeOptions: [
      {
        id: 'docker-compose-app-node',
        label: 'Compose app',
        description: 'Create a runtime node for a Docker Compose application.',
        type: 'deployment.lifecycle',
        capability: 'deployments.compose.add',
        nodeKind: 'runtime',
        defaultProvider: providerId,
        defaultPlatform: 'docker-compose',
        tags: ['docker', 'compose']
      },
      {
        id: 'docker-container-node',
        label: 'Container',
        description: 'Create a container node for a Docker-managed service.',
        type: 'runtime.container',
        capability: 'runtime.containers.add',
        nodeKind: 'container',
        defaultProvider: providerId,
        defaultPlatform: 'docker',
        tags: ['docker', 'container']
      }
    ],
    ui: {
      component: 'docker-cli-panel',
      surfaces: ['provider.panel']
    },
    configSchema: {
      dockerContext: {
        type: 'string',
        title: 'Docker context',
        default: 'current'
      },
      targetName: {
        type: 'string',
        title: 'Target name',
        default: 'local-docker'
      },
      portainerUrl: {
        type: 'string',
        title: 'Portainer URL',
        default: 'http://localhost:9000'
      },
      portainerEnabled: {
        type: 'boolean',
        title: 'Portainer enabled',
        default: true
      }
    }
  },

  async collectRuntime() {
    return collectDockerRuntime()
  },

  async planAction(request, deployments) {
    return planDockerAction(request, deployments)
  },

  async executeAction(request, deployments) {
    return executeDockerAction(request, deployments)
  }
}

export async function getDockerManagerState(): Promise<DockerManagerState> {
  const checkedAt = new Date().toISOString()
  const enabled = booleanFromEnv('BUILDER_PORTAINER_ENABLED', true)
  const baseUrl = normalizeUrl(process.env.BUILDER_PORTAINER_URL) || 'http://localhost:9000'
  const areas = dockerManagerAreas(baseUrl)

  if (!enabled) {
    return {
      enabled,
      baseUrl,
      status: 'disabled',
      checkedAt,
      areas
    }
  }

  try {
    const response = await fetch(new URL('/api/status', ensureTrailingSlash(serverUrlFor(baseUrl))), {
      signal: AbortSignal.timeout(2_000)
    })

    return {
      enabled,
      baseUrl,
      status: response.ok ? 'connected' : 'degraded',
      checkedAt,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      areas
    }
  } catch (error) {
    return {
      enabled,
      baseUrl,
      status: 'degraded',
      checkedAt,
      error: errorMessage(error),
      areas
    }
  }
}

async function collectDockerRuntime(): Promise<ProviderCollectResult> {
  const generatedAt = new Date().toISOString()
  const dockerContext = dockerContextFromEnv()
  const targetName = stringFromEnv('BUILDER_DOCKER_TARGET_NAME', 'local-docker')
  const mode = 'write_capable'

  const target: ProviderTargetScope = {
    id: targetId,
    name: targetName,
    kind: 'docker-daemon',
    description: dockerContext ? `Docker context ${dockerContext}` : 'Active Docker context',
    transport: {
      type: 'local-cli',
      label: dockerContext ? `docker --context ${dockerContext}` : 'docker'
    },
    labels: {
      provider: providerId,
      dockerContext: dockerContext || 'current'
    }
  }

  try {
    const context = dockerContext || await dockerContextShow()
    const [rows, stats, volumes, networks, systemRows] = await Promise.all([
      dockerPs(dockerContext),
      optionalDockerRows(() => dockerStats(dockerContext)),
      optionalDockerRows(() => dockerVolumeLs(dockerContext)),
      optionalDockerRows(() => dockerNetworkLs(dockerContext)),
      optionalDockerRows(() => dockerSystemDf(dockerContext))
    ])
    const metricsByKey = metricsByIdentifier(stats)
    const deployments = rows.map((row) => {
      return deploymentFromDockerRow(row, context || 'current', generatedAt, metricsForRow(row, metricsByKey))
    })
    const observations = [
      ...deployments.map((deployment) => observationFromDeployment(deployment, generatedAt)),
      ...deployments
        .filter((deployment) => deployment.metrics)
        .map((deployment) => metricsObservationFromDeployment(deployment, generatedAt)),
      ...volumes.map((volume) => observationFromVolume(volume, generatedAt)),
      ...networks.map((network) => observationFromNetwork(network, generatedAt)),
      ...systemRows.map((row, index) => observationFromSystemRow(row, index, generatedAt))
    ]
    const runningCount = deployments.filter((deployment) => deployment.status === 'running').length

    recordDockerMetrics(context || 'current', deployments)

    return {
      target,
      collector: {
        id: collectorId,
        providerId,
        targetId,
        mode,
        status: 'connected',
        config: {
          dockerContext: dockerContext || context || 'current',
          targetName,
          portainerUrl: normalizeUrl(process.env.BUILDER_PORTAINER_URL) || 'http://localhost:9000'
        },
        lastRun: generatedAt,
        summary: `${deployments.length} containers, ${runningCount} running, ${volumes.length} volumes, ${networks.length} networks`
      },
      deployments,
      observations
    }
  } catch (error) {
    recordDockerMetrics(dockerContext || 'current', [])

    return {
      target,
      collector: {
        id: collectorId,
        providerId,
        targetId,
        mode,
        status: 'degraded',
        config: {
          dockerContext: dockerContext || 'current',
          targetName
        },
        lastRun: generatedAt,
        summary: dockerErrorSummary(error)
      },
      deployments: [],
      observations: []
    }
  }
}

async function dockerContextShow() {
  const { stdout } = await execDocker(['context', 'show'])
  return stdout.trim()
}

async function dockerPs(context?: string) {
  const args = [
    ...contextArgs(context),
    'ps',
    '--all',
    '--format',
    '{{json .}}'
  ]
  const { stdout } = await execDocker(args)
  return parseJsonLines<DockerPsRow>(stdout)
}

async function dockerStats(context?: string) {
  const args = [
    ...contextArgs(context),
    'stats',
    '--all',
    '--no-stream',
    '--format',
    '{{json .}}'
  ]
  const { stdout } = await execDocker(args)
  return parseJsonLines<DockerStatsRow>(stdout)
}

async function dockerVolumeLs(context?: string) {
  const args = [
    ...contextArgs(context),
    'volume',
    'ls',
    '--format',
    '{{json .}}'
  ]
  const { stdout } = await execDocker(args)
  return parseJsonLines<DockerVolumeRow>(stdout)
}

async function dockerNetworkLs(context?: string) {
  const args = [
    ...contextArgs(context),
    'network',
    'ls',
    '--format',
    '{{json .}}'
  ]
  const { stdout } = await execDocker(args)
  return parseJsonLines<DockerNetworkRow>(stdout)
}

async function dockerSystemDf(context?: string) {
  const args = [
    ...contextArgs(context),
    'system',
    'df',
    '--format',
    '{{json .}}'
  ]
  const { stdout } = await execDocker(args)
  return parseJsonLines<DockerSystemDfRow>(stdout)
}

async function optionalDockerRows<T>(collect: () => Promise<T[]>) {
  try {
    return await collect()
  } catch {
    return []
  }
}

async function execDocker(args: string[]) {
  return execFileAsync('docker', args, {
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 5
  })
}

function deploymentFromDockerRow(
  row: DockerPsRow,
  context: string,
  observedAt: string,
  metrics?: ProviderDeploymentMetrics
): ProviderDeploymentRef {
  const labels = parseDockerLabels(row.Labels)
  const name = row.Names || row.ID || 'unknown-container'
  const status = runtimeStatusFromState(row.State, row.Status)
  const externalId = row.ID || name

  return {
    id: `deployment:${providerId}:${externalId}`,
    providerId,
    collectorId,
    targetId,
    externalId,
    name,
    service: labels['builder.service'] || labels['com.docker.compose.service'] || name,
    project: labels['builder.project'] || labels['com.docker.compose.project'],
    environment: labels['builder.environment'] || labels['environment'] || 'local',
    image: row.Image,
    status,
    ports: splitDockerList(row.Ports),
    labels: {
      ...labels,
      dockerContext: context
    },
    actions: actionsForStatus(status),
    metrics,
    observedAt
  }
}

function observationFromDeployment(deployment: ProviderDeploymentRef, observedAt: string): ProviderObservation {
  return {
    id: `observation:${providerId}:${deployment.externalId}`,
    providerId,
    collectorId,
    targetId,
    externalId: deployment.externalId,
    kind: 'container',
    fingerprint: fingerprint(deployment),
    observedAt,
    payload: {
      name: deployment.name,
      image: deployment.image,
      status: deployment.status,
      ports: deployment.ports,
      labels: deployment.labels,
      metrics: deployment.metrics
    }
  }
}

function metricsObservationFromDeployment(deployment: ProviderDeploymentRef, observedAt: string): ProviderObservation {
  return {
    id: `observation:${providerId}:metrics:${deployment.externalId}`,
    providerId,
    collectorId,
    targetId,
    externalId: deployment.externalId,
    kind: 'container-metrics',
    fingerprint: fingerprint(deployment.metrics),
    observedAt,
    payload: {
      containerId: deployment.externalId,
      name: deployment.name,
      project: deployment.project,
      service: deployment.service,
      environment: deployment.environment,
      image: deployment.image,
      metrics: deployment.metrics || {}
    }
  }
}

function observationFromVolume(volume: DockerVolumeRow, observedAt: string): ProviderObservation {
  const externalId = volume.Name || fingerprint(volume).slice(0, 12)

  return {
    id: `observation:${providerId}:volume:${externalId}`,
    providerId,
    collectorId,
    targetId,
    externalId,
    kind: 'docker-volume',
    fingerprint: fingerprint(volume),
    observedAt,
    payload: {
      name: volume.Name,
      driver: volume.Driver,
      scope: volume.Scope,
      mountpoint: volume.Mountpoint,
      labels: parseDockerLabels(volume.Labels),
      size: volume.Size
    }
  }
}

function observationFromNetwork(network: DockerNetworkRow, observedAt: string): ProviderObservation {
  const externalId = network.ID || network.Name || fingerprint(network).slice(0, 12)

  return {
    id: `observation:${providerId}:network:${externalId}`,
    providerId,
    collectorId,
    targetId,
    externalId,
    kind: 'docker-network',
    fingerprint: fingerprint(network),
    observedAt,
    payload: {
      id: network.ID,
      name: network.Name,
      driver: network.Driver,
      scope: network.Scope,
      ipv6: network.IPv6,
      internal: network.Internal,
      labels: parseDockerLabels(network.Labels)
    }
  }
}

function observationFromSystemRow(row: DockerSystemDfRow, index: number, observedAt: string): ProviderObservation {
  const externalId = row.Type || `system-${index + 1}`

  return {
    id: `observation:${providerId}:system:${externalId}`,
    providerId,
    collectorId,
    targetId,
    externalId,
    kind: 'docker-system',
    fingerprint: fingerprint(row),
    observedAt,
    payload: {
      type: row.Type,
      totalCount: numberFromString(row.TotalCount),
      active: numberFromString(row.Active),
      size: row.Size,
      reclaimable: row.Reclaimable
    }
  }
}

async function planDockerAction(
  request: DeploymentActionRequest,
  deployments: ProviderDeploymentRef[]
): Promise<DeploymentActionPlan> {
  const deployment = deployments.find((item) => item.id === request.deploymentId)
  if (!deployment) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Deployment not found'
    })
  }

  if (!deployment.actions.includes(request.action)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Action ${request.action} is not available for ${deployment.name}`
    })
  }

  const dockerContext = dockerContextFromEnv()
  const command = [
    'docker',
    ...contextArgs(dockerContext),
    dockerCommandForAction(request.action),
    deployment.externalId
  ]

  return {
    id: `action-plan:${request.action}:${deployment.id}:${Date.now()}`,
    providerId,
    collectorId,
    deploymentId: deployment.id,
    action: request.action,
    targetLabel: deployment.name,
    command,
    mode: 'write_capable',
    risk: request.action === 'stop' ? 'medium' : 'low',
    requiresConfirmation: true,
    summary: `${titleCase(request.action)} ${deployment.name} via Docker CLI`,
    createdAt: new Date().toISOString(),
    executable: true
  }
}

async function executeDockerAction(
  request: DeploymentActionRequest,
  deployments: ProviderDeploymentRef[]
): Promise<DeploymentActionResult> {
  const plan = await planDockerAction(request, deployments)
  const [, ...args] = plan.command

  try {
    const { stdout, stderr } = await execDocker(args)
    return {
      id: `action-result:${request.action}:${plan.deploymentId}:${Date.now()}`,
      providerId,
      collectorId,
      deploymentId: plan.deploymentId,
      action: request.action,
      targetLabel: plan.targetLabel,
      command: plan.command,
      status: 'completed',
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      executedAt: new Date().toISOString()
    }
  } catch (error) {
    const output = dockerExecErrorOutput(error)
    return {
      id: `action-result:${request.action}:${plan.deploymentId}:${Date.now()}`,
      providerId,
      collectorId,
      deploymentId: plan.deploymentId,
      action: request.action,
      targetLabel: plan.targetLabel,
      command: plan.command,
      status: 'failed',
      stdout: output.stdout,
      stderr: output.stderr || dockerErrorSummary(error),
      executedAt: new Date().toISOString()
    }
  }
}

function dockerCommandForAction(action: DeploymentActionKind) {
  if (action === 'restart') {
    return 'restart'
  }

  if (action === 'stop') {
    return 'stop'
  }

  if (action === 'start') {
    return 'start'
  }

  return 'run'
}

function actionsForStatus(status: DeploymentRuntimeStatus): DeploymentActionKind[] {
  if (status === 'running') {
    return ['stop', 'restart']
  }

  if (status === 'stopped') {
    return ['start']
  }

  return ['start', 'restart']
}

function runtimeStatusFromState(state?: string, status?: string): DeploymentRuntimeStatus {
  const normalized = `${state || ''} ${status || ''}`.toLowerCase()
  if (normalized.includes('running') || normalized.includes('up')) {
    return 'running'
  }

  if (normalized.includes('exited') || normalized.includes('created') || normalized.includes('stopped')) {
    return 'stopped'
  }

  return 'unknown'
}

function parseJsonLines<T>(stdout: string) {
  const rows: T[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    try {
      rows.push(JSON.parse(trimmed) as T)
    } catch {
      // Docker occasionally emits non-JSON warnings before formatted rows.
    }
  }

  return rows
}

function metricsByIdentifier(rows: DockerStatsRow[]) {
  const byIdentifier = new Map<string, ProviderDeploymentMetrics>()

  for (const row of rows) {
    const source = metricSourceFromDockerStats(row)
    if (!source) {
      continue
    }

    for (const identifier of source.identifiers) {
      byIdentifier.set(identifier, source.metrics)
    }
  }

  return byIdentifier
}

function metricSourceFromDockerStats(row: DockerStatsRow): DockerMetricSource | undefined {
  const memory = splitSizePair(row.MemUsage)
  const network = splitSizePair(row.NetIO)
  const block = splitSizePair(row.BlockIO)
  const metrics = compactMetrics({
    cpuPercent: percentFromString(row.CPUPerc),
    memoryUsageBytes: memory?.[0],
    memoryLimitBytes: memory?.[1],
    memoryPercent: percentFromString(row.MemPerc),
    networkRxBytes: network?.[0],
    networkTxBytes: network?.[1],
    blockReadBytes: block?.[0],
    blockWriteBytes: block?.[1]
  })

  if (!Object.keys(metrics).length) {
    return undefined
  }

  return {
    identifiers: [row.ID, row.Container, row.Name]
      .flatMap((value) => identifierVariants(value))
      .filter((value, index, values) => value && values.indexOf(value) === index),
    metrics
  }
}

function metricsForRow(row: DockerPsRow, metricsByKey: Map<string, ProviderDeploymentMetrics>) {
  const keys = [row.ID, row.Names].flatMap((value) => identifierVariants(value))
  for (const key of keys) {
    const metrics = metricsByKey.get(key)
    if (metrics) {
      return metrics
    }
  }

  return undefined
}

function identifierVariants(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return []
  }

  return [
    trimmed,
    trimmed.replace(/^\//, ''),
    trimmed.slice(0, 12)
  ].filter(Boolean)
}

function compactMetrics(metrics: ProviderDeploymentMetrics): ProviderDeploymentMetrics {
  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) => value !== undefined)
  ) as ProviderDeploymentMetrics
}

function recordDockerMetrics(dockerContext: string, deployments: ProviderDeploymentRef[]) {
  recordDockerContainerMetrics({
    provider: providerId,
    targetId,
    dockerContext,
    containers: deployments
      .filter((deployment) => deployment.metrics)
      .map((deployment) => ({
        containerId: deployment.externalId,
        containerName: deployment.name,
        project: deployment.project,
        service: deployment.service,
        environment: deployment.environment,
        image: deployment.image,
        ...deployment.metrics
      }))
  })
}

function parseDockerLabels(value?: string) {
  const labels: Record<string, string> = {}
  if (!value) {
    return labels
  }

  for (const part of value.split(',')) {
    const [key, ...rest] = part.split('=')
    if (key && rest.length) {
      labels[key.trim()] = rest.join('=').trim()
    }
  }

  return labels
}

function splitDockerList(value?: string) {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitSizePair(value?: string): [number, number] | undefined {
  if (!value || !value.includes('/')) {
    return undefined
  }

  const [left, right] = value.split('/').map((item) => bytesFromSize(item))
  if (left === undefined && right === undefined) {
    return undefined
  }

  return [left || 0, right || 0]
}

function bytesFromSize(value?: string) {
  const match = value?.trim().match(/^([\d.,]+)\s*([kmgtp]?i?b)$/i)
  if (!match) {
    return undefined
  }

  const rawAmount = match[1]
  const rawUnit = match[2]
  if (!rawAmount || !rawUnit) {
    return undefined
  }

  const amount = Number(rawAmount.replace(',', '.'))
  if (!Number.isFinite(amount)) {
    return undefined
  }

  const unit = rawUnit.toLowerCase()
  const multiplier: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    pb: 1000 ** 5,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    pib: 1024 ** 5
  }

  return Math.round(amount * (multiplier[unit] || 1))
}

function percentFromString(value?: string) {
  const amount = Number(value?.replace('%', '').replace(',', '.').trim())
  return Number.isFinite(amount) ? amount : undefined
}

function numberFromString(value?: string) {
  const amount = Number(value?.trim())
  return Number.isFinite(amount) ? amount : undefined
}

function contextArgs(context?: string) {
  return context ? ['--context', context] : []
}

function dockerContextFromEnv() {
  const value = stringFromEnv('BUILDER_DOCKER_CONTEXT', '')
  return value && value !== 'current' ? value : undefined
}

function stringFromEnv(key: string, fallback: string) {
  return typeof process.env[key] === 'string' ? process.env[key] as string : fallback
}

function booleanFromEnv(key: string, fallback: boolean) {
  const value = process.env[key]?.trim().toLowerCase()
  if (value === 'true' || value === '1' || value === 'yes') {
    return true
  }

  if (value === 'false' || value === '0' || value === 'no') {
    return false
  }

  return fallback
}

function dockerManagerAreas(baseUrl: string): DockerManagerArea[] {
  return [
    managerArea('dashboard', 'Dashboard', baseUrl),
    managerArea('containers', 'Containers', baseUrl, '/#!/endpoints/1/docker/containers'),
    managerArea('volumes', 'Volumes', baseUrl, '/#!/endpoints/1/docker/volumes'),
    managerArea('networks', 'Networks', baseUrl, '/#!/endpoints/1/docker/networks'),
    managerArea('images', 'Images', baseUrl, '/#!/endpoints/1/docker/images'),
    managerArea('stacks', 'Stacks', baseUrl, '/#!/endpoints/1/docker/stacks')
  ]
}

function managerArea(id: DockerManagerArea['id'], label: string, baseUrl: string, path = '/') {
  return {
    id,
    label,
    url: new URL(path, ensureTrailingSlash(baseUrl)).toString()
  }
}

function normalizeUrl(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

function serverUrlFor(value: string) {
  return value
    .replace('http://localhost:', 'http://127.0.0.1:')
    .replace('http://[::1]:', 'http://127.0.0.1:')
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

function fingerprint(value: unknown) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function dockerErrorSummary(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return `Docker CLI unavailable or not reachable: ${String(error.message)}`
  }

  return 'Docker CLI unavailable or not reachable'
}

function dockerExecErrorOutput(error: unknown) {
  if (error && typeof error === 'object') {
    const maybeOutput = error as { stdout?: unknown, stderr?: unknown }
    return {
      stdout: typeof maybeOutput.stdout === 'string' ? maybeOutput.stdout.trim() : '',
      stderr: typeof maybeOutput.stderr === 'string' ? maybeOutput.stderr.trim() : ''
    }
  }

  return {
    stdout: '',
    stderr: ''
  }
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }

  return String(error)
}
