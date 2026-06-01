import { createHash } from 'node:crypto'
import { createError } from 'h3'
import {
  deleteProviderSecret,
  getProviderSecret,
  isSecretStoreReady,
  providerSecretStatus,
  setProviderSecret
} from '../../server/utils/secret-store'
import type {
  DeploymentActionRequest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'
import type { ProviderCollectResult, ProviderPlugin } from '../../server/providers/types'
import type { GitHubConnectionStatus } from './types'

interface GitHubTokenResolution {
  value?: string
  source: 'secret-store' | 'env' | 'missing'
  fingerprint?: string
  updatedAt?: string
}

interface GitHubUser {
  login: string
  html_url: string
  avatar_url?: string
}

interface GitHubRepository {
  id: number
  name: string
  full_name: string
  private: boolean
  visibility?: string
  html_url: string
  default_branch: string
  language?: string | null
  archived: boolean
  disabled?: boolean
  fork: boolean
  has_pages?: boolean
  pushed_at?: string
  updated_at?: string
  permissions?: {
    admin?: boolean
    maintain?: boolean
    push?: boolean
    triage?: boolean
    pull?: boolean
  }
  owner: {
    login: string
  }
}

interface GitHubBranch {
  name: string
  protected?: boolean
  commit?: {
    sha?: string
  }
}

interface GitHubWorkflow {
  id: number
  name: string
  path: string
  state: string
  html_url?: string
  badge_url?: string
  updated_at?: string
}

interface GitHubWorkflowResponse {
  total_count: number
  workflows: GitHubWorkflow[]
}

interface GitHubApiResult<T> {
  data: T
  headers: Headers
}

const providerId = 'github'
const collectorId = 'collector:github:source'
const tokenSecretKey = 'token'
const apiBaseUrl = process.env.BUILDER_GITHUB_API_URL || 'https://api.github.com'
const apiVersion = process.env.BUILDER_GITHUB_API_VERSION || '2022-11-28'
const requiredPermissions = [
  'Fine-grained PAT: Metadata read',
  'Actions read fuer Workflows',
  'Public repos ohne Token moeglich, private repos nur mit Tokenzugriff'
]

export const githubProvider: ProviderPlugin = {
  manifest: {
    id: providerId,
    displayName: 'GitHub',
    version: '0.2.0',
    description: 'Source provider for repositories, branches, GitHub Actions workflows, and Pages surfaces.',
    types: ['source.repo', 'ci.workflow', 'hosting.pages'],
    roles: ['inventory.provider'],
    capabilities: [
      'github.connection.status',
      'github.connection.save-secret',
      'sources.repos.list',
      'sources.branches.list',
      'ci.workflows.list',
      'ci.runs.list',
      'pages.sites.list'
    ],
    ui: {
      component: 'github-panel',
      surfaces: ['provider.panel', 'add.option.panel', 'project.node.create']
    },
    addOptions: [
      {
        id: 'github-repository',
        label: 'Repository',
        description: 'Add a GitHub repository as a source node.',
        type: 'source.repo',
        capability: 'sources.repos.add',
        configSchema: {
          repository: {
            type: 'string',
            title: 'Repository',
            placeholder: 'owner/name'
          }
        }
      },
      {
        id: 'github-actions-workflow',
        label: 'GitHub Actions workflow',
        description: 'Add a workflow as CI/CD deployment actor.',
        type: 'ci.workflow',
        capability: 'ci.workflows.add',
        configSchema: {
          workflow: {
            type: 'string',
            title: 'Workflow file',
            placeholder: '.github/workflows/deploy.yml'
          }
        }
      },
      {
        id: 'github-pages-site',
        label: 'Pages site',
        description: 'Add a GitHub Pages site as ingress/hosting surface.',
        type: 'hosting.pages',
        capability: 'pages.sites.add'
      }
    ],
    nodeOptions: [
      {
        id: 'github-repository-folder-node',
        label: 'Repository folder',
        description: 'Create a project node from a GitHub repository and a folder inside it.',
        type: 'source.repo.folder',
        capability: 'sources.repo-folders.add',
        nodeKind: 'repo',
        defaultProvider: providerId,
        defaultPlatform: 'repository-folder',
        tags: ['source', 'github', 'repo-folder'],
        ui: {
          component: 'github-project-node-create'
        },
        configSchema: {
          repository: {
            type: 'select',
            title: 'Repository'
          },
          folder: {
            type: 'string',
            title: 'Folder',
            placeholder: 'apps/api'
          },
          branch: {
            type: 'select',
            title: 'Branch'
          }
        }
      },
      {
        id: 'github-pages-site-node',
        label: 'GitHub Pages site',
        description: 'Create a hosting/domain node for a GitHub Pages surface.',
        type: 'hosting.pages',
        capability: 'pages.sites.add',
        nodeKind: 'domain',
        defaultProvider: providerId,
        defaultPlatform: 'github-pages',
        tags: ['hosting', 'github-pages'],
        ui: {
          component: 'github-project-node-create'
        },
        configSchema: {
          repository: {
            type: 'select',
            title: 'Repository'
          },
          pagesUrl: {
            type: 'string',
            title: 'Pages URL',
            placeholder: 'https://owner.github.io/repo'
          }
        }
      }
    ],
    configSchema: {
      maxRepositories: {
        type: 'number',
        title: 'Max repositories',
        default: 100
      },
      apiVersion: {
        type: 'string',
        title: 'GitHub API version',
        default: apiVersion
      }
    },
    secretSchema: {
      token: {
        type: 'string',
        title: 'Fine-grained personal access token'
      }
    }
  },

  async collectRuntime() {
    return collectGitHubRuntime()
  },

  async planAction(request) {
    throw unsupportedAction(request)
  },

  async executeAction(request) {
    throw unsupportedAction(request)
  }
}

export async function getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  const token = await resolveGitHubToken()
  if (!token.value) {
    return {
      configured: false,
      source: token.source,
      storeReady: isSecretStoreReady(),
      requiredPermissions
    }
  }

  try {
    const userResponse = await githubRequest<GitHubUser>('/user', token.value)
    return {
      configured: true,
      source: token.source,
      storeReady: isSecretStoreReady(),
      user: {
        login: userResponse.data.login,
        htmlUrl: userResponse.data.html_url,
        avatarUrl: userResponse.data.avatar_url
      },
      fingerprint: token.fingerprint,
      updatedAt: token.updatedAt,
      rateLimit: rateLimitFromHeaders(userResponse.headers),
      requiredPermissions
    }
  } catch (error) {
    return {
      configured: true,
      source: token.source,
      storeReady: isSecretStoreReady(),
      fingerprint: token.fingerprint,
      updatedAt: token.updatedAt,
      requiredPermissions,
      error: githubErrorSummary(error)
    }
  }
}

