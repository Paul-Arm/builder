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

interface SurrealConfig {
  url: string
  namespace: string
  database: string
  username: string
  password: string
}

export async function readInventory(config: SurrealConfig): Promise<InventoryDataset> {
  if (!config.url) {
    return applyProjectOverlay(createSeedInventory())
  }

  const db = new Surreal()

  try {
    await db.connect(config.url, {
      authentication: config.username && config.password
        ? {
            username: config.username,
            password: config.password
          }
        : undefined
    })

    await db.use({
      namespace: config.namespace,
      database: config.database
    })

    const [entities, relations, deployments, collectors, insights] = await db
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
      .collect()

    await db.close()

    return applyProjectOverlay({
      generatedAt: new Date().toISOString(),
      mode: collectors.some((collector) => collector.mode === 'write_capable') ? 'mixed' : 'read_only',
      source: 'surrealdb',
      entities: normalizeRows(entities),
      relations: normalizeRows(relations),
      deployments: normalizeRows(deployments),
      collectors: normalizeRows(collectors),
      insights: normalizeRows(insights)
    })
  } catch (error) {
    await closeQuietly(db)
    console.warn('[inventory-store] Falling back to seed inventory:', error)
    return applyProjectOverlay(createSeedInventory())
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
