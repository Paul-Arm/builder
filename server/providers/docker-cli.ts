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
  ProviderCollectorInstance,
  ProviderDeploymentRef,
  ProviderManifest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'
import type { ProviderCollectResult, ProviderPlugin } from './types'

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

const providerId = 'docker-cli'
const collectorId = 'collector:docker-cli:local'
const targetId = 'target:docker:local'

export const dockerCliProvider: ProviderPlugin = {
  manifest: {
    id: providerId,
    displayName: 'Docker CLI',
    version: '0.1.0',
    description: 'Docker-compatible local runtime provider for Docker Desktop, OrbStack, Colima, and remote contexts.',
    roles: ['inventory.provider', 'deployment.provider'],
    capabilities: [
      'inventory.discover',
      'inventory.observe',
      'deployments.list',
      'deployments.start',
      'deployments.stop',
      'deployments.restart',
      'deployments.create.preview'
    ],
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
    const rows = await dockerPs(dockerContext)
    const deployments = rows.map((row) => deploymentFromDockerRow(row, context || 'current', generatedAt))
    const observations = deployments.map((deployment) => observationFromDeployment(deployment, generatedAt))
    const runningCount = deployments.filter((deployment) => deployment.status === 'running').length

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
          targetName
        },
        lastRun: generatedAt,
        summary: `${deployments.length} containers, ${runningCount} running`
      },
      deployments,
      observations
    }
  } catch (error) {
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
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DockerPsRow)
}

async function execDocker(args: string[]) {
  return execFileAsync('docker', args, {
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 5
  })
}

function deploymentFromDockerRow(row: DockerPsRow, context: string, observedAt: string): ProviderDeploymentRef {
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
    labels,
    actions: actionsForStatus(status),
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
      labels: deployment.labels
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