export async function saveGitHubToken(token: string) {
  if (!isSecretStoreReady()) {
    throw createError({
      statusCode: 412,
      statusMessage: 'BUILDER_SECRET_KEY is required for encrypted secret storage'
    })
  }

  const trimmedToken = token.trim()
  if (!trimmedToken) {
    throw createError({
      statusCode: 400,
      statusMessage: 'GitHub token is required'
    })
  }

  await githubRequest<GitHubUser>('/user', trimmedToken)
  await setProviderSecret(providerId, tokenSecretKey, trimmedToken)
  return getGitHubConnectionStatus()
}

export async function deleteGitHubToken() {
  await deleteProviderSecret(providerId, tokenSecretKey)
  return getGitHubConnectionStatus()
}

async function collectGitHubRuntime(): Promise<ProviderCollectResult> {
  const generatedAt = new Date().toISOString()
  const token = await resolveGitHubToken()

  if (!token.value) {
    const target = targetFor('unconfigured')
    return {
      target,
      collector: {
        id: collectorId,
        providerId,
        targetId: target.id,
        mode: 'write_capable',
        status: 'degraded',
        config: {
          auth: token.source,
          storeReady: isSecretStoreReady()
        },
        lastRun: generatedAt,
        summary: 'GitHub token missing'
      },
      deployments: [],
      observations: []
    }
  }

  try {
    const userResponse = await githubRequest<GitHubUser>('/user', token.value)
    const target = targetFor(userResponse.data.login)
    const repositories = await listRepositories(token.value)
    const details = await collectRepositoryDetails(token.value, repositories)
    const observations = [
      ...repositories.map((repository) => repositoryObservation(repository, target.id, generatedAt)),
      ...details.branches.map(({ repository, branch }) => branchObservation(repository, branch, target.id, generatedAt)),
      ...details.workflows.map(({ repository, workflow }) => workflowObservation(repository, workflow, target.id, generatedAt)),
      ...details.errors.map((detailError) => detailErrorObservation(detailError, target.id, generatedAt))
    ]

    return {
      target,
      collector: {
        id: collectorId,
        providerId,
        targetId: target.id,
        mode: 'write_capable',
        status: details.errors.length ? 'degraded' : 'connected',
        config: {
          auth: token.source,
          apiVersion,
          repositories: repositories.length,
          branches: details.branches.length,
          workflows: details.workflows.length
        },
        lastRun: generatedAt,
        summary: `${repositories.length} repositories, ${details.branches.length} branches, ${details.workflows.length} workflows`
      },
      deployments: [],
      observations
    }
  } catch (error) {
    const target = targetFor(token.source)
    return {
      target,
      collector: {
        id: collectorId,
        providerId,
        targetId: target.id,
        mode: 'write_capable',
        status: 'degraded',
        config: {
          auth: token.source,
          apiVersion
        },
        lastRun: generatedAt,
        summary: githubErrorSummary(error)
      },
      deployments: [],
      observations: []
    }
  }
}

