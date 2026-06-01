import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createError } from 'h3'
import type { LocalFolderPreview, LocalFolderPreviewEntry } from './types'
import type {
  DeploymentActionRequest,
  ProviderObservation,
  ProviderTargetScope
} from '~~/types/providers'
import type { ProviderCollectResult, ProviderPlugin } from '../../server/providers/types'

const providerId = 'local-folder'
const collectorId = 'collector:local-folder:workspace'
const targetId = 'target:local-folder:workspace'

export const localFolderProvider: ProviderPlugin = {
  manifest: {
    id: providerId,
    displayName: 'Local Folder',
    version: '0.1.0',
    description: 'Local filesystem source provider for workspace folders and service paths.',
    types: ['source.folder', 'workspace.local'],
    roles: ['inventory.provider'],
    capabilities: [
      'sources.folders.list',
      'sources.folders.observe',
      'sources.files.watch',
      'sources.folders.preview'
    ],
    ui: {
      component: 'local-folder-panel',
      surfaces: ['provider.panel', 'add.option.panel']
    },
    addOptions: [
      {
        id: 'local-workspace-folder',
        label: 'Workspace folder',
        description: 'Add a local folder as a source workspace.',
        type: 'source.folder',
        capability: 'sources.folders.add',
        configSchema: {
          path: {
            type: 'string',
            title: 'Folder path',
            placeholder: 'C:\\Users\\paulp\\Documents\\my-app'
          }
        }
      },
      {
        id: 'local-service-folder',
        label: 'Service folder',
        description: 'Map a subfolder to a service inside an existing workspace.',
        type: 'workspace.local',
        capability: 'sources.service-folders.add',
        configSchema: {
          path: {
            type: 'string',
            title: 'Service path',
            placeholder: 'apps/backend'
          }
        }
      }
    ],
    nodeOptions: [
      {
        id: 'local-workspace-folder-node',
        label: 'Workspace folder',
        description: 'Create a source folder node from the configured local workspace.',
        type: 'source.folder',
        capability: 'sources.folders.add',
        nodeKind: 'repo',
        defaultProvider: providerId,
        defaultPlatform: 'local-folder',
        tags: ['source', 'local-folder']
      },
      {
        id: 'local-service-folder-node',
        label: 'Service folder',
        description: 'Create a service node mapped to a local folder path.',
        type: 'workspace.local',
        capability: 'sources.service-folders.add',
        nodeKind: 'service',
        defaultProvider: providerId,
        defaultPlatform: 'local-folder',
        tags: ['service', 'local-folder']
      }
    ],
    configSchema: {
      root: {
        type: 'string',
        title: 'Workspace root',
        default: 'process.cwd()'
      }
    }
  },

  async collectRuntime() {
    return collectLocalFolderRuntime()
  },

  async planAction(request) {
    throw unsupportedAction(request)
  },

  async executeAction(request) {
    throw unsupportedAction(request)
  }
}

export async function previewConfiguredLocalFolder(requestedRoot?: string): Promise<LocalFolderPreview> {
  const configuredRoot = resolve(stringFromEnv('BUILDER_LOCAL_SOURCE_ROOT', process.cwd()))
  const root = requestedRoot ? resolve(requestedRoot) : configuredRoot

  if (root !== configuredRoot) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Local folder preview is limited to the configured provider root'
    })
  }

  return previewLocalFolderRoot(configuredRoot)
}

async function collectLocalFolderRuntime(): Promise<ProviderCollectResult> {
  const generatedAt = new Date().toISOString()
  const root = resolve(stringFromEnv('BUILDER_LOCAL_SOURCE_ROOT', process.cwd()))
  const target = targetFor(root)

  try {
    const folderStat = await stat(root)
    const payload = {
      root,
      name: basename(root),
      exists: true,
      modifiedAt: folderStat.mtime.toISOString()
    }

    return {
      target,
      collector: {
        id: collectorId,
        providerId,
        targetId,
        mode: 'write_capable',
        status: 'connected',
        config: {
          root
        },
        lastRun: generatedAt,
        summary: `${basename(root)} workspace folder observed`
      },
      deployments: [],
      observations: [folderObservation(payload, generatedAt)]
    }
  } catch (error) {
    return {
      target,
      collector: {
        id: collectorId,
        providerId,
        targetId,
        mode: 'write_capable',
        status: 'degraded',
        config: {
          root
        },
        lastRun: generatedAt,
        summary: folderErrorSummary(error)
      },
      deployments: [],
      observations: []
    }
  }
}

async function previewLocalFolderRoot(root: string): Promise<LocalFolderPreview> {
  const generatedAt = new Date().toISOString()
  const maxEntries = 80
  const rootStat = await stat(root)

  if (!rootStat.isDirectory()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Local folder root is not a directory'
    })
  }

  const directoryEntries = await readdir(root, { withFileTypes: true })
  const sortedEntries = directoryEntries
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }

      return a.name.localeCompare(b.name)
    })

  const entries: LocalFolderPreviewEntry[] = []
  let fileCount = 0
  let directoryCount = 0

  for (const entry of sortedEntries) {
    if (entry.isDirectory()) {
      directoryCount += 1
    } else if (entry.isFile()) {
      fileCount += 1
    }

    if (entries.length >= maxEntries) {
      continue
    }

    const absolutePath = join(root, entry.name)
    const entryStat = await stat(absolutePath)
    entries.push({
      name: entry.name,
      kind: entry.isDirectory() ? 'directory' : 'file',
      relativePath: entry.name,
      size: entry.isFile() ? entryStat.size : undefined,
      modifiedAt: entryStat.mtime.toISOString()
    })
  }

  return {
    source: 'server',
    rootLabel: basename(root) || root,
    rootPath: root,
    generatedAt,
    fileCount,
    directoryCount,
    truncated: sortedEntries.length > maxEntries,
    entries
  }
}

function targetFor(root: string): ProviderTargetScope {
  return {
    id: targetId,
    name: basename(root) || root,
    kind: 'filesystem',
    description: root,
    transport: {
      type: 'local-fs',
      label: root
    },
    labels: {
      provider: providerId,
      root
    }
  }
}

function folderObservation(payload: Record<string, unknown>, observedAt: string): ProviderObservation {
  return {
    id: `observation:${providerId}:workspace`,
    providerId,
    collectorId,
    targetId,
    externalId: String(payload.root),
    kind: 'folder',
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

function stringFromEnv(key: string, fallback: string) {
  return typeof process.env[key] === 'string' ? process.env[key] as string : fallback
}

function fingerprint(value: unknown) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

function folderErrorSummary(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return `Local folder unavailable: ${String(error.message)}`
  }

  return 'Local folder unavailable'
}
