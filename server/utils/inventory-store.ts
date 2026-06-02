import { Surreal } from 'surrealdb'
import type {
  CollectorRun,
  DeploymentEvent,
  InventoryDataset,
  InventoryEntity,
  InventoryInsight,
  InventoryRelation
} from '~~/types/inventory'
import { createSeedInventory } from './seed-inventory'
import { applyProjectOverlay } from './project-store'
import { applyIacBackbone } from './iac-backbone'
import {
  logWarning,
  recordDbFallback
} from './observability-telemetry'

interface SurrealConfig {
  url: string
  namespace: string
  database: string
  username: string
  password: string
}

const databaseTimeoutMs = numberFromEnv('BUILDER_INVENTORY_DB_TIMEOUT_MS', 1_000)
const databaseBackoffMs = numberFromEnv('BUILDER_INVENTORY_DB_BACKOFF_MS', 30_000)

let databaseUnavailableUntil = 0

export async function readInventory(config: SurrealConfig): Promise<InventoryDataset> {
  if (!config.url || !canUseDatabase()) {
    return applyIacBackbone(await applyProjectOverlay(createSeedInventory()))
  }

  const db = new Surreal()

  try {
    await withTimeout(db.connect(config.url, {
      authentication: config.username && config.password
        ? {
            username: config.username,
            password: config.password
          }
        : undefined
    }), databaseTimeoutMs, 'Inventory database connect timed out')

    await withTimeout(db.use({
      namespace: config.namespace,
      database: config.database
    }), databaseTimeoutMs, 'Inventory database select timed out')

    const [entities, relations, deployments, collectors, insights] = await withTimeout(db
      .query<[
        InventoryEntity[],
        InventoryRelation[],
        DeploymentEvent[],
        CollectorRun[],
        InventoryInsight[]
      ]>(`
        SELECT * FROM entity ORDER BY kind, name;
        SELECT * FROM relation ORDER BY type;
        SELECT * FROM deployment ORDER BY deployedAt DESC;
        SELECT * FROM collector ORDER BY kind, name;
        SELECT * FROM insight ORDER BY severity, title;
      `)
      .json()
      .collect(), databaseTimeoutMs, 'Inventory database query timed out')

    await db.close()

    return applyIacBackbone(await applyProjectOverlay({
      generatedAt: new Date().toISOString(),
      mode: collectors.some((collector) => collector.mode === 'write_capable') ? 'mixed' : 'read_only',
      source: 'surrealdb',
      entities: normalizeRows(entities),
      relations: normalizeRows(relations),
      deployments: normalizeRows(deployments),
      collectors: normalizeRows(collectors),
      insights: normalizeRows(insights)
    }))
  } catch (error) {
    markDatabaseUnavailable()
    recordDbFallback('inventory')
    await closeQuietly(db)
    console.warn('[inventory-store] Falling back to seed inventory:', error)
    void logWarning('inventory_database_fallback', {
      error: errorMessage(error)
    })
    return applyIacBackbone(await applyProjectOverlay(createSeedInventory()))
  }
}

function normalizeRows<T extends { id?: unknown, uid?: unknown }>(rows: T[] | undefined): T[] {
  if (!Array.isArray(rows)) {
    return []
  }

  return rows.map((row) => ({
    ...row,
    id: stringifyRecordId(row.uid ?? row.id)
  }))
}

function stringifyRecordId(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object' && 'tb' in value && 'id' in value) {
    const record = value as { tb: string, id: unknown }
    return `${record.tb}:${String(record.id)}`
  }

  return String(value)
}

async function closeQuietly(db: Surreal) {
  try {
    if (db.isConnected) {
      await db.close()
    }
  } catch {
    // Nothing useful to do during fallback.
  }
}

function canUseDatabase() {
  return Date.now() >= databaseUnavailableUntil
}

function markDatabaseUnavailable() {
  databaseUnavailableUntil = Date.now() + databaseBackoffMs
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function numberFromEnv(key: string, fallback: number) {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return String(error)
}