async function resolveGitHubToken(): Promise<GitHubTokenResolution> {
  if (isSecretStoreReady()) {
    const secret = await getProviderSecret(providerId, tokenSecretKey)
    if (secret) {
      const status = await providerSecretStatus(providerId, tokenSecretKey)
      return {
        value: secret,
        source: 'secret-store',
        fingerprint: status.fingerprint,
        updatedAt: status.updatedAt
      }
    }
  }

  const envToken = stringFromEnv('BUILDER_GITHUB_TOKEN', '')
  if (envToken) {
    return {
      value: envToken,
      source: 'env',
      fingerprint: fingerprintSecret(envToken)
    }
  }

  return {
    source: 'missing'
  }
}

async function listRepositories(token: string) {
  const maxRepositories = numberFromEnv('BUILDER_GITHUB_MAX_REPOSITORIES', 100)
  const repositories: GitHubRepository[] = []
  let page = 1

  while (repositories.length < maxRepositories) {
    const response = await githubRequest<GitHubRepository[]>(
      `/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`,
      token
    )
    repositories.push(...response.data)

    if (!hasNextPage(response.headers) || !response.data.length) {
      break
    }

    page += 1
  }

  return repositories.slice(0, maxRepositories)
}

async function collectRepositoryDetails(token: string, repositories: GitHubRepository[]) {
  const detailLimit = numberFromEnv('BUILDER_GITHUB_DETAIL_REPOSITORIES', 0)
  const branches: Array<{ repository: GitHubRepository, branch: GitHubBranch }> = repositories.map((repository) => ({
    repository,
    branch: {
      name: repository.default_branch
    }
  }))
  const workflowResults = detailLimit > 0
    ? await Promise.all(repositories.slice(0, detailLimit).map(async (repository) => {
    try {
      const workflowResponse = await githubRequest<GitHubWorkflowResponse>(
        `/repos/${encodeURIComponent(repository.owner.login)}/${encodeURIComponent(repository.name)}/actions/workflows?per_page=100`,
        token
      )
      return {
        repository,
        workflows: workflowResponse.data.workflows
      }
    } catch (error) {
      return {
        repository,
        workflows: [],
        error: githubErrorSummary(error)
      }
    }
  }))
    : []

  const workflows = workflowResults.flatMap((result) => {
    return result.workflows.map((workflow) => ({
      repository: result.repository,
      workflow
    }))
  })
  const errors = workflowResults
    .filter((result) => result.error)
    .map((result) => ({
      repository: result.repository,
      surface: 'workflows',
      message: result.error || 'GitHub workflow request failed'
    }))

  return { branches, workflows, errors }
}

async function githubRequest<T>(path: string, token: string): Promise<GitHubApiResult<T>> {
  const url = new URL(path, apiBaseUrl)
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'builder-provider-github',
      'X-GitHub-Api-Version': apiVersion
    },
    signal: AbortSignal.timeout(15_000)
  })

  if (!response.ok) {
    throw await githubResponseError(response)
  }

  return {
    data: await response.json() as T,
    headers: response.headers
  }
}

async function githubResponseError(response: Response) {
  let message = `GitHub API returned ${response.status}`

  try {
    const body = await response.json() as { message?: string }
    if (body.message) {
      message = body.message
    }
  } catch {
    // Keep the generic status message when GitHub sends a non-JSON error body.
  }

  return createError({
    statusCode: response.status,
    statusMessage: message
  })
}

function targetFor(account: string): ProviderTargetScope {
  const slug = account.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
  return {
    id: `target:github:${slug}`,
    name: `GitHub / ${account}`,
    kind: 'git-account',
    description: 'Repository, branch, workflow, and Pages source scope',
    transport: {
      type: 'api',
      label: apiBaseUrl
    },
    labels: {
      provider: providerId,
      account
    }
  }
}

function repositoryObservation(repository: GitHubRepository, targetId: string, observedAt: string): ProviderObservation {
  const payload = {
    repository: repository.full_name,
    url: repository.html_url,
    owner: repository.owner.login,
    name: repository.name,
    private: repository.private,
    visibility: repository.visibility,
    defaultBranch: repository.default_branch,
    language: repository.language,
    archived: repository.archived,
    fork: repository.fork,
    hasPages: Boolean(repository.has_pages),
    pushedAt: repository.pushed_at,
    updatedAt: repository.updated_at,
    permissions: repository.permissions
  }

  return observation(`repository:${repository.full_name}`, targetId, 'repository', `github:${repository.full_name}`, payload, observedAt)
}

function branchObservation(
  repository: GitHubRepository,
  branch: GitHubBranch,
  targetId: string,
  observedAt: string
): ProviderObservation {
  const payload = {
    repository: repository.full_name,
    branch: branch.name,
    sha: branch.commit?.sha,
    protected: Boolean(branch.protected),
    default: branch.name === repository.default_branch
  }

  return observation(
    `branch:${repository.full_name}:${branch.name}`,
    targetId,
    'branch',
    `github:${repository.full_name}:branch:${branch.name}`,
    payload,
    observedAt
  )
}

function workflowObservation(
  repository: GitHubRepository,
  workflow: GitHubWorkflow,
  targetId: string,
  observedAt: string
): ProviderObservation {
  const payload = {
    repository: repository.full_name,
    workflowId: workflow.id,
    name: workflow.name,
    path: workflow.path,
    state: workflow.state,
    url: workflow.html_url,
    badgeUrl: workflow.badge_url,
    updatedAt: workflow.updated_at
  }

  return observation(
    `workflow:${repository.full_name}:${workflow.id}`,
    targetId,
    'workflow',
    `github:${repository.full_name}:workflow:${workflow.id}`,
    payload,
    observedAt
  )
}

function detailErrorObservation(
  error: { repository: GitHubRepository, surface: string, message: string },
  targetId: string,
  observedAt: string
): ProviderObservation {
  return observation(
    `detail-error:${error.repository.full_name}:${error.surface}`,
    targetId,
    'provider-warning',
    `github:${error.repository.full_name}:${error.surface}`,
    {
      repository: error.repository.full_name,
      surface: error.surface,
      message: error.message
    },
    observedAt
  )
}

function observation(
  key: string,
  targetId: string,
  kind: string,
  externalId: string,
  payload: Record<string, unknown>,
  observedAt: string
): ProviderObservation {
  return {
    id: `observation:${providerId}:${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    providerId,
    collectorId,
    targetId,
    externalId,
    kind,
    fingerprint: fingerprint(payload),
    observedAt,
    payload
  }
}

function unsupportedAction(request: DeploymentActionRequest): never {
  throw createError({
    statusCode: 400,
    statusMessage: `Provider ${providerId} does not support deployment action ${request.action}`
  })
}

function hasNextPage(headers: Headers) {
  return (headers.get('link') || '').includes('rel="next"')
}

function rateLimitFromHeaders(headers: Headers) {
  const remaining = headers.get('x-ratelimit-remaining')
  const reset = headers.get('x-ratelimit-reset')

  return {
    remaining: remaining ? Number(remaining) : undefined,
    resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : undefined
  }
}

function githubErrorSummary(error: unknown) {
  if (error && typeof error === 'object') {
    if ('statusMessage' in error && typeof error.statusMessage === 'string') {
      return error.statusMessage
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }
  }

  return 'GitHub API request failed'
}

function stringFromEnv(key: string, fallback: string) {
  return typeof process.env[key] === 'string' ? process.env[key] as string : fallback
}

function numberFromEnv(key: string, fallback: number) {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function fingerprint(value: unknown) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

function fingerprintSecret(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}
